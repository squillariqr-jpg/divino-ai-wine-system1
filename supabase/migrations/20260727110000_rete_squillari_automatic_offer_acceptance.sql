-- Rete Squillari — automatic acceptance of valid store-to-store offers.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, requires its own explicit-authorization step before
-- `supabase db push`. Depends on 20260727100000 (enum values) having
-- already been applied first.
--
-- Business change: a valid offer on a DA_TROVARE/ARRIVO_PARZIALE_A_TRASTA
-- request, from an active pilot-enabled donor different from the requester,
-- for a positive quantity not exceeding the request's current
-- remaining_quantity, is now accepted in the SAME transaction that creates
-- it - rete_offer_create does what rete_offer_create + rete_offer_approve
-- used to do together, atomically, under the request row's own lock. No
-- central click, no separate approval step, no window where a valid offer
-- sits waiting.
--
-- Central review is reserved for the one real exception this RPC can
-- produce: a request in a status that isn't a normal "still open" state
-- (DA_VERIFICARE, DA_CONFERMARE, DA_PREPARARE, IN_TRASFERIMENTO,
-- ARRIVATO_A_TRASTA, RICEVUTA - anything that isn't DA_TROVARE/
-- ARRIVO_PARZIALE_A_TRASTA and isn't already a hard-rejected CHIUSA/
-- ANNULLATA) goes to DATA_REVIEW instead of being silently accepted or
-- silently dropped. Everything else this gate's spec anticipated
-- (ambiguous product identity, a genuinely irreconcilable concurrent
-- conflict, an arrival that raced the submission) resolves cleanly through
-- the request row's FOR UPDATE lock + a fresh remaining_quantity check -
-- there is no real ambiguity left for a human to review in those cases, so
-- CONFLICT_REVIEW/ARRIVAL_CONFLICT are modeled (enum values exist,
-- rete_offer_approve/reject already accept them as valid starting points)
-- but have no trigger point in this gate. Documented here rather than
-- faked with an artificial condition.
--
-- rete_offer_approve/rete_offer_reject are NOT removed - they become the
-- exception-resolution path for a DATA_REVIEW (or, if ever produced,
-- CONFLICT_REVIEW/ARRIVAL_CONFLICT) offer, central-only, exactly as before.
-- The one pre-existing live PROPOSTA offer (created before this migration)
-- also still resolves through the unchanged legacy path - PROPOSTA remains
-- a valid starting status for both functions.

BEGIN;

-- Automatic acceptance has no human central approver - rete_transfers.approved_by
-- was NOT NULL (every prior transfer was created by rete_offer_approve, a
-- central-only action, which always supplied auth.uid()). Caught by re-reading
-- the schema rather than a live insert this session (Docker was unavailable) -
-- disclosed in the final report as exactly the kind of thing local DB testing
-- exists to catch.
ALTER TABLE "public"."rete_transfers" ALTER COLUMN "approved_by" DROP NOT NULL;

ALTER TABLE "public"."rete_offers"
  ADD COLUMN IF NOT EXISTS "accepted_at" timestamp with time zone,
  ADD COLUMN IF NOT EXISTS "acceptance_mode" "text",
  ADD COLUMN IF NOT EXISTS "accepted_by_user_id" "uuid",
  ADD COLUMN IF NOT EXISTS "review_reason" "text";

ALTER TABLE "public"."rete_offers"
  ADD CONSTRAINT "rete_offers_acceptance_mode_check"
  CHECK (("acceptance_mode" IS NULL) OR ("acceptance_mode" IN ('AUTOMATIC', 'MANUAL')));
ALTER TABLE "public"."rete_offers"
  ADD CONSTRAINT "rete_offers_review_reason_check"
  CHECK (("review_reason" IS NULL) OR (length("review_reason") <= 300));

-- Extend the existing protected-column guard to cover the four new
-- columns, same mechanism as every previous extension of this function -
-- additive only, every previously-guarded table/column is unchanged.
CREATE OR REPLACE FUNCTION "public"."rete_guard_protected_columns"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" TO 'public', 'pg_temp'
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
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.product_code IS DISTINCT FROM OLD.product_code
         OR NEW.product_description IS DISTINCT FROM OLD.product_description
         OR NEW.requested_quantity IS DISTINCT FROM OLD.requested_quantity
         OR NEW.requesting_location_id IS DISTINCT FROM OLD.requesting_location_id
         OR NEW.request_reason IS DISTINCT FROM OLD.request_reason
         OR NEW.request_reason_note IS DISTINCT FROM OLD.request_reason_note THEN
        RAISE EXCEPTION 'rete_requests: status, quantity, product identity, requesting store, reason, and lifecycle fields can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_offers' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.approved_quantity IS DISTINCT FROM OLD.approved_quantity
         OR NEW.approved_by IS DISTINCT FROM OLD.approved_by
         OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
         OR NEW.acceptance_mode IS DISTINCT FROM OLD.acceptance_mode
         OR NEW.accepted_by_user_id IS DISTINCT FROM OLD.accepted_by_user_id
         OR NEW.review_reason IS DISTINCT FROM OLD.review_reason THEN
        RAISE EXCEPTION 'rete_offers: status, approval and acceptance fields can only change via a governed operation';
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

