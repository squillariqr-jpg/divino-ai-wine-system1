-- Rete Squillari — wire canonical multi-channel notification enqueueing
-- into existing governed RPCs (Phase 11), additively alongside the
-- existing WhatsApp outbox enqueueing (Phase 14 compatibility).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- Every function below is restated with its EXACT current signature and
-- body (as committed by 20260724120000 / 20260727110000 / 20260727130000 -
-- the latest version of each function on this branch), verified line by
-- line against those migrations before writing this file. The ONLY
-- addition in each is one or more `PERFORM public.rete_notification_enqueue_event(...)`
-- calls, always placed immediately after the pre-existing
-- `rete_whatsapp_enqueue_notification` call(s) for the same business
-- moment, inside the same transaction. No existing validation, locking,
-- status transition, audit-event call, or WhatsApp enqueue call is
-- altered, reordered, or removed - the WhatsApp outbox keeps receiving
-- exactly the rows it received before this migration.
--
-- rete_excess_stock_publish gains its FIRST notification-outbox call of
-- any kind here (EXCESS_STOCK_PUBLISHED was never wired to WhatsApp at
-- all - see lib/rete-squillari/whatsapp/templates.ts's
-- EXCESS_STOCK_PUBLISHED: null). That is a pure addition, not a change to
-- existing WhatsApp behavior.

BEGIN;

