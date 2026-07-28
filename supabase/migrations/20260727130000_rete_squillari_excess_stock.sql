-- Rete Squillari — excess stock publication.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Depends on
-- 20260727120000 (enum values), 20260727110000 (automatic offer
-- acceptance, for the approved_by nullability fix reused below) and
-- 20260724110000 (WhatsApp outbox) having already been applied.
--
-- Deliberately separate from rete_requests/rete_offers (see
-- 20260727120000's header for the full audit reasoning): excess stock has
-- no requesting party until a reservation exists, so reusing those tables
-- would force either a fake self-referential request or an offer with no
-- request_id - both blur meanings the rest of this codebase treats as
-- structurally guaranteed.
--
-- The transfer LIFECYCLE is reused, not reimplemented: rete_transfers gains
-- a nullable excess_reservation_id alongside its now-nullable request_id/
-- offer_id/approved_by, with a CHECK enforcing that a transfer belongs to
-- exactly one world (a shortage-request offer, or an excess reservation),
-- never both, never neither. rete_transfer_mark_ready/mark_departed/receive
-- are extended (not duplicated) to also drive the excess-reservation
-- status forward when a transfer is excess-linked - genuinely one transfer
-- system, per the gate's own instruction.

BEGIN;

-- ---------------------------------------------------------------------------
-- 0. rete_transfers: make request_id/offer_id nullable, add the excess
--    reservation link, and enforce "exactly one world" with a CHECK.
-- ---------------------------------------------------------------------------
ALTER TABLE "public"."rete_transfers" ALTER COLUMN "request_id" DROP NOT NULL;
ALTER TABLE "public"."rete_transfers" ALTER COLUMN "offer_id" DROP NOT NULL;
ALTER TABLE "public"."rete_transfers" ADD COLUMN IF NOT EXISTS "excess_reservation_id" "uuid";
ALTER TABLE "public"."rete_transfers"
  ADD CONSTRAINT "rete_transfers_exactly_one_world_check"
  CHECK ((("request_id" IS NOT NULL) AND ("excess_reservation_id" IS NULL))
      OR (("request_id" IS NULL) AND ("excess_reservation_id" IS NOT NULL)));

-- ---------------------------------------------------------------------------
-- 1. rete_excess_stock
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_excess_stock" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "offering_location_id" smallint NOT NULL REFERENCES "public"."rete_locations"("id"),
  "catalog_product_id" "text" NOT NULL,
  "product_code" "text" NOT NULL,
  "ean" "text",
  "product_description" "text" NOT NULL,
  "initial_quantity" integer NOT NULL,
  "remaining_quantity" integer NOT NULL,
  "reason" "public"."rete_excess_stock_reason" NOT NULL,
  "notes" "text",
  "status" "public"."rete_excess_stock_status" NOT NULL DEFAULT 'AVAILABLE',
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "withdrawn_at" timestamp with time zone,
  "created_by" "uuid" NOT NULL,
  "version" integer NOT NULL DEFAULT 0,
  CONSTRAINT "rete_excess_stock_initial_quantity_check" CHECK ("initial_quantity" > 0),
  CONSTRAINT "rete_excess_stock_remaining_quantity_check" CHECK (("remaining_quantity" >= 0) AND ("remaining_quantity" <= "initial_quantity")),
  CONSTRAINT "rete_excess_stock_notes_check" CHECK (("notes" IS NULL) OR (length("notes") <= 500)),
  CONSTRAINT "rete_excess_stock_product_code_check" CHECK (length(trim("product_code")) >= 1 AND length("product_code") <= 64),
  CONSTRAINT "rete_excess_stock_description_check" CHECK (length(trim("product_description")) >= 1 AND length("product_description") <= 240),
  CONSTRAINT "rete_excess_stock_catalog_product_id_check" CHECK (length(trim("catalog_product_id")) >= 1)
);
CREATE INDEX IF NOT EXISTS "rete_excess_stock_visible_idx" ON "public"."rete_excess_stock" ("status") WHERE "status" IN ('AVAILABLE', 'PARTIALLY_RESERVED');

ALTER TABLE "public"."rete_excess_stock" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_excess_stock" FROM "anon", "public";
GRANT SELECT ON "public"."rete_excess_stock" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_excess_stock" TO "service_role";

