-- Rete Squillari — WhatsApp individual operational notifications (pilot).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, requires its own explicit-authorization step before
-- `supabase db push`. No real WhatsApp message is ever sent by this
-- migration - it only creates the schema, the transactional outbox, and
-- additive enqueue calls inside existing governed RPCs. Actually sending
-- requires a separate, not-yet-built sender process reading PENDING rows
-- (see scripts/rete-squillari-whatsapp-worker.ts, added alongside this
-- migration but never scheduled/invoked automatically).
--
-- Design summary:
--  - rete_whatsapp_contacts: one destination per location, central-managed
--    only. No RLS grant to `authenticated` at all - only service_role and a
--    narrow set of SECURITY DEFINER RPCs (central-only) can read/write it.
--    Store users and the frontend never see or choose a phone number.
--  - rete_whatsapp_opt_in_events: append-only audit trail of every consent
--    change, who recorded it, and from what source.
--  - rete_whatsapp_notification_events: the transactional outbox. Every
--    governed RPC that produces a notifiable event inserts one row here in
--    the SAME transaction as the business change - never a direct call to
--    Meta from inside a business RPC. A separate sender (not part of this
--    migration) is the only thing that ever talks to Meta.
--  - rete_whatsapp_enqueue_notification(): the single insertion point,
--    SECURITY DEFINER, resolves the recipient's current opt-in state at
--    enqueue time and marks the row SKIPPED_NO_OPT_IN / SKIPPED_DISABLED
--    immediately when the contact isn't eligible - it never raises, so a
--    missing/opted-out contact can never fail or roll back the caller's
--    business transaction.

BEGIN;

CREATE TYPE "public"."rete_whatsapp_opt_in_status" AS ENUM (
  'PENDING', 'OPTED_IN', 'OPTED_OUT'
);

CREATE TYPE "public"."rete_whatsapp_opt_in_source" AS ENUM (
  'SIGNED_FORM', 'EMAIL_CONFIRMATION', 'WHATSAPP_INITIATED_MESSAGE', 'MANUAL_RECORDED_CONSENT'
);

CREATE TYPE "public"."rete_whatsapp_event_type" AS ENUM (
  'OFFER_RECEIVED', 'OFFER_AUTO_ACCEPTED', 'GOODS_TO_PREPARE', 'GOODS_READY',
  'TRANSFER_STARTED', 'TRANSFER_RECEIVED', 'TRASTA_PARTIAL_ARRIVAL',
  'TRASTA_FULL_ARRIVAL', 'REQUEST_CANCELLED', 'SYSTEM_EXCEPTION'
);

CREATE TYPE "public"."rete_whatsapp_notification_status" AS ENUM (
  'PENDING', 'SENDING', 'SENT', 'RETRY', 'FAILED', 'SKIPPED_NO_OPT_IN', 'SKIPPED_DISABLED'
);

-- ---------------------------------------------------------------------------
-- 1. Store contact model (central-controlled, one row per location)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_whatsapp_contacts" (
  "location_id" smallint PRIMARY KEY REFERENCES "public"."rete_locations"("id"),
  "contact_name" "text" NOT NULL,
  "phone_e164" "text" NOT NULL,
  "whatsapp_enabled" boolean NOT NULL DEFAULT true,
  "opt_in_status" "public"."rete_whatsapp_opt_in_status" NOT NULL DEFAULT 'PENDING',
  "opt_in_recorded_at" timestamp with time zone,
  "opt_out_at" timestamp with time zone,
  "verified_at" timestamp with time zone,
  "active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_whatsapp_contacts_phone_e164_check"
    CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT "rete_whatsapp_contacts_name_check"
    CHECK (length(trim("contact_name")) >= 1 AND length("contact_name") <= 120)
);

-- No grants at all to `authenticated`/`anon` - service_role and the
-- SECURITY DEFINER RPCs below are the only access paths. Even central staff
-- never read this table directly from the frontend; a future admin screen
-- would go through its own read-only RPC, not a raw table grant, but no such
-- screen is built in this pilot gate.
ALTER TABLE "public"."rete_whatsapp_contacts" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_whatsapp_contacts" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_whatsapp_contacts" TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. Opt-in audit trail (append-only)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_whatsapp_opt_in_events" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "location_id" smallint NOT NULL REFERENCES "public"."rete_locations"("id"),
  "phone_e164" "text" NOT NULL,
  "status" "public"."rete_whatsapp_opt_in_status" NOT NULL,
  "source" "public"."rete_whatsapp_opt_in_source" NOT NULL,
  "recorded_by" "uuid" NOT NULL,
  "evidence_reference" "text",
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_whatsapp_opt_in_events_phone_e164_check"
    CHECK ("phone_e164" ~ '^\+[1-9][0-9]{6,14}$'),
  CONSTRAINT "rete_whatsapp_opt_in_events_evidence_check"
    CHECK ("evidence_reference" IS NULL OR length("evidence_reference") <= 500)
);
ALTER TABLE "public"."rete_whatsapp_opt_in_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_whatsapp_opt_in_events" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_whatsapp_opt_in_events" TO "service_role";

