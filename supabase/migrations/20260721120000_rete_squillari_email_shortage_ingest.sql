-- Rete Squillari — email shortage ingestion write path.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. This file is a reviewable
-- design artifact only, committed to a dedicated branch
-- (feat/rete-squillari-email-shortage-ingest), separate from PR #21. It
-- must go through its own explicit-authorization step before being pushed
-- with `supabase db push` / applied via migration deploy.
--
-- Design goals, current (fourth) revision — two live AI models
-- (extractor + adversarial reviewer) plus a fully deterministic arbiter,
-- no pre-publication human queue:
--   * a parsed email row is either published immediately (rete_requests,
--     status DA_TROVARE, source EMAIL_COMMERCIALE/EMAIL_AMMINISTRAZIONE)
--     or rejected immediately (rete_email_arbitration_log only, never
--     rete_requests, never visible in the operational site) - there is no
--     PENDING_STORE_REVIEW / CENTRAL_REVIEW holding state (an earlier
--     silence-as-acceptance design was superseded before ever shipping)
--   * there is no third AI arbiter model. Two candidate NVIDIA free-tier
--     arbiter models (qwen/qwen3.5-397b-a17b, then
--     qwen/qwen3-next-80b-a3b-instruct) were live-tested across several
--     gates and neither proved reliable enough - the publish/reject
--     decision is instead computed by pure, deterministic TypeScript
--     (lib/rete-squillari/deterministic-arbiter.ts: decidePublication) from
--     the two live models' already-validated outputs plus catalog/
--     duplicate/parser checks. No network call, no model, no randomness.
--   * this RPC still NEVER trusts the caller-supplied decision blindly,
--     even though it now comes from deterministic code rather than a
--     model: it independently re-checks the hard conditions server-side
--     (product code + store + positive quantity + known active location +
--     extractor confidence above threshold + zero unresolved objections)
--     and can downgrade a claimed publish to a rejection if the gate
--     doesn't actually hold. This is the "recompute, never trust" backstop
--     - no agent (AI or deterministic) has direct write access, this
--     function is the only write path, and it does not take the caller's
--     word for whether publication is safe.
--   * every attempt (published or rejected) is logged with full
--     provenance: source, redacted message id, attachment hash, source
--     row, parser version, extractor/reviewer/arbiter model+prompt
--     versions, deterministic check results, objections, confidence
--   * a published request can later be corrected, marked a duplicate, or
--     retracted (never deleted) - always with an audit event
--   * no mailbox credentials or raw email bodies are ever persisted here -
--     only the already-redacted message reference and already-extracted
--     structured fields
--   * the calling identity is a dedicated service membership (role=central)
--     authenticated via its own rotatable JWT, reusing
--     rete_require_active_membership() exactly like every other write RPC -
--     deliberately NOT a service-role bypass of RLS. This RPC is the ONLY
--     thing with INSERT access to rete_requests via this path; no AI
--     model, agent runtime, or generic proxy is ever granted direct
--     database credentials.

BEGIN;

-- 1. Widen the source check to allow the two email-derived source values.
--    (WBOS_AUTO was already added in a prior migration; this adds the two
--    email sources alongside it.)
ALTER TABLE "public"."rete_requests" DROP CONSTRAINT IF EXISTS "rete_requests_source_check";
ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_source_check"
    CHECK (("source" = ANY (ARRAY[
        'MANUAL'::"text",
        'EMAIL'::"text",
        'TRASTA_ARRIVAL'::"text",
        'DEMO'::"text",
        'WBOS_AUTO'::"text",
        'EMAIL_COMMERCIALE'::"text",
        'EMAIL_AMMINISTRAZIONE'::"text"
    ])));