-- Active pilot members see AVAILABLE/PARTIALLY_RESERVED entries from any
-- store, plus their OWN entries regardless of status (so a store can see
-- its own WITHDRAWN/EXPIRED/COMPLETED/FULLY_RESERVED history). Central
-- sees everything. Inactive members and anonymous users match no row at
-- all (no membership row -> the EXISTS clause fails).
CREATE POLICY "active pilot members read excess stock" ON "public"."rete_excess_stock" FOR SELECT TO "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."rete_memberships" m
      WHERE m.user_id = (SELECT auth.uid()) AND m.active AND m.pilot_enabled
        AND (m.role = 'central' OR status IN ('AVAILABLE', 'PARTIALLY_RESERVED') OR m.location_id = offering_location_id)
    )
  );

-- ---------------------------------------------------------------------------
-- 2. rete_excess_reservations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_excess_reservations" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "excess_stock_id" "uuid" NOT NULL REFERENCES "public"."rete_excess_stock"("id"),
  "requesting_location_id" smallint NOT NULL REFERENCES "public"."rete_locations"("id"),
  "quantity" integer NOT NULL,
  "status" "public"."rete_excess_reservation_status" NOT NULL DEFAULT 'ACCEPTED',
  "idempotency_key" "text",
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "accepted_at" timestamp with time zone,
  "transfer_id" "uuid" REFERENCES "public"."rete_transfers"("id"),
  "received_at" timestamp with time zone,
  "cancelled_at" timestamp with time zone,
  CONSTRAINT "rete_excess_reservations_quantity_check" CHECK ("quantity" > 0),
  CONSTRAINT "rete_excess_reservations_idempotency_key_unique" UNIQUE ("idempotency_key")
);
ALTER TABLE "public"."rete_excess_reservations" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_excess_reservations" FROM "anon", "public";
GRANT SELECT ON "public"."rete_excess_reservations" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_excess_reservations" TO "service_role";

CREATE POLICY "relevant members read excess reservations" ON "public"."rete_excess_reservations" FOR SELECT TO "authenticated"
  USING (
    EXISTS (
      SELECT 1 FROM "public"."rete_memberships" m
      WHERE m.user_id = (SELECT auth.uid()) AND m.active
        AND (
          m.role = 'central'
          OR m.location_id = requesting_location_id
          OR EXISTS (SELECT 1 FROM "public"."rete_excess_stock" es WHERE es.id = excess_stock_id AND es.offering_location_id = m.location_id)
        )
    )
  );

-- ---------------------------------------------------------------------------
-- 3. rete_excess_stock_config (singleton, central-configurable limit)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_excess_stock_config" (
  "id" boolean PRIMARY KEY DEFAULT true,
  "max_active_per_store" integer NOT NULL DEFAULT 10,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_by" "uuid",
  CONSTRAINT "rete_excess_stock_config_singleton_check" CHECK ("id"),
  CONSTRAINT "rete_excess_stock_config_limit_check" CHECK ("max_active_per_store" > 0)
);
INSERT INTO "public"."rete_excess_stock_config" ("id", "max_active_per_store") VALUES (true, 10)
  ON CONFLICT ("id") DO NOTHING;
ALTER TABLE "public"."rete_excess_stock_config" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_excess_stock_config" FROM "anon", "public";
GRANT SELECT ON "public"."rete_excess_stock_config" TO "authenticated";
GRANT ALL ON TABLE "public"."rete_excess_stock_config" TO "service_role";
CREATE POLICY "active members read excess stock config" ON "public"."rete_excess_stock_config" FOR SELECT TO "authenticated"
  USING (EXISTS (SELECT 1 FROM "public"."rete_memberships" m WHERE m.user_id = (SELECT auth.uid()) AND m.active));

-- ---------------------------------------------------------------------------
-- 4. Extend the protected-column guard to the two new tables (same
--    mechanism as every previous extension) - direct writes to lifecycle/
--    quantity/status fields are blocked outside a governed RPC.
-- ---------------------------------------------------------------------------
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
    ELSIF TG_TABLE_NAME = 'rete_excess_stock' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.remaining_quantity IS DISTINCT FROM OLD.remaining_quantity
         OR NEW.withdrawn_at IS DISTINCT FROM OLD.withdrawn_at
         OR NEW.version IS DISTINCT FROM OLD.version
         OR NEW.catalog_product_id IS DISTINCT FROM OLD.catalog_product_id
         OR NEW.product_code IS DISTINCT FROM OLD.product_code
         OR NEW.product_description IS DISTINCT FROM OLD.product_description
         OR NEW.offering_location_id IS DISTINCT FROM OLD.offering_location_id THEN
        RAISE EXCEPTION 'rete_excess_stock: status, quantity, product identity, offering store, and lifecycle fields can only change via a governed operation';
      END IF;
    ELSIF TG_TABLE_NAME = 'rete_excess_reservations' THEN
      IF NEW.status IS DISTINCT FROM OLD.status
         OR NEW.accepted_at IS DISTINCT FROM OLD.accepted_at
         OR NEW.transfer_id IS DISTINCT FROM OLD.transfer_id
         OR NEW.received_at IS DISTINCT FROM OLD.received_at
         OR NEW.cancelled_at IS DISTINCT FROM OLD.cancelled_at THEN
        RAISE EXCEPTION 'rete_excess_reservations: status and lifecycle fields can only change via a governed operation';
      END IF;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS "rete_guard_protected_columns_excess_stock" ON "public"."rete_excess_stock";