-- ---------------------------------------------------------------------------
-- 3. Transactional outbox
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_whatsapp_notification_events" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "event_type" "public"."rete_whatsapp_event_type" NOT NULL,
  "recipient_location_id" smallint NOT NULL REFERENCES "public"."rete_locations"("id"),
  "request_id" "uuid" REFERENCES "public"."rete_requests"("id"),
  "offer_id" "uuid" REFERENCES "public"."rete_offers"("id"),
  "transfer_id" "uuid" REFERENCES "public"."rete_transfers"("id"),
  "template_name" "text" NOT NULL,
  "template_parameters" "jsonb" NOT NULL DEFAULT '{}'::"jsonb",
  "deep_link" "text" NOT NULL,
  "deduplication_key" "text" NOT NULL,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "status" "public"."rete_whatsapp_notification_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "last_attempt_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "provider_message_id" "text",
  "last_error_code" "text",
  "last_error_redacted" "text",
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_whatsapp_notification_events_dedup_key_unique" UNIQUE ("deduplication_key"),
  CONSTRAINT "rete_whatsapp_notification_events_attempt_count_check" CHECK ("attempt_count" >= 0)
);
CREATE INDEX IF NOT EXISTS "rete_whatsapp_notification_events_pending_idx"
  ON "public"."rete_whatsapp_notification_events" ("status", "available_at")
  WHERE "status" IN ('PENDING', 'RETRY');

ALTER TABLE "public"."rete_whatsapp_notification_events" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_whatsapp_notification_events" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_whatsapp_notification_events" TO "service_role";

-- ---------------------------------------------------------------------------
-- 4. Enqueue helper - the ONLY way any RPC creates an outbox row.
--    Never raises: a missing/ineligible contact is recorded as a SKIPPED
--    row, not an error, so it can never roll back or block the caller.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_enqueue_notification"(
  "p_event_type" "public"."rete_whatsapp_event_type",
  "p_recipient_location_id" smallint,
  "p_request_id" "uuid",
  "p_offer_id" "uuid",
  "p_transfer_id" "uuid",
  "p_template_name" "text",
  "p_template_parameters" "jsonb",
  "p_deep_link" "text",
  "p_deduplication_key" "text"
)
RETURNS "uuid"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_contact "public"."rete_whatsapp_contacts";
  v_status "public"."rete_whatsapp_notification_status";
  v_id "uuid";
