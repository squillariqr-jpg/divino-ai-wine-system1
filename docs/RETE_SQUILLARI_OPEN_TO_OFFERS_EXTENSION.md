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

## WBOS-to-application location translation

WBOS's canonical store IDs (`scripts/active_transfer_opportunity_filter.py`
`CANONICAL_STORES`) do **not** match this schema's `rete_locations.id`:

| Store | WBOS id | `rete_locations.id` | `rete_locations.code` |
|---|---|---|---|
| Malta | 2 | 1 | 101 |
| Sestri | 4 | 2 | 102 |
| Cantore | 5 | 3 | 103 |
| Trento | 6 | 4 | 104 |
| De Ferrari | 7 | 5 | 105 |
| Armenia | 8 | 6 | 106 |

`rete_locations.wbos_location_id` is the explicit, queryable mapping —
`rete_wbos_suggestion_ingest()` translates through it internally; no
caller should ever assume raw ID equality between the two systems.

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
7. **WBOS-to-application location translation** — see above.

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

`rete_locations`: `wbos_location_id` (unique, nullable).

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

## Pilot scope (unchanged)

No chat, comments, photographs, attachments, voice notes, reactions,
general messaging, or push notifications were added. No additional pilot
stores were activated — `pilot_enabled` remains exactly as it already was
for every existing membership on the linked remote project; this
extension's local-sandbox test fixtures enable additional synthetic
identities only inside the disposable local Supabase instance, never
touching the remote project.
