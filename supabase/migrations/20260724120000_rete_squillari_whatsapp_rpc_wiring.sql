-- Rete Squillari — wire WhatsApp notification enqueueing into existing
-- governed RPCs.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Same status as the
-- migration this depends on (20260724110000_rete_squillari_whatsapp_notifications.sql).
--
-- Every function below is restated with its EXACT pre-existing signature
-- (verified against the current live/local schema before writing this file)
-- - only one or two additive `PERFORM public.rete_whatsapp_enqueue_notification(...)`
-- calls are inserted, always AFTER the real business state change has been
-- written, inside the same transaction, and always via the helper function
-- that never raises. No existing validation, locking, status transition, or
-- audit-event call is altered. Enqueue payloads carry only IDs and
-- quantities - product descriptions and store display names are resolved by
-- the server-side worker at send time (service_role), keeping these
-- already-live, security-critical RPCs' own query footprint unchanged.

BEGIN;

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
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'store' THEN
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

  PERFORM public.rete_whatsapp_enqueue_notification(
    'OFFER_RECEIVED', v_request.requesting_location_id, p_request_id, v_offer_id, NULL,
    'rete_offerta_ricevuta_v1',
    jsonb_build_object('counterpart_location_id', v_membership.location_id, 'quantity', p_offered_quantity),
    '/rete-squillari?offer=' || v_offer_id::text,
    'OFFER_RECEIVED:' || v_offer_id::text
  );

  v_result := jsonb_build_object('offer_id', v_offer_id, 'status', 'PROPOSTA');
  PERFORM public.rete_store_idempotency_result('rete_offer_create', p_idempotency_key, v_result);
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

  PERFORM public.rete_write_audit_event('transfer_prepared', 'transfer', p_transfer_id::text, 'DA_PREPARARE', 'PRONTA', '{}'::jsonb);

  PERFORM public.rete_whatsapp_enqueue_notification(
    'GOODS_READY', v_transfer.to_location_id, v_transfer.request_id, v_transfer.offer_id, p_transfer_id,
    'rete_merce_pronta_v1',
    jsonb_build_object('counterpart_location_id', v_transfer.from_location_id, 'quantity', v_transfer.quantity),
    '/rete-squillari?transfer=' || p_transfer_id::text,
    'GOODS_READY:' || p_transfer_id::text
  );

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

  PERFORM public.rete_request_recompute_status(v_transfer.request_id);
  PERFORM public.rete_write_audit_event('transfer_departed', 'transfer', p_transfer_id::text, 'PRONTA', 'IN_TRASFERIMENTO', '{}'::jsonb);

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

  -- Both recipients' copies name the RECEIVING store explicitly
  -- (to_location_id), never a "counterpart" that would flip meaning
  -- depending on which side is reading it - "Sestri ha ricevuto..." must
  -- read the same way whether Malta (the donor) or Sestri (the receiver)
  -- is the one holding the phone.
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

  v_result := jsonb_build_object('transfer_id', p_transfer_id, 'status', 'RICEVUTA',
                                  'received_quantity', p_received_quantity, 'discrepancy', v_is_discrepancy);
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
  v_payload jsonb;
  v_request public.rete_requests;
  v_arrival_id uuid;
  v_applied integer;
  v_new_status public.rete_request_status;
  v_remaining_after integer;
  v_event public.rete_whatsapp_event_type;
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
  ELSE
    v_new_status := 'ARRIVO_PARZIALE_A_TRASTA';
    v_event := 'TRASTA_PARTIAL_ARRIVAL';
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

  v_result := jsonb_build_object('arrival_id', v_arrival_id, 'request_id', p_target_request_id, 'status', v_new_status);
  PERFORM public.rete_store_idempotency_result('rete_trasta_arrival_record', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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

  -- Notify every store that had an active (PROPOSTA) offer on this request -
  -- an APPROVATA offer can never coexist with a cancel (guarded above), so
  -- this only ever reaches stores whose not-yet-approved offer is now moot.
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
  END LOOP;

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_cancel', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

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
  END LOOP;

  v_result := jsonb_build_object('request_id', p_request_id, 'status', 'ANNULLATA');
  PERFORM public.rete_store_idempotency_result('rete_request_mark_no_longer_needed', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;

COMMIT;
