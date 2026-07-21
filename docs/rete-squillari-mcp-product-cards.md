# Rete Squillari — "Prodotti mancanti" (production MCP product cards)

Read-only view of open/pending network requests, sourced live from the
production Rete Squillari MCP, rendered as product/request cards inside the
existing static Rete Squillari site. Additive only: it does not replace or
alter any existing demo or governed-backend page.

## Architecture

```
Browser (public/rete-squillari/index.html + rete-mcp-product-cards.js)
  │  fetch('/api/rete-squillari/mcp', { action: 'list_missing_products' })
  │  Authorization: Bearer <caller's own Supabase access token>
  ▼
Next.js Route Handler — app/api/rete-squillari/mcp/route.ts   (server-only)
  │  1. rate limit (best-effort, in-memory)
  │  2. validate `action` against a fixed allowlist (never a raw tool name)
  │  3. resolveActor(accessToken)  → lib/rete-squillari/authorize.ts
  │       - Supabase client using the CALLER's own JWT + anon key
  │         (never service-role) so rete_memberships RLS applies unchanged
  │  4. callMcpTool(...)           → lib/rete-squillari/mcp-adapter.ts
  │       - attaches RETE_MCP_TOKEN server-side, 8s timeout, validates the
  │         JSON-RPC envelope, redacts all upstream error detail
  │  5. validateArray + type guards → lib/rete-squillari/mcp-schemas.ts
  │  6. buildProductCards + classifyShortages → lib/rete-squillari/product-cards.ts
  │       - pure functions, no I/O, fully unit-tested
  │  7. applyRoleFiltering(cards, actor) → lib/rete-squillari/authorize.ts
  │       - enforced server-side; the browser never receives unfiltered data
  ▼
Production MCP  https://rete-mcp.188.245.173.244.sslip.io/mcp   (read-only, 10 allowlisted tools)
```

The browser **never** calls the MCP directly and never receives the MCP
token. The only network call the frontend makes for this feature is a
same-origin POST to `/api/rete-squillari/mcp`.

## Required server-side secrets

Set only in the Next.js server environment (never `NEXT_PUBLIC_*`, never
committed — see `.gitignore`):