CREATE TRIGGER "rete_guard_protected_columns_excess_stock" BEFORE UPDATE ON "public"."rete_excess_stock"
  FOR EACH ROW EXECUTE FUNCTION "public"."rete_guard_protected_columns"();

DROP TRIGGER IF EXISTS "rete_guard_protected_columns_excess_reservations" ON "public"."rete_excess_reservations";
CREATE TRIGGER "rete_guard_protected_columns_excess_reservations" BEFORE UPDATE ON "public"."rete_excess_reservations"
  FOR EACH ROW EXECUTE FUNCTION "public"."rete_guard_protected_columns"();

-- ---------------------------------------------------------------------------
-- 5. rete_excess_stock_recompute_status - mirrors rete_request_recompute_status's
--    pattern. COMPLETED once remaining_quantity = 0 and every reservation
--    against this entry has reached RECEIVED (none are ever CANCELLED by
--    any RPC in this gate, so that branch never blocks completion here).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_recompute_status"("p_excess_stock_id" "uuid")
RETURNS void
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_stock public.rete_excess_stock;
  v_open_reservations integer;
BEGIN
  SELECT * INTO v_stock FROM public.rete_excess_stock WHERE id = p_excess_stock_id FOR UPDATE;
  IF NOT FOUND OR v_stock.status IN ('WITHDRAWN', 'EXPIRED', 'COMPLETED') THEN
    RETURN;
  END IF;

  SELECT count(*) INTO v_open_reservations
  FROM public.rete_excess_reservations
  WHERE excess_stock_id = p_excess_stock_id AND status NOT IN ('RECEIVED', 'CANCELLED');

  IF v_stock.remaining_quantity = 0 AND v_open_reservations = 0 THEN
    UPDATE public.rete_excess_stock SET status = 'COMPLETED', updated_at = now() WHERE id = p_excess_stock_id;
  END IF;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_recompute_status"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_recompute_status"("uuid") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_recompute_status"("uuid") FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_recompute_status"("uuid") FROM "authenticated";
-- Internal helper only, called from other SECURITY DEFINER functions owned
-- by postgres - never granted to authenticated/anon directly, same lockdown
-- pattern as the pre-existing rete_request_recompute_status.

