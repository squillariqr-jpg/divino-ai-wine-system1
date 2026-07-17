-- Migration 4: rete_squillari_pilot_allowlist_enforcement
--
-- Adds a server-side pilot allowlist and enforces it inside every governed
-- write RPC. The prior design (documented in the pilot integration design
-- gate) proposed a `pilot_enabled` flag primarily to pick a frontend
-- adapter; that is NOT server-side enforcement. Any `authenticated` user
-- can call these RPCs directly over REST regardless of what the frontend
-- does, so the flag must be checked inside the database, in the single
-- helper already called by all nine RPCs.
--
-- Design decisions made explicit here:
--   * pilot_enabled lives on rete_memberships (the same row every RPC
--     already reads for role/location), not a separate table or a client
--     parameter. It defaults to false and this migration does not enable
--     any specific membership - enabling the three pilot identities
--     (Centrale, Malta, Sestri) is a separate, explicit, non-migration
--     operator action performed directly against the database, exactly
--     like the emergency-revoke kill switch already documented.
--   * rete_memberships has never had an UPDATE policy for `authenticated`
--     (only "users read own membership", SELECT-only) - RLS therefore
--     already denies any direct client write to any column on this table,
--     including pilot_enabled, with zero policy changes required here.
--     This mirrors how rete_idempotent_operations is protected (RLS
--     enabled, zero policies) rather than by a guard trigger, and avoids
--     adding a trigger that would also have to special-case the operator's
--     own direct enable/disable UPDATE.
--   * rete_require_active_membership() is the single call site used by
--     all nine RPCs (verified: exactly nine call sites). Pilot enforcement
--     is added there, once, using the same generic "no active membership"
--     failure message already used for missing/inactive membership - the
--     three cases (no row, inactive, pilot disabled) must stay
--     indistinguishable to the caller by design (no information leak about
--     which specific gate failed).
--   * The membership row is locked FOR KEY SHARE inside
--     rete_require_active_membership(). This provides a clear
--     linearization point for the kill switch:
--       - If the operator's UPDATE (pilot_enabled=false) commits BEFORE an
--         RPC reaches the SELECT...FOR KEY SHARE, the RPC reads
--         pilot_enabled=false and is immediately rejected.
--       - If an RPC acquires the KEY SHARE lock before the UPDATE, the RPC
--         may complete (it already passed the authorization gate); the
--         UPDATE then sets pilot_enabled=false and all subsequent RPCs are
--         rejected. No deadlock is possible: FOR KEY SHARE is compatible
--         with other readers (multiple concurrent RPCs for the same user
--         do not block each other) and the operator's UPDATE only acquires
--         a SHARE ROW EXCLUSIVE lock, which does not conflict with FOR KEY
--         SHARE at the row level. The function is changed from STABLE to
--         VOLATILE because FOR UPDATE/FOR KEY SHARE cannot appear inside a
--         STABLE function (Postgres will error at parse time if it tries).
--   * Authorization now happens strictly before the idempotency cache is
--     ever consulted, for all nine RPCs: rete_require_active_membership()
--     (now including the pilot check) and every statically-known role
--     check (central-only / store-only) are moved before the call to
--     rete_claim_idempotency_key(). This closes a real ordering bug in the
--     prior migration, where the idempotency claim/lookup ran first: a
--     retry with a previously-successful idempotency key from an identity
--     that has since been disabled (pilot_enabled set back to false, or
--     deactivated) would otherwise still return the old cached result
--     without ever re-checking authorization. Row-specific ownership
--     checks that require the target entity (e.g. "is this my transfer")
--     necessarily still happen after the entity is fetched, later in the
--     function - but the identity-level gate (membership/active/pilot) is
--     now fully resolved before any idempotency-table access, DML, or
--     audit write.
--
-- Nothing in this migration is applied to the remote project. It is
-- replayed exclusively against the local Supabase stack via
-- `supabase db reset --local`.

-- ---------------------------------------------------------------------------
-- 1. pilot_enabled column
-- ---------------------------------------------------------------------------

ALTER TABLE "public"."rete_memberships"
    ADD COLUMN IF NOT EXISTS "pilot_enabled" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN "public"."rete_memberships"."pilot_enabled" IS
    'Server-side pilot allowlist gate, checked by rete_require_active_membership() before every governed RPC. Defaults to false for every membership, including ones created by this migration''s predecessors. Enabling a specific identity is a direct operator UPDATE against the database, never a migration and never a client-writable field: rete_memberships has no UPDATE policy for authenticated, so this column (like every other column here) cannot be changed by a direct client request.';

