-- Rete Squillari — notification engine: Italian copy rendering, channel
-- routing, and every governed RPC the frontend/workers use (Phases 2, 5,
-- 6, 8, 10 tied together).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- Everything here is additive on top of 20260729080000-20260729080400 and
-- touches none of the WhatsApp-era objects.

BEGIN;

-- ---------------------------------------------------------------------------
-- 1. Italian copy rendering - single source of truth for every event's
--    title/body, so the wiring in 20260729080600 only ever passes
--    structured context, never hand-writes Italian strings per call site.
--    Mirrored (for pure unit testing, no DB required) in
--    lib/rete-squillari/notifications/copy.ts - keep the two in sync.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notification_render_copy"(
  "p_event_type" "public"."rete_notification_event_type",
  "p_ctx" "jsonb"
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
IMMUTABLE
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_qty text := COALESCE(p_ctx->>'quantity', '');
  v_product text := COALESCE(p_ctx->>'product', '');
  v_counterpart text := COALESCE(p_ctx->>'counterpart_name', '');
  v_own text := COALESCE(p_ctx->>'own_name', '');
  v_to text := COALESCE(p_ctx->>'to_name', '');
  v_remaining text := COALESCE(p_ctx->>'remaining_quantity', '0');
  v_detail text := COALESCE(p_ctx->>'detail', '');
  v_direction text := COALESCE(p_ctx->>'direction', 'ARRIVING');
  v_title text;
  v_body text;
BEGIN
  CASE p_event_type
    WHEN 'OFFER_RECEIVED' THEN
      v_title := 'Nuova offerta';
      v_body := v_counterpart || ' ha offerto ' || v_qty || ' unità di ' || v_product || ' per la tua richiesta.';
    WHEN 'OFFER_AUTO_ACCEPTED' THEN
      v_title := 'Offerta accettata';
      v_body := v_counterpart || ' fornirà ' || v_qty || ' unità di ' || v_product || ' per la tua richiesta.';
    WHEN 'GOODS_TO_PREPARE', 'EXCESS_GOODS_TO_PREPARE' THEN
      v_title := 'Merce da preparare';
      v_body := v_own || ' deve preparare ' || v_qty || ' unità di ' || v_product || '.';
    WHEN 'GOODS_READY' THEN
      v_title := 'Merce pronta';
      v_body := v_qty || ' unità di ' || v_product || ' sono pronte, in arrivo da ' || v_counterpart || '.';
    WHEN 'TRANSFER_STARTED', 'EXCESS_TRANSFER_STARTED' THEN
      v_title := 'Trasferimento partito';
      IF v_direction = 'DEPARTING' THEN
        v_body := 'Il trasferimento verso ' || v_counterpart || ' è partito.';
      ELSE
        v_body := 'Il trasferimento da ' || v_counterpart || ' è partito.';
      END IF;
    WHEN 'TRANSFER_RECEIVED', 'EXCESS_TRANSFER_RECEIVED' THEN
      v_title := 'Merce ricevuta';
      v_body := v_to || ' ha ricevuto ' || v_qty || ' unità di ' || v_product || '.';
    WHEN 'TRASTA_PARTIAL_ARRIVAL' THEN
      v_title := 'Arrivo parziale a Trasta';
      v_body := 'Sono arrivate ' || v_qty || ' unità di ' || v_product || ' a Trasta. Restano da trovare: ' || v_remaining || '.';
    WHEN 'TRASTA_FULL_ARRIVAL' THEN
      v_title := 'Arrivo completo a Trasta';
      v_body := 'Arrivo completo a Trasta: richiesta coperta.';
    WHEN 'REQUEST_CANCELLED' THEN
      v_title := 'Richiesta annullata';
      v_body := 'La richiesta per ' || v_product || ' non è più disponibile - è stata annullata.';
    WHEN 'EXCESS_STOCK_PUBLISHED' THEN
      v_title := 'Nuova eccedenza';
      v_body := v_own || ' ha pubblicato ' || v_qty || ' unità di ' || v_product || ' in eccedenza.';
    WHEN 'EXCESS_STOCK_RESERVED' THEN
      v_title := 'Eccedenza prenotata';
      v_body := v_counterpart || ' ha prenotato ' || v_qty || ' unità dalla tua eccedenza.';
    WHEN 'EXCESS_STOCK_PARTIALLY_RESERVED' THEN
      v_title := 'Eccedenza parzialmente prenotata';
      v_body := v_counterpart || ' ha prenotato ' || v_qty || ' unità dalla tua eccedenza (parziale).';
    WHEN 'EXCESS_STOCK_FULLY_RESERVED' THEN
      v_title := 'Eccedenza esaurita';
      v_body := 'La tua eccedenza di ' || v_product || ' è stata interamente prenotata.';
    WHEN 'EXCESS_STOCK_EXPIRED' THEN
      v_title := 'Eccedenza scaduta';
      v_body := 'La tua eccedenza di ' || v_product || ' è scaduta e non è più visibile.';
    WHEN 'EXCESS_STOCK_WITHDRAWN' THEN
      v_title := 'Eccedenza ritirata';
      v_body := 'Hai ritirato la tua eccedenza di ' || v_product || '.';
    WHEN 'SYSTEM_EXCEPTION' THEN
      v_title := 'Eccezione operativa';
      v_body := 'Si è verificata un''eccezione operativa da verificare: ' || v_detail || '.';
    ELSE
      RAISE EXCEPTION 'no copy defined for event_type %', p_event_type;
  END CASE;

  RETURN jsonb_build_object('title', v_title, 'body', v_body);
