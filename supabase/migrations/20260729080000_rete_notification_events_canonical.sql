-- Rete Squillari — canonical, channel-neutral notification model.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. Reviewable design
-- artifact only, same status as every other rete-squillari migration in
-- this branch (see 20260724110000 for the WhatsApp outbox this extends).
--
-- This migration is purely additive: it creates two brand-new tables and
-- does not touch rete_whatsapp_contacts / rete_whatsapp_opt_in_events /
-- rete_whatsapp_notification_events or any of their columns, enum values,
-- functions, triggers or grants. The WhatsApp outbox keeps working exactly
-- as before (Phase 14) - business RPCs will additively enqueue into BOTH
-- the WhatsApp-specific outbox and this new canonical model, side by side
-- (wired in 20260729080600).
--
-- Design summary:
--  - rete_notification_events: ONE row per business-meaningful occurrence,
--    channel-neutral (no phone number, no push endpoint, no email address
--    ever stored here). deduplication_key carries a UNIQUE constraint so a
--    retried/duplicated business call can never produce two canonical
--    events for the same occurrence.
--  - rete_notification_deliveries: zero or more per event, one per channel
--    attempted for that event. A delivery failure (temporary, permanent,
--    or uncertain) only ever mutates its own row - it can never roll back
--    the business transaction that created the event, because it is
--    always created and updated by code that runs AFTER the business
--    state change already committed (or, for the initial IN_APP row, in
--    the same transaction but via an insert that cannot itself fail for
--    business reasons - see 20260729080500).
--  - No credentials of any channel (WhatsApp phone, push subscription
--    secret, email address) are ever stored in either table - deliveries
--    carries only recipient_reference, an opaque pointer (e.g.
--    'location:<id>', 'push_subscription:<uuid>') resolved against the
--    channel-specific table (rete_push_subscriptions, rete_notification_contacts)
--    only by server-side/service-role code at actual send time.

BEGIN;

CREATE TYPE "public"."rete_notification_event_type" AS ENUM (
  'OFFER_RECEIVED', 'OFFER_AUTO_ACCEPTED', 'GOODS_TO_PREPARE', 'GOODS_READY',
  'TRANSFER_STARTED', 'TRANSFER_RECEIVED', 'TRASTA_PARTIAL_ARRIVAL',
  'TRASTA_FULL_ARRIVAL', 'REQUEST_CANCELLED', 'SYSTEM_EXCEPTION',
  'EXCESS_STOCK_PUBLISHED', 'EXCESS_STOCK_RESERVED',
  'EXCESS_STOCK_PARTIALLY_RESERVED', 'EXCESS_STOCK_FULLY_RESERVED',
  'EXCESS_GOODS_TO_PREPARE', 'EXCESS_TRANSFER_STARTED',
  'EXCESS_TRANSFER_RECEIVED', 'EXCESS_STOCK_EXPIRED', 'EXCESS_STOCK_WITHDRAWN'
);

CREATE TYPE "public"."rete_notification_priority" AS ENUM (
  'LOW', 'NORMAL', 'HIGH', 'URGENT'
);

CREATE TYPE "public"."rete_notification_channel" AS ENUM (
  'IN_APP', 'WEB_PUSH', 'EMAIL', 'WHATSAPP'
);

CREATE TYPE "public"."rete_notification_delivery_status" AS ENUM (
  'PENDING', 'READY', 'SENDING', 'DELIVERED', 'READ',
  'SKIPPED_DISABLED', 'SKIPPED_NO_DESTINATION', 'SKIPPED_NO_CONSENT',
  'FAILED_TEMPORARY', 'FAILED_PERMANENT', 'FAILED_UNCERTAIN'
);