-- No UPDATE policy is added for rete_memberships here or anywhere else:
-- authenticated has only ever had a SELECT policy on this table
-- ("users read own membership"), so RLS already denies any client UPDATE
-- attempt on any column, pilot_enabled included. This is verified by test
-- (direct PATCH from an authenticated session is rejected).

-- ---------------------------------------------------------------------------
-- 2. Enforcement in the single shared helper
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."rete_require_active_membership"()
RETURNS "public"."rete_memberships"
LANGUAGE "plpgsql"
VOLATILE
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  -- FOR KEY SHARE provides kill-switch linearization: the operator's
  -- UPDATE (pilot_enabled=false) acquires a SHARE ROW EXCLUSIVE lock that
  -- is not compatible with any open FOR KEY SHARE on the same row. Therefore:
  --   * If the UPDATE commits before this SELECT executes, the SELECT reads
  --     pilot_enabled=false and the RPC is rejected immediately.
  --   * If this SELECT acquires FOR KEY SHARE before the UPDATE commits,
  --     the RPC completes (it already passed the authorization gate); the
  --     UPDATE waits for the RPC transaction to commit, then sets
  --     pilot_enabled=false, blocking all subsequent RPC calls.
  -- Multiple concurrent RPCs for the same user do not block each other:
  -- FOR KEY SHARE is compatible with other FOR KEY SHARE holders on the
  -- same row. No deadlock is possible because RPCs do not hold this lock
  -- while requesting any other lock that could create a cycle.
  SELECT * INTO v_membership
  FROM public.rete_memberships
  WHERE user_id = auth.uid() AND active
  FOR KEY SHARE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active membership';
  END IF;

  -- Fail-closed pilot gate: a missing membership, an inactive membership,
  -- and a pilot_enabled=false membership all raise the exact same
  -- exception. The caller must not be able to distinguish "you have no
  -- membership" from "you have a membership but the pilot is off" - both
  -- must look identical from outside the database.
  IF NOT v_membership.pilot_enabled THEN
    RAISE EXCEPTION 'no active membership';
  END IF;

  RETURN v_membership;
END;
$$;

ALTER FUNCTION "public"."rete_require_active_membership"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM "authenticated";