| Name | Purpose |
|---|---|
| `RETE_MCP_BASE_URL` | Production MCP base URL |
| `RETE_MCP_TOKEN` | Operational MCP token, subject `rete-site-reader`, scope `rete:read` |
| `RETE_SQUILLARI_SUPABASE_URL` | Same Supabase project the existing governed backend uses |
| `RETE_SQUILLARI_SUPABASE_ANON_KEY` | Anon key (not sensitive by Supabase's own design; RLS is the real boundary) — same value already public in `index.html`'s client-side code |

Local dev: copy these into `.env.local` (gitignored) and restart `next dev`.
Production/preview: set as server-side environment variables in the hosting
platform's project settings (never as a "client" / `NEXT_PUBLIC_` variable).

### Token rotation

The MCP token is independently revocable/rotatable on the MCP server side
(subject `rete-site-reader`) without touching this repo's code — only the
`RETE_MCP_TOKEN` env var value needs to be updated and the app restarted.
Rotate by issuing a new token, updating the env var everywhere it's set,
redeploying/restarting, then revoking the old token.

## Supported MCP tools

Only these 10 read-only tools are ever callable, enforced both in
`mcp-adapter.ts` (`ALLOWED_TOOLS`) and implicitly by the fact that the route
handler only ever passes tool names it hardcodes itself — the browser
cannot supply a tool name:

`rete_get_health`, `rete_get_pilot_status`, `rete_list_locations`,
`rete_list_pending_confirmations`, `rete_list_open_requests`,
`rete_get_request`, `rete_list_offers`, `rete_list_transfers`,
`rete_list_receipt_discrepancies`, `rete_get_request_audit`.

The `list_missing_products` action currently uses `rete_list_locations`,
`rete_list_open_requests`, `rete_list_pending_confirmations`,
`rete_list_offers`, `rete_list_transfers` (unfiltered offers/transfers calls
return the full table in one call each — no per-request N+1 pattern).

## Role filtering

Enforced server-side in `applyRoleFiltering` (`lib/rete-squillari/authorize.ts`),
using the same `rete_memberships` row (role + location + `pilot_enabled`)
the existing governed-backend adapter already relies on:

- **Centrale**: unfiltered — sees all requests, offers, transfers,
  discrepancies, and shortage classifications.
- **Store**: full detail on its own requests; on every other store's card,
  `transferStatus` and `receiptDiscrepancy` are nulled and `classification`
  is forced to `TRANSFER_CANDIDATE` (never exposes buyer-priority /
  network-shortage signal about another store's demand). Product code,
  description, missing quantity, status, and offer counts remain visible
  network-wide so a store can still decide whether it can help.

This runs on every response — there is no code path that returns MCP-derived
cards to the browser without passing through `applyRoleFiltering` first.

## Status normalization

Backend statuses are mapped via an explicit allowlist
(`mapBackendStatus` in `product-cards.ts`) to:
`DA_VERIFICARE, DA_TROVARE, DA_CONFERMARE, DA_PREPARARE, IN_TRASFERIMENTO,
ARRIVO_PARZIALE, ARRIVATO_A_TRASTA, RICEVUTA, CHIUSA`.

`ANNULLATA` is deliberately excluded from cards entirely (`isExcludedStatus`).
Any other unrecognized backend status is surfaced as `STATO_SCONOSCIUTO`
rather than silently coerced into an existing bucket.

## Shortage classification

Deterministic, computed server-side in `classifyShortages`:

- `TRANSFER_CANDIDATE` — missing in 1–2 stores.
- `BUYER_SHORTAGE` — missing in 3+ stores.
- `HIGH_VOLUME_STORES_MONTHLY_SHORTAGE` — missing in all four high-volume
  stores (Malta, Sestri, Cantore, De Ferrari, matched by **name**, not a
  hardcoded numeric ID) within the current calendar month.

Classification never creates, approves, or triggers a transfer — it is a
read-only label computed from already-fetched request/location data.

## Demo vs. real data

This feature only ever renders real, MCP-sourced cards
(`dataSource: 'MCP_PRODUCTION'` on every card). It never mixes in demo data.
If the MCP returns zero open/pending requests, the UI shows a genuine empty
state, not a fallback to demo content. It is entirely separate from, and
does not touch, the existing `DEMO_LOCAL` / governed-backend demo paths
already present in `rete-backend-adapter.js`.

## Failure modes surfaced to the browser

| Condition | Route response | UI state |
|---|---|---|
| No/invalid Supabase session | `401 NOT_AUTHENTICATED` | auth error, prompts re-login |
| Membership missing/inactive/pilot disabled | `403 ACCESS_DENIED` / `403 PILOT_NOT_ENABLED` | auth/access error |
| Unknown `action` value | `400 ACTION_NOT_ALLOWED` | generic error (should not occur from the shipped UI) |
| Server env vars missing | `503 MCP_NOT_CONFIGURED` / `503 SERVER_NOT_CONFIGURED` | "service unavailable" + retry |
| MCP token expired/rejected | `401 MCP_AUTH_DENIED` | "service unavailable" + retry (does not imply the user's own session is invalid) |
| MCP timeout (8s) | `504 MCP_TIMEOUT` | "service unavailable" + retry |
| MCP unreachable / non-2xx / malformed JSON-RPC / bad schema | `502 MCP_*` | "service unavailable" + retry |
| Per-IP rate limit exceeded (30/min, best-effort) | `429 RATE_LIMITED` | "too many requests" |

All error responses are a fixed `{ok:false, code, message}` shape — never a
raw upstream error string or stack trace.

## Feature flag / rollout

The UI wiring in `index.html` is gated behind `window.RETE_MCP_CARDS_ENABLED`
only (not a URL query parameter — this file has a standing invariant, see
`test_querystring_role_tamper_ignored`, that role/feature state is never
derived from `location.search`). For local QA, enable via the browser
console: `window.RETE_MCP_CARDS_ENABLED = true; go('mcp-products')`. With
the flag unset, this feature installs nothing and every existing page is
unaffected.

## Rollback

Setting `RETE_MCP_TOKEN`/`RETE_MCP_BASE_URL` unset, or `window.RETE_MCP_CARDS_ENABLED`
left `false`/unset, fully disables this feature with zero effect on the
existing site. To remove entirely: revert the four changed/added source
areas (`app/api/rete-squillari/mcp/`, `lib/rete-squillari/`,
`public/rete-squillari/rete-mcp-product-cards.js`, and the wiring block +
route registration appended to `public/rete-squillari/index.html` /
`tests/test_rete_squillari_governed_browser.py`). No database migration or
schema change is involved, so rollback is a pure code revert.

## Known limitations (see final report for full detail)

- Zero real open requests currently exist in production, so the "first
  controlled real card" phase could only be verified against the genuine
  empty state, not an actual populated card.
- No real store/centrale PIN credentials were available in this session, so
  a fully authenticated end-to-end UI walkthrough was not performed; the API
  route's security boundaries (no-auth, invalid-auth, disallowed-action)
  were verified directly via browser `fetch()` calls instead.