-- ---------------------------------------------------------------------------
-- rete_offer_create (automatic acceptance path)
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
  v_own_name text;
  v_counterpart_name text;
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
    RAISE EXCEPTION 'operation not permitted';
  ELSIF v_request.status NOT IN ('DA_TROVARE', 'ARRIVO_PARZIALE_A_TRASTA') THEN
    v_offer_status := 'DATA_REVIEW';
    v_review_reason := 'invalid_or_legacy_request_state:' || v_request.status::text;
  ELSIF p_offered_quantity > v_request.remaining_quantity THEN
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

    PERFORM public.rete_whatsapp_enqueue_notification(
      'OFFER_AUTO_ACCEPTED', v_request.requesting_location_id, p_request_id, v_offer_id, v_transfer_id,
      'rete_offerta_ricevuta_v1',
      jsonb_build_object('counterpart_location_id', v_membership.location_id, 'quantity', p_offered_quantity),
      '/rete-squillari?offer=' || v_offer_id::text,
      'OFFER_AUTO_ACCEPTED:' || v_offer_id::text || ':requester'
    );
    PERFORM public.rete_whatsapp_enqueue_notification(
      'GOODS_TO_PREPARE', v_membership.location_id, p_request_id, v_offer_id, v_transfer_id,
      'rete_merce_da_preparare_v1',
      jsonb_build_object('counterpart_location_id', v_request.requesting_location_id, 'quantity', p_offered_quantity),
      '/rete-squillari?transfer=' || v_transfer_id::text,
      'GOODS_TO_PREPARE:' || v_transfer_id::text
    );

    SELECT name INTO v_own_name FROM public.rete_locations WHERE id = v_membership.location_id;
    SELECT name INTO v_counterpart_name FROM public.rete_locations WHERE id = v_request.requesting_location_id;

    PERFORM public.rete_notification_enqueue_event(
      'OFFER_AUTO_ACCEPTED', 'CANON:OFFER_AUTO_ACCEPTED:' || v_offer_id::text || ':requester',
      '/rete-squillari?offer=' || v_offer_id::text,
      jsonb_build_object('counterpart_name', v_own_name, 'quantity', p_offered_quantity, 'product', v_request.product_description),
      v_request.requesting_location_id, NULL, p_request_id, v_offer_id, v_transfer_id
    );
    PERFORM public.rete_notification_enqueue_event(
      'GOODS_TO_PREPARE', 'CANON:GOODS_TO_PREPARE:' || v_transfer_id::text,
      '/rete-squillari?transfer=' || v_transfer_id::text,
      jsonb_build_object('own_name', v_own_name, 'quantity', p_offered_quantity, 'product', v_request.product_description),
      v_membership.location_id, NULL, p_request_id, v_offer_id, v_transfer_id,
      NULL, NULL, 'HIGH'
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
-- rete_offer_approve (exception-resolution / legacy path)
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
  v_own_name text;
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

  SELECT name INTO v_own_name FROM public.rete_locations WHERE id = v_offer.offering_location_id;
  PERFORM public.rete_notification_enqueue_event(
    'GOODS_TO_PREPARE', 'CANON:GOODS_TO_PREPARE:' || v_transfer_id::text,
    '/rete-squillari?transfer=' || v_transfer_id::text,
    jsonb_build_object('own_name', v_own_name, 'quantity', p_approved_quantity, 'product', v_request.product_description),
    v_offer.offering_location_id, NULL, v_request.id, p_offer_id, v_transfer_id,
    NULL, NULL, 'HIGH'
  );

  v_result := jsonb_build_object('offer_id', p_offer_id, 'transfer_id', v_transfer_id, 'status', 'APPROVATA');
  PERFORM public.rete_store_idempotency_result('rete_offer_approve', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_transfer_mark_ready (shortage + excess-linked)
-- ---------------------------------------------------------------------------
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
  v_product text;
  v_counterpart_name text;
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

    SELECT product_description INTO v_product FROM public.rete_requests WHERE id = v_transfer.request_id;
    SELECT name INTO v_counterpart_name FROM public.rete_locations WHERE id = v_transfer.from_location_id;
    PERFORM public.rete_notification_enqueue_event(
      'GOODS_READY', 'CANON:GOODS_READY:' || p_transfer_id::text,
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('counterpart_name', v_counterpart_name, 'quantity', v_transfer.quantity, 'product', v_product),
      v_transfer.to_location_id, NULL, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      NULL, NULL, 'HIGH'
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'PRONTA');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_ready', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_transfer_mark_departed (shortage + excess-linked)
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
  v_product text;
  v_from_name text;
  v_to_name text;
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

  SELECT name INTO v_from_name FROM public.rete_locations WHERE id = v_transfer.from_location_id;
  SELECT name INTO v_to_name FROM public.rete_locations WHERE id = v_transfer.to_location_id;

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

    SELECT product_description INTO v_product FROM public.rete_requests WHERE id = v_transfer.request_id;
    PERFORM public.rete_notification_enqueue_event(
      'TRANSFER_STARTED', 'CANON:TRANSFER_STARTED:' || p_transfer_id::text || ':from',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('counterpart_name', v_to_name, 'quantity', v_transfer.quantity, 'product', v_product, 'direction', 'DEPARTING'),
      v_transfer.from_location_id, NULL, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      NULL, NULL, 'HIGH'
    );
    PERFORM public.rete_notification_enqueue_event(
      'TRANSFER_STARTED', 'CANON:TRANSFER_STARTED:' || p_transfer_id::text || ':to',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('counterpart_name', v_from_name, 'quantity', v_transfer.quantity, 'product', v_product, 'direction', 'ARRIVING'),
      v_transfer.to_location_id, NULL, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
      NULL, NULL, 'HIGH'
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

    SELECT es.product_description INTO v_product
    FROM public.rete_excess_reservations r JOIN public.rete_excess_stock es ON es.id = r.excess_stock_id
    WHERE r.id = v_transfer.excess_reservation_id;
    PERFORM public.rete_notification_enqueue_event(
      'EXCESS_TRANSFER_STARTED', 'CANON:EXCESS_TRANSFER_STARTED:' || p_transfer_id::text || ':from',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('counterpart_name', v_to_name, 'quantity', v_transfer.quantity, 'product', v_product, 'direction', 'DEPARTING'),
      v_transfer.from_location_id, NULL, NULL, NULL, p_transfer_id, NULL, v_transfer.excess_reservation_id, 'HIGH'
    );
    PERFORM public.rete_notification_enqueue_event(
      'EXCESS_TRANSFER_STARTED', 'CANON:EXCESS_TRANSFER_STARTED:' || p_transfer_id::text || ':to',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('counterpart_name', v_from_name, 'quantity', v_transfer.quantity, 'product', v_product, 'direction', 'ARRIVING'),
      v_transfer.to_location_id, NULL, NULL, NULL, p_transfer_id, NULL, v_transfer.excess_reservation_id, 'HIGH'
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'IN_TRASFERIMENTO');
  PERFORM public.rete_store_idempotency_result('rete_transfer_mark_departed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_transfer_receive (shortage + excess-linked)
-- ---------------------------------------------------------------------------
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
  v_product text;
  v_to_name text;
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

  SELECT name INTO v_to_name FROM public.rete_locations WHERE id = v_transfer.to_location_id;

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

    SELECT product_description INTO v_product FROM public.rete_requests WHERE id = v_transfer.request_id;
    PERFORM public.rete_notification_enqueue_event(
      'TRANSFER_RECEIVED', 'CANON:TRANSFER_RECEIVED:' || p_transfer_id::text || ':from',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('to_name', v_to_name, 'quantity', p_received_quantity, 'product', v_product),
      v_transfer.from_location_id, NULL, v_transfer.request_id, v_transfer.offer_id, p_transfer_id
    );
    PERFORM public.rete_notification_enqueue_event(
      'TRANSFER_RECEIVED', 'CANON:TRANSFER_RECEIVED:' || p_transfer_id::text || ':to',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('to_name', v_to_name, 'quantity', p_received_quantity, 'product', v_product),
      v_transfer.to_location_id, NULL, v_transfer.request_id, v_transfer.offer_id, p_transfer_id
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

    SELECT es.product_description INTO v_product
    FROM public.rete_excess_reservations r JOIN public.rete_excess_stock es ON es.id = r.excess_stock_id
    WHERE r.id = v_transfer.excess_reservation_id;
    PERFORM public.rete_notification_enqueue_event(
      'EXCESS_TRANSFER_RECEIVED', 'CANON:EXCESS_TRANSFER_RECEIVED:' || p_transfer_id::text || ':from',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('to_name', v_to_name, 'quantity', p_received_quantity, 'product', v_product),
      v_transfer.from_location_id, NULL, NULL, NULL, p_transfer_id, NULL, v_transfer.excess_reservation_id
    );
    PERFORM public.rete_notification_enqueue_event(
      'EXCESS_TRANSFER_RECEIVED', 'CANON:EXCESS_TRANSFER_RECEIVED:' || p_transfer_id::text || ':to',
      '/rete-squillari?transfer=' || p_transfer_id::text,
      jsonb_build_object('to_name', v_to_name, 'quantity', p_received_quantity, 'product', v_product),
      v_transfer.to_location_id, NULL, NULL, NULL, p_transfer_id, NULL, v_transfer.excess_reservation_id
    );
  END IF;

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'RICEVUTA',
                                  'received_quantity', p_received_quantity, 'discrepancy', v_is_discrepancy);
  PERFORM public.rete_store_idempotency_result('rete_transfer_receive', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_trasta_arrival_record
-- ---------------------------------------------------------------------------
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
  v_payload jsonb;
  v_request public.rete_requests;
  v_arrival_id uuid;
  v_applied integer;
  v_new_status public.rete_request_status;
  v_remaining_after integer;
  v_event public.rete_whatsapp_event_type;
  v_canon_event public.rete_notification_event_type;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object(
    'target_request_id', p_target_request_id,
    'product_code', p_product_code,
    'quantity', p_quantity,
    'source_reference', p_source_reference
  );
  v_cached := public.rete_claim_idempotency_key('rete_trasta_arrival_record', p_idempotency_key, v_payload);
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

  v_remaining_after := greatest(0, v_request.remaining_quantity - v_applied);
  IF v_remaining_after <= 0 THEN
    v_new_status := 'ARRIVATO_A_TRASTA';
    v_event := 'TRASTA_FULL_ARRIVAL';
    v_canon_event := 'TRASTA_FULL_ARRIVAL';
  ELSE
    v_new_status := 'ARRIVO_PARZIALE_A_TRASTA';
    v_event := 'TRASTA_PARTIAL_ARRIVAL';
    v_canon_event := 'TRASTA_PARTIAL_ARRIVAL';
  END IF;

  UPDATE public.rete_requests
  SET remaining_quantity = v_remaining_after, status = v_new_status
  WHERE id = p_target_request_id;

  PERFORM public.rete_write_audit_event(
    'trasta_arrival_recorded', 'request', p_target_request_id::text, v_request.status::text, v_new_status::text,
    jsonb_build_object('arrival_id', v_arrival_id, 'quantity', p_quantity, 'applied', v_applied)
  );

  PERFORM public.rete_whatsapp_enqueue_notification(
    v_event, v_request.requesting_location_id, p_target_request_id, NULL, NULL,
    'rete_arrivo_trasta_v1',
    jsonb_build_object('quantity', v_applied, 'remaining_quantity', v_remaining_after),
    '/rete-squillari?request=' || p_target_request_id::text,
    v_event::text || ':' || v_arrival_id::text
  );

  PERFORM public.rete_notification_enqueue_event(
    v_canon_event, 'CANON:' || v_canon_event::text || ':' || v_arrival_id::text,
    '/rete-squillari?request=' || p_target_request_id::text,
    jsonb_build_object('quantity', v_applied, 'remaining_quantity', v_remaining_after, 'product', v_request.product_description),
    v_request.requesting_location_id, NULL, p_target_request_id, NULL, NULL, NULL, NULL, 'HIGH'
  );

  v_result := jsonb_build_object('arrival_id', v_arrival_id, 'request_id', p_target_request_id, 'status', v_new_status);
  PERFORM public.rete_store_idempotency_result('rete_trasta_arrival_record', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_request_cancel
-- ---------------------------------------------------------------------------
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
  v_offer_location record;
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

  FOR v_offer_location IN
    SELECT DISTINCT offering_location_id FROM public.rete_offers
    WHERE request_id = p_request_id AND status = 'RIFIUTATA'
  LOOP
    PERFORM public.rete_whatsapp_enqueue_notification(
      'REQUEST_CANCELLED', v_offer_location.offering_location_id, p_request_id, NULL, NULL,
      'rete_richiesta_annullata_v1',
      '{}'::jsonb,
      '/rete-squillari?request=' || p_request_id::text,
      'REQUEST_CANCELLED:' || p_request_id::text || ':' || v_offer_location.offering_location_id::text
    );
    PERFORM public.rete_notification_enqueue_event(
      'REQUEST_CANCELLED', 'CANON:REQUEST_CANCELLED:' || p_request_id::text || ':' || v_offer_location.offering_location_id::text,
      '/rete-squillari?request=' || p_request_id::text,
      jsonb_build_object('product', v_request.product_description),
      v_offer_location.offering_location_id, NULL, p_request_id
    );
  END LOOP;

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_cancel', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_request_mark_no_longer_needed
-- ---------------------------------------------------------------------------
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
  v_offer_location record;
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

  FOR v_offer_location IN
    SELECT DISTINCT offering_location_id FROM public.rete_offers
    WHERE request_id = p_request_id AND status = 'RIFIUTATA'
  LOOP
    PERFORM public.rete_whatsapp_enqueue_notification(
      'REQUEST_CANCELLED', v_offer_location.offering_location_id, p_request_id, NULL, NULL,
      'rete_richiesta_annullata_v1',
      '{}'::jsonb,
      '/rete-squillari?request=' || p_request_id::text,
      'REQUEST_CANCELLED:' || p_request_id::text || ':' || v_offer_location.offering_location_id::text
    );
    PERFORM public.rete_notification_enqueue_event(
      'REQUEST_CANCELLED', 'CANON:REQUEST_CANCELLED:' || p_request_id::text || ':' || v_offer_location.offering_location_id::text,
      '/rete-squillari?request=' || p_request_id::text,
      jsonb_build_object('product', v_request.product_description),
      v_offer_location.offering_location_id, NULL, p_request_id
    );
  END LOOP;

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_mark_no_longer_needed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_excess_stock_publish - first canonical wiring of this event (never
-- wired to WhatsApp at all, per the deliberate "do not broadcast" design in
-- lib/rete-squillari/whatsapp/templates.ts). Broadcast: recipient_location_id
-- is left NULL and event_reference carries the publishing store's own id so
-- the routing engine's fan-out excludes the publisher from its own broadcast.
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
  v_own_name text;
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

  PERFORM pg_advisory_xact_lock(hashtext('rete_excess_stock_publish:' || v_membership.location_id));
  SELECT count(*) INTO v_active_count FROM public.rete_excess_stock
    WHERE offering_location_id = v_membership.location_id AND status IN ('AVAILABLE', 'PARTIALLY_RESERVED');
  SELECT max_active_per_store INTO v_limit FROM public.rete_excess_stock_config WHERE id = true;
  IF v_active_count >= v_limit THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

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

  PERFORM public.rete_write_audit_event('excess_stock_published', 'excess_stock', v_id::text, NULL, 'AVAILABLE',
    jsonb_build_object(
      'created_by', auth.uid(), 'offering_location_id', v_membership.location_id,
      'published_at', v_published_at, 'publication_mode', 'AUTOMATIC',
      'catalog_match_method', p_catalog_match_method, 'initial_quantity', p_quantity,
      'reason', p_reason, 'idempotency_key', p_idempotency_key
    ));

  -- Deliberately NOT broadcast to every store via push/WhatsApp - only the
  -- new IN_APP canonical event, which the routing engine fans out to
  -- every active store's notification panel (Phase 3: "do not broadcast
  -- all excess publications through push").
  SELECT name INTO v_own_name FROM public.rete_locations WHERE id = v_membership.location_id;
  PERFORM public.rete_notification_enqueue_event(
    'EXCESS_STOCK_PUBLISHED', 'CANON:EXCESS_STOCK_PUBLISHED:' || v_id::text,
    '/rete-squillari?excess=' || v_id::text,
    jsonb_build_object('own_name', v_own_name, 'quantity', p_quantity, 'product', p_product_description),
    NULL, NULL, NULL, NULL, NULL, v_id, NULL, 'LOW', v_membership.location_id::text
  );

  v_result := jsonb_build_object(
    'excess_stock_id', v_id, 'status', 'AVAILABLE', 'remaining_quantity', p_quantity,
    'published_at', v_published_at, 'publication_mode', 'AUTOMATIC', 'approved_by', NULL,
    'human_approval_required', false
  );
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_publish', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_excess_stock_reserve - canonical EXCESS_STOCK_RESERVED targets the
-- DONOR explicitly ("Sestri ha prenotato 1 unità dalla tua eccedenza"),
-- distinct from the legacy WhatsApp call above it (which reuses a
-- requester-facing template on the reserving store) - a deliberate,
-- additive design choice for the new channel-neutral copy, not a change
-- to the WhatsApp row it sits beside.
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
  v_reserver_name text;
  v_donor_name text;
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

  INSERT INTO public.rete_transfers (excess_reservation_id, from_location_id, to_location_id, quantity, status)
  VALUES (v_reservation_id, v_stock.offering_location_id, v_membership.location_id, p_quantity, 'DA_PREPARARE')
  RETURNING id INTO v_transfer_id;

  UPDATE public.rete_excess_reservations SET transfer_id = v_transfer_id WHERE id = v_reservation_id;

  PERFORM public.rete_write_audit_event('excess_stock_reserved', 'excess_stock', p_excess_stock_id::text, v_stock.status::text, v_new_status::text,
    jsonb_build_object('reservation_id', v_reservation_id, 'quantity', p_quantity, 'requesting_location_id', v_membership.location_id));
  PERFORM public.rete_write_audit_event('excess_transfer_created', 'transfer', v_transfer_id::text, NULL, 'DA_PREPARARE',
    jsonb_build_object('excess_stock_id', p_excess_stock_id, 'reservation_id', v_reservation_id));

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

  SELECT name INTO v_reserver_name FROM public.rete_locations WHERE id = v_membership.location_id;
  SELECT name INTO v_donor_name FROM public.rete_locations WHERE id = v_stock.offering_location_id;

  PERFORM public.rete_notification_enqueue_event(
    'EXCESS_GOODS_TO_PREPARE', 'CANON:EXCESS_GOODS_TO_PREPARE:' || v_transfer_id::text,
    '/rete-squillari?transfer=' || v_transfer_id::text,
    jsonb_build_object('own_name', v_donor_name, 'quantity', p_quantity, 'product', v_stock.product_description),
    v_stock.offering_location_id, NULL, NULL, NULL, v_transfer_id, p_excess_stock_id, v_reservation_id, 'HIGH'
  );
  PERFORM public.rete_notification_enqueue_event(
    'EXCESS_STOCK_RESERVED', 'CANON:EXCESS_STOCK_RESERVED:' || v_reservation_id::text,
    '/rete-squillari?transfer=' || v_transfer_id::text,
    jsonb_build_object('counterpart_name', v_reserver_name, 'quantity', p_quantity, 'product', v_stock.product_description),
    v_stock.offering_location_id, NULL, NULL, NULL, v_transfer_id, p_excess_stock_id, v_reservation_id
  );

  v_result := jsonb_build_object(
    'reservation_id', v_reservation_id, 'transfer_id', v_transfer_id, 'excess_stock_status', v_new_status, 'quantity', p_quantity,
    'reservation_status', 'ACCEPTED', 'human_approval_required', false
  );
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_reserve', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_excess_stock_withdraw
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

  PERFORM public.rete_notification_enqueue_event(
    'EXCESS_STOCK_WITHDRAWN', 'CANON:EXCESS_STOCK_WITHDRAWN:' || p_excess_stock_id::text,
    '/rete-squillari?excess=' || p_excess_stock_id::text,
    jsonb_build_object('product', v_stock.product_description),
    v_stock.offering_location_id, NULL, NULL, NULL, NULL, p_excess_stock_id
  );

  v_result := jsonb_build_object('excess_stock_id', p_excess_stock_id, 'status', 'WITHDRAWN');
  PERFORM public.rete_store_idempotency_result('rete_excess_stock_withdraw', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

-- ---------------------------------------------------------------------------
-- rete_excess_stock_expire_pending - additive SELECT of product_description
-- (harmless widening of the loop cursor's own column list, not a schema
-- change) so the canonical copy can name the expired product.
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
    SELECT id, offering_location_id, remaining_quantity, product_description FROM public.rete_excess_stock
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
    PERFORM public.rete_notification_enqueue_event(
      'EXCESS_STOCK_EXPIRED', 'CANON:EXCESS_STOCK_EXPIRED:' || v_row.id::text,
      '/rete-squillari?excess=' || v_row.id::text,
      jsonb_build_object('product', v_row.product_description),
      v_row.offering_location_id, NULL, NULL, NULL, NULL, v_row.id
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

COMMIT;