END;
$$;
ALTER FUNCTION "public"."rete_notification_render_copy"("public"."rete_notification_event_type", "jsonb") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_render_copy"("public"."rete_notification_event_type", "jsonb") FROM PUBLIC, "anon", "authenticated";

-- ---------------------------------------------------------------------------
-- 2. Channel routing - creates zero or more rete_notification_deliveries
--    rows for one already-inserted event, using the default matrix
--    (20260729080100), effective preferences, and real destinations
--    (push subscriptions / verified email contact). Never raises - an
--    ineligible/missing destination is recorded as a SKIPPED_* row, never
--    an error, so it can never affect the caller's business transaction.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notification_route_deliveries"("p_event_id" "uuid")
RETURNS void
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_event public.rete_notification_events;
  v_mode text;
  v_loc record;
  v_sub record;
  v_user_web_push boolean;
  v_user_email boolean;
  v_user_whatsapp boolean;
  v_contact public.rete_notification_contacts;
  v_loc_pref public.rete_notification_preferences;
BEGIN
  SELECT * INTO v_event FROM public.rete_notification_events WHERE id = p_event_id;
  IF NOT FOUND THEN
    RETURN;
  END IF;

  -- ---- IN_APP -------------------------------------------------------------
  SELECT mode INTO v_mode FROM public.rete_notification_routing_defaults WHERE event_type = v_event.event_type AND channel = 'IN_APP';
  IF v_mode = 'YES' THEN
    IF v_event.recipient_location_id IS NOT NULL THEN
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (p_event_id, 'IN_APP', 'location:' || v_event.recipient_location_id::text, 'READY')
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    END IF;
    IF v_event.recipient_user_id IS NOT NULL THEN
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (p_event_id, 'IN_APP', 'user:' || v_event.recipient_user_id::text, 'READY')
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    END IF;
    IF v_event.event_type = 'EXCESS_STOCK_PUBLISHED' AND v_event.recipient_location_id IS NULL THEN
      FOR v_loc IN
        SELECT id FROM public.rete_locations
        WHERE active AND id IS DISTINCT FROM NULLIF(v_event.event_reference, '')::smallint
      LOOP
        INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
        VALUES (p_event_id, 'IN_APP', 'location:' || v_loc.id::text, 'READY')
        ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
      END LOOP;
    END IF;
  END IF;

  -- ---- WEB_PUSH -------------------------------------------------------------
  SELECT mode INTO v_mode FROM public.rete_notification_routing_defaults WHERE event_type = v_event.event_type AND channel = 'WEB_PUSH';
  IF v_mode = 'YES' AND v_event.recipient_location_id IS NOT NULL THEN
    FOR v_sub IN
      SELECT s.id, s.user_id FROM public.rete_push_subscriptions s
      WHERE s.location_id = v_event.recipient_location_id AND s.revoked_at IS NULL
    LOOP
      SELECT COALESCE(up.web_push_enabled, lp.web_push_enabled, true) INTO v_user_web_push
      FROM (SELECT 1) dummy
      LEFT JOIN public.rete_notification_preferences up ON up.user_id = v_sub.user_id AND up.event_type = v_event.event_type
      LEFT JOIN public.rete_notification_preferences lp ON lp.user_id IS NULL AND lp.location_id = v_event.recipient_location_id AND lp.event_type = v_event.event_type;

      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (
        p_event_id, 'WEB_PUSH', 'push_subscription:' || v_sub.id::text,
        CASE WHEN v_user_web_push THEN 'PENDING' ELSE 'SKIPPED_DISABLED' END
      )
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    END LOOP;

    IF NOT EXISTS (
      SELECT 1 FROM public.rete_push_subscriptions
      WHERE location_id = v_event.recipient_location_id AND revoked_at IS NULL
    ) THEN
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (p_event_id, 'WEB_PUSH', 'location:' || v_event.recipient_location_id::text, 'SKIPPED_NO_DESTINATION')
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    END IF;
  END IF;

  -- ---- EMAIL -------------------------------------------------------------
  SELECT mode INTO v_mode FROM public.rete_notification_routing_defaults WHERE event_type = v_event.event_type AND channel = 'EMAIL';
  IF v_mode IN ('DIGEST', 'IMMEDIATE') AND v_event.recipient_location_id IS NOT NULL THEN
    SELECT * INTO v_contact FROM public.rete_notification_contacts WHERE location_id = v_event.recipient_location_id;
    SELECT * INTO v_loc_pref FROM public.rete_notification_preferences
      WHERE user_id IS NULL AND location_id = v_event.recipient_location_id AND event_type = v_event.event_type;

    IF NOT FOUND OR v_contact.email_address IS NULL THEN
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (p_event_id, 'EMAIL', 'contact:' || v_event.recipient_location_id::text, 'SKIPPED_NO_DESTINATION')
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    ELSIF NOT v_contact.email_enabled OR v_contact.email_verified_at IS NULL OR (v_loc_pref.location_id IS NOT NULL AND NOT v_loc_pref.email_digest_enabled) THEN
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
      VALUES (p_event_id, 'EMAIL', 'contact:' || v_event.recipient_location_id::text, 'SKIPPED_DISABLED')
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    ELSE
      INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status, next_attempt_at)
      VALUES (
        p_event_id, 'EMAIL', 'contact:' || v_event.recipient_location_id::text, 'PENDING',
        CASE WHEN v_mode = 'IMMEDIATE' THEN now() ELSE NULL END
      )
      ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
    END IF;
  END IF;

  -- ---- WHATSAPP -------------------------------------------------------------
  -- Deliberately disabled by default in every case, per the gate's blanket
  -- instruction - this channel-neutral WHATSAPP delivery row is created
  -- only for observability (so the routing decision is auditable) and is
  -- always SKIPPED_DISABLED here; it never sends anything and is
  -- independent of the pre-existing rete_whatsapp_notification_events
  -- outbox, which keeps its own, unrelated (and also disabled) lifecycle.
  SELECT mode INTO v_mode FROM public.rete_notification_routing_defaults WHERE event_type = v_event.event_type AND channel = 'WHATSAPP';
  IF v_mode IN ('YES', 'OPTIONAL_DISABLED') AND v_event.recipient_location_id IS NOT NULL THEN
    INSERT INTO public.rete_notification_deliveries (notification_event_id, channel, recipient_reference, status)
    VALUES (p_event_id, 'WHATSAPP', 'location:' || v_event.recipient_location_id::text, 'SKIPPED_DISABLED')
    ON CONFLICT (notification_event_id, channel, recipient_reference) DO NOTHING;
  END IF;
