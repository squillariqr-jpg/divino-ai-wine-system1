-- Migration 3: rete_squillari_real_operations_rpc
--
-- Adds the governed write path for real (non-demo) Rete Squillari operational
-- data: an idempotency ledger, an internal audit writer, a received-quantity
-- column on rete_transfers, protected-column guard triggers, and nine
-- SECURITY DEFINER RPCs covering the full request -> offer -> transfer ->
-- receipt / Trasta-arrival lifecycle for the Malta + Centrale pilot.
--
-- Design decisions made explicit here (certified by the prior read-only
-- assessment, decided during implementation):
--   * remaining_quantity is decremented at OFFER APPROVAL time (not at
--     receipt), matching the existing frontend demo behaviour. A request
--     reaches DA_PREPARARE once fully covered by approved offers, and only
--     reaches CHIUSA once every non-cancelled transfer for it has been
--     received.
--   * a request's status is recomputed (never client-supplied) from the
--     aggregate state of its own transfers by
--     rete_request_recompute_status(), called at the end of every RPC that
--     touches a transfer belonging to that request.
--   * Trasta-arrival matching to a request is never automatic/ambiguous:
--     rete_trasta_arrival_record requires an explicit target_request_id
--     chosen by Centrale, never a product_code lookup.
--   * No new enum values are introduced (enums are left untouched, per
--     boundary). No conflict-resolution RPC is introduced in this gate: it
--     was not part of the certified RPC list, and is left as a documented
--     gap for a future gate rather than exposed as an un-audited raw UPDATE.
--
-- Nothing in this migration is applied to the remote project. It is replayed
-- exclusively against the local Supabase stack via `supabase db reset --local`.

-- ---------------------------------------------------------------------------
-- 1. Idempotency ledger
-- ---------------------------------------------------------------------------
-- Every RPC that performs a real mutation claims (operation, idempotency_key)
-- before doing any work. A retry with the same key returns the cached result
-- instead of repeating the side effects. Never directly readable/writable by
-- authenticated/anon: only the SECURITY DEFINER RPCs below (running as the
-- table owner) touch it.

CREATE TABLE IF NOT EXISTS "public"."rete_idempotent_operations" (
    "operation" "text" NOT NULL,
    "idempotency_key" "text" NOT NULL,
    "actor_user_id" "uuid" NOT NULL,
    "result" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "rete_idempotent_operations_pkey" PRIMARY KEY ("operation", "idempotency_key"),
    CONSTRAINT "rete_idempotent_operations_operation_check" CHECK ((("length"(TRIM(BOTH FROM "operation")) >= 1) AND ("length"(TRIM(BOTH FROM "operation")) <= 100))),
    CONSTRAINT "rete_idempotent_operations_key_check" CHECK ((("length"(TRIM(BOTH FROM "idempotency_key")) >= 1) AND ("length"(TRIM(BOTH FROM "idempotency_key")) <= 200)))
);

ALTER TABLE "public"."rete_idempotent_operations" OWNER TO "postgres";

ALTER TABLE ONLY "public"."rete_idempotent_operations"
    ADD CONSTRAINT "rete_idempotent_operations_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "auth"."users"("id");

ALTER TABLE "public"."rete_idempotent_operations" ENABLE ROW LEVEL SECURITY;

-- No policies for authenticated/anon: RLS enabled with zero permissive
-- policies denies all access to those roles. Only the table owner (postgres,
-- which the RPCs below run as) can read/write it.

REVOKE ALL ON TABLE "public"."rete_idempotent_operations" FROM "anon";
REVOKE ALL ON TABLE "public"."rete_idempotent_operations" FROM "authenticated";
GRANT ALL ON TABLE "public"."rete_idempotent_operations" TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. received_quantity on rete_transfers
-- ---------------------------------------------------------------------------
-- received_at/received_by already exist (migration 1). The only genuine gap
-- certified by the prior assessment (G-3, BLOCKER) is the missing quantity
-- actually received, distinct from the quantity transferred, needed to
-- represent a partial/anomalous receipt exactly like the frontend demo does.

ALTER TABLE "public"."rete_transfers"
    ADD COLUMN IF NOT EXISTS "received_quantity" integer;

ALTER TABLE "public"."rete_transfers"
    ADD CONSTRAINT "rete_transfers_received_quantity_check"
    CHECK (("received_quantity" IS NULL) OR (("received_quantity" >= 0) AND ("received_quantity" <= "quantity")));

