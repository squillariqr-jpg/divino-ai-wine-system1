# Rete Squillari — WBOS open-to-offers pilot extension

Additive extension implementing the persistence, authorization, and UI
required by the WBOS open-to-offers domain model
(`scripts/active_transfer_opportunity_filter.py` +
`scripts/open_to_offers_model.py` in the `wbos` repository, merged via
WBOS PR #30). Does not modify or remove anything from the four
pre-existing migrations: all seven original tables, all nine original
RPCs, all original RLS policies, the idempotency ledger, the pilot
allowlist, and the Trasta-hub arrival flow continue to work exactly as
before (verified: all 23 steps of the pre-existing
`tests/rete-squillari-governed-e2e-scenario.local.js` pass unmodified).

## Why additive, not a replacement

This schema already implements a mature, adversarially-reviewed "Trasta
hub + central-publish" process model — a fundamentally different
topology from WBOS's peer-to-peer "system suggests → store confirms →
open to offers" model. Rather than reconciling or replacing the existing
state machine (high risk to already-tested behavior), this extension adds
only the specific capabilities WBOS's model requires that this schema
did not yet have, reusing every existing table, enum, and RPC wherever
possible.

## WBOS location resolution

`rete_locations.id` **is** the WBOS canonical retail location ID directly
(`scripts/active_transfer_opportunity_filter.py` `CANONICAL_STORES`) for
all six stores, and `rete_locations.code` mirrors `id` — there is no
separate translation column or numbering scheme:

| Store | `rete_locations.id` = `code` = WBOS id |
|---|---|
| Malta | 2 |
| Sestri | 4 |
| Cantore | 5 |
| Trento | 6 |
| De Ferrari | 7 |
| Armenia | 8 |

This is the certified production model (verified live against the
`ljuyolwnlbqlfxjujfrq` project and against `scripts/provision_rete_squillari.js`,
which enforces and fails closed on any other numbering). An earlier
version of this extension introduced a `wbos_location_id` mapping column
under the mistaken premise that `rete_locations.id`/`code` used a
sequential `{1..6}`/`{101..106}` scheme unrelated to WBOS's ids — that
premise was wrong (see
`20260719130000_rete_squillari_canonical_location_reconciliation.sql` for
the root-cause history and reconciliation). `rete_wbos_suggestion_ingest()`
resolves the requesting store with `WHERE id = p_requesting_location_wbos_id
AND active` directly; no mapping column exists.

## New domain state reused, not reinvented

`DA_CONFERMARE` already existed in the `rete_request_status` enum
(pre-dating this extension) but had no RPC wiring — a genuine, previously
unused placeholder for exactly this gap. This extension reuses it as
WBOS's `PENDING_REQUESTING_STORE_CONFIRMATION`, and reuses the existing
`DA_TROVARE` as WBOS's `OPEN_TO_OFFERS` (an already-confirmed request
open for other stores' offers). No new enum values were added to any
existing type.

## New capabilities (7, matching the gate's scoped mandate)

1. **Requesting-store confirmation** — `rete_wbos_suggestion_ingest()`
   creates a request in `DA_CONFERMARE`; `rete_request_confirm()`
   (requesting store only, optimistic version check) transitions it to
   `DA_TROVARE`. A `DA_CONFERMARE` request is visible only to the
   requesting store and central — see the RLS section below.
2. **Store-side manual request creation** — `rete_manual_request_create()`
   derives the requesting location exclusively from the caller's own
   membership (no location parameter exists to spoof); active-duplicate
   prevented (same store + product code, non-terminal status).
   `requires_central_confirmation`/`warning_codes` are accepted as
   caller-supplied flags (the four-high-volume-store business logic that
   sets them lives in WBOS's Python domain, never duplicated in SQL).
3. **Requesting-store cancellation / no-longer-needed** —
   `rete_request_cancel()` (central or requesting store) and
   `rete_request_mark_no_longer_needed()` (requesting store only) both
   transition to `ANNULLATA`, explicitly reject any still-`PROPOSTA`
   offers as part of the same transaction (never left dangling), and
   refuse once any offer is already `APPROVATA` (a transfer obligation
   already exists — mirrors WBOS's `approve_offer()` guard against
   reviving a cancelled request).
4. **Explicit receipt-discrepancy recording and resolution** —
   `rete_transfer_receive()` gained a `p_discrepancy_type` parameter
   (`SHORT`/`DAMAGED`/`OTHER`, required exactly when `received_quantity <>
   quantity`, forbidden otherwise) and emits a distinct
   `receipt_discrepancy_recorded` audit event. `rete_request_recompute_status()`
   now additionally requires every `RICEVUTA` transfer for a request to
   have no unresolved discrepancy before reaching `CHIUSA` — a strict
   narrowing of the existing closure condition, never a widening, so no
   request that had already legitimately reached `CHIUSA` is affected.
   `rete_transfer_resolve_discrepancy()` (central only) is the explicit,
   audited action that clears the gate; it never alters the underlying
   `received_quantity`/`quantity` facts, only records who resolved it and
   how.
5. **Transactional automatic-publication budget** —
   `rete_wbos_publication_budget_check()` enforces the same limits as
   WBOS's `PUBLICATION_BUDGET_CONFIG` (max 5 active `WBOS_AUTO` requests
   globally, max 2 per requesting store, max 2 new publications/day, max
   1 pending confirmation per store), serialized via
   `pg_advisory_xact_lock` so concurrent ingestion attempts cannot both
   pass the count check before either commits. `MANUAL`/`EMAIL`/
   `TRASTA_ARRIVAL`/`DEMO`-sourced requests are never counted — manual
   requests stay outside the automatic budget by construction.
6. **Immutable audit actions** — `rete_audit_events.event_type` is
   free-text (only length-checked, no enum), so no schema change was
   needed; new RPCs emit `wbos_suggestion_ingested`, `request_confirmed`,
   `request_quantity_updated`, `manual_request_created`,
   `central_confirmation_required`, `central_confirmed`,
   `request_cancelled`, `request_marked_no_longer_needed`,
   `receipt_discrepancy_recorded`, `receipt_discrepancy_resolved`.
7. **WBOS location resolution** — see above.

## RLS: unconfirmed suggestions are not broadly visible

The pre-existing "active members read requests" policy was a blanket
"any active member sees every request" SELECT policy — correct and left
unchanged for every status this schema already had. `DA_CONFERMARE` is a
new status this extension introduces; a request sitting in it is
explicitly a private, not-yet-confirmed suggestion (WBOS: "unconfirmed
suggestion not visible to other stores"). Since Postgres RLS policies are
OR'd together (a second permissive policy cannot subtract visibility),
the policy itself was replaced (not supplemented) with one that carves
out this one exception — `DA_CONFERMARE` visible only to the requesting
store and central — while every other status remains exactly as visible
as before. Verified live: a second store cannot read another store's
`DA_CONFERMARE` row via direct `SELECT`.

## New columns

`rete_requests`: `operational_request_key` (unique, nullable — WBOS
dedup key), `score`, `score_version`, `source_document_date`,
`hard_exclusion_reason`, `warning_codes` (text[]),
`requires_central_confirmation`, `confirmed_by`, `confirmed_at`,
`cancelled_by`, `cancelled_at`, `cancel_reason`, `version` (optimistic
concurrency). `source` check widened to additionally allow `WBOS_AUTO`.

`rete_transfers`: `discrepancy_type`, `discrepancy_acknowledged`,
`discrepancy_resolved_by`, `discrepancy_resolved_at`,
`discrepancy_resolution_note`, `version`. New constraint:
`discrepancy_acknowledged` can only be `true` when a real discrepancy
exists (`received_quantity IS NOT NULL AND received_quantity <>
quantity`) — prevents ever "pre-clearing" a not-yet-received transfer or
marking a clean receipt as acknowledged for no reason.

The existing protected-column guard trigger
(`rete_guard_protected_columns()`) was extended (not replaced) to also
guard every new governed column on `rete_requests` and `rete_transfers` —
none of them can change via a raw client UPDATE, only through the
governed RPCs above.

## Automatic-suggestion ingestion: not exercised with real data

`rete_wbos_suggestion_ingest()` is implemented and tested exclusively
against synthetic fixtures in this gate. Zero real automatic suggestions
were ever inserted into any database, local or remote.

## Local testing

- `tests/security_adversarial_open_to_offers.sql` — 20 adversarial
  security tests (cross-store confirm/offer/cancel, disabled store, anon
  read, donor self-approval, wrong-location transfer actions, stale
  version, duplicate request/offer, over-approval, direct table bypass,
  audit immutability, manual-request duplicate prevention). Local
  sandbox only.
- `tests/e2e_open_to_offers_synthetic.sql` — full synthetic pilot flow:
  ingest → confirmation-gated visibility → confirm → multi-donor offers
  → full + partial approval → independent per-donor prepare/send/receive
  → a real short-shipment discrepancy blocking closure → resolution →
  closure → full audit chronology verification. Local sandbox only.
- `tests/rete-squillari-governed-adapter.test.js` — extended with 7 new
  unit tests (category D) for the new adapter methods, alongside the 12
  pre-existing tests (unmodified, all still passing).
- `tests/rete-squillari-governed-e2e-scenario.local.js` — pre-existing
  23-step scenario, unmodified, verified still passing against the
  extended schema (proves no regression to the original 9-RPC contract).
- Live UI verification: the full confirm → manual request → offer →
  approve → transfer lifecycle → damaged receipt → discrepancy
  resolution → automatic closure flow was exercised through the actual
  rendered `index.html` UI in a real browser against a local Supabase
  instance (never the linked remote project), including the RLS
  visibility fix for `DA_CONFERMARE` (verified a second store reads 0
  rows for another store's unconfirmed suggestion).

## Rollback

The migration is purely additive (new columns, new/replaced functions, one
replaced RLS policy, no destructive DDL against any pre-existing object),
so reverting it never requires restoring deleted data. If this migration
needs to be reverted after being applied:

1. **Restore the original RLS policy** on `rete_requests`:
   ```sql
   DROP POLICY IF EXISTS "active members read requests" ON "public"."rete_requests";
   CREATE POLICY "active members read requests" ON "public"."rete_requests" FOR SELECT TO "authenticated" USING (
     EXISTS (SELECT 1 FROM "public"."rete_memberships" "m"
       WHERE "m"."user_id" = (SELECT "auth"."uid"()) AND "m"."active")
   );
   ```
2. **Restore the original `rete_transfer_receive`** (4-arg signature, no
   `p_discrepancy_type`) and **drop the 9 new/extended functions**:
   `rete_wbos_suggestion_ingest`, `rete_request_confirm`,
   `rete_request_update_quantity`, `rete_manual_request_create`,
   `rete_request_central_confirm`, `rete_request_cancel`,
   `rete_request_mark_no_longer_needed`,
   `rete_transfer_resolve_discrepancy`, `rete_wbos_publication_budget_check`.
3. **Restore the original `rete_request_recompute_status` and
   `rete_guard_protected_columns`** (drop the discrepancy-aware closure
   condition and the extended guarded-column list).
4. **Drop the new columns**:
   `rete_requests.operational_request_key`/`score`/`score_version`/
   `source_document_date`/`hard_exclusion_reason`/`warning_codes`/
   `requires_central_confirmation`/`confirmed_by`/`confirmed_at`/
   `cancelled_by`/`cancelled_at`/`cancel_reason`/`version`;
   `rete_transfers.discrepancy_type`/`discrepancy_acknowledged`/
   `discrepancy_resolved_by`/`discrepancy_resolved_at`/
   `discrepancy_resolution_note`/`version`.
5. **Restore the original `source` check constraint** on `rete_requests`
   (drop the `WBOS_AUTO` allowed value).

Any `rete_requests` row with `source = 'WBOS_AUTO'` or `status =
'DA_CONFERMARE'` created after this migration was applied would need a
business decision before rollback (this pilot never inserts real
WBOS-sourced rows, so in practice there should be none outside test
fixtures). No `auth.*` table or `pilot_enabled` value is ever touched by
this migration or by rolling it back.

## Canonical location model

`rete_locations.id` is the immutable WBOS canonical retail location ID;
`code` mirrors `id`. Names (`Malta`, `Sestri`, ...) are display labels only —
never a join key, and never assumed unique except as a diagnostic anchor
during the one-time reconciliation described below. Trasta is a hub, not a
requesting retail location, and is intentionally not a `rete_locations` row.

The certified production project (`ljuyolwnlbqlfxjujfrq`) has always used
this model. The original `20260715075948_create_rete_squillari_core_schema.sql`
migration's tracked seed used a stale, unrelated sequential `{1..6}`/
`{101..106}` scheme that was never what actually ran against the certified
project (Supabase tracks applied migrations by version/filename, not
content hash, so the file's content could diverge from history without
detection). That seed has been corrected in place — this is safe because
it only affects future fresh installs/resets, never an already-migrated
environment. `20260719130000_rete_squillari_canonical_location_
reconciliation.sql` reconciles any environment that already ran the old
seed (a clean local reset performed before this fix) to the canonical
model: a no-op if already canonical, a guarded re-key if in the exact known
legacy state, and a fail-closed `RAISE EXCEPTION` (full rollback) for any
other state — it never guesses, never invents a missing store, and never
uses `ON DELETE`/`ON UPDATE CASCADE` as a shortcut. Legacy `101-106` codes
are invalid everywhere; nothing in this schema should ever produce or
accept them again.

## Pilot scope (unchanged)

No chat, comments, photographs, attachments, voice notes, reactions,
general messaging, or push notifications were added. No additional pilot
stores were activated — `pilot_enabled` remains exactly as it already was
for every existing membership on the linked remote project; this
extension's local-sandbox test fixtures enable additional synthetic
identities only inside the disposable local Supabase instance, never
touching the remote project.