END;
$$;
ALTER FUNCTION "public"."rete_notification_route_deliveries"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_route_deliveries"("uuid") FROM PUBLIC, "anon", "authenticated";

-- ---------------------------------------------------------------------------
-- 3. Single enqueue entry point - the ONLY way any business RPC creates a
--    canonical event. Never raises for dedup: a repeated deduplication_key
--    returns the pre-existing event's id without creating a second event
--    or re-running routing.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notification_enqueue_event"(
  "p_event_type" "public"."rete_notification_event_type",
  "p_deduplication_key" "text",
  "p_deep_link" "text",
  "p_context" "jsonb",
  "p_recipient_location_id" smallint DEFAULT NULL,
  "p_recipient_user_id" "uuid" DEFAULT NULL,
  "p_request_id" "uuid" DEFAULT NULL,
  "p_offer_id" "uuid" DEFAULT NULL,
  "p_transfer_id" "uuid" DEFAULT NULL,
  "p_excess_stock_id" "uuid" DEFAULT NULL,
  "p_reservation_id" "uuid" DEFAULT NULL,
  "p_priority" "public"."rete_notification_priority" DEFAULT 'NORMAL',
  "p_event_reference" "text" DEFAULT NULL,
  "p_expires_at" timestamp with time zone DEFAULT NULL
)
RETURNS "uuid"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_copy jsonb;
  v_id uuid;