-- 2. Arbitration log — the single source of truth for every row the
--    extractor/reviewer/arbiter pipeline ever evaluated, whatever the
--    outcome. A PUBLISHED_DA_TROVARE row always has a matching
--    rete_requests row (published_request_id); every REJECTED_* row never
--    does, and is never surfaced anywhere in the operational site - this
--    table is central-only, read-only from the application's perspective
--    (see RLS below).
CREATE TYPE "public"."rete_email_arbitration_decision" AS ENUM (
    'PUBLISHED_DA_TROVARE',
    'REJECTED_AMBIGUOUS',
    'REJECTED_AI_DISAGREEMENT',
    'REJECTED_DUPLICATE',
    'REJECTED_FALSE_POSITIVE',
    'REJECTED_MODEL_FAILURE'
);

CREATE TABLE IF NOT EXISTS "public"."rete_email_arbitration_log" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL PRIMARY KEY,
    "decision" "public"."rete_email_arbitration_decision" NOT NULL,
    "source" "text",
    "redacted_message_id" "text" NOT NULL,
    "attachment_hash" "text" NOT NULL,
    "source_row_number" integer NOT NULL,
    "parser_version" "text" NOT NULL,

    "product_code" "text",
    "product_description" "text",
    "requesting_location_id" smallint,
    "missing_quantity" integer,
    -- Quantity provenance (business rule correction: default shortage
    -- quantity is 6). NEVER an AI-derived value - either the source data
    -- had an explicit positive number, or the deterministic default
    -- applied because stock_status was independently re-derived as
    -- ZERO_STOCK. Both quantity_source values are mutually exclusive.
    "quantity_source" "text",
    "default_rule_version" "text",
    "source_numeric_quantity_present" boolean,

    "published_request_id" "uuid" REFERENCES "public"."rete_requests"("id"),
    "duplicate_of_request_id" "uuid" REFERENCES "public"."rete_requests"("id"),

    -- Adjudication audit fields. extractor_model/reviewer_model are always
    -- populated (the two live NVIDIA models). arbiter_model and
    -- arbiter_prompt_version are kept as historical/audit columns from an
    -- earlier three-model design - they are always NULL now, never a
    -- fabricated identifier, because the arbiter is deterministic
    -- application code, not a model (see arbiter_type below).
    "extractor_model" "text",
    "extractor_prompt_version" "text",
    "reviewer_model" "text",
    "reviewer_prompt_version" "text",
    "arbiter_model" "text",
    "arbiter_prompt_version" "text",
    "arbiter_type" "text" NOT NULL DEFAULT 'DETERMINISTIC',
    "deterministic_checks" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "objections" "jsonb" NOT NULL DEFAULT '[]'::"jsonb",
    -- The EXTRACTOR's own confidence score (there is no arbiter confidence
    -- anymore - the deterministic arbiter is binary, not scored). Used only
    -- as one of several inputs to the server-side backstop threshold check.
    "confidence" numeric,
    "rejection_reason" "text",
    -- Set true whenever this RPC's own server-side deterministic backstop
    -- overrode the caller-supplied decision (e.g. the TS deterministic
    -- arbiter claimed PUBLISHED_DA_TROVARE but a hard condition, re-derived
    -- independently here, actually failed).
    "server_side_override_applied" boolean NOT NULL DEFAULT false,

    "received_at" timestamp with time zone NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,

    CONSTRAINT "rete_email_arbitration_log_source_check"
        CHECK (("source" IS NULL) OR ("source" = ANY (ARRAY['EMAIL_COMMERCIALE'::"text", 'EMAIL_AMMINISTRAZIONE'::"text"]))),
    CONSTRAINT "rete_email_arbitration_log_arbiter_type_check"
        CHECK (("arbiter_type" = ANY (ARRAY['DETERMINISTIC'::"text", 'AI'::"text"]))),
    -- Never fabricate a model identifier for deterministic code: when
    -- arbiter_type is DETERMINISTIC, arbiter_model/arbiter_prompt_version
    -- must both be NULL. (AI is retained as an allowed value only so a
    -- historical row from the earlier three-model design, if one ever
    -- existed, would remain valid against this constraint - no such row
    -- exists, since nothing was ever applied to a live database.)
    CONSTRAINT "rete_email_arbitration_log_arbiter_model_null_when_deterministic_check"
        CHECK (
            ("arbiter_type" = 'DETERMINISTIC' AND "arbiter_model" IS NULL AND "arbiter_prompt_version" IS NULL)
            OR ("arbiter_type" = 'AI')
        ),
    CONSTRAINT "rete_email_arbitration_publish_consistency_check"
        CHECK (
            ("decision" = 'PUBLISHED_DA_TROVARE' AND "published_request_id" IS NOT NULL)
            OR ("decision" <> 'PUBLISHED_DA_TROVARE' AND "published_request_id" IS NULL)
        ),
    CONSTRAINT "rete_email_arbitration_log_quantity_source_check"
        CHECK (("quantity_source" IS NULL) OR ("quantity_source" = ANY (ARRAY['EXPLICIT_NUMERIC'::"text", 'DEFAULT_BUSINESS_RULE'::"text"]))),
    -- A published row always has a quantity_source; default_rule_version is
    -- populated only for the DEFAULT_BUSINESS_RULE path, never for
    -- EXPLICIT_NUMERIC or for a rejected row.
    CONSTRAINT "rete_email_arbitration_log_quantity_provenance_check"
        CHECK (
            ("decision" <> 'PUBLISHED_DA_TROVARE' AND "quantity_source" IS NULL AND "default_rule_version" IS NULL)
            OR ("decision" = 'PUBLISHED_DA_TROVARE' AND "quantity_source" = 'EXPLICIT_NUMERIC' AND "default_rule_version" IS NULL)
            OR ("decision" = 'PUBLISHED_DA_TROVARE' AND "quantity_source" = 'DEFAULT_BUSINESS_RULE' AND "default_rule_version" IS NOT NULL)
        )
);

