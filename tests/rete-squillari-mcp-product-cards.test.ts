// Rete Squillari MCP product-cards test suite.
// Run: npx tsx tests/rete-squillari-mcp-product-cards.test.ts
// Exercises the pure/unit-testable layers (schema validation, view-model
// transformation, classification, status normalization) plus the MCP
// adapter's failure-path handling via a mocked fetch. Does not touch the
// real production MCP or Supabase - see scripts/rete-squillari-mcp-tool-check.mjs
// for the live, production-facing verification (Phase 5 of the gate this
// shipped under).
import assert from 'node:assert/strict';

import {
  mapBackendStatus,
  isExcludedStatus,
  classifyShortages,
  buildProductCards,
  NORMALIZED_STATUSES,
} from '../lib/rete-squillari/product-cards';
import { isRequestRow, isOfferRow, isTransferRow, isLocationRow, validateArray } from '../lib/rete-squillari/mcp-schemas';
import type { LocationRow, RequestRow } from '../lib/rete-squillari/mcp-schemas';
import { ALLOWED_TOOLS, callMcpTool } from '../lib/rete-squillari/mcp-adapter';
import { applyRoleFiltering } from '../lib/rete-squillari/authorize';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function test(name: string, fn: () => void | Promise<void>) {
  return (async () => {
    try {
      await fn();
      passed++;
    } catch (e) {
      failed++;
      failures.push(`${name}: ${(e as Error).message}`);
    }
  })();
}

// --- fixtures (clearly synthetic, never touches real business data) ---
function fixtureLocation(id: number, code: number, name: string): LocationRow {
  return { id, code, name, active: true };
}
const LOCATIONS = new Map<number, LocationRow>([
  [2, fixtureLocation(2, 2, 'Malta')],
  [4, fixtureLocation(4, 4, 'Sestri')],
  [5, fixtureLocation(5, 5, 'Cantore')],
  [6, fixtureLocation(6, 6, 'Trento')],
  [7, fixtureLocation(7, 7, 'De Ferrari')],
  [8, fixtureLocation(8, 8, 'Armenia')],
]);

function fixtureRequest(overrides: Partial<RequestRow>): RequestRow {
  return {
    id: 'req-' + Math.random().toString(36).slice(2),
    requesting_location_id: 2,
    product_code: 'TEST-0001',
    product_description: 'Vino di test',
    requested_quantity: 6,
    remaining_quantity: 6,
    status: 'DA_TROVARE',
    source: 'WBOS_AUTO',
    requires_central_confirmation: false,
    warning_codes: [],
    score: null,
    score_version: null,
    created_at: '2026-07-01T10:00:00Z',
    updated_at: '2026-07-01T10:00:00Z',
    confirmed_at: null,
    cancelled_at: null,
    closed_at: null,
    ...overrides,
  };
}

