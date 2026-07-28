-- Rete Squillari — close a defense-in-depth gap on the three email-shortage
-- RPCs (20260721120000_rete_squillari_email_shortage_ingest.sql). Their
-- REVOKE statements only targeted PUBLIC, unlike every other governed RPC in
-- this codebase, which also explicitly revokes from "anon". Function-body
-- authorization (rete_require_active_membership()) already blocks anon
-- correctly and unconditionally - this migration only removes the redundant
-- grant-layer permission, restoring the same two-layer protection every
-- other governed RPC already has. No function body, signature, owner,
-- SECURITY DEFINER mode, search_path, or non-anon grant is touched.

REVOKE ALL ON FUNCTION "public"."rete_email_arbitrate_and_publish"(
    "public"."rete_email_arbitration_decision", "text", "text", "text", integer, "text",
    "text", "text", smallint, integer, "uuid",
    "text", "text", "text", "text",
    "jsonb", "jsonb", numeric, "text", timestamp with time zone,
    "text", boolean, integer, numeric, "text"
) FROM "anon";

REVOKE ALL ON FUNCTION "public"."rete_email_arbitration_correct_published"("uuid", "text", "text", integer, "text") FROM "anon";

REVOKE ALL ON FUNCTION "public"."rete_email_arbitration_retract_published"("uuid", "text", "text") FROM "anon";
