-- Migration 7: rete_squillari_mcp_readonly_role
--
-- Creates a dedicated, minimally-privileged Postgres role for the
-- production Supabase-backed read-only MCP server
-- (scripts/rete_squillari_mcp_prod/). This is the sole data-access
-- mechanism for that server - it never uses the Supabase service-role key
-- or the PostgREST REST API, and it is architecturally distinct from the
-- existing demo MCP (scripts/rete_squillari_mcp/), which is untouched by
-- this migration.
--
-- Design: the read-only guarantee is enforced at the database grant level,
-- not merely by application code discipline. rete_mcp_reader receives
-- exactly column-level SELECT grants on exactly the tables the 10 MCP read
-- tools need, and nothing else:
--   * no INSERT/UPDATE/DELETE/TRUNCATE grants anywhere, ever;
--   * no EXECUTE grant on any governed RPC (rete_wbos_suggestion_ingest,
--     rete_request_confirm, rete_offer_create, rete_offer_approve, etc.) -
--     this role can never call a mutation RPC even if a future application
--     bug tried to;
--   * no access to auth.* or storage.* schemas at all;
--   * no SELECT on rete_idempotent_operations (internal concurrency
--     plumbing, not pilot-monitoring data);
--   * column-level (not table-level) SELECT grants exclude every actor
--     UUID column (created_by, confirmed_by, cancelled_by, offered_by,
--     approved_by, received_by, discrepancy_resolved_by, actor_user_id)
--     and every free-text staff-commentary column not explicitly needed
--     (notes, cancel_reason, hard_exclusion_reason) - a bug in the MCP
--     application code that tried to SELECT one of these columns would be
--     rejected by Postgres itself, not merely caught by code review.
--
-- This role is created WITHOUT login capability and without a password.
-- Enabling login and setting a strong, generated password is a deliberate,
-- out-of-band, non-migration deployment step (see
-- deploy/rete-squillari-mcp-prod/RUNBOOK.md) - no credential for this role
-- is ever committed to this repository.
--
-- Rollback: DROP OWNED BY rete_mcp_reader (removes the six "rete_mcp_reader
-- full read" RLS policies and all grants in one step, since they are all
-- owned-by/granted-to this role); then DROP ROLE rete_mcp_reader - safe at
-- any time, since this role owns no tables/columns/functions itself and
-- this migration creates no tables, columns, or functions of its own.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'rete_mcp_reader') THEN
    CREATE ROLE rete_mcp_reader NOLOGIN NOINHERIT;
  END IF;
END;
$$;

-- Explicit, not merely default-absent: no role should ever assume this
-- one has write access via some future GRANT ... TO PUBLIC.
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM rete_mcp_reader;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM rete_mcp_reader;
REVOKE ALL ON SCHEMA public FROM rete_mcp_reader;

GRANT USAGE ON SCHEMA public TO rete_mcp_reader;

GRANT SELECT (
  id, requesting_location_id, product_code, product_description,
  requested_quantity, remaining_quantity, status, source,
  requires_central_confirmation, warning_codes, score, score_version,
  created_at, updated_at, confirmed_at, cancelled_at, closed_at
) ON public.rete_requests TO rete_mcp_reader;

GRANT SELECT (
  id, request_id, offering_location_id, offered_quantity,
  approved_quantity, status, created_at, updated_at
) ON public.rete_offers TO rete_mcp_reader;

GRANT SELECT (
  id, request_id, offer_id, from_location_id, to_location_id, quantity,
  status, prepared_at, departed_at, received_at, received_quantity,
  discrepancy_type, discrepancy_acknowledged, discrepancy_resolution_note,
  discrepancy_resolved_at, anomaly_note, created_at, updated_at
) ON public.rete_transfers TO rete_mcp_reader;

GRANT SELECT (
  id, event_type, entity_type, entity_id, payload, created_at
) ON public.rete_audit_events TO rete_mcp_reader;

GRANT SELECT (
  id, code, name, active
) ON public.rete_locations TO rete_mcp_reader;

GRANT SELECT (
  location_id, role, active, pilot_enabled, display_name
) ON public.rete_memberships TO rete_mcp_reader;

-- No grant at all on rete_idempotent_operations - internal plumbing, not
-- pilot-monitoring data, and its actor_user_id/payload are more sensitive
-- (raw idempotency request bodies) than anything this MCP needs to expose.

-- All six tables above have row level security enabled. A GRANT alone does
-- not make any row visible under RLS - without an explicit policy for this
-- role, rete_mcp_reader would pass every privilege check yet see zero rows
-- on every query (verified live during development: SELECT succeeded,
-- returned 0 rows, on a table known to have 6). Add one dedicated,
-- unconditional SELECT policy per table, scoped to rete_mcp_reader only -
-- every existing policy for anon/authenticated is left completely
-- unchanged (Postgres policies are OR'd together per role; this adds a
-- policy, it does not touch or replace any existing one). The actual data
-- minimization boundary for this role is the column-level GRANT above, not
-- the RLS policy - USING (true) here is correct and intentional because
-- this role already cannot see or touch anything outside its granted
-- columns and tables.
CREATE POLICY "rete_mcp_reader full read" ON public.rete_requests
  FOR SELECT TO rete_mcp_reader USING (true);
CREATE POLICY "rete_mcp_reader full read" ON public.rete_offers
  FOR SELECT TO rete_mcp_reader USING (true);
CREATE POLICY "rete_mcp_reader full read" ON public.rete_transfers
  FOR SELECT TO rete_mcp_reader USING (true);
CREATE POLICY "rete_mcp_reader full read" ON public.rete_audit_events
  FOR SELECT TO rete_mcp_reader USING (true);
CREATE POLICY "rete_mcp_reader full read" ON public.rete_locations
  FOR SELECT TO rete_mcp_reader USING (true);
CREATE POLICY "rete_mcp_reader full read" ON public.rete_memberships
  FOR SELECT TO rete_mcp_reader USING (true);

COMMENT ON ROLE rete_mcp_reader IS
  'Read-only Postgres role for the production Rete Squillari MCP server (scripts/rete_squillari_mcp_prod/). Column-level SELECT grants only, on exactly the tables/columns the 10 read tools require. No INSERT/UPDATE/DELETE/TRUNCATE/DDL, no EXECUTE on any RPC, no auth.*/storage.* access. NOLOGIN by default - login and password are enabled out-of-band at deployment time, never via a migration or a committed credential.';