COMMENT ON COLUMN "public"."rete_transfers"."received_quantity" IS
    'Quantity actually confirmed received by the destination store. NULL until rete_transfer_receive() runs. Never exceeds quantity (the amount transferred).';

-- ---------------------------------------------------------------------------
-- 3. Protected-column guard triggers
-- ---------------------------------------------------------------------------
-- rete_requests.status/remaining_quantity/closed_at and
-- rete_offers.status/approved_quantity/approved_by and
-- rete_transfers.status/received_quantity/received_at/received_by/
-- prepared_at/departed_at must only ever change as a side effect of a
-- governed RPC below, never via a raw client UPDATE - even though RLS
-- already restricts who may attempt such an UPDATE, RLS alone cannot express
-- "this column may only change via a trusted code path" (it has no OLD-vs-NEW
-- comparison). Each RPC sets a transaction-local trusted flag before
-- touching these columns; the flag reverts automatically at transaction end.

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
         OR NEW.closed_at IS DISTINCT FROM OLD.closed_at THEN
        RAISE EXCEPTION 'rete_requests: status, remaining_quantity and closed_at can only change via a governed operation';
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
         OR NEW.departed_at IS DISTINCT FROM OLD.departed_at THEN
        RAISE EXCEPTION 'rete_transfers: status and receipt/prep/departure fields can only change via a governed operation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

ALTER FUNCTION "public"."rete_guard_protected_columns"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_guard_protected_columns"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_guard_protected_columns"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_guard_protected_columns"() FROM "authenticated";

CREATE TRIGGER "rete_requests_guard_protected_columns_trg"
    BEFORE UPDATE ON "public"."rete_requests"
    FOR EACH ROW EXECUTE FUNCTION "public"."rete_guard_protected_columns"();

CREATE TRIGGER "rete_offers_guard_protected_columns_trg"
    BEFORE UPDATE ON "public"."rete_offers"
    FOR EACH ROW EXECUTE FUNCTION "public"."rete_guard_protected_columns"();

CREATE TRIGGER "rete_transfers_guard_protected_columns_trg"
    BEFORE UPDATE ON "public"."rete_transfers"
    FOR EACH ROW EXECUTE FUNCTION "public"."rete_guard_protected_columns"();

-- ---------------------------------------------------------------------------
-- 4. Internal helpers (never directly executable by anon/authenticated)
-- ---------------------------------------------------------------------------

CREATE OR REPLACE FUNCTION "public"."rete_require_active_membership"()
RETURNS "public"."rete_memberships"
LANGUAGE "plpgsql"
STABLE
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'not authenticated';
  END IF;

  SELECT * INTO v_membership
  FROM public.rete_memberships
  WHERE user_id = auth.uid() AND active;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'no active membership';
  END IF;

  RETURN v_membership;
END;
$$;

ALTER FUNCTION "public"."rete_require_active_membership"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_require_active_membership"() FROM "authenticated";

-- Internal audit writer. authenticated has no INSERT grant on
-- rete_audit_events at all (migration 1); this function is the only path
-- that can ever populate it, and it is itself never grantable to
-- anon/authenticated - only the RPCs below (owned by the same definer) can
-- call it.
CREATE OR REPLACE FUNCTION "public"."rete_write_audit_event"(
    "p_event_type" "text",
    "p_entity_type" "text",
    "p_entity_id" "text",
    "p_previous_state" "text",
    "p_new_state" "text",
    "p_metadata" "jsonb" DEFAULT '{}'::"jsonb"
)
RETURNS void
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
BEGIN
  SELECT * INTO v_membership FROM public.rete_memberships WHERE user_id = auth.uid() AND active;

  INSERT INTO public.rete_audit_events (actor_user_id, event_type, entity_type, entity_id, payload)
  VALUES (
    auth.uid(),
    p_event_type,
    p_entity_type,
    p_entity_id,
    jsonb_build_object(
      'actor_role', v_membership.role,
      'actor_location_id', v_membership.location_id,
      'previous_state', p_previous_state,
      'new_state', p_new_state,
      'metadata', coalesce(p_metadata, '{}'::jsonb)
    )
  );
END;
$$;

ALTER FUNCTION "public"."rete_write_audit_event"("text", "text", "text", "text", "text", "jsonb") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_write_audit_event"("text", "text", "text", "text", "text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_write_audit_event"("text", "text", "text", "text", "text", "jsonb") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_write_audit_event"("text", "text", "text", "text", "text", "jsonb") FROM "authenticated";