-- ---------------------------------------------------------------------------
-- 1. Canonical business events
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_notification_events" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "event_type" "public"."rete_notification_event_type" NOT NULL,
  "event_reference" "text",
  "request_id" "uuid" REFERENCES "public"."rete_requests"("id"),
  "offer_id" "uuid" REFERENCES "public"."rete_offers"("id"),
  "transfer_id" "uuid" REFERENCES "public"."rete_transfers"("id"),
  "excess_stock_id" "uuid" REFERENCES "public"."rete_excess_stock"("id"),
  "reservation_id" "uuid" REFERENCES "public"."rete_excess_reservations"("id"),
  "recipient_location_id" smallint REFERENCES "public"."rete_locations"("id"),
  "recipient_user_id" "uuid",
  "title" "text" NOT NULL,
  "body" "text" NOT NULL,
  "deep_link" "text" NOT NULL,
  "priority" "public"."rete_notification_priority" NOT NULL DEFAULT 'NORMAL',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "expires_at" timestamp with time zone,
  "deduplication_key" "text" NOT NULL,
  "payload_version" smallint NOT NULL DEFAULT 1,
  CONSTRAINT "rete_notification_events_dedup_key_unique" UNIQUE ("deduplication_key"),
  CONSTRAINT "rete_notification_events_title_check" CHECK (length(trim("title")) >= 1 AND length("title") <= 200),
  CONSTRAINT "rete_notification_events_body_check" CHECK (length(trim("body")) >= 1 AND length("body") <= 2000),
  CONSTRAINT "rete_notification_events_deep_link_check" CHECK (
    "deep_link" ~ '^/rete-squillari(\?[A-Za-z0-9_=&\-]*)?$'
  ),
  -- A broadcast event (e.g. EXCESS_STOCK_PUBLISHED) may target neither a
  -- single location nor a single user directly - fan-out to many IN_APP
  -- deliveries happens in the routing function, not by encoding "everyone"
  -- as a recipient here. Any other event must name at least one recipient.
  CONSTRAINT "rete_notification_events_recipient_shape_check" CHECK (
    "recipient_location_id" IS NOT NULL
    OR "recipient_user_id" IS NOT NULL
    OR "event_type" = 'EXCESS_STOCK_PUBLISHED'
  )
);
CREATE INDEX IF NOT EXISTS "rete_notification_events_recipient_location_idx"
  ON "public"."rete_notification_events" ("recipient_location_id", "created_at" DESC);
CREATE INDEX IF NOT EXISTS "rete_notification_events_recipient_user_idx"
  ON "public"."rete_notification_events" ("recipient_user_id", "created_at" DESC)
  WHERE "recipient_user_id" IS NOT NULL;

ALTER TABLE "public"."rete_notification_events" ENABLE ROW LEVEL SECURITY;
-- No direct grants to authenticated/anon at all - every read goes through
-- the governed RPCs in 20260729080500 (rete_notifications_list etc.), same
-- lockdown pattern as rete_whatsapp_contacts. Direct table writes/reads are
-- therefore structurally blocked for every non-service-role caller.
REVOKE ALL ON "public"."rete_notification_events" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_notification_events" TO "service_role";

-- ---------------------------------------------------------------------------
-- 2. Per-channel delivery attempts
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS "public"."rete_notification_deliveries" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "notification_event_id" "uuid" NOT NULL REFERENCES "public"."rete_notification_events"("id"),
  "channel" "public"."rete_notification_channel" NOT NULL,
  "recipient_reference" "text" NOT NULL,
  "status" "public"."rete_notification_delivery_status" NOT NULL DEFAULT 'PENDING',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "next_attempt_at" timestamp with time zone,
  "sent_at" timestamp with time zone,
  "read_at" timestamp with time zone,
  "error_code" "text",
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_notification_deliveries_attempt_count_check" CHECK ("attempt_count" >= 0),
  -- One delivery row per (event, channel, recipient_reference) - the
  -- routing function is itself idempotent (re-running it for an event that
  -- already has deliveries is a no-op per channel/recipient), and this
  -- constraint is the durable backstop against ever double-creating one.
  CONSTRAINT "rete_notification_deliveries_unique_target" UNIQUE ("notification_event_id", "channel", "recipient_reference")
);
CREATE INDEX IF NOT EXISTS "rete_notification_deliveries_pending_idx"
  ON "public"."rete_notification_deliveries" ("channel", "status", "next_attempt_at")
  WHERE "status" IN ('PENDING', 'READY');
CREATE INDEX IF NOT EXISTS "rete_notification_deliveries_event_idx"
  ON "public"."rete_notification_deliveries" ("notification_event_id");

ALTER TABLE "public"."rete_notification_deliveries" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_notification_deliveries" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_notification_deliveries" TO "service_role";

CREATE OR REPLACE FUNCTION "public"."rete_notification_deliveries_touch_updated_at"()
RETURNS "trigger"
LANGUAGE "plpgsql"
SET "search_path" = "public", "pg_temp"
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS "rete_notification_deliveries_touch_updated_at" ON "public"."rete_notification_deliveries";
CREATE TRIGGER "rete_notification_deliveries_touch_updated_at"
  BEFORE UPDATE ON "public"."rete_notification_deliveries"
  FOR EACH ROW EXECUTE FUNCTION "public"."rete_notification_deliveries_touch_updated_at"();

COMMIT;
