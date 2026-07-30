-- Rete Squillari — Web Push subscription registry (Phase 6).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. No real subscription is
-- ever created by this migration - it only creates the schema. Real
-- browser subscriptions require VAPID keys that are never generated or
-- committed as part of this gate (RETE_PUSH_VAPID_PUBLIC_KEY /
-- RETE_PUSH_VAPID_PRIVATE_KEY are referenced by name only, in
-- lib/rete-squillari/notifications/push-adapter.ts, and are unset).
--
-- Security model: this table is never granted to authenticated/anon -
-- endpoint/p256dh/auth_secret are exactly the kind of "channel-specific
-- credential" the gate says must never live in the channel-neutral event
-- row, and here they must also never be enumerable by any store. All
-- access - create own subscription, list own subscriptions, revoke own
-- subscription - goes through SECURITY DEFINER RPCs
-- (20260729080500) that scope every operation to auth.uid(). The
-- server-side delivery worker connects with the service_role key (bypasses
-- RLS/grants entirely), exactly like the WhatsApp sender.

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."rete_push_subscriptions" (
  "id" "uuid" DEFAULT "gen_random_uuid"() PRIMARY KEY,
  "user_id" "uuid" NOT NULL,
  "location_id" smallint REFERENCES "public"."rete_locations"("id"),
  "endpoint_hash" "text" NOT NULL,
  "endpoint_ciphertext" "text" NOT NULL,
  "p256dh" "text" NOT NULL,
  "auth_secret" "text" NOT NULL,
  "user_agent" "text",
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_used_at" timestamp with time zone,
  "revoked_at" timestamp with time zone,
  CONSTRAINT "rete_push_subscriptions_endpoint_hash_unique" UNIQUE ("endpoint_hash"),
  CONSTRAINT "rete_push_subscriptions_user_agent_check" CHECK ("user_agent" IS NULL OR length("user_agent") <= 300)
);
-- Only ever query "does this user/location have a live subscription" -
-- never full-table scans from application code.
CREATE INDEX IF NOT EXISTS "rete_push_subscriptions_active_by_user_idx"
  ON "public"."rete_push_subscriptions" ("user_id")
  WHERE "revoked_at" IS NULL;
CREATE INDEX IF NOT EXISTS "rete_push_subscriptions_active_by_location_idx"
  ON "public"."rete_push_subscriptions" ("location_id")
  WHERE "revoked_at" IS NULL;

ALTER TABLE "public"."rete_push_subscriptions" ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON "public"."rete_push_subscriptions" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_push_subscriptions" TO "service_role";

COMMIT;