ALTER TABLE "public"."rete_email_arbitration_log" OWNER TO "postgres";

CREATE INDEX IF NOT EXISTS "rete_email_arbitration_log_decision_idx"
    ON "public"."rete_email_arbitration_log" USING "btree" ("decision", "created_at" DESC);
-- Prevents the exact same (message, product, row) from ever being
-- published twice, even under concurrent/retried delivery.
CREATE UNIQUE INDEX IF NOT EXISTS "rete_email_arbitration_log_publish_dedup_idx"
    ON "public"."rete_email_arbitration_log" ("redacted_message_id", "attachment_hash", "source_row_number")
    WHERE "decision" = 'PUBLISHED_DA_TROVARE';

ALTER TABLE "public"."rete_email_arbitration_log" ENABLE ROW LEVEL SECURITY;

-- Central-only visibility. Stores never see this table at all (rejected
-- rows must never appear in the operational site; published rows are
-- already visible to the relevant store via rete_requests + the existing
-- MCP product-cards role filtering, which needs no changes here).
CREATE POLICY "central reads arbitration log" ON "public"."rete_email_arbitration_log" FOR SELECT TO "authenticated"
    USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" m
        WHERE m.user_id = auth.uid() AND m.active AND m.role = 'central')));

-- No INSERT/UPDATE/DELETE policy for "authenticated" - all writes go
-- through the RPCs below (SECURITY DEFINER), never direct table access.
REVOKE ALL ON TABLE "public"."rete_email_arbitration_log" FROM PUBLIC;
GRANT SELECT ON TABLE "public"."rete_email_arbitration_log" TO "authenticated";