-- ---------------------------------------------------------------------------
-- rete_offer_create: now performs create-and-evaluate atomically.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_offer_create"(
    "p_request_id" "uuid",
    "p_offered_quantity" integer,
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
  v_offer_id uuid;
  v_transfer_id uuid;
  v_offer_status public.rete_offer_status;
  v_acceptance_mode text;
  v_review_reason text;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  -- Non-pilot donor blocked - defense in depth. The real app can never
  -- reach this RPC in DEMO_LOCAL mode (governed action overrides are only
  -- installed for GOVERNED_BACKEND actors), but the RPC itself must not
  -- rely on frontend mode selection as its only guard.
  IF v_membership.pilot_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'request_id', p_request_id,
    'offered_quantity', p_offered_quantity
  );
  v_cached := public.rete_claim_idempotency_key('rete_offer_create', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_offered_quantity IS NULL OR p_offered_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status IN ('CHIUSA', 'ANNULLATA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.requesting_location_id = v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  IF v_request.status IN ('DA_PREPARARE', 'IN_TRASFERIMENTO', 'RICEVUTA') THEN
    -- rete_request_recompute_status only ever moves a request into one of
    -- these three states once remaining_quantity has already hit 0 and a
    -- transfer already exists for it - i.e. the request is already fully
    -- allocated and progressing normally toward fulfillment. This is an
    -- expected outcome, not an anomaly, so a further offer against it is
    -- rejected the same clean way as an ordinary over-offer, not routed to
    -- review.
    RAISE EXCEPTION 'operation not permitted';
  ELSIF v_request.status NOT IN ('DA_TROVARE', 'ARRIVO_PARZIALE_A_TRASTA') THEN
    -- Request exists, isn't terminal, isn't already fully allocated, but
    -- also isn't a normal "still open for donor offers" state (e.g.
    -- DA_CONFERMARE, ARRIVATO_A_TRASTA, DA_VERIFICARE) - a genuinely
    -- ambiguous case a human should look at, not silently accepted and not
    -- silently dropped.
    v_offer_status := 'DATA_REVIEW';
    v_review_reason := 'invalid_or_legacy_request_state:' || v_request.status::text;
  ELSIF p_offered_quantity > v_request.remaining_quantity THEN
    -- Over-offer / already-fully-covered request: never silently clipped,
    -- never silently accepted - a clean, immediate rejection under the
    -- same lock that makes concurrent offers on the same request safe (a
    -- second concurrent caller blocks here until the first transaction
    -- commits, then evaluates against the now-updated remaining_quantity).
    RAISE EXCEPTION 'operation not permitted';
  ELSE
    v_offer_status := 'APPROVATA';
    v_acceptance_mode := 'AUTOMATIC';
  END IF;

  INSERT INTO public.rete_offers (
    request_id, offering_location_id, offered_quantity, status, offered_by,
    approved_quantity, accepted_at, acceptance_mode, review_reason
  ) VALUES (
    p_request_id, v_membership.location_id, p_offered_quantity, v_offer_status, auth.uid(),
    CASE WHEN v_offer_status = 'APPROVATA' THEN p_offered_quantity ELSE NULL END,
    CASE WHEN v_offer_status = 'APPROVATA' THEN now() ELSE NULL END,
    v_acceptance_mode, v_review_reason
  )
  RETURNING id INTO v_offer_id;

  PERFORM public.rete_write_audit_event(
    'offer_created', 'offer', v_offer_id::text, NULL, v_offer_status::text,
    jsonb_build_object('request_id', p_request_id, 'acceptance_mode', v_acceptance_mode, 'review_reason', v_review_reason)
  );

  IF v_offer_status = 'APPROVATA' THEN
    INSERT INTO public.rete_transfers (request_id, offer_id, from_location_id, to_location_id, quantity, status)
    VALUES (v_request.id, v_offer_id, v_membership.location_id, v_request.requesting_location_id, p_offered_quantity, 'DA_PREPARARE')
    RETURNING id INTO v_transfer_id;

    UPDATE public.rete_requests
    SET remaining_quantity = remaining_quantity - p_offered_quantity
    WHERE id = v_request.id;

    PERFORM public.rete_request_recompute_status(v_request.id);

    PERFORM public.rete_write_audit_event('offer_auto_accepted', 'offer', v_offer_id::text, v_offer_status::text, v_offer_status::text, jsonb_build_object('approved_quantity', p_offered_quantity));
    PERFORM public.rete_write_audit_event('transfer_created', 'transfer', v_transfer_id::text, NULL, 'DA_PREPARARE', jsonb_build_object('request_id', v_request.id, 'offer_id', v_offer_id));

    -- Requester: "disponibilità ricevuta da <donor>" - fires once, at
    -- acceptance time, since there is no longer a separate
    -- "received but not yet approved" moment to notify about.
    PERFORM public.rete_whatsapp_enqueue_notification(
      'OFFER_AUTO_ACCEPTED', v_request.requesting_location_id, p_request_id, v_offer_id, v_transfer_id,
      'rete_offerta_ricevuta_v1',
      jsonb_build_object('counterpart_location_id', v_membership.location_id, 'quantity', p_offered_quantity),
      '/rete-squillari?offer=' || v_offer_id::text,
      'OFFER_AUTO_ACCEPTED:' || v_offer_id::text || ':requester'
    );
    -- Donor: "merce da preparare".
    PERFORM public.rete_whatsapp_enqueue_notification(
      'GOODS_TO_PREPARE', v_membership.location_id, p_request_id, v_offer_id, v_transfer_id,
      'rete_merce_da_preparare_v1',
      jsonb_build_object('counterpart_location_id', v_request.requesting_location_id, 'quantity', p_offered_quantity),
      '/rete-squillari?transfer=' || v_transfer_id::text,
      'GOODS_TO_PREPARE:' || v_transfer_id::text
    );
  END IF;

  v_result := jsonb_build_object(
    'offer_id', v_offer_id, 'status', v_offer_status, 'acceptance_mode', v_acceptance_mode,
    'transfer_id', v_transfer_id, 'requires_review', (v_offer_status <> 'APPROVATA')
  );
  PERFORM public.rete_store_idempotency_result('rete_offer_create', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_offer_approve: now the exception-resolution / legacy path. Accepts
-- PROPOSTA (the one pre-existing live offer, and any future non-automatic
-- path) plus the three review statuses. Marks acceptance_mode = MANUAL and
-- records the approving central user - unchanged transfer-creation logic.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_offer_approve"(
    "p_offer_id" "uuid",
    "p_approved_quantity" integer,
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
  v_offer public.rete_offers;
  v_request public.rete_requests;
  v_transfer_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'offer_id', p_offer_id,
    'approved_quantity', p_approved_quantity
  );
  v_cached := public.rete_claim_idempotency_key('rete_offer_approve', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_approved_quantity IS NULL OR p_approved_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_offer FROM public.rete_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.status NOT IN ('PROPOSTA', 'DATA_REVIEW', 'CONFLICT_REVIEW', 'ARRIVAL_CONFLICT') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_approved_quantity > v_offer.offered_quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = v_offer.request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('DA_TROVARE', 'ARRIVO_PARZIALE_A_TRASTA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_approved_quantity > v_request.remaining_quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  UPDATE public.rete_offers
  SET status = 'APPROVATA', approved_quantity = p_approved_quantity, approved_by = auth.uid(),
      accepted_at = now(), acceptance_mode = 'MANUAL'
  WHERE id = p_offer_id;

  INSERT INTO public.rete_transfers (request_id, offer_id, from_location_id, to_location_id, quantity, status, approved_by)
  VALUES (v_request.id, p_offer_id, v_offer.offering_location_id, v_request.requesting_location_id, p_approved_quantity, 'DA_PREPARARE', auth.uid())
  RETURNING id INTO v_transfer_id;

  UPDATE public.rete_requests
  SET remaining_quantity = remaining_quantity - p_approved_quantity
  WHERE id = v_request.id;

  PERFORM public.rete_request_recompute_status(v_request.id);

  PERFORM public.rete_write_audit_event('offer_approved', 'offer', p_offer_id::text, v_offer.status::text, 'APPROVATA', jsonb_build_object('approved_quantity', p_approved_quantity, 'acceptance_mode', 'MANUAL'));
  PERFORM public.rete_write_audit_event('transfer_created', 'transfer', v_transfer_id::text, NULL, 'DA_PREPARARE', jsonb_build_object('request_id', v_request.id, 'offer_id', p_offer_id));

  PERFORM public.rete_whatsapp_enqueue_notification(
    'GOODS_TO_PREPARE', v_offer.offering_location_id, v_request.id, p_offer_id, v_transfer_id,
    'rete_merce_da_preparare_v1',
    jsonb_build_object('counterpart_location_id', v_request.requesting_location_id, 'quantity', p_approved_quantity),
    '/rete-squillari?transfer=' || v_transfer_id::text,
    'GOODS_TO_PREPARE:' || v_transfer_id::text
  );

  v_result := jsonb_build_object('offer_id', p_offer_id, 'transfer_id', v_transfer_id, 'status', 'APPROVATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_approve', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_offer_reject: same widened starting-status set, for central to
-- reject an exceptional offer instead of approving it.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_offer_reject"(
    "p_offer_id" "uuid",
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
  v_offer public.rete_offers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('offer_id', p_offer_id);
  v_cached := public.rete_claim_idempotency_key('rete_offer_reject', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_offer FROM public.rete_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.status NOT IN ('PROPOSTA', 'DATA_REVIEW', 'CONFLICT_REVIEW', 'ARRIVAL_CONFLICT') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_offers SET status = 'RIFIUTATA' WHERE id = p_offer_id;

  PERFORM public.rete_write_audit_event('offer_rejected', 'offer', p_offer_id::text, v_offer.status::text, 'RIFIUTATA', '{}'::jsonb);

  v_result := jsonb_build_object('offer_id', p_offer_id, 'status', 'RIFIUTATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_reject', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