BEGIN
  v_copy := public.rete_notification_render_copy(p_event_type, p_context);

  INSERT INTO public.rete_notification_events (
    event_type, event_reference, request_id, offer_id, transfer_id, excess_stock_id, reservation_id,
    recipient_location_id, recipient_user_id, title, body, deep_link, priority, deduplication_key, expires_at
  ) VALUES (
    p_event_type, p_event_reference, p_request_id, p_offer_id, p_transfer_id, p_excess_stock_id, p_reservation_id,
    p_recipient_location_id, p_recipient_user_id, v_copy->>'title', v_copy->>'body', p_deep_link, p_priority, p_deduplication_key, p_expires_at
  )
  ON CONFLICT (deduplication_key) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN
    SELECT id INTO v_id FROM public.rete_notification_events WHERE deduplication_key = p_deduplication_key;
    RETURN v_id;
  END IF;

  PERFORM public.rete_notification_route_deliveries(v_id);
  RETURN v_id;
END;
$$;
ALTER FUNCTION "public"."rete_notification_enqueue_event"(
  "public"."rete_notification_event_type", "text", "text", "jsonb", smallint, "uuid", "uuid", "uuid", "uuid", "uuid", "uuid",
  "public"."rete_notification_priority", "text", timestamp with time zone
) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_enqueue_event"(
  "public"."rete_notification_event_type", "text", "text", "jsonb", smallint, "uuid", "uuid", "uuid", "uuid", "uuid", "uuid",
  "public"."rete_notification_priority", "text", timestamp with time zone
) FROM PUBLIC, "anon";
-- Callable only from other SECURITY DEFINER functions owned by postgres
-- (the business RPCs wired in 20260729080600) - never granted to
-- authenticated/anon directly, same lockdown as rete_whatsapp_enqueue_notification.

-- ---------------------------------------------------------------------------
-- 4. In-app governed RPCs (Phase 5). Identity always derived from
--    rete_require_active_membership() / auth.uid() - never a
--    caller-supplied location or user id.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notifications_list"(
  "p_limit" integer DEFAULT 20,
  "p_before" timestamp with time zone DEFAULT NULL,
  "p_unread_only" boolean DEFAULT false
)
RETURNS TABLE (
  "delivery_id" "uuid", "event_id" "uuid", "event_type" "public"."rete_notification_event_type",
  "title" "text", "body" "text", "deep_link" "text", "priority" "public"."rete_notification_priority",
  "created_at" timestamp with time zone, "read_at" timestamp with time zone
)
LANGUAGE "plpgsql"
SECURITY DEFINER
-- Not STABLE: rete_require_active_membership()'s FOR KEY SHARE lock cannot
-- run in the read-only transaction PostgREST opens for STABLE functions.
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
BEGIN
  v_membership := public.rete_require_active_membership();

  RETURN QUERY
  SELECT d.id, e.id, e.event_type, e.title, e.body, e.deep_link, e.priority, e.created_at, d.read_at
  FROM public.rete_notification_deliveries d
  JOIN public.rete_notification_events e ON e.id = d.notification_event_id
  WHERE d.channel = 'IN_APP'
    AND (
      (v_membership.role = 'store' AND e.recipient_location_id = v_membership.location_id)
      OR e.recipient_user_id = auth.uid()
    )
    AND (NOT p_unread_only OR d.read_at IS NULL)
    AND (p_before IS NULL OR e.created_at < p_before)
  ORDER BY e.created_at DESC
  LIMIT LEAST(GREATEST(COALESCE(p_limit, 20), 1), 100);
END;
$$;
ALTER FUNCTION "public"."rete_notifications_list"(integer, timestamp with time zone, boolean) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notifications_list"(integer, timestamp with time zone, boolean) FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notifications_list"(integer, timestamp with time zone, boolean) TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notifications_unread_count"()
RETURNS integer
LANGUAGE "plpgsql"
SECURITY DEFINER
-- Not STABLE: see rete_notifications_list above.
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_count integer;
BEGIN
  v_membership := public.rete_require_active_membership();

  SELECT count(*) INTO v_count
  FROM public.rete_notification_deliveries d
  JOIN public.rete_notification_events e ON e.id = d.notification_event_id
  WHERE d.channel = 'IN_APP' AND d.read_at IS NULL
    AND (
      (v_membership.role = 'store' AND e.recipient_location_id = v_membership.location_id)
      OR e.recipient_user_id = auth.uid()
    );

  RETURN v_count;