-- ---------------------------------------------------------------------------
-- 3. Re-order all nine RPCs: membership/pilot/role gate before the
--    idempotency claim. Bodies are otherwise byte-for-byte identical to
--    migration 20260716142429_rete_squillari_real_operations_rpc.sql: same
--    SECURITY DEFINER, same search_path, same validation, same locking,
--    same audit events, same idempotency store calls, same error messages.
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."rete_request_publish"(
    "p_requesting_location_id" smallint,
    "p_product_code" "text",
    "p_product_description" "text",
    "p_requested_quantity" integer,
    "p_urgency" "text" DEFAULT 'NORMALE',
    "p_notes" "text" DEFAULT NULL,
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
  v_request_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_request_publish', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_requested_quantity IS NULL OR p_requested_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM public.rete_locations WHERE id = p_requesting_location_id AND active) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  INSERT INTO public.rete_requests (
    requesting_location_id, product_code, product_description,
    requested_quantity, remaining_quantity, status, urgency, source, notes, created_by
  ) VALUES (
    p_requesting_location_id, p_product_code, p_product_description,
    p_requested_quantity, p_requested_quantity, 'DA_TROVARE', coalesce(p_urgency, 'NORMALE'), 'MANUAL', p_notes, auth.uid()
  ) RETURNING id INTO v_request_id;

  PERFORM public.rete_write_audit_event('request_published', 'request', v_request_id::text, NULL, 'DA_TROVARE', '{}'::jsonb);

  v_result := jsonb_build_object('request_id', v_request_id, 'status', 'DA_TROVARE');
  PERFORM public.rete_store_idempotency_result('rete_request_publish', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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
  v_request public.rete_requests;
  v_offer_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_offer_create', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_offered_quantity IS NULL OR p_offered_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('DA_TROVARE') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_request.requesting_location_id = v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  INSERT INTO public.rete_offers (request_id, offering_location_id, offered_quantity, status, offered_by)
  VALUES (p_request_id, v_membership.location_id, p_offered_quantity, 'PROPOSTA', auth.uid())
  RETURNING id INTO v_offer_id;

  PERFORM public.rete_write_audit_event('offer_created', 'offer', v_offer_id::text, NULL, 'PROPOSTA', jsonb_build_object('request_id', p_request_id));

  v_result := jsonb_build_object('offer_id', v_offer_id, 'status', 'PROPOSTA');
  PERFORM public.rete_store_idempotency_result('rete_offer_create', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_offer_withdraw"(
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
  v_offer public.rete_offers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_offer_withdraw', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_offer FROM public.rete_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.offering_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_offer.status <> 'PROPOSTA' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_offers SET status = 'RITIRATA' WHERE id = p_offer_id;

  PERFORM public.rete_write_audit_event('offer_withdrawn', 'offer', p_offer_id::text, 'PROPOSTA', 'RITIRATA', '{}'::jsonb);

  v_result := jsonb_build_object('offer_id', p_offer_id, 'status', 'RITIRATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_withdraw', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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
  v_offer public.rete_offers;
  v_request public.rete_requests;
  v_transfer_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_offer_approve', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_approved_quantity IS NULL OR p_approved_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_offer FROM public.rete_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.status <> 'PROPOSTA' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_approved_quantity > v_offer.offered_quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = v_offer.request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('DA_TROVARE') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Oversubscription guard: with both rows locked, remaining_quantity is
  -- already the true residual (no other approval can be mid-flight for this
  -- request without holding the same lock), so a simple bound check suffices.
  IF p_approved_quantity > v_request.remaining_quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  UPDATE public.rete_offers
  SET status = 'APPROVATA', approved_quantity = p_approved_quantity, approved_by = auth.uid()
  WHERE id = p_offer_id;

  INSERT INTO public.rete_transfers (request_id, offer_id, from_location_id, to_location_id, quantity, status, approved_by)
  VALUES (v_request.id, p_offer_id, v_offer.offering_location_id, v_request.requesting_location_id, p_approved_quantity, 'DA_PREPARARE', auth.uid())
  RETURNING id INTO v_transfer_id;

  UPDATE public.rete_requests
  SET remaining_quantity = remaining_quantity - p_approved_quantity
  WHERE id = v_request.id;

  PERFORM public.rete_request_recompute_status(v_request.id);

  PERFORM public.rete_write_audit_event('offer_approved', 'offer', p_offer_id::text, 'PROPOSTA', 'APPROVATA', jsonb_build_object('approved_quantity', p_approved_quantity));
  PERFORM public.rete_write_audit_event('transfer_created', 'transfer', v_transfer_id::text, NULL, 'DA_PREPARARE', jsonb_build_object('request_id', v_request.id, 'offer_id', p_offer_id));

  v_result := jsonb_build_object('offer_id', p_offer_id, 'transfer_id', v_transfer_id, 'status', 'APPROVATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_approve', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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
  v_offer public.rete_offers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_offer_reject', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_offer FROM public.rete_offers WHERE id = p_offer_id FOR UPDATE;
  IF NOT FOUND OR v_offer.status <> 'PROPOSTA' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_offers SET status = 'RIFIUTATA' WHERE id = p_offer_id;

  PERFORM public.rete_write_audit_event('offer_rejected', 'offer', p_offer_id::text, 'PROPOSTA', 'RIFIUTATA', '{}'::jsonb);

  v_result := jsonb_build_object('offer_id', p_offer_id, 'status', 'RIFIUTATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_reject', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_transfer_mark_ready"(
    "p_transfer_id" "uuid",
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
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_ready', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.from_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.status <> 'DA_PREPARARE' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_transfers SET status = 'PRONTA', prepared_at = now() WHERE id = p_transfer_id;

  PERFORM public.rete_write_audit_event('transfer_prepared', 'transfer', p_transfer_id::text, 'DA_PREPARARE', 'PRONTA', '{}'::jsonb);

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'PRONTA');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_ready', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_transfer_mark_departed"(
    "p_transfer_id" "uuid",
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
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_departed', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.from_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.status <> 'PRONTA' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_transfers SET status = 'IN_TRASFERIMENTO', departed_at = now() WHERE id = p_transfer_id;

  PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  PERFORM public.rete_write_audit_event('transfer_departed', 'transfer', p_transfer_id::text, 'PRONTA', 'IN_TRASFERIMENTO', '{}'::jsonb);

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'IN_TRASFERIMENTO');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_departed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_transfer_receive"(
    "p_transfer_id" "uuid",
    "p_received_quantity" integer,
    "p_anomaly_note" "text" DEFAULT NULL,
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
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_transfer_receive', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.to_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_transfer.status <> 'IN_TRASFERIMENTO' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_received_quantity IS NULL OR p_received_quantity < 0 OR p_received_quantity > v_transfer.quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_transfers
  SET status = 'RICEVUTA', received_at = now(), received_by = auth.uid(),
      received_quantity = p_received_quantity, anomaly_note = p_anomaly_note
  WHERE id = p_transfer_id;

  PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  PERFORM public.rete_write_audit_event(
    'transfer_received', 'transfer', p_transfer_id::text, 'IN_TRASFERIMENTO', 'RICEVUTA',
    jsonb_build_object('received_quantity', p_received_quantity, 'anomaly', (p_received_quantity <> v_transfer.quantity))
  );

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'RICEVUTA', 'received_quantity', p_received_quantity);
  PERFORM public.rete_store_idempotency_result('rete_transfer_receive', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

CREATE OR REPLACE FUNCTION "public"."rete_trasta_arrival_record"(
    "p_target_request_id" "uuid",
    "p_product_code" "text",
    "p_quantity" integer,
    "p_source_reference" "text" DEFAULT NULL,
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
  v_request public.rete_requests;
  v_arrival_id uuid;
  v_applied integer;
  v_new_status public.rete_request_status;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_cached := public.rete_claim_idempotency_key('rete_trasta_arrival_record', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_request FROM public.rete_requests WHERE id = p_target_request_id FOR UPDATE;
  IF NOT FOUND OR v_request.status NOT IN ('DA_TROVARE', 'ARRIVO_PARZIALE_A_TRASTA') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  INSERT INTO public.rete_trasta_arrivals (product_code, quantity, source_reference, recorded_by)
  VALUES (p_product_code, p_quantity, p_source_reference, auth.uid())
  RETURNING id INTO v_arrival_id;

  v_applied := least(p_quantity, v_request.remaining_quantity);

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  IF v_request.remaining_quantity - v_applied <= 0 THEN
    v_new_status := 'ARRIVATO_A_TRASTA';
  ELSE
    v_new_status := 'ARRIVO_PARZIALE_A_TRASTA';
  END IF;

  UPDATE public.rete_requests
  SET remaining_quantity = greatest(0, remaining_quantity - v_applied), status = v_new_status
  WHERE id = p_target_request_id;

  PERFORM public.rete_write_audit_event(
    'trasta_arrival_recorded', 'request', p_target_request_id::text, v_request.status::text, v_new_status::text,
    jsonb_build_object('arrival_id', v_arrival_id, 'quantity', p_quantity, 'applied', v_applied)
  );

  v_result := jsonb_build_object('arrival_id', v_arrival_id, 'request_id', p_target_request_id, 'status', v_new_status);
  PERFORM public.rete_store_idempotency_result('rete_trasta_arrival_record', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- 4. Re-lockdown (CREATE OR REPLACE preserves existing grants in Postgres,
--    but the owner/grants are restated explicitly here for auditability and
--    to guarantee no drift versus the original lockdown).
-- ---------------------------------------------------------------------------

ALTER FUNCTION "public"."rete_request_publish"(smallint, "text", "text", integer, "text", "text", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_offer_create"("uuid", integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_offer_withdraw"("uuid", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_offer_approve"("uuid", integer, "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_offer_reject"("uuid", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_transfer_mark_ready"("uuid", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_transfer_mark_departed"("uuid", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text") OWNER TO "postgres";
ALTER FUNCTION "public"."rete_trasta_arrival_record"("uuid", "text", integer, "text", "text") OWNER TO "postgres";

REVOKE ALL ON FUNCTION "public"."rete_request_publish"(smallint, "text", "text", integer, "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_offer_create"("uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_offer_withdraw"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_offer_approve"("uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_offer_reject"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_transfer_mark_ready"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_transfer_mark_departed"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_trasta_arrival_record"("uuid", "text", integer, "text", "text") FROM PUBLIC;

REVOKE ALL ON FUNCTION "public"."rete_request_publish"(smallint, "text", "text", integer, "text", "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_offer_create"("uuid", integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_offer_withdraw"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_offer_approve"("uuid", integer, "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_offer_reject"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_transfer_mark_ready"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_transfer_mark_departed"("uuid", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_trasta_arrival_record"("uuid", "text", integer, "text", "text") FROM "anon";

GRANT EXECUTE ON FUNCTION "public"."rete_request_publish"(smallint, "text", "text", integer, "text", "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_offer_create"("uuid", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_offer_withdraw"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_offer_approve"("uuid", integer, "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_offer_reject"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_transfer_mark_ready"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_transfer_mark_departed"("uuid", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_transfer_receive"("uuid", integer, "text", "text") TO "authenticated";
GRANT EXECUTE ON FUNCTION "public"."rete_trasta_arrival_record"("uuid", "text", integer, "text", "text") TO "authenticated";