async function main() {
  // --- status normalization ---
  await test('mapBackendStatus: known status maps correctly', () => {
    const r = mapBackendStatus('DA_TROVARE');
    assert.equal(r.normalized, 'DA_TROVARE');
    assert.equal(r.known, true);
  });
  await test('mapBackendStatus: unknown status is never silently mapped', () => {
    const r = mapBackendStatus('QUALCOSA_DI_NUOVO');
    assert.equal(r.known, false);
    assert.equal(r.normalized, 'STATO_SCONOSCIUTO');
    assert.equal(r.raw, 'QUALCOSA_DI_NUOVO');
  });
  await test('isExcludedStatus: ANNULLATA is excluded, never mapped', () => {
    assert.equal(isExcludedStatus('ANNULLATA'), true);
    assert.equal(isExcludedStatus('DA_TROVARE'), false);
  });
  await test('NORMALIZED_STATUSES contains exactly the required vocabulary', () => {
    const expected = ['DA_VERIFICARE', 'DA_TROVARE', 'DA_CONFERMARE', 'DA_PREPARARE', 'IN_TRASFERIMENTO', 'ARRIVO_PARZIALE', 'ARRIVATO_A_TRASTA', 'RICEVUTA', 'CHIUSA'];
    assert.deepEqual([...NORMALIZED_STATUSES].sort(), expected.sort());
  });

  // --- schema validation ---
  await test('isRequestRow: accepts a well-formed row', () => {
    assert.equal(isRequestRow(fixtureRequest({})), true);
  });
  await test('isRequestRow: rejects a row missing a required field', () => {
    const bad = fixtureRequest({}) as any;
    delete bad.product_code;
    assert.equal(isRequestRow(bad), false);
  });
  await test('isRequestRow: rejects wrong types', () => {
    assert.equal(isRequestRow(fixtureRequest({ remaining_quantity: 'six' as any })), false);
  });
  await test('validateArray: rejects a non-array field', () => {
    assert.equal(validateArray({ requests: 'not-an-array' }, 'requests', isRequestRow), null);
  });
  await test('validateArray: rejects if any item fails validation', () => {
    const bad = { requests: [fixtureRequest({}), { totally: 'wrong' }] };
    assert.equal(validateArray(bad, 'requests', isRequestRow), null);
  });
  await test('validateArray: accepts a fully valid array', () => {
    const good = { requests: [fixtureRequest({}), fixtureRequest({})] };
    assert.equal(validateArray(good, 'requests', isRequestRow)?.length, 2);
  });
  await test('isOfferRow / isTransferRow / isLocationRow basic acceptance', () => {
    assert.equal(isOfferRow({ id: 'o1', request_id: 'r1', offering_location_id: 2, offered_quantity: 3, approved_quantity: null, status: 'PROPOSTA', created_at: 'x', updated_at: 'x' }), true);
    assert.equal(isTransferRow({ id: 't1', request_id: 'r1', offer_id: null, from_location_id: 2, to_location_id: 4, quantity: 3, status: 'DA_PREPARARE', prepared_at: null, departed_at: null, received_at: null, received_quantity: null, discrepancy_type: null, discrepancy_acknowledged: false, created_at: 'x', updated_at: 'x' }), true);
    assert.equal(isLocationRow({ id: 2, code: 2, name: 'Malta', active: true }), true);
  });

  // --- classification: 1-2 stores -> TRANSFER_CANDIDATE ---
  await test('classifyShortages: 1 store -> TRANSFER_CANDIDATE', () => {
    const reqs = [fixtureRequest({ product_code: 'A', requesting_location_id: 2 })];
    const result = classifyShortages(reqs, LOCATIONS);
    assert.equal(result.get('A'), 'TRANSFER_CANDIDATE');
  });
  await test('classifyShortages: 2 stores -> TRANSFER_CANDIDATE', () => {
    const reqs = [
      fixtureRequest({ product_code: 'B', requesting_location_id: 2 }),
      fixtureRequest({ product_code: 'B', requesting_location_id: 4 }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS).get('B'), 'TRANSFER_CANDIDATE');
  });

  // --- classification: 3+ stores -> BUYER_SHORTAGE ---
  await test('classifyShortages: 3 stores -> BUYER_SHORTAGE', () => {
    const reqs = [
      fixtureRequest({ product_code: 'C', requesting_location_id: 2 }),
      fixtureRequest({ product_code: 'C', requesting_location_id: 4 }),
      fixtureRequest({ product_code: 'C', requesting_location_id: 6 }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS).get('C'), 'BUYER_SHORTAGE');
  });

  // --- classification: all 4 high-volume stores this month -> HIGH_VOLUME_SHORTAGE ---
  await test('classifyShortages: all 4 high-volume stores this month -> HIGH_VOLUME_SHORTAGE', () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)).toISOString();
    const reqs = [
      fixtureRequest({ product_code: 'D', requesting_location_id: 2, created_at: thisMonth }),
      fixtureRequest({ product_code: 'D', requesting_location_id: 4, created_at: thisMonth }),
      fixtureRequest({ product_code: 'D', requesting_location_id: 5, created_at: thisMonth }),
      fixtureRequest({ product_code: 'D', requesting_location_id: 7, created_at: thisMonth }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS, now).get('D'), 'HIGH_VOLUME_SHORTAGE');
  });
  await test('classifyShortages: 3 of 4 high-volume stores -> BUYER_SHORTAGE, not HIGH_VOLUME', () => {
    const now = new Date();
    const thisMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 5)).toISOString();
    const reqs = [
      fixtureRequest({ product_code: 'E', requesting_location_id: 2, created_at: thisMonth }),
      fixtureRequest({ product_code: 'E', requesting_location_id: 4, created_at: thisMonth }),
      fixtureRequest({ product_code: 'E', requesting_location_id: 5, created_at: thisMonth }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS, now).get('E'), 'BUYER_SHORTAGE');
  });
  await test('classifyShortages: 4 high-volume stores but outside this month -> not HIGH_VOLUME', () => {
    const now = new Date();
    const lastMonth = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 5)).toISOString();
    const reqs = [
      fixtureRequest({ product_code: 'F', requesting_location_id: 2, created_at: lastMonth }),
      fixtureRequest({ product_code: 'F', requesting_location_id: 4, created_at: lastMonth }),
      fixtureRequest({ product_code: 'F', requesting_location_id: 5, created_at: lastMonth }),
      fixtureRequest({ product_code: 'F', requesting_location_id: 7, created_at: lastMonth }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS, now).get('F'), 'BUYER_SHORTAGE');
  });
  await test('classifyShortages: cancelled requests never counted', () => {
    const reqs = [
      fixtureRequest({ product_code: 'G', requesting_location_id: 2, status: 'ANNULLATA' }),
      fixtureRequest({ product_code: 'G', requesting_location_id: 4, status: 'ANNULLATA' }),
      fixtureRequest({ product_code: 'G', requesting_location_id: 6, status: 'ANNULLATA' }),
    ];
    assert.equal(classifyShortages(reqs, LOCATIONS).has('G'), false);
  });

  // --- view model / product cards ---
  await test('buildProductCards: excludes cancelled requests entirely', () => {
    const reqs = [fixtureRequest({ status: 'ANNULLATA' })];
    const cards = buildProductCards(reqs, [], [], LOCATIONS);
    assert.equal(cards.length, 0);
  });
  await test('buildProductCards: never includes the raw UUID as-is', () => {
    const reqs = [fixtureRequest({ id: '11111111-2222-3333-4444-555555555555' })];
    const cards = buildProductCards(reqs, [], [], LOCATIONS);
    assert.equal(cards[0].ref.includes('-'), false);
    assert.notEqual(cards[0].ref, '11111111-2222-3333-4444-555555555555');
    assert.equal((cards[0] as any).id, undefined);
    assert.equal((cards[0] as any).backendId, undefined);
  });
  await test('buildProductCards: aggregates offers correctly', () => {
    const req = fixtureRequest({ id: 'r1' });
    const offers = [
      { id: 'o1', request_id: 'r1', offering_location_id: 4, offered_quantity: 2, approved_quantity: 1, status: 'APPROVATA', created_at: 'x', updated_at: 'x' },
      { id: 'o2', request_id: 'r1', offering_location_id: 6, offered_quantity: 3, approved_quantity: null, status: 'PROPOSTA', created_at: 'x', updated_at: 'x' },
    ];
    const cards = buildProductCards([req], offers, [], LOCATIONS);
    assert.equal(cards[0].offersCount, 2);
    assert.equal(cards[0].offeredQuantity, 5);
    assert.equal(cards[0].approvedQuantity, 1);
  });
  await test('buildProductCards: real-data provenance marker always present', () => {
    const cards = buildProductCards([fixtureRequest({})], [], [], LOCATIONS);
    assert.equal(cards[0].dataSource, 'MCP_PRODUCTION');
  });
  await test('buildProductCards: zero requests -> zero cards (genuine empty state)', () => {
    assert.deepEqual(buildProductCards([], [], [], LOCATIONS), []);
  });

  // --- role filtering / cross-store access ---
  await test('applyRoleFiltering: central sees everything unchanged', () => {
    const cards = buildProductCards([fixtureRequest({ requesting_location_id: 4 })], [], [], LOCATIONS);
    const filtered = applyRoleFiltering(cards, { userId: 'u1', role: 'central', locationId: null });
    assert.deepEqual(filtered, cards);
  });
  await test('applyRoleFiltering: store sees its own request in full', () => {
    const cards = buildProductCards([fixtureRequest({ requesting_location_id: 2, id: 'r1' })],
      [], [{ id: 't1', request_id: 'r1', offer_id: null, from_location_id: 4, to_location_id: 2, quantity: 2, status: 'DA_PREPARARE', prepared_at: null, departed_at: null, received_at: null, received_quantity: null, discrepancy_type: 'SHORTAGE', discrepancy_acknowledged: false, discrepancy_resolution_note: null, discrepancy_resolved_at: null, anomaly_note: null, created_at: 'x', updated_at: 'x' }], LOCATIONS);
    const filtered = applyRoleFiltering(cards, { userId: 'u2', role: 'store', locationId: 2 });
    assert.notEqual(filtered[0].transferStatus, null);
  });
  await test('applyRoleFiltering: store does NOT see transfer/discrepancy detail on another store\'s request', () => {
    const cards = buildProductCards([fixtureRequest({ requesting_location_id: 4, id: 'r2' })],
      [], [{ id: 't2', request_id: 'r2', offer_id: null, from_location_id: 6, to_location_id: 4, quantity: 2, status: 'DA_PREPARARE', prepared_at: null, departed_at: null, received_at: null, received_quantity: null, discrepancy_type: 'SHORTAGE', discrepancy_acknowledged: false, discrepancy_resolution_note: null, discrepancy_resolved_at: null, anomaly_note: null, created_at: 'x', updated_at: 'x' }], LOCATIONS);
    const filtered = applyRoleFiltering(cards, { userId: 'u3', role: 'store', locationId: 2 });
    assert.equal(filtered[0].transferStatus, null);
    assert.equal(filtered[0].receiptDiscrepancy, null);
  });
  await test('applyRoleFiltering: store still sees general product/quantity info on other stores\' cards (network-wide visibility)', () => {
    const cards = buildProductCards([fixtureRequest({ requesting_location_id: 4, product_code: 'H' })], [], [], LOCATIONS);
    const filtered = applyRoleFiltering(cards, { userId: 'u4', role: 'store', locationId: 2 });
    assert.equal(filtered[0].productCode, 'H');
  });

  // --- MCP adapter: tool allowlist ---
  await test('ALLOWED_TOOLS has exactly the 10 production tools', () => {
    assert.equal(ALLOWED_TOOLS.length, 10);
    assert.ok(ALLOWED_TOOLS.includes('rete_get_health'));
    assert.ok(ALLOWED_TOOLS.includes('rete_get_request_audit'));
  });
  await test('callMcpTool: rejects a tool not in the allowlist', async () => {
    const result = await callMcpTool('not_a_real_tool' as any);
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'TOOL_NOT_ALLOWED');
  });

  // --- MCP adapter failure paths (mocked fetch, no real network) ---
  const originalFetch = globalThis.fetch;
  const originalEnv = { base: process.env.RETE_MCP_BASE_URL, token: process.env.RETE_MCP_TOKEN };
  process.env.RETE_MCP_BASE_URL = 'https://mock.invalid';
  process.env.RETE_MCP_TOKEN = 'mock-token-for-tests-only';

  await test('callMcpTool: MCP not configured fails closed', async () => {
    delete process.env.RETE_MCP_TOKEN;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MCP_NOT_CONFIGURED');
    process.env.RETE_MCP_TOKEN = 'mock-token-for-tests-only';
  });

  await test('callMcpTool: network/unavailable MCP fails closed', async () => {
    globalThis.fetch = (async () => { throw new Error('ECONNREFUSED'); }) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MCP_UNREACHABLE');
  });

  await test('callMcpTool: timeout fails closed with MCP_TIMEOUT', async () => {
    globalThis.fetch = (async (_url: any, opts: any) => {
      return new Promise((_resolve, reject) => {
        opts.signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      });
    }) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MCP_TIMEOUT');
  });

  await test('callMcpTool: malformed JSON-RPC envelope rejected', async () => {
    globalThis.fetch = (async () => ({ ok: true, json: async () => ({ not: 'a valid envelope' }) })) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MCP_INVALID_RESPONSE');
  });

  await test('callMcpTool: non-2xx HTTP status rejected', async () => {
    globalThis.fetch = (async () => ({ ok: false, status: 500, json: async () => ({}) })) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) assert.equal(result.code, 'MCP_HTTP_ERROR');
  });

  await test('callMcpTool: expired/invalid token (AUTHORIZATION_DENIED) mapped to MCP_AUTH_DENIED', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, error: { code: -32602, message: 'AUTHORIZATION_DENIED', data: { reason_code: 'AUTHORIZATION_DENIED' } } }),
    })) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, false);
    if (!result.ok) { assert.equal(result.code, 'MCP_AUTH_DENIED'); assert.equal(result.httpStatus, 401); }
  });

  await test('callMcpTool: valid response with structuredContent parses correctly', async () => {
    globalThis.fetch = (async () => ({
      ok: true,
      json: async () => ({ jsonrpc: '2.0', id: 1, result: { structuredContent: { status: 'ok' }, isError: false } }),
    })) as any;
    const result = await callMcpTool('rete_get_health');
    assert.equal(result.ok, true);
    if (result.ok) assert.equal(result.data.status, 'ok');
  });

  globalThis.fetch = originalFetch;
  if (originalEnv.base) process.env.RETE_MCP_BASE_URL = originalEnv.base; else delete process.env.RETE_MCP_BASE_URL;
  if (originalEnv.token) process.env.RETE_MCP_TOKEN = originalEnv.token; else delete process.env.RETE_MCP_TOKEN;

  // --- no token in source (static check on the shipped browser-facing files) ---
  await test('no MCP token pattern appears in any public/ browser-facing file', async () => {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const dir = path.join(__dirname, '..', 'public', 'rete-squillari');
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.js') || f.endsWith('.html'));
    for (const f of files) {
      const content = fs.readFileSync(path.join(dir, f), 'utf8');
      assert.equal(/RETE_MCP_TOKEN/.test(content), false, `${f} must never reference RETE_MCP_TOKEN`);
      assert.equal(/rete-mcp\.188\.245\.173\.244/.test(content), false, `${f} must never call the MCP endpoint directly from the browser`);
    }
  });

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log('\nFailures:');
    failures.forEach((f) => console.log('  - ' + f));
    process.exit(1);
  }
}

main();