BEGIN
  SELECT * INTO v_contact FROM "public"."rete_whatsapp_contacts" WHERE "location_id" = "p_recipient_location_id";

  IF NOT FOUND OR v_contact."opt_in_status" <> 'OPTED_IN' THEN
    v_status := 'SKIPPED_NO_OPT_IN';
  ELSIF (NOT v_contact."active") OR (NOT v_contact."whatsapp_enabled") THEN
    v_status := 'SKIPPED_DISABLED';
  ELSE
    v_status := 'PENDING';
  END IF;

  INSERT INTO "public"."rete_whatsapp_notification_events" (
    "event_type", "recipient_location_id", "request_id", "offer_id", "transfer_id",
    "template_name", "template_parameters", "deep_link", "deduplication_key", "status"
  ) VALUES (
    "p_event_type", "p_recipient_location_id", "p_request_id", "p_offer_id", "p_transfer_id",
    "p_template_name", "p_template_parameters", "p_deep_link", "p_deduplication_key", v_status
  )
  ON CONFLICT ("deduplication_key") DO NOTHING
  RETURNING "id" INTO v_id;

  RETURN v_id;
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_enqueue_notification"("public"."rete_whatsapp_event_type", smallint, "uuid", "uuid", "uuid", "text", "jsonb", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_enqueue_notification"("public"."rete_whatsapp_event_type", smallint, "uuid", "uuid", "uuid", "text", "jsonb", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_enqueue_notification"("public"."rete_whatsapp_event_type", smallint, "uuid", "uuid", "uuid", "text", "jsonb", "text", "text") FROM "anon";
-- Callable only from other SECURITY DEFINER functions owned by postgres
-- (the governed RPCs below) - never granted to authenticated/anon directly.

-- ---------------------------------------------------------------------------
-- 5. Central-only contact and opt-in management RPCs
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_contact_upsert"(
  "p_location_id" smallint,
  "p_contact_name" "text",
  "p_phone_e164" "text",
  "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership "public"."rete_memberships";
  v_cached jsonb;
  v_payload jsonb;
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_phone_e164 !~ '^\+[1-9][0-9]{6,14}$' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;
  IF p_contact_name IS NULL OR length(trim(p_contact_name)) = 0 THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('location_id', p_location_id, 'contact_name', p_contact_name, 'phone_e164', p_phone_e164);
  v_cached := public.rete_claim_idempotency_key('rete_whatsapp_contact_upsert', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  INSERT INTO public.rete_whatsapp_contacts (location_id, contact_name, phone_e164, opt_in_status, active)
  VALUES (p_location_id, p_contact_name, p_phone_e164, 'PENDING', true)
  ON CONFLICT (location_id) DO UPDATE
    SET contact_name = excluded.contact_name, phone_e164 = excluded.phone_e164, updated_at = now();

  v_result := jsonb_build_object('location_id', p_location_id, 'status', 'OK');
  PERFORM public.rete_store_idempotency_result('rete_whatsapp_contact_upsert', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_contact_upsert"(smallint, "text", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_contact_upsert"(smallint, "text", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_contact_upsert"(smallint, "text", "text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_whatsapp_contact_upsert"(smallint, "text", "text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_record_opt_in"(
  "p_location_id" smallint,
  "p_source" "public"."rete_whatsapp_opt_in_source",
  "p_evidence_reference" "text" DEFAULT NULL,
  "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership "public"."rete_memberships";
  v_cached jsonb;
  v_payload jsonb;
  v_contact "public"."rete_whatsapp_contacts";
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('location_id', p_location_id, 'source', p_source, 'evidence_reference', p_evidence_reference);
  v_cached := public.rete_claim_idempotency_key('rete_whatsapp_record_opt_in', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_contact FROM public.rete_whatsapp_contacts WHERE location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  UPDATE public.rete_whatsapp_contacts
  SET opt_in_status = 'OPTED_IN', opt_in_recorded_at = now(), opt_out_at = NULL, updated_at = now()
  WHERE location_id = p_location_id;

  INSERT INTO public.rete_whatsapp_opt_in_events (location_id, phone_e164, status, source, recorded_by, evidence_reference)
  VALUES (p_location_id, v_contact.phone_e164, 'OPTED_IN', p_source, auth.uid(), p_evidence_reference);

  v_result := jsonb_build_object('location_id', p_location_id, 'opt_in_status', 'OPTED_IN');
  PERFORM public.rete_store_idempotency_result('rete_whatsapp_record_opt_in', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_record_opt_in"(smallint, "public"."rete_whatsapp_opt_in_source", "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_opt_in"(smallint, "public"."rete_whatsapp_opt_in_source", "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_opt_in"(smallint, "public"."rete_whatsapp_opt_in_source", "text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_whatsapp_record_opt_in"(smallint, "public"."rete_whatsapp_opt_in_source", "text", "text") TO "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_record_opt_out"(
  "p_location_id" smallint,
  "p_evidence_reference" "text" DEFAULT NULL,
  "p_idempotency_key" "text" DEFAULT NULL
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_membership "public"."rete_memberships";
  v_cached jsonb;
  v_payload jsonb;
  v_contact "public"."rete_whatsapp_contacts";
  v_result jsonb;
BEGIN
  v_membership := public.rete_require_active_membership();
  IF v_membership.role <> 'central' THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  v_payload := jsonb_build_object('location_id', p_location_id, 'evidence_reference', p_evidence_reference);
  v_cached := public.rete_claim_idempotency_key('rete_whatsapp_record_opt_out', p_idempotency_key, v_payload);
  IF v_cached IS NOT NULL AND v_cached <> 'null'::jsonb THEN
    RETURN v_cached;
  END IF;

  SELECT * INTO v_contact FROM public.rete_whatsapp_contacts WHERE location_id = p_location_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  UPDATE public.rete_whatsapp_contacts
  SET opt_in_status = 'OPTED_OUT', opt_out_at = now(), updated_at = now()
  WHERE location_id = p_location_id;

  INSERT INTO public.rete_whatsapp_opt_in_events (location_id, phone_e164, status, source, recorded_by, evidence_reference)
  VALUES (p_location_id, v_contact.phone_e164, 'OPTED_OUT', 'MANUAL_RECORDED_CONSENT', auth.uid(), p_evidence_reference);

  -- Any not-yet-sent pending/retry notifications for this store are
  -- reclassified immediately - opt-out must stop future sends without
  -- deleting the business events themselves.
  UPDATE public.rete_whatsapp_notification_events
  SET status = 'SKIPPED_DISABLED'
  WHERE recipient_location_id = p_location_id AND status IN ('PENDING', 'RETRY');

  v_result := jsonb_build_object('location_id', p_location_id, 'opt_in_status', 'OPTED_OUT');
  PERFORM public.rete_store_idempotency_result('rete_whatsapp_record_opt_out', p_idempotency_key, v_result);
  RETURN v_result;
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_record_opt_out"(smallint, "text", "text") OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_opt_out"(smallint, "text", "text") FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_opt_out"(smallint, "text", "text") FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_whatsapp_record_opt_out"(smallint, "text", "text") TO "authenticated";

-- ---------------------------------------------------------------------------
-- 6. Sender-facing RPCs (used only by the server-side worker, service_role)
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_claim_pending_events"(
  "p_limit" integer DEFAULT 20
)
RETURNS SETOF "public"."rete_whatsapp_notification_events"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  RETURN QUERY
  UPDATE public.rete_whatsapp_notification_events
  SET status = 'SENDING', attempt_count = attempt_count + 1, last_attempt_at = now()
  WHERE id IN (
    SELECT id FROM public.rete_whatsapp_notification_events
    WHERE status IN ('PENDING', 'RETRY') AND available_at <= now()
    ORDER BY available_at ASC
    LIMIT p_limit
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_claim_pending_events"(integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_claim_pending_events"(integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_claim_pending_events"(integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_claim_pending_events"(integer) FROM "authenticated";

CREATE OR REPLACE FUNCTION "public"."rete_whatsapp_record_send_result"(
  "p_event_id" "uuid",
  "p_success" boolean,
  "p_provider_message_id" "text" DEFAULT NULL,
  "p_error_code" "text" DEFAULT NULL,
  "p_error_redacted" "text" DEFAULT NULL,
  "p_is_permanent_error" boolean DEFAULT false,
  "p_max_attempts" integer DEFAULT 5,
  "p_backoff_seconds" integer DEFAULT 60
)
RETURNS "jsonb"
LANGUAGE "plpgsql"
SECURITY DEFINER
SET "search_path" = "public", "pg_temp"
AS $$
DECLARE
  v_event public.rete_whatsapp_notification_events;
  v_next_status public.rete_whatsapp_notification_status;
BEGIN
  SELECT * INTO v_event FROM public.rete_whatsapp_notification_events WHERE id = p_event_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'operation not permitted';
  END IF;

  IF p_success THEN
    UPDATE public.rete_whatsapp_notification_events
    SET status = 'SENT', sent_at = now(), provider_message_id = p_provider_message_id,
        last_error_code = NULL, last_error_redacted = NULL
    WHERE id = p_event_id;
    v_next_status := 'SENT';
  ELSIF p_is_permanent_error OR v_event.attempt_count >= p_max_attempts THEN
    UPDATE public.rete_whatsapp_notification_events
    SET status = 'FAILED', last_error_code = p_error_code, last_error_redacted = p_error_redacted
    WHERE id = p_event_id;
    v_next_status := 'FAILED';
  ELSE
    UPDATE public.rete_whatsapp_notification_events
    SET status = 'RETRY', last_error_code = p_error_code, last_error_redacted = p_error_redacted,
        available_at = now() + (p_backoff_seconds * power(2, least(v_event.attempt_count - 1, 6))) * interval '1 second'
    WHERE id = p_event_id;
    v_next_status := 'RETRY';
  END IF;

  RETURN jsonb_build_object('event_id', p_event_id, 'status', v_next_status);
END;
$$;
ALTER FUNCTION "public"."rete_whatsapp_record_send_result"("uuid", boolean, "text", "text", "text", boolean, integer, integer) OWNER TO "postgres";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_send_result"("uuid", boolean, "text", "text", "text", boolean, integer, integer) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_send_result"("uuid", boolean, "text", "text", "text", boolean, integer, integer) FROM "anon";
REVOKE ALL ON FUNCTION "public"."rete_whatsapp_record_send_result"("uuid", boolean, "text", "text", "text", boolean, integer, integer) FROM "authenticated";

-- rete_whatsapp_claim_pending_events / rete_whatsapp_record_send_result are
-- intentionally granted to no role at all here - the worker connects with
-- the service_role key (bypasses RLS/grants entirely), exactly like every
-- other server-only script in this repo (scripts/rete-squillari-*.ts use
-- SUPABASE_SERVICE_ROLE_KEY, never a store/central session). No frontend
-- path can reach these.

COMMIT;
