-- Rete Squillari — central-managed email destination for the digest (Phase 8).
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. No real email address is
-- ever inserted by this migration - schema only. Mirrors
-- rete_whatsapp_contacts exactly (central-controlled, one row per
-- location, no grant to authenticated/anon at all) - login email is
-- deliberately NOT assumed to be the operational destination; only a row
-- explicitly created here by a central RPC counts, and only once
-- email_verified_at is set does the digest worker ever send to it
-- (enforced in the routing/digest logic, 20260729080500).

BEGIN;

CREATE TABLE IF NOT EXISTS "public"."rete_notification_contacts" (
  "location_id" smallint PRIMARY KEY REFERENCES "public"."rete_locations"("id"),
  "email_address" "text" NOT NULL,
  "email_enabled" boolean NOT NULL DEFAULT true,
  "email_verified_at" timestamp with time zone,
  "updated_by" "uuid",
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "rete_notification_contacts_email_check"
    CHECK ("email_address" ~ '^[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}$')
);
ALTER TABLE "public"."rete_notification_contacts" ENABLE ROW LEVEL SECURITY;
-- No grants at all to authenticated/anon - central manages this exclusively
-- through SECURITY DEFINER RPCs (20260729080500), a store user can never
-- read or edit another store's (or even its own) destination email
-- directly, matching the WhatsApp contact model precedent exactly.
REVOKE ALL ON "public"."rete_notification_contacts" FROM "authenticated", "anon", "public";
GRANT ALL ON TABLE "public"."rete_notification_contacts" TO "service_role";

COMMIT;
