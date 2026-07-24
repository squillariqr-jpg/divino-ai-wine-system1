-- Rete Squillari — canonical voluntary-request reason.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, on branch feat/rete-squillari-email-shortage-ingest,
-- requires its own explicit-authorization step before `supabase db push`.
--
-- Root cause of the reported bug ("Malta selects Vendita but it never shows
-- on the card"): no canonical reason field existed at all. The governed
-- manual-request form only ever collected free text into a "Motivo
-- (facoltativo)" input, which rete_manual_request_create persisted into the
-- pre-existing `notes` column (shared with an unrelated concept - central's
-- own operator note on rete_request_publish). That value was never read back
-- by the frontend adapter's mapRequestRow() and never rendered by any card
-- or detail view - so no reason text could ever have appeared, regardless of
-- what a store typed. `notes` is left completely untouched by this
-- migration; it is not repurposed or reused for this feature.
--
-- This migration adds a new, additive, nullable, backwards-compatible pair
-- of columns plus a required-only-for-new-manual-requests validation in the
-- RPC layer - existing rows, existing EMAIL/TRASTA_ARRIVAL-sourced requests,
-- and the existing `notes`/`p_reason` free-text parameter are all
-- unaffected.

BEGIN;

CREATE TYPE "public"."rete_request_reason" AS ENUM (
  'SALE',
  'CUSTOMER_ORDER',
  'STORE_REPLENISHMENT',
  'OTHER'
);

ALTER TABLE "public"."rete_requests"
  ADD COLUMN IF NOT EXISTS "request_reason" "public"."rete_request_reason",
  ADD COLUMN IF NOT EXISTS "request_reason_note" "text";

ALTER TABLE "public"."rete_requests"
  ADD CONSTRAINT "rete_requests_request_reason_note_check"
  CHECK (("request_reason_note" IS NULL) OR ("length"("request_reason_note") <= 500));

-- The free-text note is only meaningful alongside OTHER - keeps the enum the
-- single source of truth for every other reason's display label, so the UI
-- never has to decide whether to show a note next to SALE/CUSTOMER_ORDER/
-- STORE_REPLENISHMENT.
ALTER TABLE "public"."rete_requests"
  ADD CONSTRAINT "rete_requests_request_reason_note_scope_check"
  CHECK (("request_reason_note" IS NULL) OR ("request_reason" = 'OTHER'));

-- Extend the existing protected-column guard (unchanged mechanism, see
-- 20260722180000_rete_squillari_cross_store_visibility_correction.sql) so
-- the new columns can only ever change via a governed RPC, exactly like
-- product_code/product_description/requested_quantity already do. Additive
-- only - every previously-guarded field/table stays identical.
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

-- rete_manual_request_create gains two new, additive parameters at the end
-- of the signature. p_reason/notes keeps its exact pre-existing behavior and
-- meaning - it is not touched, repurposed, or deprecated by this change.
--
-- CREATE OR REPLACE FUNCTION does NOT replace a function with a different
-- parameter list - Postgres identifies functions by (name, parameter types),
-- so appending new parameters creates a second, overloaded function instead
-- of replacing the original, leaving both the old 7-parameter and new
-- 9-parameter versions resolvable and ambiguous to callers that don't supply
-- every parameter by name. Verified locally: without this DROP, a bare
-- PostgREST rpc() call fails with "Could not choose the best candidate
-- function". The old signature must be dropped explicitly first.
DROP FUNCTION IF EXISTS "public"."rete_manual_request_create"(
  "text", "text", integer, "text", boolean, "text"[], "text"
);

CREATE OR REPLACE FUNCTION "public"."rete_manual_request_create"(
    "p_product_code" "text",
    "p_product_description" "text",
    "p_requested_quantity" integer,
    "p_reason" "text" DEFAULT NULL,
    "p_requires_central_confirmation" boolean DEFAULT false,
    "p_warning_codes" "text"[] DEFAULT '{}'::"text"[],
    "p_idempotency_key" "text" DEFAULT NULL,
    "p_request_reason" "public"."rete_request_reason" DEFAULT NULL,
    "p_request_reason_note" "text" DEFAULT NULL
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

  -- A voluntary store request must always carry a structured reason - this
  -- is the actual fix for the reported bug (previously there was no
  -- required, structured field to select at all).
  IF p_request_reason IS NULL THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_request_reason_note IS NOT NULL AND p_request_reason <> 'OTHER' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_request_reason_note IS NOT NULL AND length(p_request_reason_note) > 500 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'product_code', p_product_code, 'product_description', p_product_description,
    'requested_quantity', p_requested_quantity, 'reason', p_reason,
    'requires_central_confirmation', p_requires_central_confirmation, 'warning_codes', p_warning_codes,
    'request_reason', p_request_reason, 'request_reason_note', p_request_reason_note
  );
  v_cached := public.rete_claim_idempotency_key('rete_manual_request_create', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_requested_quantity IS NULL OR p_requested_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

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
    requires_central_confirmation, warning_codes, request_reason, request_reason_note
  ) VALUES (
    v_membership.location_id, p_product_code, p_product_description, p_requested_quantity,
    p_requested_quantity, 'DA_TROVARE', 'NORMALE', 'MANUAL', p_reason, auth.uid(),
    coalesce(p_requires_central_confirmation, false), coalesce(p_warning_codes, '{}'::text[]),
    p_request_reason, p_request_reason_note
  ) RETURNING id INTO v_request_id;

  PERFORM public.rete_write_audit_event(
    'manual_request_created', 'request', v_request_id::text, NULL, 'DA_TROVARE',
    jsonb_build_object('requires_central_confirmation', p_requires_central_confirmation, 'request_reason', p_request_reason)
  );
  IF p_requires_central_confirmation THEN
    PERFORM public.rete_write_audit_event(
      'central_confirmation_required', 'request', v_request_id::text, 'DA_TROVARE', 'DA_TROVARE',
      jsonb_build_object('warning_codes', p_warning_codes)
    );
  END IF;

  v_result := jsonb_build_object('request_id', v_request_id, 'status', 'DA_TROVARE',
                                  'requires_central_confirmation', p_requires_central_confirmation,
                                  'request_reason', p_request_reason);
  PERFORM public.rete_store_idempotency_result('rete_manual_request_create', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