END;
$$;
ALTER FUNCTION "public"."rete_notifications_unread_count"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notifications_unread_count"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notifications_unread_count"() TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notification_mark_read"("p_delivery_id" "uuid")
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_delivery public.rete_notification_deliveries;
  v_event public.rete_notification_events;
BEGIN
  v_membership := public.rete_require_active_membership();

  SELECT * INTO v_delivery FROM public.rete_notification_deliveries WHERE id = p_delivery_id AND channel = 'IN_APP';
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  SELECT * INTO v_event FROM public.rete_notification_events WHERE id = v_delivery.notification_event_id;
  IF NOT FOUND OR NOT (
    (v_membership.role = 'store' AND v_event.recipient_location_id = v_membership.location_id)
    OR v_event.recipient_user_id = auth.uid()
  ) THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  UPDATE public.rete_notification_deliveries
  SET read_at = COALESCE(read_at, now()), status = 'READ'
  WHERE id = p_delivery_id;

  RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', 'READ');
END;
$$;
ALTER FUNCTION "public"."rete_notification_mark_read"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_mark_read"("uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_mark_read"("uuid") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notifications_mark_all_read"()
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership public.rete_memberships;
  v_updated integer;
BEGIN
  v_membership := public.rete_require_active_membership();

  WITH scoped AS (
    SELECT d.id FROM public.rete_notification_deliveries d
    JOIN public.rete_notification_events e ON e.id = d.notification_event_id
    WHERE d.channel = 'IN_APP' AND d.read_at IS NULL
      AND (
        (v_membership.role = 'store' AND e.recipient_location_id = v_membership.location_id)
        OR e.recipient_user_id = auth.uid()
      )
  )
  UPDATE public.rete_notification_deliveries d
  SET read_at = now(), status = 'READ'
  FROM scoped WHERE d.id = scoped.id;
  GET DIAGNOSTICS v_updated = ROW_COUNT;

  RETURN jsonb_build_object('marked_read', v_updated);
END;
$$;
ALTER FUNCTION "public"."rete_notifications_mark_all_read"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notifications_mark_all_read"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notifications_mark_all_read"() TO "authenticated";

