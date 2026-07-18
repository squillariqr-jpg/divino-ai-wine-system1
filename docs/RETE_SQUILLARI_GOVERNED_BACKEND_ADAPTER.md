# Rete Squillari — governed backend adapter

`public/rete-squillari/rete-backend-adapter.js` wires the existing card-UI
demo (`public/rete-squillari/index.html`) to the 9 governed Supabase RPCs
defined in `supabase/migrations/20260717090000_rete_squillari_pilot_allowlist_enforcement.sql`.

## Modes

Mode is resolved **once per session**, immediately after Supabase login, from
the caller's own `rete_memberships.pilot_enabled` value (readable only for
the caller's own row, per RLS). It never changes mid-session and there is no
fallback path from one mode to the other:

- **`GOVERNED_BACKEND`** (`pilot_enabled = true`): every operational read
  comes from `rete_requests` / `rete_offers` / `rete_transfers` (RLS-scoped,
  no service-role key involved); every mutation calls exactly one governed
  RPC with a fresh idempotency key. `localStorage` is never the source of
  truth — `save()` is neutralized to a no-op for the session.
- **`DEMO_LOCAL`** (`pilot_enabled = false`, any active membership): the
  original localStorage-backed demo is left completely untouched. No
  Supabase operational table or RPC is ever called.

If the adapter script fails to load, or `initialize()` throws for any reason
(network failure, unexpected membership shape), the session simply stays in
whatever the pre-existing `loadSession()`/`boot()` already rendered — this is
never a mid-session downgrade from an active governed session, only a
failure to *enter* governed mode in the first place.

## RPC mapping

| Frontend action | RPC | Role |
|---|---|---|
| "+ Nuova richiesta" (new, governed-only entry point) | `rete_request_publish` | central |
| "Posso aiutare" → invia disponibilità | `rete_offer_create` | store |
| "Ritira" (offer) | `rete_offer_withdraw` | store, own offer |
| "Approva" | `rete_offer_approve` | central |
| "Rifiuta" | `rete_offer_reject` | central |
| "Segna preparata" | `rete_transfer_mark_ready` | store, from-location |
| "Segna partita" | `rete_transfer_mark_departed` | store, from-location |
| "Conferma quantità ricevuta" | `rete_transfer_receive` | store, to-location |
| "Registra arrivo" | `rete_trasta_arrival_record` | central |

## Known, deliberate gaps (not RPC-backed, left out of governed mode)

- **Request withdrawal** ("Ritira richiesta"): no corresponding RPC exists
  among the 9 governed operations. Disabled in `GOVERNED_BACKEND` mode
  rather than emulated with a direct table write.
- **Email inbox / verify-extraction / conflict management**: demo-only
  concepts with no backend equivalent. Hidden from the nav in governed mode.
- **"Schede ammanco" (shortage requests)**: a separate, pre-existing,
  entirely local feature (`location-model.js`) with its own disconnected
  location model. Not part of the 9-RPC contract; left as `DEMO_LOCAL`-only
  in both modes, unmodified.
- **Audit log**: `rete_audit_events` is central-only readable by RLS and is
  not surfaced by this adapter version (`loadDashboard()` returns an empty
  `audit` array). Present in the database and verified in tests, just not
  yet rendered.

## Local testing

- `tests/rete-squillari-governed-adapter.test.js` — pure unit tests against
  a mocked Supabase client (no live database).
- `tests/rete-squillari-governed-e2e-scenario.local.js` — full 18-step
  scenario against a real local Supabase instance (`supabase start`,
  synthetic fixtures, port 127.0.0.1:54321/54322 only). Never touches the
  linked remote project.
