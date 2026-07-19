-- Migration 5: rete_squillari_open_to_offers_pilot_extension
--
-- Additive extension for the WBOS open-to-offers pilot. Does not modify or
-- remove anything from the four existing migrations: all four enums, all
-- seven tables, all nine existing RPCs, all existing RLS policies, the
-- idempotency ledger, the pilot allowlist, and the Trasta-hub arrival flow
-- continue to work exactly as before. This migration only ADDS the specific
-- capabilities the WBOS domain model (scripts/active_transfer_opportunity_
-- filter.py + scripts/open_to_offers_model.py, merged via WBOS PR #30) needs
-- and this schema does not yet have:
--
--   1. requesting-store confirmation for system-generated suggestions
--      (reuses the existing, previously-unused 'DA_CONFERMARE' enum value);
--   2. store-side manual request creation (a new RPC; the existing
--      rete_request_publish stays central-only, unchanged);
--   3. requesting-store cancellation / no-longer-needed;
--   4. explicit receipt-discrepancy recording and resolution;
--   5. transactional automatic-publication budget accounting;
--   6. immutable audit actions for all of the above (rete_audit_events'
--      event_type is free text with only a length check - no schema change
--      needed there, only new event_type string values used by new RPCs);
--   7. WBOS-suggestion ingestion resolves the requesting store directly via
--      rete_locations.id, since id already IS the WBOS canonical retail
--      location ID (Malta=2, Sestri=4, Cantore=5, Trento=6, De Ferrari=7,
--      Armenia=8 - see 20260719130000_rete_squillari_canonical_location_
--      reconciliation.sql for how this was established and reconciled).
--      No separate translation column exists or is needed.
--
-- Nothing in this migration is applied to the remote project. It is
-- replayed exclusively against the local Supabase stack via
-- `supabase db reset --local`. No pilot store is activated by this
-- migration - pilot_enabled stays exactly as it already is for every
-- existing membership row.
--
-- Rollback: purely additive (new columns, new/replaced functions, one
-- replaced RLS policy - no destructive DDL against any pre-existing
-- object), so reverting never requires restoring deleted data. Full
-- step-by-step rollback plan (restore the original RLS policy, restore
-- the original 4-arg rete_transfer_receive, drop the 9 new/extended
-- functions, drop the new columns, restore the original source check
-- constraint) is documented in
-- docs/RETE_SQUILLARI_OPEN_TO_OFFERS_EXTENSION.md under "Rollback".

-- =============================================================================
-- 1. WBOS location resolution
-- =============================================================================
-- rete_locations.id already IS the WBOS canonical retail location ID for
-- all six stores (established and reconciled in
-- 20260719130000_rete_squillari_canonical_location_reconciliation.sql - see
-- that migration for the root-cause history). No mapping column is added
-- here: a column that only ever duplicates id would be a redundant
-- indirection, not a real compatibility boundary. rete_wbos_suggestion_
-- ingest() below resolves the requesting store with
-- "WHERE id = p_requesting_location_wbos_id AND active" directly.

-- =============================================================================
-- 2. New columns on rete_requests for the WBOS suggestion lifecycle
-- =============================================================================

ALTER TABLE "public"."rete_requests"
    ADD COLUMN IF NOT EXISTS "operational_request_key" "text",
    ADD COLUMN IF NOT EXISTS "score" numeric,
    ADD COLUMN IF NOT EXISTS "score_version" "text",
    ADD COLUMN IF NOT EXISTS "source_document_date" "date",
    ADD COLUMN IF NOT EXISTS "hard_exclusion_reason" "text",
    ADD COLUMN IF NOT EXISTS "warning_codes" "text"[] DEFAULT '{}'::"text"[],
    ADD COLUMN IF NOT EXISTS "requires_central_confirmation" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "confirmed_by" "uuid",
    ADD COLUMN IF NOT EXISTS "confirmed_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cancelled_by" "uuid",
    ADD COLUMN IF NOT EXISTS "cancelled_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "cancel_reason" "text",
    ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_operational_request_key_key" UNIQUE ("operational_request_key");

ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_cancel_reason_check"
    CHECK (("cancel_reason" IS NULL) OR (("length"("cancel_reason") >= 1) AND ("length"("cancel_reason") <= 2000)));

ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_confirmed_by_fkey" FOREIGN KEY ("confirmed_by") REFERENCES "auth"."users"("id");
ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "auth"."users"("id");

COMMENT ON COLUMN "public"."rete_requests"."operational_request_key" IS
    'Idempotent dedup key for WBOS-sourced suggestions: requesting_location_id + internal_code + active_business_period (WBOS make_active_request_identity()). NULL for MANUAL/EMAIL/TRASTA_ARRIVAL/DEMO-sourced requests, which have no such upstream identity. UNIQUE so a repeat WBOS ingestion attempt for the same operational identity can never create a duplicate row.';
COMMENT ON COLUMN "public"."rete_requests"."requires_central_confirmation" IS
    'Set at creation time by the caller (WBOS-side general-shortage/warning logic, or a future manual-request caller) - never computed inside this database, since the four-high-volume-store exclusion rule and equivalent business logic live in scripts/active_transfer_opportunity_filter.py, not SQL. This flag only gates rete_request_central_confirm(); it is never silently cleared by any other RPC.';
COMMENT ON COLUMN "public"."rete_requests"."version" IS
    'Optimistic concurrency token, mirroring WBOS''s in-memory domain model. Incremented by exactly 1 on every governed mutation. Every governed RPC that accepts p_expected_version rejects a stale caller rather than silently overwriting.';

-- Widen the source check to allow the WBOS automatic-suggestion source
-- value, additively - existing values (MANUAL, EMAIL, TRASTA_ARRIVAL, DEMO)
-- are all still accepted, nothing already stored can violate the new check.
ALTER TABLE "public"."rete_requests" DROP CONSTRAINT "rete_requests_source_check";
ALTER TABLE "public"."rete_requests"
    ADD CONSTRAINT "rete_requests_source_check"
    CHECK (("source" = ANY (ARRAY['MANUAL'::"text", 'EMAIL'::"text", 'TRASTA_ARRIVAL'::"text", 'DEMO'::"text", 'WBOS_AUTO'::"text"])));

CREATE INDEX IF NOT EXISTS "rete_requests_source_status_idx" ON "public"."rete_requests" USING "btree" ("source", "status");

-- =============================================================================
-- 3. New columns on rete_transfers for explicit receipt-discrepancy handling
-- =============================================================================

ALTER TABLE "public"."rete_transfers"
    ADD COLUMN IF NOT EXISTS "discrepancy_type" "text",
    ADD COLUMN IF NOT EXISTS "discrepancy_acknowledged" boolean NOT NULL DEFAULT false,
    ADD COLUMN IF NOT EXISTS "discrepancy_resolved_by" "uuid",
    ADD COLUMN IF NOT EXISTS "discrepancy_resolved_at" timestamp with time zone,
    ADD COLUMN IF NOT EXISTS "discrepancy_resolution_note" "text",
    ADD COLUMN IF NOT EXISTS "version" integer NOT NULL DEFAULT 0;

ALTER TABLE "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_discrepancy_type_check"
    CHECK (("discrepancy_type" IS NULL) OR ("discrepancy_type" = ANY (ARRAY['SHORT'::"text", 'DAMAGED'::"text", 'OTHER'::"text"])));
ALTER TABLE "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_discrepancy_resolution_note_check"
    CHECK (("discrepancy_resolution_note" IS NULL) OR (("length"("discrepancy_resolution_note") >= 1) AND ("length"("discrepancy_resolution_note") <= 2000)));
ALTER TABLE "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_discrepancy_resolved_by_fkey" FOREIGN KEY ("discrepancy_resolved_by") REFERENCES "auth"."users"("id");

-- The genuinely load-bearing safety property: a discrepancy can only ever be
-- "acknowledged" once the discrepancy actually happened (received_quantity
-- IS NOT NULL) and only when it is a real discrepancy (received_quantity <>
-- quantity). Prevents the acknowledgment fields from ever being used to
-- pre-emptively "clear" a transfer that hasn't been received yet, or to mark
-- a clean receipt as "acknowledged" for no reason.
ALTER TABLE "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_discrepancy_ack_requires_discrepancy_check"
    CHECK (
        (NOT "discrepancy_acknowledged")
        OR (
            "received_quantity" IS NOT NULL
            AND "received_quantity" <> "quantity"
        )
    );

COMMENT ON COLUMN "public"."rete_transfers"."discrepancy_acknowledged" IS
    'Set only by rete_transfer_resolve_discrepancy() (central-only). A transfer with received_quantity <> quantity and discrepancy_acknowledged = false blocks its request from reaching CHIUSA - see the updated rete_request_recompute_status() below.';

-- =============================================================================
-- 4. Extend the protected-column guard trigger for every new governed field
-- =============================================================================
-- Same trusted_rpc transaction-local flag mechanism as the existing trigger
-- (migration 3). Extending, not replacing: the original three column groups
-- stay guarded exactly as before; this only adds the new column groups.

CREATE OR REPLACE FUNCTION "public"."rete_guard_protected_columns"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  IF current_setting('rete.trusted_rpc', true) IS DISTINCT FROM 'on' THEN
    IF TG_TABLE_NAME = 'rete_requests' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.remaining_quantity IS DISTINCT FROM OLD.remaining_quantity
         OR NEW.closed_at IS DISTINCT FROM OLD.closed_at
         OR NEW.confirmed_by IS DISTINCT FROM OLD.confirmed_by
         OR NEW.confirmed_at IS DISTINCT FROM OLD.confirmed_at
         OR NEW.cancelled_by IS DISTINCT FROM OLD.cancelled_by
         OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at
         OR NEW.cancel_reason IS DISTINCT FROM OLD.cancel_reason
         OR NEW.requires_central_confirmation IS DISTINCT FROM OLD.requires_central_confirmation
         OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'rete_requests: status, remaining_quantity, closed_at, confirmation/cancellation fields and version can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_offers' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.approved_quantity IS DISTINCT FROM OLD.approved_quantity
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by THEN
        RAISE EXCEPTION 'rete_offers: status, approved_quantity and approved_by can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_transfers' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.received_quantity IS DISTINCT FROM OLD.received_quantity
         OR NEW.received_at IS DISTINCT FROM OLD.received_at
         OR NEW.received_by IS DISTINCT FROM OLD.received_by
         OR NEW.prepared_at IS DISTINCT FROM OLD.prepared_at
         OR NEW.departed_at IS DISTINCT FROM OLD.departed_at
         OR NEW.discrepancy_type IS DISTINCT FROM OLD.discrepancy_type
         OR NEW.discrepancy_acknowledged IS DISTINCT FROM OLD.discrepancy_acknowledged
         OR NEW.discrepancy_resolved_by IS DISTINCT FROM OLD.discrepancy_resolved_by
         OR NEW.discrepancy_resolved_at IS DISTINCT FROM OLD.discrepancy_resolved_at
         OR NEW.discrepancy_resolution_note IS DISTINCT FROM OLD.discrepancy_resolution_note
         OR NEW.version IS DISTINCT FROM OLD.version THEN
        RAISE EXCEPTION 'rete_transfers: status, receipt/prep/departure fields, discrepancy fields and version can only change via a governed operation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

-- =============================================================================
-- 5. rete_request_recompute_status(): add the discrepancy-blocks-closure rule
-- =============================================================================
-- Additive change to the existing function's CHIUSA condition only. Every
-- other branch (IN_TRASFERIMENTO, DA_PREPARARE, "leave as-is") is untouched.
-- A request whose transfers are all RICEVUTA but at least one has an
-- unresolved discrepancy now stays exactly where it already was (it never
-- reached CHIUSA before this migration either, since received_quantity <>
-- quantity was previously invisible to this function) - this is a strict
-- narrowing of when CHIUSA is reached, never a widening, so no existing
-- pilot data that has already legitimately reached CHIUSA is affected
-- (recompute never moves a request backward, per the existing comment).

CREATE OR REPLACE FUNCTION "public"."rete_request_recompute_status"("p_request_id" "uuid")
RETURNS void
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_request public.rete_requests;
  v_transfer_count integer;
  v_received_count integer;
  v_departed_count integer;
  v_unresolved_discrepancy_count integer;
BEGIN
  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  IF v_request.status IN ('CHIUSA', 'ANNULLATA') THEN
    RETURN;
  END IF;

  SELECT count(*) FILTER (WHERE status <> 'ANNULLATA'),
         count(*) FILTER (WHERE status = 'RICEVUTA'),
         count(*) FILTER (WHERE status IN ('IN_TRASFERIMENTO', 'RICEVUTA')),
         count(*) FILTER (WHERE status = 'RICEVUTA' AND received_quantity IS NOT NULL
                           AND received_quantity <> quantity AND NOT discrepancy_acknowledged)
    INTO v_transfer_count, v_received_count, v_departed_count, v_unresolved_discrepancy_count
  FROM public.rete_transfers
  WHERE request_id = p_request_id;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  IF v_transfer_count > 0 AND v_received_count = v_transfer_count AND v_request.remaining_quantity = 0
     AND v_unresolved_discrepancy_count = 0 THEN
    UPDATE public.rete_requests SET status = 'CHIUSA', closed_at = now() WHERE id = p_request_id;
  ELSIF v_departed_count > 0 THEN
    UPDATE public.rete_requests SET status = 'IN_TRASFERIMENTO' WHERE id = p_request_id;
  ELSIF v_transfer_count > 0 AND v_request.remaining_quantity = 0 THEN
    UPDATE public.rete_requests SET status = 'DA_PREPARARE' WHERE id = p_request_id;
  END IF;
  -- A request with remaining_quantity = 0, every transfer received, but an
  -- unresolved discrepancy: none of the three branches above match (the
  -- first is blocked by the discrepancy count, the others require an
  -- in-transit or not-yet-fully-covered condition that no longer holds), so
  -- it falls through and status is left exactly as it already was
  -- (DA_PREPARARE, from the point the last transfer departed) until
  -- rete_transfer_resolve_discrepancy() clears the gate and calls this
  -- function again.
END;
$$;

-- =============================================================================
-- 6. New internal helper: canonical publication-budget counters
-- =============================================================================
-- Counts only source = 'WBOS_AUTO' requests, matching WBOS's own
-- PUBLICATION_BUDGET_CONFIG (max_active_requests_global=5,
-- max_active_requests_per_requesting_store=2, max_new_publications_per_day=2)
-- and MAX_PENDING_CONFIRMATION_PER_REQUESTING_STORE=1. "Active" here means
-- not yet CHIUSA/ANNULLATA, matching the WBOS domain's own "active" concept.
-- MANUAL/EMAIL/TRASTA_ARRIVAL/DEMO requests are never counted - manual
-- requests remain outside the automatic budget by construction, not by a
-- special-case exclusion that could later be forgotten.

CREATE OR REPLACE FUNCTION "public"."rete_wbos_publication_budget_check"("p_requesting_location_id" smallint)
RETURNS void
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_global_active integer;
  v_store_active integer;
  v_today_published integer;
  v_store_pending integer;
BEGIN
  -- Serializes concurrent budget checks against concurrent inserts: two
  -- simultaneous rete_wbos_suggestion_ingest calls cannot both pass the
  -- count check and then both insert, because the second call blocks here
  -- until the first commits (or rolls back) its own advisory-locked section.
  PERFORM pg_advisory_xact_lock(hashtext('rete_wbos_publication_budget'));

  SELECT count(*) INTO v_global_active
  FROM public.rete_requests
  WHERE source = 'WBOS_AUTO' AND status NOT IN ('CHIUSA', 'ANNULLATA');
  IF v_global_active >= 5 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT count(*) INTO v_store_active
  FROM public.rete_requests
  WHERE source = 'WBOS_AUTO' AND status NOT IN ('CHIUSA', 'ANNULLATA')
    AND requesting_location_id = p_requesting_location_id;
  IF v_store_active >= 2 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT count(*) INTO v_today_published
  FROM public.rete_requests
  WHERE source = 'WBOS_AUTO' AND created_at >= date_trunc('day', now());
  IF v_today_published >= 2 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT count(*) INTO v_store_pending
  FROM public.rete_requests
  WHERE source = 'WBOS_AUTO' AND status = 'DA_CONFERMARE'
    AND requesting_location_id = p_requesting_location_id;
  IF v_store_pending >= 1 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
END;
$$;

ALTER FUNCTION "public"."rete_wbos_publication_budget_check"(smallint) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_wbos_publication_budget_check"(smallint) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_wbos_publication_budget_check"(smallint) FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_wbos_publication_budget_check"(smallint) FROM "authenticated";

-- =============================================================================
-- 7. New public RPCs (SECURITY DEFINER, same conventions as the existing 9)
-- =============================================================================

-- 7.1 WBOS automatic-suggestion ingestion. Central-role only (there is no
-- separate "system" actor in this schema - the WBOS pipeline authenticates
-- as the same Centrale identity that already has an active, pilot-enabled
-- membership; this is a deliberate, minimal choice for the pilot rather than
-- introducing a new service-account role). Never called with real data in
-- this gate - only synthetic fixtures, per the explicit boundary requirement.
CREATE OR REPLACE FUNCTION "public"."rete_wbos_suggestion_ingest"(
    "p_operational_request_key" "text",
    "p_requesting_location_wbos_id" smallint,
    "p_product_code" "text",
    "p_product_description" "text",
    "p_requested_quantity" integer,
    "p_quantity_method" "text",
    "p_source_document_date" "date" DEFAULT NULL,
    "p_score" numeric DEFAULT NULL,
    "p_score_version" "text" DEFAULT NULL,
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
  v_location_id smallint;
  v_existing_id uuid;
  v_request_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'operational_request_key', p_operational_request_key,
    'requesting_location_wbos_id', p_requesting_location_wbos_id,
    'product_code', p_product_code,
    'product_description', p_product_description,
    'requested_quantity', p_requested_quantity,
    'quantity_method', p_quantity_method,
    'source_document_date', p_source_document_date,
    'score', p_score,
    'score_version', p_score_version
  );
  v_cached := public.rete_claim_idempotency_key('rete_wbos_suggestion_ingest', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_operational_request_key IS NULL OR length(trim(p_operational_request_key)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_requested_quantity IS NULL OR p_requested_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_quantity_method NOT IN ('EXPLICIT', 'SIX_BOTTLE_DEFAULT') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT id INTO v_location_id FROM public.rete_locations WHERE id = p_requesting_location_wbos_id AND active;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Repeat ingestion for the same operational identity is never a duplicate:
  -- return the existing row's current state instead of inserting a second
  -- one, whether or not the idempotency key also happened to match (a
  -- different idempotency key with the same operational_request_key is
  -- exactly the "repeat ingestion creates no duplicate" requirement).
  SELECT id INTO v_existing_id FROM public.rete_requests WHERE operational_request_key = p_operational_request_key;
  IF FOUND THEN
    v_result := jsonb_build_object('request_id', v_existing_id, 'duplicate', true);
    PERFORM public.rete_store_idempotency_result('rete_wbos_suggestion_ingest', p_idempotency_key, v_result);
    RETURN v_result;
  END IF;

  -- A closed historical request must never reopen silently: closed here
  -- means the operational_request_key uniqueness above already prevents any
  -- re-row for that key at all (closed or not), so there is nothing further
  -- to check - the row simply never gets a second life under any status.

  -- An existing active MANUAL request for the same store+product prevents
  -- an automatic suggestion for the same pair, so a store's own already-
  -- expressed need is never duplicated by an automatic one.
  --
  -- Same advisory-lock key convention as rete_manual_request_create(), so
  -- the two functions are mutually serialized for the same (location,
  -- product) pair - without this, a concurrent manual-request creation and
  -- WBOS ingestion for the same store+product could each observe "no
  -- cross-source duplicate" before either commits, defeating this check
  -- exactly like the same-function race found and fixed in
  -- rete_manual_request_create().
  PERFORM pg_advisory_xact_lock(hashtext('rete_manual_request_create:' || v_location_id || ':' || p_product_code));

  IF EXISTS (
    SELECT 1 FROM public.rete_requests
    WHERE requesting_location_id = v_location_id
      AND product_code = p_product_code
      AND source <> 'WBOS_AUTO'
      AND status NOT IN ('CHIUSA', 'ANNULLATA')
  ) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM public.rete_wbos_publication_budget_check(v_location_id);

  INSERT INTO public.rete_requests (
    requesting_location_id, product_code, product_description, requested_quantity,
    remaining_quantity, status, urgency, source, operational_request_key,
    source_document_date, score, score_version, created_by
  ) VALUES (
    v_location_id, p_product_code, p_product_description, p_requested_quantity,
    p_requested_quantity, 'DA_CONFERMARE', 'NORMALE', 'WBOS_AUTO', p_operational_request_key,
    p_source_document_date, p_score, p_score_version, auth.uid()
  ) RETURNING id INTO v_request_id;

  PERFORM public.rete_write_audit_event(
    'wbos_suggestion_ingested', 'request', v_request_id::text, NULL, 'DA_CONFERMARE',
    jsonb_build_object('operational_request_key', p_operational_request_key, 'quantity_method', p_quantity_method)
  );

  v_result := jsonb_build_object('request_id', v_request_id, 'status', 'DA_CONFERMARE', 'duplicate', false);
  PERFORM public.rete_store_idempotency_result('rete_wbos_suggestion_ingest', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.2 Requesting store confirms a pending WBOS suggestion.
CREATE OR REPLACE FUNCTION "public"."rete_request_confirm"(
    "p_request_id" "uuid",
    "p_expected_version" integer,
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
  v_request public.rete_requests;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('request_id', p_request_id, 'expected_version', p_expected_version);
  v_cached := public.rete_claim_idempotency_key('rete_request_confirm', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requesting_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.status <> 'DA_CONFERMARE' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_expected_version IS NOT NULL AND v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_requests
  SET status = 'DA_TROVARE', confirmed_by = auth.uid(), confirmed_at = now(), version = version + 1
  WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event('request_confirmed', 'request', p_request_id::text, 'DA_CONFERMARE', 'DA_TROVARE', '{}'::jsonb);

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'DA_TROVARE');
  PERFORM public.rete_store_idempotency_result('rete_request_confirm', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.3 Requesting store edits the requested quantity of its own request,
-- only before any offer has been approved (mirrors WBOS's
-- update_requested_quantity(): blocked once OFFER_APPROVED/PARTIALLY/
-- TO_PREPARE/IN_TRANSIT/RECEIVED-equivalent).
CREATE OR REPLACE FUNCTION "public"."rete_request_update_quantity"(
    "p_request_id" "uuid",
    "p_new_quantity" integer,
    "p_expected_version" integer,
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
  v_request public.rete_requests;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();

  v_payload := jsonb_build_object('request_id', p_request_id, 'new_quantity', p_new_quantity, 'expected_version', p_expected_version);
  v_cached := public.rete_claim_idempotency_key('rete_request_update_quantity', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_new_quantity IS NULL OR p_new_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR (v_membership.role <> 'central' AND v_request.requesting_location_id <> v_membership.location_id) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.status NOT IN ('DA_CONFERMARE', 'DA_TROVARE') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- No offer may already be approved for this request - editing quantity
  -- once a transfer obligation exists requires cancel-and-recreate instead,
  -- exactly like the WBOS domain model.
  IF EXISTS (SELECT 1 FROM public.rete_offers WHERE request_id = p_request_id AND status = 'APPROVATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_expected_version IS NOT NULL AND v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_requests
  SET requested_quantity = p_new_quantity, remaining_quantity = p_new_quantity, version = version + 1
  WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event(
    'request_quantity_updated', 'request', p_request_id::text, v_request.status::text, v_request.status::text,
    jsonb_build_object('quantity_before', v_request.requested_quantity, 'quantity_after', p_new_quantity)
  );

  v_result := jsonb_build_object('request_id', p_request_id, 'requested_quantity', p_new_quantity);
  PERFORM public.rete_store_idempotency_result('rete_request_update_quantity', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.4 Store creates its own manual request. Distinct from the existing,
-- unchanged rete_request_publish (central-only, requires an explicit
-- location parameter). This RPC derives the location exclusively from the
-- caller's own membership - a store can never create a request for another
-- location's name by supplying a different location_id, because there is no
-- location_id parameter at all.
CREATE OR REPLACE FUNCTION "public"."rete_manual_request_create"(
    "p_product_code" "text",
    "p_product_description" "text",
    "p_requested_quantity" integer,
    "p_reason" "text" DEFAULT NULL,
    "p_requires_central_confirmation" boolean DEFAULT false,
    "p_warning_codes" "text"[] DEFAULT '{}'::"text"[],
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
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'product_code', p_product_code, 'product_description', p_product_description,
    'requested_quantity', p_requested_quantity, 'reason', p_reason,
    'requires_central_confirmation', p_requires_central_confirmation, 'warning_codes', p_warning_codes
  );
  v_cached := public.rete_claim_idempotency_key('rete_manual_request_create', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_requested_quantity IS NULL OR p_requested_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Active-duplicate prevention: a store may not open two simultaneous
  -- requests for the same product, whether manual or WBOS-sourced, ever
  -- silently discarding the new attempt - this is an explicit rejection the
  -- caller can see, not a silent no-op.
  --
  -- Serialized via advisory lock (same pattern as
  -- rete_wbos_publication_budget_check): a plain "SELECT ... EXISTS" check
  -- here is a check-then-act race - two concurrent calls for the same
  -- (location, product) can both observe "no active duplicate" before
  -- either has inserted its row, both then insert, and the duplicate this
  -- check exists to prevent is created anyway. Verified exploitable in
  -- review before this lock was added. The lock key combines location_id
  -- and product_code so unrelated store/product pairs never block each
  -- other.
  PERFORM pg_advisory_xact_lock(hashtext('rete_manual_request_create:' || v_membership.location_id || ':' || p_product_code));

  IF EXISTS (
    SELECT 1 FROM public.rete_requests
    WHERE requesting_location_id = v_membership.location_id
      AND product_code = p_product_code
      AND status NOT IN ('CHIUSA', 'ANNULLATA')
  ) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  INSERT INTO public.rete_requests (
    requesting_location_id, product_code, product_description, requested_quantity,
    remaining_quantity, status, urgency, source, notes, created_by,
    requires_central_confirmation, warning_codes
  ) VALUES (
    v_membership.location_id, p_product_code, p_product_description, p_requested_quantity,
    p_requested_quantity, 'DA_TROVARE', 'NORMALE', 'MANUAL', p_reason, auth.uid(),
    coalesce(p_requires_central_confirmation, false), coalesce(p_warning_codes, '{}'::text[])
  ) RETURNING id INTO v_request_id;

  PERFORM public.rete_write_audit_event(
    'manual_request_created', 'request', v_request_id::text, NULL, 'DA_TROVARE',
    jsonb_build_object('requires_central_confirmation', p_requires_central_confirmation)
  );
  IF p_requires_central_confirmation THEN
    PERFORM public.rete_write_audit_event(
      'central_confirmation_required', 'request', v_request_id::text, 'DA_TROVARE', 'DA_TROVARE',
      jsonb_build_object('warning_codes', p_warning_codes)
    );
  END IF;

  v_result := jsonb_build_object('request_id', v_request_id, 'status', 'DA_TROVARE',
                                  'requires_central_confirmation', p_requires_central_confirmation);
  PERFORM public.rete_store_idempotency_result('rete_manual_request_create', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.5 Central clears a manual request's central-confirmation requirement.
CREATE OR REPLACE FUNCTION "public"."rete_request_central_confirm"(
    "p_request_id" "uuid",
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
  v_request public.rete_requests;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('request_id', p_request_id);
  v_cached := public.rete_claim_idempotency_key('rete_request_central_confirm', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR NOT v_request.requires_central_confirmation THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_requests
  SET requires_central_confirmation = false, confirmed_by = auth.uid(), confirmed_at = now(), version = version + 1
  WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event('central_confirmed', 'request', p_request_id::text, v_request.status::text, v_request.status::text, '{}'::jsonb);

  v_result := jsonb_build_object('request_id', p_request_id, 'requires_central_confirmation', false);
  PERFORM public.rete_store_idempotency_result('rete_request_central_confirm', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.6 Cancel a request (central, or the requesting store). Refuses once any
-- offer for the request is already APPROVATA (a transfer obligation already
-- exists - never silently revive/orphan it). Any still-PROPOSTA offers are
-- explicitly rejected as part of the same governed transaction, never left
-- dangling with no disposition.
CREATE OR REPLACE FUNCTION "public"."rete_request_cancel"(
    "p_request_id" "uuid",
    "p_reason" "text" DEFAULT NULL,
    "p_expected_version" integer DEFAULT NULL,
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
  v_request public.rete_requests;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();

  v_payload := jsonb_build_object('request_id', p_request_id, 'reason', p_reason, 'expected_version', p_expected_version);
  v_cached := public.rete_claim_idempotency_key('rete_request_cancel', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR (v_membership.role <> 'central' AND v_request.requesting_location_id <> v_membership.location_id) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.status IN ('CHIUSA', 'ANNULLATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rete_offers WHERE request_id = p_request_id AND status = 'APPROVATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_expected_version IS NOT NULL AND v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  UPDATE public.rete_offers SET status = 'RIFIUTATA' WHERE request_id = p_request_id AND status = 'PROPOSTA';

  UPDATE public.rete_requests
  SET status = 'ANNULLATA', cancelled_by = auth.uid(), cancelled_at = now(), cancel_reason = p_reason, version = version + 1
  WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event('request_cancelled', 'request', p_request_id::text, v_request.status::text, 'ANNULLATA', jsonb_build_object('reason', p_reason));

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_cancel', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.7 Requesting-store-only "no longer needed" - same mechanics as cancel,
-- distinct action name/audit event so the two are never indistinguishable
-- in the audit trail (mirrors WBOS's STORE_CANCELLED vs
-- STORE_MARKED_NO_LONGER_NEEDED).
CREATE OR REPLACE FUNCTION "public"."rete_request_mark_no_longer_needed"(
    "p_request_id" "uuid",
    "p_expected_version" integer DEFAULT NULL,
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
  v_request public.rete_requests;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('request_id', p_request_id, 'expected_version', p_expected_version);
  v_cached := public.rete_claim_idempotency_key('rete_request_mark_no_longer_needed', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.requesting_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.status IN ('CHIUSA', 'ANNULLATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF EXISTS (SELECT 1 FROM public.rete_offers WHERE request_id = p_request_id AND status = 'APPROVATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_expected_version IS NOT NULL AND v_request.version <> p_expected_version THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  UPDATE public.rete_offers SET status = 'RIFIUTATA' WHERE request_id = p_request_id AND status = 'PROPOSTA';

  UPDATE public.rete_requests
  SET status = 'ANNULLATA', cancelled_by = auth.uid(), cancelled_at = now(),
      cancel_reason = 'STORE_MARKED_NO_LONGER_NEEDED', version = version + 1
  WHERE id = p_request_id;

  PERFORM public.rete_write_audit_event('request_marked_no_longer_needed', 'request', p_request_id::text, v_request.status::text, 'ANNULLATA', '{}'::jsonb);

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_mark_no_longer_needed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.8 Central resolves a receipt discrepancy. Only legal once a real,
-- unresolved discrepancy exists (received_quantity <> quantity and not
-- already acknowledged) - the underlying received_quantity/quantity facts
-- are never altered, only the acknowledgment/resolution metadata is set.
CREATE OR REPLACE FUNCTION "public"."rete_transfer_resolve_discrepancy"(
    "p_transfer_id" "uuid",
    "p_resolution_note" "text",
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
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('transfer_id', p_transfer_id, 'resolution_note', p_resolution_note);
  v_cached := public.rete_claim_idempotency_key('rete_transfer_resolve_discrepancy', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_resolution_note IS NULL OR length(trim(p_resolution_note)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.status <> 'RICEVUTA' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.received_quantity IS NULL OR v_transfer.received_quantity = v_transfer.quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.discrepancy_acknowledged THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_transfers
  SET discrepancy_acknowledged = true, discrepancy_resolved_by = auth.uid(),
      discrepancy_resolved_at = now(), discrepancy_resolution_note = p_resolution_note,
      version = version + 1
  WHERE id = p_transfer_id;

  PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  PERFORM public.rete_write_audit_event(
    'receipt_discrepancy_resolved', 'transfer', p_transfer_id::text, 'RICEVUTA', 'RICEVUTA',
    jsonb_build_object('resolution_note', p_resolution_note)
  );

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'discrepancy_acknowledged', true);
  PERFORM public.rete_store_idempotency_result('rete_transfer_resolve_discrepancy', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- 7.9 Extend rete_transfer_receive with an explicit discrepancy_type and a
-- RECEIPT_DISCREPANCY_RECORDED audit event whenever received_quantity <>
-- quantity - byte-for-byte identical to the existing function otherwise
-- (same locking, same validation, same status transition, same
-- recompute_status call, same idempotency binding).
CREATE OR REPLACE FUNCTION "public"."rete_transfer_receive"(
    "p_transfer_id" "uuid",
    "p_received_quantity" integer,
    "p_anomaly_note" "text" DEFAULT NULL,
    "p_discrepancy_type" "text" DEFAULT NULL,
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
  v_transfer public.rete_transfers;
  v_is_discrepancy boolean;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();

  v_payload := jsonb_build_object(
    'transfer_id', p_transfer_id, 'received_quantity', p_received_quantity,
    'anomaly_note', p_anomaly_note, 'discrepancy_type', p_discrepancy_type
  );
  v_cached := public.rete_claim_idempotency_key('rete_transfer_receive', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.to_location_id <> v_membership.location_id OR v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.status <> 'IN_TRASFERIMENTO' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_received_quantity IS NULL OR p_received_quantity < 0 OR p_received_quantity > v_transfer.quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_is_discrepancy := p_received_quantity <> v_transfer.quantity;

  IF v_is_discrepancy AND p_discrepancy_type IS NULL THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF (NOT v_is_discrepancy) AND p_discrepancy_type IS NOT NULL THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_transfers
  SET status = 'RICEVUTA', received_at = now(), received_by = auth.uid(),
      received_quantity = p_received_quantity, anomaly_note = p_anomaly_note,
      discrepancy_type = p_discrepancy_type, version = version + 1
  WHERE id = p_transfer_id;

  PERFORM public.rete_request_recompute_status(v_transfer.request_id);

  IF v_is_discrepancy THEN
    PERFORM public.rete_write_audit_event(
      'receipt_discrepancy_recorded', 'transfer', p_transfer_id::text, 'IN_TRASFERIMENTO', 'RICEVUTA',
      jsonb_build_object('quantity_before', v_transfer.quantity, 'quantity_after', p_received_quantity, 'discrepancy_type', p_discrepancy_type)
    );
  ELSE
    PERFORM public.rete_write_audit_event(
      'transfer_received', 'transfer', p_transfer_id::text, 'IN_TRASFERIMENTO', 'RICEVUTA',
      jsonb_build_object('received_quantity', p_received_quantity, 'anomaly', false)
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'RICEVUTA',
                                  'received_quantity', p_received_quantity, 'discrepancy', v_is_discrepancy);
  PERFORM public.rete_store_idempotency_result('rete_transfer_receive', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- =============================================================================
-- 8. SECURITY DEFINER lockdown for every new/replaced RPC
-- =============================================================================

ALTER FUNCTION "public"."rete_wbos_suggestion_ingest"("text", smallint, "text", "text", integer, "text", "date", numeric, "text", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_request_confirm"("uuid", integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_request_update_quantity"("uuid", integer, integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_manual_request_create"("text", "text", integer, "text", boolean, "text"[], "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_request_central_confirm"("uuid", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_request_cancel"("uuid", "text", integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_request_mark_no_longer_needed"("uuid", integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_transfer_resolve_discrepancy"("uuid", "text", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."rete_wbos_suggestion_ingest"("text", smallint, "text", "text", integer, "text", "date", numeric, "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_confirm"("uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_update_quantity"("uuid", integer, integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_manual_request_create"("text", "text", integer, "text", boolean, "text"[], "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_central_confirm"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_cancel"("uuid", "text", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_mark_no_longer_needed"("uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_transfer_resolve_discrepancy"("uuid", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text", "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."rete_wbos_suggestion_ingest"("text", smallint, "text", "text", integer, "text", "date", numeric, "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_confirm"("uuid", integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_update_quantity"("uuid", integer, integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_manual_request_create"("text", "text", integer, "text", boolean, "text"[], "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_central_confirm"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_cancel"("uuid", "text", integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_mark_no_longer_needed"("uuid", integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_transfer_resolve_discrepancy"("uuid", "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text", "text") FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."rete_wbos_suggestion_ingest"("text", smallint, "text", "text", integer, "text", "date", numeric, "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_request_confirm"("uuid", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_request_update_quantity"("uuid", integer, integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_manual_request_create"("text", "text", integer, "text", boolean, "text"[], "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_request_central_confirm"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_request_cancel"("uuid", "text", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_request_mark_no_longer_needed"("uuid", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_transfer_resolve_discrepancy"("uuid", "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text", "text") TO "authenticated";

-- Old 4-argument rete_transfer_receive signature is superseded by the new
-- 5-argument one above; drop the old overload so there is exactly one
-- rete_transfer_receive going forward (both signatures resolving PostgREST's
-- RPC name lookup ambiguously would be worse than a clean single signature -
-- and no existing pilot session has reason to call the 4-arg form once this
-- migration has replayed, since the frontend adapter is being updated in the
-- same feature branch).
DROP FUNCTION IF EXISTS "public"."rete_transfer_receive"("uuid", integer, "text", "text");

-- =============================================================================
-- 9. Restrict visibility of unconfirmed WBOS suggestions
-- =============================================================================
-- The existing "active members read requests" policy (migration 1) is a
-- blanket "any active member sees every request" read policy - correct and
-- unchanged for every status this schema already had. DA_CONFERMARE is a
-- brand new status this migration introduces; a request sitting in it is
-- explicitly a private, not-yet-confirmed suggestion (WBOS Phase 6:
-- "unconfirmed suggestion not visible to other stores"). Replacing the
-- policy (rather than adding a second permissive one, which cannot subtract
-- visibility - Postgres RLS policies are OR'd together) is the only way to
-- carve out this one exception while leaving every other status exactly as
-- visible as it already was.

DROP POLICY IF EXISTS "active members read requests" ON "public"."rete_requests";

CREATE POLICY "active members read requests" ON "public"."rete_requests" FOR SELECT TO "authenticated" USING (
  (EXISTS ( SELECT 1 FROM "public"."rete_memberships" "m"
    WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active")))
  AND (
    "status" <> 'DA_CONFERMARE'
    OR (EXISTS ( SELECT 1 FROM "public"."rete_memberships" "m"
      WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active"
        AND (("m"."role" = 'central'::"public"."rete_user_role")
             OR ("m"."location_id" = "rete_requests"."requesting_location_id")))))
  )
);