-- Recomputes a request's status from the aggregate state of its own
-- transfers. Never client-invoked directly; called at the end of every RPC
-- that changes a transfer belonging to the request.
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
         count(*) FILTER (WHERE status IN ('IN_TRASFERIMENTO', 'RICEVUTA'))
    INTO v_transfer_count, v_received_count, v_departed_count
  FROM public.rete_transfers
  WHERE request_id = p_request_id;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  IF v_transfer_count > 0 AND v_received_count = v_transfer_count AND v_request.remaining_quantity = 0 THEN
    UPDATE public.rete_requests SET status = 'CHIUSA', closed_at = now() WHERE id = p_request_id;
  ELSIF v_departed_count > 0 THEN
    UPDATE public.rete_requests SET status = 'IN_TRASFERIMENTO' WHERE id = p_request_id;
  ELSIF v_transfer_count > 0 AND v_request.remaining_quantity = 0 THEN
    UPDATE public.rete_requests SET status = 'DA_PREPARARE' WHERE id = p_request_id;
  END IF;
  -- Otherwise (still open, no transfer has departed yet, not fully covered):
  -- leave status as-is (DA_TROVARE/DA_CONFERMARE). This function never moves
  -- a request backward and never touches DA_VERIFICARE/ARRIVO*/ARRIVATO*
  -- (those belong to rete_trasta_arrival_record's own path).
END;
$$;

ALTER FUNCTION "public"."rete_request_recompute_status"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_request_recompute_status"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_request_recompute_status"("uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_request_recompute_status"("uuid") FROM "authenticated";

-- Idempotency claim helper: returns the cached result if (operation, key)
-- was already recorded, else NULL after having claimed the key for this call.
CREATE OR REPLACE FUNCTION "public"."rete_claim_idempotency_key"("p_operation" "text", "p_idempotency_key" "text")
RETURNS "jsonb"
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_cached jsonb;
BEGIN
  IF p_idempotency_key IS NULL OR length(trim(p_idempotency_key)) = 0 THEN
    RAISE EXCEPTION 'idempotency_key is required';
  END IF;

  BEGIN
    INSERT INTO public.rete_idempotent_operations (operation, idempotency_key, actor_user_id, result)
    VALUES (p_operation, p_idempotency_key, auth.uid(), 'null'::jsonb);
    RETURN NULL;
  EXCEPTION WHEN unique_violation THEN
    SELECT result INTO v_cached
    FROM public.rete_idempotent_operations
    WHERE operation = p_operation AND idempotency_key = p_idempotency_key;
    RETURN coalesce(v_cached, 'null'::jsonb);
  END;
END;
$$;

ALTER FUNCTION "public"."rete_claim_idempotency_key"("text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_claim_idempotency_key"("text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_claim_idempotency_key"("text", "text") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_claim_idempotency_key"("text", "text") FROM "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_store_idempotency_result"("p_operation" "text", "p_idempotency_key" "text", "p_result" "jsonb")
RETURNS void
LANGUAGE "sql"
SET "search_path" = "public", "pg_temp"
AS $$
  UPDATE public.rete_idempotent_operations
  SET result = p_result
  WHERE operation = p_operation AND idempotency_key = p_idempotency_key;
$$;

ALTER FUNCTION "public"."rete_store_idempotency_result"("text", "text", "jsonb") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_store_idempotency_result"("text", "text", "jsonb") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_store_idempotency_result"("text", "text", "jsonb") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_store_idempotency_result"("text", "text", "jsonb") FROM "authenticated";

-- ---------------------------------------------------------------------------
-- 5. Public RPCs (SECURITY DEFINER, one per governed transition)
-- ---------------------------------------------------------------------------
-- Every RPC below: requires auth.uid(), requires an active membership,
-- verifies role/location from the DB (never trusts a client-supplied role or
-- location), validates quantities are positive integers, locks the rows it
-- touches (SELECT ... FOR UPDATE), is idempotent via
-- rete_claim_idempotency_key, writes exactly one audit event per real
-- transition, and raises a single generic exception message on any
-- authorization/validation failure (no internal detail leaked).

-- 5.1 Central publishes a request (already-verified, skips DA_VERIFICARE).
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
  v_cached := public.rete_claim_idempotency_key('rete_request_publish', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
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

-- 5.2 Store creates an offer.
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
  v_cached := public.rete_claim_idempotency_key('rete_offer_create', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
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

-- 5.3 Store withdraws its own not-yet-approved offer.
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
  v_cached := public.rete_claim_idempotency_key('rete_offer_withdraw', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
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

-- 5.4 Central approves an offer and atomically creates the corresponding
-- transfer. This is the core concurrency-critical operation: locks the
-- offer then the request, recomputes remaining_quantity inside the same
-- transaction, and rejects oversubscription.
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
  v_cached := public.rete_claim_idempotency_key('rete_offer_approve', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
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

-- 5.5 Central rejects an offer.
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
  v_cached := public.rete_claim_idempotency_key('rete_offer_reject', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
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

-- 5.6 Offering store confirms preparation.
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
  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_ready', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.from_location_id <> v_membership.location_id OR v_membership.role <> 'store' THEN
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

-- Offering store confirms departure.
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
  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_departed', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();

  SELECT * INTO v_transfer FROM public.rete_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND OR v_transfer.from_location_id <> v_membership.location_id OR v_membership.role <> 'store' THEN
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

-- 5.7 Destination store confirms receipt.
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
  v_cached := public.rete_claim_idempotency_key('rete_transfer_receive', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();

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

-- 5.8 Central records a Trasta arrival against an explicit, human-chosen
-- request (never resolved automatically by product_code, to avoid ambiguity
-- when multiple open requests share a code).
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
  v_cached := public.rete_claim_idempotency_key('rete_trasta_arrival_record', p_idempotency_key);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
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
-- 6. SECURITY DEFINER lockdown (owner, search_path, PUBLIC/anon revocation,
--    authenticated-only execute grant)
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

-- ---------------------------------------------------------------------------
-- 7. Restrict direct-table policies that would otherwise bypass the RPCs
-- ---------------------------------------------------------------------------
-- Offer/transfer/Trasta-arrival state transitions that must be atomic and
-- audited can no longer be reached by a raw client INSERT/UPDATE. Simple,
-- single-row, non-concurrency-sensitive writes (store's own request
-- creation, store's own offer creation) keep their existing direct-RLS path
-- unchanged - the RPCs for those exist for audit/idempotency, not because
-- the raw path was unsafe.

DROP POLICY IF EXISTS "offering store or central updates offers" ON "public"."rete_offers";
-- Store may still withdraw its own PROPOSTA offer directly if it wants to
-- (rete_offer_withdraw exists for the audited path; this keeps behaviour
-- backward compatible without granting central any raw approve/reject path).
CREATE POLICY "store withdraws own proposed offer" ON "public"."rete_offers" FOR UPDATE TO "authenticated"
USING ((EXISTS ( SELECT 1 FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'store'::"public"."rete_user_role") AND ("m"."location_id" = "rete_offers"."offering_location_id")))))
WITH CHECK ((("status" = ANY (ARRAY['PROPOSTA'::"public"."rete_offer_status", 'RITIRATA'::"public"."rete_offer_status"])) AND ("approved_quantity" IS NULL) AND ("approved_by" IS NULL) AND (EXISTS ( SELECT 1 FROM "public"."rete_memberships" "m"
  WHERE (("m"."user_id" = ( SELECT "auth"."uid"() AS "uid")) AND "m"."active" AND ("m"."role" = 'store'::"public"."rete_user_role") AND ("m"."location_id" = "rete_offers"."offering_location_id"))))));

DROP POLICY IF EXISTS "central creates transfers" ON "public"."rete_transfers";
DROP POLICY IF EXISTS "central or involved stores update transfers" ON "public"."rete_transfers";
-- No replacement policy: every transfer INSERT/UPDATE now goes exclusively
-- through rete_offer_approve / rete_transfer_mark_ready /
-- rete_transfer_mark_departed / rete_transfer_receive, which bypass RLS as
-- the table owner. Direct client INSERT/UPDATE on rete_transfers is denied.

DROP POLICY IF EXISTS "central records trasta arrivals" ON "public"."rete_trasta_arrivals";
-- No replacement policy: arrivals are recorded exclusively through
-- rete_trasta_arrival_record.

-- rete_requests: direct UPDATE by the requesting store or central is kept
-- for administrative fields (notes, urgency, product_description
-- correction), but status/remaining_quantity/closed_at are hard-blocked by
-- the guard trigger installed in section 3 above regardless of this policy,
-- so no policy change is required here to prevent bypass.