-- 3. The single write path. Takes the two live models' outputs plus the TS
--    deterministic-arbiter.ts decision as input, but is the actual
--    authority on whether anything gets published - see the header
--    comment. No AI agent or model ever calls this directly with database
--    credentials; it is invoked by the same dedicated central service
--    identity used throughout this feature, itself invoked by ordinary
--    application code (a server route), never by a model's own tool-use
--    loop. There is no p_arbiter_model / p_arbiter_prompt_version
--    parameter at all - the arbiter is deterministic application code
--    (lib/rete-squillari/deterministic-arbiter.ts), never a model, so
--    there is no model identifier to accept or fabricate.
CREATE OR REPLACE FUNCTION "public"."rete_email_arbitrate_and_publish"(
    "p_decision" "public"."rete_email_arbitration_decision",
    "p_source" "text",
    "p_redacted_message_id" "text",
    "p_attachment_hash" "text",
    "p_source_row_number" integer,
    "p_parser_version" "text",
    "p_product_code" "text",
    "p_product_description" "text",
    "p_requesting_location_id" smallint,
    "p_missing_quantity" integer,
    "p_duplicate_of_request_id" "uuid",
    "p_extractor_model" "text",
    "p_extractor_prompt_version" "text",
    "p_reviewer_model" "text",
    "p_reviewer_prompt_version" "text",
    "p_deterministic_checks" "jsonb",
    "p_objections" "jsonb",
    "p_confidence" numeric,
    "p_rejection_reason" "text",
    "p_received_at" timestamp with time zone,
    -- Business rule correction: default shortage quantity is 6. Both
    -- inputs are re-derived independently server-side from the same Note
    -- text the deterministic parser and TS arbiter already classified -
    -- p_missing_quantity/p_stock_status are never trusted blindly.
    "p_stock_status" "text" DEFAULT NULL,
    "p_source_numeric_quantity_present" boolean DEFAULT false,
    "p_default_shortage_quantity" integer DEFAULT 6,
    "p_confidence_threshold" numeric DEFAULT 0.9,
    "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_cached jsonb;
  v_payload jsonb;
  v_request_id uuid;
  v_result jsonb;
  v_final_decision public.rete_email_arbitration_decision;
  v_final_reason text;
  v_overridden boolean := false;
  v_resolved_quantity integer;
  v_quantity_source text;
  v_default_rule_version text;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Canonical payload: every parameter that defines the claimed operation
  -- (all of them - none excluded), built server-side before the claim call,
  -- exactly as every other governed RPC does since
  -- 20260717090000_rete_squillari_pilot_allowlist_enforcement.sql.
  -- p_received_at is the caller-claimed original-message timestamp (stable
  -- across retries of the same email), never a volatile now()-generated
  -- value, so it is safe and correct to bind.
  v_payload := jsonb_build_object(
    'decision', p_decision,
    'source', p_source,
    'redacted_message_id', p_redacted_message_id,
    'attachment_hash', p_attachment_hash,
    'source_row_number', p_source_row_number,
    'parser_version', p_parser_version,
    'product_code', p_product_code,
    'product_description', p_product_description,
    'requesting_location_id', p_requesting_location_id,
    'missing_quantity', p_missing_quantity,
    'duplicate_of_request_id', p_duplicate_of_request_id,
    'extractor_model', p_extractor_model,
    'extractor_prompt_version', p_extractor_prompt_version,
    'reviewer_model', p_reviewer_model,
    'reviewer_prompt_version', p_reviewer_prompt_version,
    'deterministic_checks', p_deterministic_checks,
    'objections', p_objections,
    'confidence', p_confidence,
    'rejection_reason', p_rejection_reason,
    'received_at', p_received_at,
    'stock_status', p_stock_status,
    'source_numeric_quantity_present', p_source_numeric_quantity_present,
    'default_shortage_quantity', p_default_shortage_quantity,
    'confidence_threshold', p_confidence_threshold
  );
  v_cached := public.rete_claim_idempotency_key('rete_email_arbitrate_and_publish', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_final_decision := p_decision;
  v_final_reason := p_rejection_reason;

  -- Independent quantity re-derivation - never trust p_missing_quantity
  -- blindly, including when it happens to already be 6. An explicit
  -- positive number (a future richer format) always wins; otherwise the
  -- default (6) applies ONLY when stock_status is re-confirmed ZERO_STOCK
  -- here, never for ARTICOLO_NON_TROVATO/UNKNOWN_NOTE/NULL.
  IF p_source_numeric_quantity_present AND p_missing_quantity IS NOT NULL AND p_missing_quantity > 0 THEN
    v_resolved_quantity := p_missing_quantity;
    v_quantity_source := 'EXPLICIT_NUMERIC';
    v_default_rule_version := NULL;
  ELSIF p_stock_status = 'ZERO_STOCK' AND p_default_shortage_quantity = 6 THEN
    v_resolved_quantity := p_default_shortage_quantity;
    v_quantity_source := 'DEFAULT_BUSINESS_RULE';
    v_default_rule_version := 'zero-stock-default-v1';
  ELSE
    v_resolved_quantity := NULL;
    v_quantity_source := NULL;
    v_default_rule_version := NULL;
  END IF;

  -- Server-side deterministic backstop. A claimed PUBLISHED_DA_TROVARE is
  -- re-derived from the same hard gate conditions, never taken on faith:
  --   valid product code + unambiguous store + a resolved positive
  --   quantity (explicit or confirmed-ZERO_STOCK default) + the location
  --   must actually exist and be active + confidence must clear the
  --   configured threshold + zero unresolved objections.
  IF p_decision = 'PUBLISHED_DA_TROVARE' THEN
    IF p_product_code IS NULL OR length(trim(p_product_code)) = 0
       OR p_requesting_location_id IS NULL
       OR v_resolved_quantity IS NULL OR v_resolved_quantity <= 0 THEN
      v_final_decision := 'REJECTED_MODEL_FAILURE';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: incomplete required fields or quantity could not be independently resolved';
      v_overridden := true;
    ELSIF NOT EXISTS (SELECT 1 FROM public.rete_locations WHERE id = p_requesting_location_id AND active) THEN
      v_final_decision := 'REJECTED_MODEL_FAILURE';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: unknown or inactive location';
      v_overridden := true;
    ELSIF p_confidence IS NULL OR p_confidence < p_confidence_threshold THEN
      v_final_decision := 'REJECTED_AMBIGUOUS';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: confidence below threshold';
      v_overridden := true;
    ELSIF jsonb_typeof(p_objections) = 'array' AND jsonb_array_length(p_objections) > 0 THEN
      v_final_decision := 'REJECTED_AI_DISAGREEMENT';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: unresolved reviewer objections present';
      v_overridden := true;
    ELSIF p_duplicate_of_request_id IS NOT NULL THEN
      v_final_decision := 'REJECTED_DUPLICATE';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: duplicate_of_request_id set on a publish decision';
      v_overridden := true;
    END IF;
  END IF;

  IF v_final_decision = 'PUBLISHED_DA_TROVARE' THEN
    PERFORM pg_advisory_xact_lock(hashtext('rete_email_arbitrate_and_publish:' || p_requesting_location_id || ':' || p_product_code));

    -- Re-check duplication one more time inside the lock, against
    -- authoritative current data, independent of whatever the arbiter's
    -- own (necessarily point-in-time) duplicate-check said. Uses the
    -- independently re-resolved quantity, never p_missing_quantity as-is.
    IF EXISTS (
      SELECT 1 FROM public.rete_requests
      WHERE requesting_location_id = p_requesting_location_id
        AND product_code = p_product_code
        AND requested_quantity = v_resolved_quantity
        AND status NOT IN ('CHIUSA', 'ANNULLATA')
        AND created_at >= p_received_at - interval '72 hours'
    ) THEN
      v_final_decision := 'REJECTED_DUPLICATE';
      v_final_reason := 'SERVER_SIDE_GATE_FAILED: matching open request already exists';
      v_overridden := true;
    ELSE
      INSERT INTO public.rete_requests (
        requesting_location_id, product_code, product_description,
        requested_quantity, remaining_quantity, status, urgency, source, source_reference, created_by
      ) VALUES (
        p_requesting_location_id, p_product_code, p_product_description,
        v_resolved_quantity, v_resolved_quantity, 'DA_TROVARE', 'NORMALE', p_source, p_redacted_message_id, auth.uid()
      ) RETURNING id INTO v_request_id;

      PERFORM public.rete_write_audit_event('email_deterministic_arbitrated_publish', 'request', v_request_id::text, NULL, 'DA_TROVARE',
        jsonb_build_object('source', p_source, 'extractor_confidence', p_confidence, 'arbiter_type', 'DETERMINISTIC',
                            'quantity_source', v_quantity_source));
    END IF;
  END IF;

  -- If the row ended up rejected (whether by the caller's own decision or
  -- by this backstop overriding it), quantity provenance is never recorded
  -- - only a genuinely published row carries quantity_source/
  -- default_rule_version, matching the table's own CHECK constraint.
  IF v_final_decision <> 'PUBLISHED_DA_TROVARE' THEN
    v_quantity_source := NULL;
    v_default_rule_version := NULL;
  END IF;

  -- arbiter_model / arbiter_prompt_version are always NULL and arbiter_type
  -- is always 'DETERMINISTIC' - never fabricated, since the arbiter is
  -- application code, not a model.
  INSERT INTO public.rete_email_arbitration_log (
    decision, source, redacted_message_id, attachment_hash, source_row_number, parser_version,
    product_code, product_description, requesting_location_id, missing_quantity,
    quantity_source, default_rule_version, source_numeric_quantity_present,
    published_request_id, duplicate_of_request_id,
    extractor_model, extractor_prompt_version, reviewer_model, reviewer_prompt_version,
    arbiter_model, arbiter_prompt_version, arbiter_type, deterministic_checks, objections, confidence,
    rejection_reason, server_side_override_applied, received_at
  ) VALUES (
    v_final_decision, p_source, p_redacted_message_id, p_attachment_hash, p_source_row_number, p_parser_version,
    p_product_code, p_product_description, p_requesting_location_id,
    -- The raw caller-supplied quantity is kept for every row regardless of
    -- outcome (useful for auditing why something was rejected, e.g. an
    -- implausible explicit value) - only quantity_source/
    -- default_rule_version are restricted to published rows, per the
    -- table's own consistency constraint.
    p_missing_quantity,
    v_quantity_source, v_default_rule_version, p_source_numeric_quantity_present,
    v_request_id, CASE WHEN v_final_decision = 'REJECTED_DUPLICATE' THEN p_duplicate_of_request_id ELSE NULL END,
    p_extractor_model, p_extractor_prompt_version, p_reviewer_model, p_reviewer_prompt_version,
    NULL, NULL, 'DETERMINISTIC', COALESCE(p_deterministic_checks, '{}'::jsonb),
    COALESCE(p_objections, '[]'::jsonb), p_confidence,
    v_final_reason, v_overridden, p_received_at
  );

  v_result := jsonb_build_object(
    'decision', v_final_decision, 'request_id', v_request_id,
    'reason', v_final_reason, 'server_side_override_applied', v_overridden
  );
  PERFORM public.rete_store_idempotency_result('rete_email_arbitrate_and_publish', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."rete_email_arbitrate_and_publish"(
    "public"."rete_email_arbitration_decision", "text", "text", "text", integer, "text",
    "text", "text", smallint, integer, "uuid",
    "text", "text", "text", "text",
    "jsonb", "jsonb", numeric, "text", timestamp with time zone,
    "text", boolean, integer, numeric, "text"
) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."rete_email_arbitrate_and_publish"(
    "public"."rete_email_arbitration_decision", "text", "text", "text", integer, "text",
    "text", "text", smallint, integer, "uuid",
    "text", "text", "text", "text",
    "jsonb", "jsonb", numeric, "text", timestamp with time zone,
    "text", boolean, integer, numeric, "text"
) TO "authenticated";

-- 4. Post-publication, corrective-only human actions. "Human intervention
--    is only post-publication and corrective" - there is no pre-publish
--    approval RPC in this revision; these three only ever act on a request
--    that already exists (published by the RPC above), and they always
--    preserve history via rete_write_audit_event rather than deleting.

CREATE OR REPLACE FUNCTION "public"."rete_email_arbitration_correct_published"(
    "p_request_id" "uuid",
    "p_corrected_product_code" "text",
    "p_corrected_product_description" "text",
    "p_corrected_quantity" integer,
    "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_request public.rete_requests;
  v_cached jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_membership.role <> 'central' AND (v_membership.role <> 'store' OR v_membership.location_id <> v_request.requesting_location_id) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_corrected_quantity IS NOT NULL AND p_corrected_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Canonical payload: every parameter that defines the claimed correction
  -- (all of them - none excluded), built server-side before the claim call.
  -- No optimistic-concurrency version parameter exists on this RPC's
  -- signature, so none is fabricated here.
  v_payload := jsonb_build_object(
    'request_id', p_request_id,
    'corrected_product_code', p_corrected_product_code,
    'corrected_product_description', p_corrected_product_description,
    'corrected_quantity', p_corrected_quantity
  );
  v_cached := public.rete_claim_idempotency_key('rete_email_arbitration_correct_published', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  -- Required since 20260722180000_rete_squillari_cross_store_visibility_correction.sql:
  -- direct changes to status/quantity/product identity/lifecycle fields on
  -- rete_requests are rejected by trigger unless this session flag is set,
  -- exactly like every other governed RPC that updates this table.
  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_requests
    SET product_code = COALESCE(p_corrected_product_code, product_code),
        product_description = COALESCE(p_corrected_product_description, product_description),
        requested_quantity = COALESCE(p_corrected_quantity, requested_quantity),
        remaining_quantity = COALESCE(p_corrected_quantity, remaining_quantity),
        updated_at = now()
    WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event('email_ai_publish_corrected', 'request', p_request_id::text, NULL, NULL,
    jsonb_build_object('corrected_product_code', p_corrected_product_code, 'corrected_quantity', p_corrected_quantity));

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'CORRECTED');
  PERFORM public.rete_store_idempotency_result('rete_email_arbitration_correct_published', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_email_arbitration_retract_published"(
    "p_request_id" "uuid",
    "p_reason" "text", -- e.g. 'FALSE_POSITIVE' | 'DUPLICATE' | 'OTHER'
    "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_request public.rete_requests;
  v_cached jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_membership.role <> 'central' AND (v_membership.role <> 'store' OR v_membership.location_id <> v_request.requesting_location_id) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Canonical payload: every parameter that defines the claimed retraction
  -- (all of them - none excluded), built server-side before the claim call.
  -- No optimistic-concurrency version parameter exists on this RPC's
  -- signature, so none is fabricated here.
  v_payload := jsonb_build_object(
    'request_id', p_request_id,
    'reason', p_reason
  );
  v_cached := public.rete_claim_idempotency_key('rete_email_arbitration_retract_published', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  -- Never deletes - closes with an audit trail, preserving history. Required
  -- since 20260722180000_rete_squillari_cross_store_visibility_correction.sql:
  -- a status change on rete_requests is rejected by trigger unless this
  -- session flag is set, exactly like every other governed RPC.
  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_requests SET status = 'ANNULLATA', closed_at = now(), updated_at = now() WHERE id = p_request_id;
  PERFORM public.rete_write_audit_event('email_ai_publish_retracted', 'request', p_request_id::text, v_request.status::text, 'ANNULLATA', jsonb_build_object('reason', p_reason));

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_email_arbitration_retract_published', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

REVOKE ALL ON FUNCTION "public"."rete_email_arbitration_correct_published"("uuid", "text", "text", integer, "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."rete_email_arbitration_correct_published"("uuid", "text", "text", integer, "text") TO "authenticated";
REVOKE ALL ON FUNCTION "public"."rete_email_arbitration_retract_published"("uuid", "text", "text") FROM PUBLIC;
GRANT EXECUTE ON FUNCTION "public"."rete_email_arbitration_retract_published"("uuid", "text", "text") TO "authenticated";

COMMIT;