-- ---------------------------------------------------------------------------
-- 6. rete_excess_stock_publish
--
-- product_code/catalog_product_id/product_description are trusted as
-- already-verified by the caller (the server-side-only
-- /api/rete-squillari/excess-stock/verify-product route, which performs
-- the exact catalog lookup - the WBOS catalog lives in a different Supabase
-- project entirely and cannot be reached from inside this database). This
-- RPC enforces that those fields are non-empty, exactly the same trust
-- boundary the existing rete_manual_request_create already relies on for
-- store-entered product_code/product_description - it does not, and
-- structurally cannot, re-verify the catalog match itself.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_publish"(
  "p_product_code" "text",
  "p_catalog_product_id" "text",
  "p_product_description" "text",
  "p_quantity" integer,
  "p_reason" "public"."rete_excess_stock_reason",
  "p_catalog_match_method" "text" DEFAULT 'PRODUCT_CODE',
  "p_ean" "text" DEFAULT NULL,
  "p_notes" "text" DEFAULT NULL,
  "p_expires_at" timestamp with time zone DEFAULT NULL,
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
  v_active_count integer;
  v_limit integer;
  v_id uuid;
  v_published_at timestamp with time zone;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_membership.pilot_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'product_code', p_product_code, 'catalog_product_id', p_catalog_product_id,
    'product_description', p_product_description, 'quantity', p_quantity, 'reason', p_reason,
    'ean', p_ean, 'notes', p_notes, 'expires_at', p_expires_at
  );
  v_cached := public.rete_claim_idempotency_key('rete_excess_stock_publish', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_catalog_product_id IS NULL OR length(trim(p_catalog_product_id)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_product_code IS NULL OR length(trim(p_product_code)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_product_description IS NULL OR length(trim(p_product_description)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_reason IS NULL THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- Per-store excess limit (central-configurable), counted over
  -- AVAILABLE + PARTIALLY_RESERVED only - a separate budget from the
  -- 60-card shortage-request network budget, never shared with it.
  PERFORM pg_advisory_xact_lock(hashtext('rete_excess_stock_publish:' || v_membership.location_id));
  SELECT count(*) INTO v_active_count FROM public.rete_excess_stock
    WHERE offering_location_id = v_membership.location_id AND status IN ('AVAILABLE', 'PARTIALLY_RESERVED');
  SELECT max_active_per_store INTO v_limit FROM public.rete_excess_stock_config WHERE id = true;
  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  -- No active duplicate for the same store + canonical catalog product -
  -- keyed on catalog_product_id (the verified catalog identity), never on
  -- the store's own free-text description, so two differently-worded
  -- submissions of the same real product still collide correctly.
  IF EXISTS (
    SELECT 1 FROM public.rete_excess_stock
    WHERE offering_location_id = v_membership.location_id
      AND catalog_product_id = p_catalog_product_id
      AND status IN ('AVAILABLE', 'PARTIALLY_RESERVED')
  ) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_published_at := now();
  PERFORM set_config('rete.trusted_rpc', 'on', true);
  INSERT INTO public.rete_excess_stock (
    offering_location_id, catalog_product_id, product_code, ean, product_description,
    initial_quantity, remaining_quantity, reason, notes, status, expires_at, created_by, created_at, updated_at
  ) VALUES (
    v_membership.location_id, p_catalog_product_id, p_product_code, p_ean, p_product_description,
    p_quantity, p_quantity, p_reason, p_notes, 'AVAILABLE', p_expires_at, auth.uid(), v_published_at, v_published_at
  )
  RETURNING id INTO v_id;

  -- No approval record is created, none is required, and no approver
  -- identity is fabricated - publication_mode is always AUTOMATIC and
  -- there is no "approved_by" concept for excess stock at all.
  PERFORM public.rete_write_audit_event('excess_stock_published', 'excess_stock', v_id::text, NULL, 'AVAILABLE',
    jsonb_build_object(
      'created_by', auth.uid(), 'offering_location_id', v_membership.location_id,
      'published_at', v_published_at, 'publication_mode', 'AUTOMATIC',
      'catalog_match_method', p_catalog_match_method, 'initial_quantity', p_quantity,
      'reason', p_reason, 'idempotency_key', p_idempotency_key
    ));

  -- Deliberately NOT broadcast to every store immediately (Phase 10: "do
  -- not broadcast every publication immediately in the initial version" -
  -- in-app visibility via the SELECT policy above is immediate; an
  -- optional digest is a future, separate gate).

  v_result := jsonb_build_object(
    'excess_stock_id', v_id, 'status', 'AVAILABLE', 'remaining_quantity', p_quantity,
    'published_at', v_published_at, 'publication_mode', 'AUTOMATIC', 'approved_by', NULL,
    'human_approval_required', false
  );
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_publish', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_publish"("text", "text", "text", integer, "public"."rete_excess_stock_reason", "text", "text", "text", timestamp with time zone, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_publish"("text", "text", "text", integer, "public"."rete_excess_stock_reason", "text", "text", "text", timestamp with time zone, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_publish"("text", "text", "text", integer, "public"."rete_excess_stock_reason", "text", "text", "text", timestamp with time zone, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_excess_stock_publish"("text", "text", "text", integer, "public"."rete_excess_stock_reason", "text", "text", "text", timestamp with time zone, "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 7. rete_excess_stock_reserve - automatic acceptance, atomic, under the
--    excess-stock row's own lock (same pattern proven for offers).
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_reserve"(
  "p_excess_stock_id" "uuid",
  "p_quantity" integer,
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
  v_stock public.rete_excess_stock;
  v_reservation_id uuid;
  v_transfer_id uuid;
  v_new_status public.rete_excess_stock_status;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_membership.pilot_enabled IS NOT TRUE THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('excess_stock_id', p_excess_stock_id, 'quantity', p_quantity);
  v_cached := public.rete_claim_idempotency_key('rete_excess_stock_reserve', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_quantity IS NULL OR p_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_stock FROM public.rete_excess_stock WHERE id = p_excess_stock_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_stock.offering_location_id = v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_stock.status NOT IN ('AVAILABLE', 'PARTIALLY_RESERVED') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF v_stock.expires_at IS NOT NULL AND v_stock.expires_at <= now() THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_quantity > v_stock.remaining_quantity THEN
    -- Over-reservation: hard rejected, never clipped. The caller (frontend)
    -- reloads the entry after any rejection, so the current
    -- remaining_quantity is always shown fresh rather than embedded in a
    -- generic exception payload - consistent with this codebase's existing
    -- "never leak specifics via the error message" pattern.
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);

  INSERT INTO public.rete_excess_reservations (excess_stock_id, requesting_location_id, quantity, status, idempotency_key, accepted_at)
  VALUES (p_excess_stock_id, v_membership.location_id, p_quantity, 'ACCEPTED', p_idempotency_key, now())
  RETURNING id INTO v_reservation_id;

  v_new_status := CASE WHEN v_stock.remaining_quantity - p_quantity = 0 THEN 'FULLY_RESERVED' ELSE 'PARTIALLY_RESERVED' END;
  UPDATE public.rete_excess_stock
  SET remaining_quantity = remaining_quantity - p_quantity, status = v_new_status, version = version + 1, updated_at = now()
  WHERE id = p_excess_stock_id;

  -- Transfer task created in the same transaction, same lifecycle table as
  -- shortage-request transfers - request_id/offer_id NULL, excess_reservation_id
  -- set, approved_by NULL (no human approver for an automatic acceptance).
  INSERT INTO public.rete_transfers (excess_reservation_id, from_location_id, to_location_id, quantity, status)
  VALUES (v_reservation_id, v_stock.offering_location_id, v_membership.location_id, p_quantity, 'DA_PREPARARE')
  RETURNING id INTO v_transfer_id;

  UPDATE public.rete_excess_reservations SET transfer_id = v_transfer_id WHERE id = v_reservation_id;

  PERFORM public.rete_write_audit_event('excess_stock_reserved', 'excess_stock', p_excess_stock_id::text, v_stock.status::text, v_new_status::text,
    jsonb_build_object('reservation_id', v_reservation_id, 'quantity', p_quantity, 'requesting_location_id', v_membership.location_id));
  PERFORM public.rete_write_audit_event('excess_transfer_created', 'transfer', v_transfer_id::text, NULL, 'DA_PREPARARE',
    jsonb_build_object('excess_stock_id', p_excess_stock_id, 'reservation_id', v_reservation_id));

  -- Donor-facing "prepare goods" notification - same event type regardless
  -- of full vs partial reservation (mirrors the shortage flow's GOODS_TO_PREPARE,
  -- which is likewise not split by coverage). EXCESS_STOCK_FULLY_RESERVED/
  -- EXCESS_STOCK_PARTIALLY_RESERVED remain distinct enum values reserved for
  -- a future donor-facing "stock status changed" notification, not used here.
  PERFORM public.rete_whatsapp_enqueue_notification(
    'EXCESS_GOODS_TO_PREPARE',
    v_stock.offering_location_id, NULL, NULL, v_transfer_id,
    'rete_merce_da_preparare_v1',
    jsonb_build_object('counterpart_location_id', v_membership.location_id, 'quantity', p_quantity),
    '/rete-squillari?transfer=' || v_transfer_id::text,
    'EXCESS_GOODS_TO_PREPARE:' || v_transfer_id::text
  );
  PERFORM public.rete_whatsapp_enqueue_notification(
    'EXCESS_STOCK_RESERVED', v_membership.location_id, NULL, NULL, v_transfer_id,
    'rete_offerta_ricevuta_v1',
    jsonb_build_object('counterpart_location_id', v_stock.offering_location_id, 'quantity', p_quantity),
    '/rete-squillari?transfer=' || v_transfer_id::text,
    'EXCESS_STOCK_RESERVED:' || v_reservation_id::text
  );

  v_result := jsonb_build_object(
    'reservation_id', v_reservation_id, 'transfer_id', v_transfer_id, 'excess_stock_status', v_new_status, 'quantity', p_quantity,
    'reservation_status', 'ACCEPTED', 'human_approval_required', false
  );
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_reserve', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_reserve"("uuid", integer, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_reserve"("uuid", integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_reserve"("uuid", integer, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_excess_stock_reserve"("uuid", integer, "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 8. rete_excess_stock_withdraw - offering store withdraws only the
--    unreserved remainder. Already-accepted reservations (separate rows)
--    are entirely untouched, so they keep progressing normally.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_withdraw"(
  "p_excess_stock_id" "uuid",
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
  v_stock public.rete_excess_stock;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();

  v_payload := jsonb_build_object('excess_stock_id', p_excess_stock_id);
  v_cached := public.rete_claim_idempotency_key('rete_excess_stock_withdraw', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_stock FROM public.rete_excess_stock WHERE id = p_excess_stock_id FOR UPDATE;
  IF NOT FOUND OR (v_membership.role <> 'central' AND v_stock.offering_location_id <> v_membership.location_id) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_stock.status NOT IN ('AVAILABLE', 'PARTIALLY_RESERVED') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_excess_stock
  SET remaining_quantity = 0, status = 'WITHDRAWN', withdrawn_at = now(), version = version + 1, updated_at = now()
  WHERE id = p_excess_stock_id;

  PERFORM public.rete_write_audit_event('excess_stock_withdrawn', 'excess_stock', p_excess_stock_id::text, v_stock.status::text, 'WITHDRAWN', '{}'::jsonb);
  PERFORM public.rete_whatsapp_enqueue_notification(
    'EXCESS_STOCK_WITHDRAWN', v_stock.offering_location_id, NULL, NULL, NULL,
    'rete_richiesta_annullata_v1', jsonb_build_object('quantity', v_stock.remaining_quantity),
    '/rete-squillari?excess=' || p_excess_stock_id::text, 'EXCESS_STOCK_WITHDRAWN:' || p_excess_stock_id::text
  );

  v_result := jsonb_build_object('excess_stock_id', p_excess_stock_id, 'status', 'WITHDRAWN');
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_withdraw', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_withdraw"("uuid", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_withdraw"("uuid", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_withdraw"("uuid", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_excess_stock_withdraw"("uuid", "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 9. rete_excess_stock_update_quantity - offering store corrects remaining
--    quantity DOWNWARD only (e.g. a miscount). Zeroing out entirely should
--    use rete_excess_stock_withdraw instead, which also records
--    withdrawn_at - keeps the two operations' meanings distinct.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_update_quantity"(
  "p_excess_stock_id" "uuid",
  "p_new_remaining_quantity" integer,
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
  v_stock public.rete_excess_stock;
  v_new_status public.rete_excess_stock_status;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('excess_stock_id', p_excess_stock_id, 'new_remaining_quantity', p_new_remaining_quantity);
  v_cached := public.rete_claim_idempotency_key('rete_excess_stock_update_quantity', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  IF p_new_remaining_quantity IS NULL OR p_new_remaining_quantity <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  SELECT * INTO v_stock FROM public.rete_excess_stock WHERE id = p_excess_stock_id FOR UPDATE;
  IF NOT FOUND OR v_stock.offering_location_id <> v_membership.location_id THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF v_stock.status NOT IN ('AVAILABLE', 'PARTIALLY_RESERVED') THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_new_remaining_quantity > v_stock.remaining_quantity THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_expected_version IS NOT NULL AND v_stock.version <> p_expected_version THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_new_status := CASE WHEN p_new_remaining_quantity = v_stock.initial_quantity THEN 'AVAILABLE' ELSE 'PARTIALLY_RESERVED' END;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_excess_stock
  SET remaining_quantity = p_new_remaining_quantity, status = v_new_status, version = version + 1, updated_at = now()
  WHERE id = p_excess_stock_id;

  PERFORM public.rete_write_audit_event('excess_stock_quantity_updated', 'excess_stock', p_excess_stock_id::text, v_stock.status::text, v_new_status::text,
    jsonb_build_object('previous_remaining', v_stock.remaining_quantity, 'new_remaining', p_new_remaining_quantity));

  v_result := jsonb_build_object('excess_stock_id', p_excess_stock_id, 'status', v_new_status, 'remaining_quantity', p_new_remaining_quantity);
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_update_quantity', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_update_quantity"("uuid", integer, integer, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_update_quantity"("uuid", integer, integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_update_quantity"("uuid", integer, integer, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_excess_stock_update_quantity"("uuid", integer, integer, "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 10. rete_excess_stock_set_config - central-only limit configuration.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_set_config"(
  "p_max_active_per_store" integer,
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
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_max_active_per_store IS NULL OR p_max_active_per_store <= 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('max_active_per_store', p_max_active_per_store);
  v_cached := public.rete_claim_idempotency_key('rete_excess_stock_set_config', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  PERFORM set_config('rete.trusted_rpc', 'on', true);
  UPDATE public.rete_excess_stock_config SET max_active_per_store = p_max_active_per_store, updated_at = now(), updated_by = auth.uid() WHERE id = true;

  v_result := jsonb_build_object('max_active_per_store', p_max_active_per_store);
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_set_config', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_set_config"(integer, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_set_config"(integer, "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_set_config"(integer, "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_excess_stock_set_config"(integer, "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 11. Expiry - callable job only, no timer/schedule enabled by this gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_excess_stock_expire_pending"()
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_row record;
  v_count integer := 0;
BEGIN
  PERFORM set_config('rete.trusted_rpc', 'on', true);
  FOR v_row IN
    SELECT id, offering_location_id, remaining_quantity FROM public.rete_excess_stock
    WHERE status IN ('AVAILABLE', 'PARTIALLY_RESERVED') AND expires_at IS NOT NULL AND expires_at <= now()
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.rete_excess_stock SET status = 'EXPIRED', updated_at = now(), version = version + 1 WHERE id = v_row.id;
    PERFORM public.rete_write_audit_event('excess_stock_expired', 'excess_stock', v_row.id::text, NULL, 'EXPIRED', '{}'::jsonb);
    PERFORM public.rete_whatsapp_enqueue_notification(
      'EXCESS_STOCK_EXPIRED', v_row.offering_location_id, NULL, NULL, NULL,
      'rete_richiesta_annullata_v1', jsonb_build_object('quantity', v_row.remaining_quantity),
      '/rete-squillari?excess=' || v_row.id::text, 'EXCESS_STOCK_EXPIRED:' || v_row.id::text
    );
    v_count := v_count + 1;
  END LOOP;
  RETURN jsonb_build_object('expired_count', v_count);
END;
$$;
ALTER FUNCTION "public"."rete_excess_stock_expire_pending"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_expire_pending"() FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_expire_pending"() FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_excess_stock_expire_pending"() FROM "authenticated";
-- No GRANT to authenticated - service_role only (matches the WhatsApp
-- worker's sender-facing RPC pattern), called by a callable script, never
-- scheduled by this migration.

-- ---------------------------------------------------------------------------
-- 12. Extend rete_transfer_mark_departed / rete_transfer_receive: NULL-guard
--     the request-recompute call (a shortage-request-only concept) and
--     drive the excess reservation forward when the transfer is
--     excess-linked. rete_transfer_mark_ready needs no change - it never
--     called rete_request_recompute_status in the first place.
-- ---------------------------------------------------------------------------
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
  v_payload jsonb;
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('transfer_id', p_transfer_id);
  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_departed', p_idempotency_key, v_payload);
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

  IF v_transfer.request_id IS NOT NULL THEN
    PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  END IF;
  IF v_transfer.excess_reservation_id IS NOT NULL THEN
    UPDATE public.rete_excess_reservations SET status = 'IN_TRANSFER' WHERE id = v_transfer.excess_reservation_id;
  END IF;

  PERFORM public.rete_write_audit_event('transfer_departed', 'transfer', p_transfer_id::text, 'PRONTA', 'IN_TRASFERIMENTO', '{}'::jsonb);

  IF v_transfer.request_id IS NOT NULL THEN
    PERFORM public.rete_whatsapp_enqueue_notification(
      'TRANSFER_STARTED', v_transfer.from_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      'rete_trasferimento_partito_v1',
      jsonb_build_object('counterpart_location_id', v_transfer.to_location_id, 'quantity', v_transfer.quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'TRANSFER_STARTED:' || p_transfer_id::text || ':' || v_transfer.from_location_id::text
    );
    PERFORM public.rete_whatsapp_enqueue_notification(
      'TRANSFER_STARTED', v_transfer.to_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      'rete_trasferimento_partito_v1',
      jsonb_build_object('counterpart_location_id', v_transfer.from_location_id, 'quantity', v_transfer.quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'TRANSFER_STARTED:' || p_transfer_id::text || ':' || v_transfer.to_location_id::text
    );
  ELSE
    PERFORM public.rete_whatsapp_enqueue_notification(
      'EXCESS_TRANSFER_STARTED', v_transfer.from_location_id, NULL, NULL, p_transfer_id,
      'rete_trasferimento_partito_v1',
      jsonb_build_object('counterpart_location_id', v_transfer.to_location_id, 'quantity', v_transfer.quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'EXCESS_TRANSFER_STARTED:' || p_transfer_id::text || ':' || v_transfer.from_location_id::text
    );
    PERFORM public.rete_whatsapp_enqueue_notification(
      'EXCESS_TRANSFER_STARTED', v_transfer.to_location_id, NULL, NULL, p_transfer_id,
      'rete_trasferimento_partito_v1',
      jsonb_build_object('counterpart_location_id', v_transfer.from_location_id, 'quantity', v_transfer.quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'EXCESS_TRANSFER_STARTED:' || p_transfer_id::text || ':' || v_transfer.to_location_id::text
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'IN_TRASFERIMENTO');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_departed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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

  IF v_transfer.request_id IS NOT NULL THEN
    PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  END IF;
  IF v_transfer.excess_reservation_id IS NOT NULL THEN
    UPDATE public.rete_excess_reservations SET status = 'RECEIVED', received_at = now() WHERE id = v_transfer.excess_reservation_id;
    PERFORM public.rete_excess_stock_recompute_status(
      (SELECT excess_stock_id FROM public.rete_excess_reservations WHERE id = v_transfer.excess_reservation_id)
    );
  END IF;

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

  IF v_transfer.request_id IS NOT NULL THEN
    PERFORM public.rete_whatsapp_enqueue_notification(
      'TRANSFER_RECEIVED', v_transfer.from_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      'rete_merce_ricevuta_v1',
      jsonb_build_object('to_location_id', v_transfer.to_location_id, 'quantity', p_received_quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'TRANSFER_RECEIVED:' || p_transfer_id::text || ':' || v_transfer.from_location_id::text
    );
    PERFORM public.rete_whatsapp_enqueue_notification(
      'TRANSFER_RECEIVED', v_transfer.to_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      'rete_merce_ricevuta_v1',
      jsonb_build_object('to_location_id', v_transfer.to_location_id, 'quantity', p_received_quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'TRANSFER_RECEIVED:' || p_transfer_id::text || ':' || v_transfer.to_location_id::text
    );
  ELSE
    PERFORM public.rete_whatsapp_enqueue_notification(
      'EXCESS_TRANSFER_RECEIVED', v_transfer.from_location_id, NULL, NULL, p_transfer_id,
      'rete_merce_ricevuta_v1',
      jsonb_build_object('to_location_id', v_transfer.to_location_id, 'quantity', p_received_quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'EXCESS_TRANSFER_RECEIVED:' || p_transfer_id::text || ':' || v_transfer.from_location_id::text
    );
    PERFORM public.rete_whatsapp_enqueue_notification(
      'EXCESS_TRANSFER_RECEIVED', v_transfer.to_location_id, NULL, NULL, p_transfer_id,
      'rete_merce_ricevuta_v1',
      jsonb_build_object('to_location_id', v_transfer.to_location_id, 'quantity', p_received_quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'EXCESS_TRANSFER_RECEIVED:' || p_transfer_id::text || ':' || v_transfer.to_location_id::text
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'RICEVUTA',
                                  'received_quantity', p_received_quantity, 'discrepancy', v_is_discrepancy);
  PERFORM public.rete_store_idempotency_result('rete_transfer_receive', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- Also extend rete_transfer_mark_ready to enqueue the excess-specific
-- WhatsApp event when excess-linked (it never called
-- rete_request_recompute_status, so no NULL-guard was needed there).
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
  v_payload jsonb;
  v_transfer public.rete_transfers;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('transfer_id', p_transfer_id);
  v_cached := public.rete_claim_idempotency_key('rete_transfer_mark_ready', p_idempotency_key, v_payload);
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

  IF v_transfer.excess_reservation_id IS NOT NULL THEN
    UPDATE public.rete_excess_reservations SET status = 'PREPARING' WHERE id = v_transfer.excess_reservation_id;
  END IF;

  PERFORM public.rete_write_audit_event('transfer_prepared', 'transfer', p_transfer_id::text, 'DA_PREPARARE', 'PRONTA', '{}'::jsonb);

  IF v_transfer.request_id IS NOT NULL THEN
    PERFORM public.rete_whatsapp_enqueue_notification(
      'GOODS_READY', v_transfer.to_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      'rete_merce_pronta_v1',
      jsonb_build_object('counterpart_location_id', v_transfer.from_location_id, 'quantity', v_transfer.quantity),
      '/rete-squillari?transfer=' || p_transfer_id::text,
      'GOODS_READY:' || p_transfer_id::text
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'PRONTA');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_ready', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
