-- Rete Squillari — corrective lockdown for rete_manual_request_create.
--
-- NOT APPLIED TO PRODUCTION AS PART OF THIS GATE. A separate, explicit
-- authorization step is required, same as every other migration in this
-- project - but this one fixes a REAL, currently-live gap and should be
-- prioritized once authorized.
--
-- Root cause: 20260724100000_rete_squillari_request_reason.sql (already
-- applied to production) changed rete_manual_request_create's signature
-- from 7 to 9 parameters via DROP FUNCTION + CREATE OR REPLACE. Postgres
-- treats a different parameter list as a genuinely new catalog object, so
-- it received this project's default privilege grant (EXECUTE to
-- postgres/anon/authenticated/service_role, configured once via ALTER
-- DEFAULT PRIVILEGES early in this project's history) instead of
-- inheriting the OLD signature's explicit anon revocation. Verified live
-- against ljuyolwnlbqlfxjujfrq (read-only query): the 9-parameter function
-- currently grants EXECUTE to anon and PUBLIC.
--
-- Practical impact: LOW, not an active exploit. rete_require_active_membership()
-- - the very first call inside the function body - independently rejects
-- any caller with auth.uid() IS NULL (i.e. anon) with 'not authenticated'
-- before any row is read or written, regardless of this grant. This is a
-- defense-in-depth violation (the codebase's own established convention is
-- to revoke anon explicitly on every store/central RPC, redundant with the
-- runtime check), not a data-exposure or data-creation vulnerability - but
-- it should still be corrected to match the rest of this codebase's
-- posture, and per the same 20260724100000 migration file's own history,
-- this file must not be edited retroactively since it is already applied.
--
-- This migration does not need to be applied together with any frontend
-- deploy - it only tightens a grant, it does not change any RPC behavior
-- or signature.

BEGIN;

REVOKE ALL ON FUNCTION "public"."rete_manual_request_create"(
  "text", "text", integer, "text", boolean, "text"[], "text",
  "public"."rete_request_reason", "text"
) FROM PUBLIC;
REVOKE ALL ON FUNCTION "public"."rete_manual_request_create"(
  "text", "text", integer, "text", boolean, "text"[], "text",
  "public"."rete_request_reason", "text"
) FROM "anon";
GRANT EXECUTE ON FUNCTION "public"."rete_manual_request_create"(
  "text", "text", integer, "text", boolean, "text"[], "text",
  "public"."rete_request_reason", "text"
) TO "authenticated";

COMMIT;