-- ---------------------------------------------------------------------------
-- 5. Web push subscription RPCs (Phase 6). Every operation scoped to
--    auth.uid() - a store can never enumerate or touch another user's
--    subscription, and endpoint/p256dh/auth_secret are never selected back.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_push_subscription_create"(
  "p_endpoint" "text",
  "p_p256dh" "text",
  "p_auth_secret" "text",
  "p_user_agent" "text" DEFAULT NULL,
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
  v_hash text;
  v_id uuid;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();

  IF p_endpoint IS NULL OR length(p_endpoint) < 10 OR p_p256dh IS NULL OR p_auth_secret IS NULL THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('endpoint_len', length(p_endpoint));
  v_cached := public.rete_claim_idempotency_key('rete_push_subscription_create', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  v_hash := encode(digest(p_endpoint, 'sha256'), 'hex');

  INSERT INTO public.rete_push_subscriptions (user_id, location_id, endpoint_hash, endpoint_ciphertext, p256dh, auth_secret, user_agent)
  VALUES (auth.uid(), v_membership.location_id, v_hash, p_endpoint, p_p256dh, p_auth_secret, p_user_agent)
  ON CONFLICT (endpoint_hash) DO UPDATE SET
    user_id = excluded.user_id, location_id = excluded.location_id, p256dh = excluded.p256dh,
    auth_secret = excluded.auth_secret, user_agent = excluded.user_agent, revoked_at = NULL
  RETURNING id INTO v_id;

  v_result := jsonb_build_object('subscription_id', v_id, 'status', 'ACTIVE');
  PERFORM public.rete_store_idempotency_result('rete_push_subscription_create', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_push_subscription_create"("text", "text", "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_push_subscription_create"("text", "text", "text", "text", "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_push_subscription_create"("text", "text", "text", "text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_push_subscription_revoke"("p_subscription_id" "uuid")
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  PERFORM public.rete_require_active_membership();

  UPDATE public.rete_push_subscriptions
  SET revoked_at = COALESCE(revoked_at, now())
  WHERE id = p_subscription_id AND user_id = auth.uid();

  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  RETURN jsonb_build_object('subscription_id', p_subscription_id, 'status', 'REVOKED');
END;
$$;
ALTER FUNCTION "public"."rete_push_subscription_revoke"("uuid") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_push_subscription_revoke"("uuid") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_push_subscription_revoke"("uuid") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_push_subscriptions_list_own"()
RETURNS TABLE ("id" "uuid", "user_agent" "text", "created_at" timestamp with time zone, "last_used_at" timestamp with time zone, "revoked_at" timestamp with time zone)
LANGUAGE "plpgsql"
SECURITY DEFINER
-- Not STABLE: see rete_notifications_list above.
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  PERFORM public.rete_require_active_membership();
  RETURN QUERY
  SELECT s.id, s.user_agent, s.created_at, s.last_used_at, s.revoked_at
  FROM public.rete_push_subscriptions s
  WHERE s.user_id = auth.uid()
  ORDER BY s.created_at DESC;
END;
$$;
ALTER FUNCTION "public"."rete_push_subscriptions_list_own"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_push_subscriptions_list_own"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_push_subscriptions_list_own"() TO "authenticated";

-- Worker-facing (service_role only, no grants) - mirrors
-- rete_whatsapp_claim_pending_events / rete_whatsapp_record_send_result.
CREATE OR REPLACE FUNCTION "public"."rete_push_claim_pending_deliveries"("p_limit" integer DEFAULT 20)
RETURNS SETOF "public"."rete_notification_deliveries"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.rete_notification_deliveries
  SET status = 'SENDING', attempt_count = attempt_count + 1
  WHERE id IN (
    SELECT id FROM public.rete_notification_deliveries
    WHERE channel = 'WEB_PUSH' AND status = 'PENDING' AND (next_attempt_at IS NULL OR next_attempt_at <= now())
    ORDER BY created_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
ALTER FUNCTION "public"."rete_push_claim_pending_deliveries"(integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_push_claim_pending_deliveries"(integer) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_push_record_delivery_result"(
  "p_delivery_id" "uuid",
  "p_outcome" "text", -- 'SUCCESS' | 'TEMPORARY' | 'PERMANENT' | 'UNCERTAIN'
  "p_error_code" "text" DEFAULT NULL,
  "p_max_attempts" integer DEFAULT 5,
  "p_backoff_seconds" integer DEFAULT 60
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_delivery public.rete_notification_deliveries;
  v_next_status public.rete_notification_delivery_status;
  v_sub_id uuid;
BEGIN
  SELECT * INTO v_delivery FROM public.rete_notification_deliveries WHERE id = p_delivery_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_outcome = 'SUCCESS' THEN
    UPDATE public.rete_notification_deliveries SET status = 'DELIVERED', sent_at = now(), error_code = NULL WHERE id = p_delivery_id;
    v_next_status := 'DELIVERED';
  ELSIF p_outcome = 'PERMANENT' OR (p_outcome = 'TEMPORARY' AND v_delivery.attempt_count >= p_max_attempts) THEN
    UPDATE public.rete_notification_deliveries SET status = 'FAILED_PERMANENT', error_code = p_error_code WHERE id = p_delivery_id;
    v_next_status := 'FAILED_PERMANENT';
    IF v_delivery.recipient_reference LIKE 'push_subscription:%' THEN
      v_sub_id := (split_part(v_delivery.recipient_reference, ':', 2))::uuid;
      UPDATE public.rete_push_subscriptions SET revoked_at = COALESCE(revoked_at, now()) WHERE id = v_sub_id;
    END IF;
  ELSIF p_outcome = 'UNCERTAIN' THEN
    -- Never auto-retried - next_attempt_at is left NULL so the claim query
    -- (WHERE status = 'PENDING') can never pick this row up again.
    UPDATE public.rete_notification_deliveries SET status = 'FAILED_UNCERTAIN', error_code = p_error_code WHERE id = p_delivery_id;
    v_next_status := 'FAILED_UNCERTAIN';
  ELSE
    UPDATE public.rete_notification_deliveries
    SET status = 'PENDING', error_code = p_error_code,
        next_attempt_at = now() + (p_backoff_seconds * power(2, least(attempt_count - 1, 6))) * interval '1 second'
    WHERE id = p_delivery_id;
    v_next_status := 'PENDING';
  END IF;

  RETURN jsonb_build_object('delivery_id', p_delivery_id, 'status', v_next_status);
END;
$$;
ALTER FUNCTION "public"."rete_push_record_delivery_result"("uuid", "text", "text", integer, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_push_record_delivery_result"("uuid", "text", "text", integer, integer) FROM PUBLIC, "anon", "authenticated";

-- ---------------------------------------------------------------------------
-- 6. Central-only email contact RPCs (Phase 8) - mirrors
--    rete_whatsapp_contact_upsert exactly.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notification_contact_upsert"(
  "p_location_id" smallint,
  "p_email_address" "text",
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
  IF p_email_address !~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('location_id', p_location_id, 'email_address', p_email_address);
  v_cached := public.rete_claim_idempotency_key('rete_notification_contact_upsert', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.rete_notification_contacts (location_id, email_address, email_enabled, email_verified_at, updated_by)
  VALUES (p_location_id, p_email_address, true, NULL, auth.uid())
  ON CONFLICT (location_id) DO UPDATE SET
    email_address = excluded.email_address, email_verified_at = NULL, updated_by = auth.uid(), updated_at = now();

  v_result := jsonb_build_object('location_id', p_location_id, 'status', 'OK', 'verified', false);
  PERFORM public.rete_store_idempotency_result('rete_notification_contact_upsert', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_notification_contact_upsert"(smallint, "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_contact_upsert"(smallint, "text", "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_contact_upsert"(smallint, "text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notification_contact_verify"(
  "p_location_id" smallint,
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

  v_payload := jsonb_build_object('location_id', p_location_id);
  v_cached := public.rete_claim_idempotency_key('rete_notification_contact_verify', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  UPDATE public.rete_notification_contacts SET email_verified_at = now(), updated_by = auth.uid(), updated_at = now()
  WHERE location_id = p_location_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_result := jsonb_build_object('location_id', p_location_id, 'status', 'VERIFIED');
  PERFORM public.rete_store_idempotency_result('rete_notification_contact_verify', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_notification_contact_verify"(smallint, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_contact_verify"(smallint, "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_contact_verify"(smallint, "text") TO "authenticated";

-- Worker-facing digest claim/record (service_role only).
CREATE OR REPLACE FUNCTION "public"."rete_email_digest_claim_locations"()
RETURNS TABLE ("location_id" smallint)
LANGUAGE "sql"
SECURITY DEFINER
STABLE
SET "search_path" = "public", "pg_temp"
AS $$
  SELECT DISTINCT (split_part(d.recipient_reference, ':', 2))::smallint AS location_id
  FROM public.rete_notification_deliveries d
  WHERE d.channel = 'EMAIL' AND d.status = 'PENDING' AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now());
$$;
ALTER FUNCTION "public"."rete_email_digest_claim_locations"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_email_digest_claim_locations"() FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_email_digest_claim_deliveries"("p_location_id" smallint)
RETURNS TABLE ("delivery_id" "uuid", "event_id" "uuid", "event_type" "public"."rete_notification_event_type", "title" "text", "body" "text", "deep_link" "text", "created_at" timestamp with time zone)
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.rete_notification_deliveries d
  SET status = 'SENDING', attempt_count = attempt_count + 1
  FROM public.rete_notification_events e
  WHERE d.notification_event_id = e.id
    AND d.channel = 'EMAIL' AND d.status = 'PENDING'
    AND d.recipient_reference = 'contact:' || p_location_id::text
    AND (d.next_attempt_at IS NULL OR d.next_attempt_at <= now())
  RETURNING d.id, e.id, e.event_type, e.title, e.body, e.deep_link, e.created_at;
END;
$$;
ALTER FUNCTION "public"."rete_email_digest_claim_deliveries"(smallint) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_email_digest_claim_deliveries"(smallint) FROM PUBLIC, "anon", "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_email_digest_record_result"(
  "p_delivery_ids" "uuid"[],
  "p_success" boolean,
  "p_error_code" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_count integer;
BEGIN
  IF p_success THEN
    UPDATE public.rete_notification_deliveries SET status = 'DELIVERED', sent_at = now(), error_code = NULL
    WHERE id = ANY(p_delivery_ids);
  ELSE
    UPDATE public.rete_notification_deliveries
    SET status = 'PENDING', error_code = p_error_code, next_attempt_at = now() + interval '1 hour'
    WHERE id = ANY(p_delivery_ids);
  END IF;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN jsonb_build_object('updated', v_count, 'success', p_success);
END;
$$;
ALTER FUNCTION "public"."rete_email_digest_record_result"("uuid"[], boolean, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_email_digest_record_result"("uuid"[], boolean, "text") FROM PUBLIC, "anon", "authenticated";

-- ---------------------------------------------------------------------------
-- 7. Preference RPCs (Phase 10). in_app_enabled and whatsapp_enabled are
--    always forced regardless of caller input - IN_APP can never be
--    disabled, WHATSAPP is never enabled by any path in this gate.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_notification_preferences_get"()
RETURNS SETOF "public"."rete_notification_preferences"
LANGUAGE "plpgsql"
SECURITY DEFINER
-- Not STABLE: see rete_notifications_list above.
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  PERFORM public.rete_require_active_membership();
  RETURN QUERY SELECT * FROM public.rete_notification_preferences WHERE user_id = auth.uid();
END;
$$;
ALTER FUNCTION "public"."rete_notification_preferences_get"() OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_preferences_get"() FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_preferences_get"() TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notification_preferences_set"(
  "p_event_type" "public"."rete_notification_event_type",
  "p_web_push_enabled" boolean DEFAULT true,
  "p_email_digest_enabled" boolean DEFAULT false,
  "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_cached jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  PERFORM public.rete_require_active_membership();

  v_payload := jsonb_build_object('event_type', p_event_type, 'web_push_enabled', p_web_push_enabled, 'email_digest_enabled', p_email_digest_enabled);
  v_cached := public.rete_claim_idempotency_key('rete_notification_preferences_set', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.rete_notification_preferences (user_id, event_type, in_app_enabled, web_push_enabled, email_digest_enabled, whatsapp_enabled)
  VALUES (auth.uid(), p_event_type, true, COALESCE(p_web_push_enabled, true), COALESCE(p_email_digest_enabled, false), false)
  ON CONFLICT (user_id, event_type) WHERE user_id IS NOT NULL DO UPDATE SET
    in_app_enabled = true, web_push_enabled = excluded.web_push_enabled,
    email_digest_enabled = excluded.email_digest_enabled, whatsapp_enabled = false, updated_at = now();

  v_result := jsonb_build_object('event_type', p_event_type, 'status', 'OK');
  PERFORM public.rete_store_idempotency_result('rete_notification_preferences_set', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_notification_preferences_set"("public"."rete_notification_event_type", boolean, boolean, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_preferences_set"("public"."rete_notification_event_type", boolean, boolean, "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_preferences_set"("public"."rete_notification_event_type", boolean, boolean, "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_notification_central_set_location_default"(
  "p_location_id" smallint,
  "p_event_type" "public"."rete_notification_event_type",
  "p_web_push_enabled" boolean DEFAULT true,
  "p_email_digest_enabled" boolean DEFAULT false,
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

  v_payload := jsonb_build_object('location_id', p_location_id, 'event_type', p_event_type, 'web_push_enabled', p_web_push_enabled, 'email_digest_enabled', p_email_digest_enabled);
  v_cached := public.rete_claim_idempotency_key('rete_notification_central_set_location_default', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.rete_notification_preferences (location_id, event_type, in_app_enabled, web_push_enabled, email_digest_enabled, whatsapp_enabled)
  VALUES (p_location_id, p_event_type, true, COALESCE(p_web_push_enabled, true), COALESCE(p_email_digest_enabled, false), false)
  ON CONFLICT (location_id, event_type) WHERE user_id IS NULL AND location_id IS NOT NULL DO UPDATE SET
    in_app_enabled = true, web_push_enabled = excluded.web_push_enabled,
    email_digest_enabled = excluded.email_digest_enabled, whatsapp_enabled = false, updated_at = now();

  v_result := jsonb_build_object('location_id', p_location_id, 'event_type', p_event_type, 'status', 'OK');
  PERFORM public.rete_store_idempotency_result('rete_notification_central_set_location_default', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_notification_central_set_location_default"(smallint, "public"."rete_notification_event_type", boolean, boolean, "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_notification_central_set_location_default"(smallint, "public"."rete_notification_event_type", boolean, boolean, "text") FROM PUBLIC, "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_notification_central_set_location_default"(smallint, "public"."rete_notification_event_type", boolean, boolean, "text") TO "authenticated";

COMMIT;
