-- Rete Squillari — close a live authorization gap on
-- rete_notification_enqueue_event.
--
-- 20260729080500 revoked EXECUTE from PUBLIC and anon on this function but
-- omitted "authenticated" (unlike the three other server-only functions in
-- that same migration, which all correctly list PUBLIC, anon,
-- authenticated). Because Postgres/Supabase grants EXECUTE on new
-- functions to PUBLIC by default and "authenticated" inherits that
-- default separately from the platform's own default-privilege setup,
-- REVOKE ... FROM PUBLIC, anon alone left "authenticated" with EXECUTE.
--
-- rete_notification_enqueue_event is SECURITY DEFINER, does no identity or
-- ownership check, and takes recipient_location_id/recipient_user_id and
-- title/body content as caller-supplied parameters - the only intended
-- caller is other SECURITY DEFINER functions owned by postgres (which run
-- as postgres and never need an explicit grant). With the gap, any
-- authenticated store user could call it directly and inject a fabricated
-- notification event - with any event_type and arbitrary title/body -
-- into any other store's in-app notification feed.
--
-- This was found live in production (project ljuyolwnlbqlfxjujfrq) during
-- the go-live gate's grant verification, immediately after 20260729080500
-- was applied there, and the REVOKE was run out-of-band the moment it was
-- found (a pure permission-narrowing statement, safe by construction).
-- This migration makes that fix permanent and versioned so local
-- `supabase db reset` and any future re-deploy also get it, and so
-- production's migration history matches what is actually true of the
-- live schema.

BEGIN;

REVOKE ALL ON FUNCTION "public"."rete_notification_enqueue_event"(
  "public"."rete_notification_event_type", "text", "text", "jsonb", smallint, "uuid", "uuid", "uuid", "uuid", "uuid", "uuid",
  "public"."rete_notification_priority", "text", timestamp with time zone
) FROM "authenticated";

COMMIT;
