-- Rete Squillari — per-user / per-location notification preferences (Phase 10).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE.
--
-- A row with user_id set is a per-user override. A row with user_id NULL
-- and location_id set is a central-configured, location-wide default (used
-- when no user-level row exists for that location's members). Effective
-- preference resolution (implemented in the routing engine,
-- 20260729080500) is: user-level row > location-level row > hardcoded
-- fallback (IN_APP always on, WEB_PUSH on only once a live subscription
-- exists, EMAIL_DIGEST off until a verified contact exists, WHATSAPP off).
--
-- IN_APP cannot be disabled by anyone, for any event type, in this gate -
-- every event_type currently defined routes IN_APP = YES by default
-- (20260729080100) and the write RPC in 20260729080500 always forces
-- in_app_enabled = true regardless of the caller's input, exactly matching
-- the instruction that operationally critical in-app notifications must
-- never be fully disabled by a store user.

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."rete_notification_preferences" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "user_id" "uuid",
  "location_id" smallint REFERENCES "public"."rete_locations"("id"),
  "event_type" "public"."rete_notification_event_type" NOT NULL,
  "in_app_enabled" boolean NOT NULL DEFAULT true,
  "web_push_enabled" boolean NOT NULL DEFAULT true,
  "email_digest_enabled" boolean NOT NULL DEFAULT false,
  "whatsapp_enabled" boolean NOT NULL DEFAULT false,
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_notification_preferences_identity_check"
    CHECK ("user_id" IS NOT NULL OR "location_id" IS NOT NULL),
  CONSTRAINT "rete_notification_preferences_in_app_check"
    CHECK ("in_app_enabled" = true)
);
CREATE UNIQUE INDEX IF NOT EXISTS "rete_notification_preferences_user_event_unique"
  ON "public"."rete_notification_preferences" ("user_id", "event_type")
  WHERE "user_id" IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "rete_notification_preferences_location_event_unique"
  ON "public"."rete_notification_preferences" ("location_id", "event_type")
  WHERE "user_id" IS NULL AND "location_id" IS NOT NULL;

ALTER TABLE "public"."rete_notification_preferences" ENABLE ROW LEVEL SECURITY;
-- No direct grants - read/write only via the governed RPCs in
-- 20260729080500 (rete_notification_preferences_get / _set), so a store
-- user can never read or overwrite another identity's row directly.
REVOKE ALL ON "public"."rete_notification_preferences" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_notification_preferences" TO "service_role";

COMMIT;
