# Rete Squillari production MCP — read-only design

`scripts/rete_squillari_mcp_prod/` is a new, architecturally separate
component from the existing demo MCP (`scripts/rete_squillari_mcp/`). It
shares **no code, no config, no process, no port** with the demo. The demo
remains untouched by this work and continues to run in `DEMO` source mode
with zero Supabase integration, as it always has.

## Why a new component, not a converted demo

The demo MCP was explicitly built and reviewed as a local/staging protocol
conformance exercise (`source_mode` is hardcoded to the literal string
`"DEMO"` throughout, with no code path that ever queries Supabase). Reusing
or converting it in place would risk quietly changing behavior a prior
review already certified. This is a fresh implementation instead, built
specifically around one architectural decision that could not be retrofit
safely: **the read-only guarantee is enforced at the Postgres grant level,
not by application code discipline alone.**

## Data access model

A dedicated Postgres role, `rete_mcp_reader`, is created by
`supabase/migrations/20260720100000_rete_squillari_mcp_readonly_role.sql`:

- Column-level (not table-level) `SELECT` grants on exactly six tables
  (`rete_requests`, `rete_offers`, `rete_transfers`, `rete_audit_events`,
  `rete_locations`, `rete_memberships`), naming exactly the columns the 10
  tools need. Every actor UUID column (`created_by`, `confirmed_by`,
  `cancelled_by`, `offered_by`, `approved_by`, `received_by`,
  `discrepancy_resolved_by`, `actor_user_id`) and every free-text
  staff-commentary column not explicitly needed (`notes`, `cancel_reason`,
  `hard_exclusion_reason`) is excluded from the grant itself — a bug in the
  application code that tried to `SELECT` one of these is rejected by
  Postgres, not merely caught in review.
- Zero `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/DDL grants anywhere.
- Zero `EXECUTE` grant on any governed RPC — this role cannot call
  `rete_wbos_suggestion_ingest`, `rete_request_confirm`,
  `rete_offer_approve`, or any other mutation function, even if a future
  application bug tried to.
- Zero access to `auth.*` or `storage.*`.
- Zero grant on `rete_idempotent_operations` (internal concurrency
  plumbing, more sensitive than useful for pilot monitoring).
- **Row-level security**: all six tables have RLS enabled. A grant alone
  does not make a row visible under RLS (this was found and fixed during
  development — `rete_mcp_reader` initially had correct column grants but
  zero row visibility until an explicit, role-scoped `USING (true)` SELECT
  policy was added per table). These new policies are additive — every
  existing `anon`/`authenticated` policy is completely untouched, since
  Postgres RLS policies are evaluated per-role and this role matches none
  of the existing ones.
- The role is created `NOLOGIN` by the migration. Enabling login and
  setting a strong, generated password is a deliberate, out-of-band,
  non-migration deployment step (`deploy/rete-squillari-mcp-prod/RUNBOOK.md`
  §2.2) — no credential for this role is ever committed to this repository.
- The MCP server connects via a **direct Postgres connection string**
  (`RETE_MCP_DATABASE_URL`), never via the Supabase REST API / PostgREST,
  and never using the service-role key. `MCPConfig.validate()` refuses to
  start if the connection string looks like it contains the service role
  or the `postgres` superuser credential.

Verified live (both manually and in
`tests/test_rete_squillari_mcp_prod.py`, the
`test_reader_role_cannot_*` cases): `INSERT`, `UPDATE`, `DELETE`,
`TRUNCATE`, `CREATE TABLE`/`ALTER TABLE`/`DROP TABLE`, `CREATE FUNCTION`,
`COPY` (read and write), `SET ROLE` to any other role, execution of a
mutation RPC, `auth.*` access, and selecting a column outside the grant
list are all rejected directly by Postgres with `permission denied` —
independent of any bug in this server's own code.

### Two layers of protection, and where each one's boundary actually is

Two distinct guarantees are stacked, and it matters which one is doing the
work for which capability:

1. **Grant-level** (independent of the application, holds even for a raw
   `psql` connection): every `INSERT`/`UPDATE`/`DELETE`/`TRUNCATE`/DDL/
   mutation-RPC/`auth.*`/forbidden-column attempt above is blocked here,
   permanently, regardless of session settings.
2. **Session-level** (`db.py` opens every pooled connection with
   `default_transaction_read_only=on`): `CREATE TEMP TABLE` and large-object
   creation (`lo_create`) are *not* blockable at the grant level at all -
   both are granted to `PUBLIC` by every Postgres database by default, and
   revoking a PUBLIC-inherited privilege from one specific role is a no-op
   in Postgres (verified live: the `REVOKE` succeeds with a "no privileges
   could be revoked" warning and changes nothing). Only Postgres's own
   read-only-transaction enforcement blocks them (verified live: `ERROR:
   cannot execute CREATE TABLE/lo_create() in a read-only transaction`)
   - meaning this specific guarantee depends on the application's own
     connection configuration, not on something independent of it.

### Two capabilities that cannot be blocked at all, by Postgres design

`LISTEN`/`NOTIFY` and `pg_advisory_lock` (session-scoped, non-transactional)
succeed for `rete_mcp_reader` even under a read-only session - Postgres
deliberately permits both in read-only transactions, and neither has any
GRANT/REVOKE-based permission model at all; every authenticated role can
always use them. This is a real, verified, accepted residual, not an
oversight:

- **`LISTEN`/`NOTIFY`**: gives no access to any table, column, or row -
  at most a pub/sub coordination side-channel with zero persistent state.
- **`pg_advisory_lock`** (as opposed to the `pg_advisory_xact_lock` the
  governed RPCs use, which releases automatically at transaction end):
  a session holding this role's credential *could* acquire a lock using
  the same key convention the application's own concurrency control uses
  (`hashtext('rete_manual_request_create:' || location_id || ':' ||
  product_code)`, see the `rete_squillari_open_to_offers_pilot_extension`
  migration) and hold it indefinitely, blocking legitimate concurrent
  writes - a theoretical denial-of-service, never a data-integrity or
  confidentiality breach. This requires already possessing the
  `rete_mcp_reader` password (itself a protected, never-committed secret)
  *and* independently knowing this internal lock-key naming convention,
  which no tool or output in this MCP ever exposes.  No code in
  `scripts/rete_squillari_mcp_prod/` calls `pg_advisory_lock` or any
  advisory-lock function anywhere - this residual describes what the
  *credential* could do if used outside this application, not anything
  this MCP itself does or exposes through its own surface.

## Tool contract

All 10 tools are read-only by construction and by naming convention
(`rete_get_*` / `rete_list_*` only — enforced by
`test_no_mutation_tools_in_registry`, which also checks no tool name
contains a mutation-shaped word). There is no generic SQL tool, no
arbitrary table reader, and no arbitrary RPC caller.

| Tool | Scope required | Purpose |
|---|---|---|
| `rete_get_health` | `rete:health` | Liveness + DB reachability |
| `rete_get_pilot_status` | `rete:requests:read` | Aggregate counters (pending confirmations, active automatic requests, unresolved discrepancies) |
| `rete_list_locations` | `rete:health` | The six pilot locations and their `active` flag |
| `rete_list_pending_confirmations` | `rete:requests:read` | Requests in `DA_CONFERMARE`, optional `location_id` filter |
| `rete_list_open_requests` | `rete:requests:read` | Requests past confirmation, not closed/cancelled |
| `rete_get_request` | `rete:requests:read` | One request by UUID |
| `rete_list_offers` | `rete:offers:read` | Offers, optional `request_id`/`location_id` filter |
| `rete_list_transfers` | `rete:transfers:read` | Transfers, optional `request_id`/`status` filter |
| `rete_list_receipt_discrepancies` | `rete:transfers:read` | Transfers with a recorded discrepancy, optional `resolved` filter |
| `rete_get_request_audit` | `rete:audit:read` | Chronological, redacted audit trail for one request |

`rete:read` is a superset scope that satisfies every narrower scope check
(`Identity.has_scope`). A token holding only `rete:health` cannot call any
`*:read`-gated tool — verified in `test_missing_scope_blocked`.

### Pagination and limits

Every list tool accepts `limit`/`offset`. `limit` is clamped server-side to
`RETE_MCP_MAX_LIST_LIMIT` (default 100) for all list tools and
`RETE_MCP_MAX_AUDIT_LIMIT` (default 200) for the audit tool — a caller
requesting more never gets more; a caller requesting an invalid or
negative value gets a structured `INVALID_LIMIT`/`INVALID_OFFSET` error,
not a silently-clamped-and-ignored one. Ordering is always deterministic
(`created_at, id`, both directions explicit per query) — never an
unbounded or caller-controlled sort expression. Offset+limit (not
cursor-token) pagination was a deliberate choice given this pilot's own
publication-budget ceiling (max 5 active automatic requests globally) —
cursor pagination would be complexity with no corresponding benefit at
this scale.

### Filters

Only `location_id` (validated as one of the six known canonical location
IDs implicitly via the FK), `status`/enum-like filters (validated against
an explicit allowlist per table — `db.STATUS_ALLOWLIST_*`), and UUIDs
(validated via `uuid.UUID(...)`, never interpolated into SQL text) are
accepted anywhere. An unrecognized filter key in `arguments` is simply
ignored by the tool (not rejected), matching normal JSON-RPC tolerance for
forward-compatible clients — but no filter value is ever used unvalidated.

## Data minimization

Requests, offers, and transfers each expose exactly the field set listed
in this gate's Phase 5 specification (id, location, product code/
description, quantities, state, confirmation state, timestamps, warning
codes, score/version) — no actor UUIDs, no free-text staff notes beyond
`anomaly_note`/`discrepancy_resolution_note` (operational commentary
directly relevant to the discrepancy tools, not personal data).

Audit events pass through `event_type`/`entity_type`/`entity_id`/
`created_at`/`payload`, with `actor_user_id` dropped entirely and the
`payload` JSON defensively re-scanned key-by-key
(`tools._redact_payload`) for anything matching `pin|token|password|
secret|key|jwt` (case-insensitive) — replaced with `"[REDACTED]"` even
though the writing RPCs were already confirmed (in an earlier review gate)
to never place such values in an audit payload. This is deliberate
defense-in-depth, not a claim that the writers are untrusted.

No auth user email, PIN, password hash, JWT, or Supabase key is ever
selectable by `rete_mcp_reader` in the first place (no `auth.*` grant
exists at all) — so no tool-level redaction could ever be the only thing
standing between a bug and a leak.

## Authentication and authorization

Bearer JWTs (HS256, via PyJWT — constant-time signature comparison is
handled internally by the library), issued **out-of-band** by
`scripts/rete_squillari_mcp_prod/issue_token.py`, a CLI never reachable
over the network and never invoked by the running server. Claims:
`sub`, `scopes`, `iss`, `aud`, `iat`, `exp` (all required —
`options={"require": [...]}` rejects a token missing any of them), `jti`
(for revocation).

- No `STATIC_TEST_TOKEN`, no shared test-token env var, no anonymous mode.
- Every failure path — missing token, malformed token, expired, wrong
  issuer, wrong audience, revoked `jti`, missing scope — returns the
  identical generic `AUTHORIZATION_DENIED` error. A caller probing for
  which check failed learns nothing from the response shape.
- Revocation is a JSON file (`revoked_jti.json`) the server reloads at
  most every 30 seconds; if the file exists but is unreadable/corrupt,
  the server fails closed (`REVOCATION_LIST_UNAVAILABLE`) rather than
  silently treating the list as empty.

## Observability

Structured log line per tool call: `request_id` (a fresh UUID per call,
not derived from the token), `tool` name, `sub` (client identity — never
the raw token), `duration_ms`, `result_count` (best-effort, first list
field found), and `reason_code` on any denial/error. The token itself,
its signature, and any PIN/secret value are never logged anywhere in this
module. `/healthz` and `/readyz` are public and return only a bare status
string — no schema/version/internal detail leaks pre-authentication.

## What this MCP will never do

No mutation tool, ever, by construction (naming convention + registry
test). No generic SQL execution tool. No arbitrary RPC-calling tool. No
write path exists anywhere in this codebase — there is no `INSERT`/
`UPDATE`/`DELETE` statement anywhere in `scripts/rete_squillari_mcp_prod/`,
and even if one were added by mistake, the `rete_mcp_reader` role would
reject it at the database layer.
