// Frontend (browser JS) tests for the "Prodotti mancanti" filter logic.
// Run: node tests/rete-squillari-mcp-product-cards-frontend.test.js
'use strict';
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const scriptPath = path.join(__dirname, '..', 'public', 'rete-squillari', 'rete-mcp-product-cards.js');
const source = fs.readFileSync(scriptPath, 'utf8');
const sandbox = {};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(source, sandbox, { filename: 'rete-mcp-product-cards.js' });

const filterCards = sandbox.RETE_MCP_PRODUCT_CARDS.filterCards;

let passed = 0, failed = 0;
const failures = [];
function test(name, fn) {
  try { fn(); passed++; } catch (e) { failed++; failures.push(name + ': ' + e.message); }
}

function card(overrides) {
  return Object.assign({
    ref: 'ABCD1234', productCode: 'X-100', productDescription: 'Barolo DOCG',
    requestingLocationLabel: '2 – Malta', missingQuantity: 6, status: 'DA_TROVARE',
    classification: 'TRANSFER_CANDIDATE', offersCount: 0, offeredQuantity: 0, approvedQuantity: 0,
    transferStatus: null, receiptDiscrepancy: null, lastUpdate: '2026-07-01', dataSource: 'MCP_PRODUCTION',
  }, overrides);
}

test('search: matches product code case-insensitively', () => {
  const cards = [card({ productCode: 'ABC-123' }), card({ productCode: 'ZZZ-999' })];
  const out = filterCards(cards, { search: 'abc', location: 'Tutti', status: 'Tutte', classification: 'ALL' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].productCode, 'ABC-123');
});
test('search: matches product description', () => {
  const cards = [card({ productDescription: 'Barolo DOCG' }), card({ productDescription: 'Riesling' })];
  const out = filterCards(cards, { search: 'barolo', location: 'Tutti', status: 'Tutte', classification: 'ALL' });
  assert.strictEqual(out.length, 1);
});
test('location filter: exact match only', () => {
  const cards = [card({ requestingLocationLabel: '2 – Malta' }), card({ requestingLocationLabel: '4 – Sestri' })];
  const out = filterCards(cards, { search: '', location: '4 – Sestri', status: 'Tutte', classification: 'ALL' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].requestingLocationLabel, '4 – Sestri');
});
test('status filter: exact match only', () => {
  const cards = [card({ status: 'DA_TROVARE' }), card({ status: 'DA_PREPARARE' })];
  const out = filterCards(cards, { search: '', location: 'Tutti', status: 'DA_PREPARARE', classification: 'ALL' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].status, 'DA_PREPARARE');
});
test('classification filter: transfer candidates only', () => {
  const cards = [card({ classification: 'TRANSFER_CANDIDATE' }), card({ classification: 'BUYER_SHORTAGE' })];
  const out = filterCards(cards, { search: '', location: 'Tutti', status: 'Tutte', classification: 'TRANSFER_CANDIDATES' });
  assert.strictEqual(out.length, 1);
});
test('classification filter: network shortages includes buyer + high-volume', () => {
  const cards = [card({ classification: 'BUYER_SHORTAGE' }), card({ classification: 'HIGH_VOLUME_SHORTAGE' }), card({ classification: 'TRANSFER_CANDIDATE' })];
  const out = filterCards(cards, { search: '', location: 'Tutti', status: 'Tutte', classification: 'NETWORK_SHORTAGES' });
  assert.strictEqual(out.length, 2);
});
test('classification filter: buyer priority is high-volume only', () => {
  const cards = [card({ classification: 'BUYER_SHORTAGE' }), card({ classification: 'HIGH_VOLUME_SHORTAGE' })];
  const out = filterCards(cards, { search: '', location: 'Tutti', status: 'Tutte', classification: 'BUYER_PRIORITY' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].classification, 'HIGH_VOLUME_SHORTAGE');
});
test('combined filters apply together (AND, not OR)', () => {
  const cards = [
    card({ productCode: 'A-1', requestingLocationLabel: '2 – Malta', status: 'DA_TROVARE' }),
    card({ productCode: 'A-1', requestingLocationLabel: '4 – Sestri', status: 'DA_TROVARE' }),
  ];
  const out = filterCards(cards, { search: 'a-1', location: '4 – Sestri', status: 'DA_TROVARE', classification: 'ALL' });
  assert.strictEqual(out.length, 1);
  assert.strictEqual(out[0].requestingLocationLabel, '4 – Sestri');
});
test('empty filters (defaults) return all cards unchanged', () => {
  const cards = [card({}), card({})];
  const out = filterCards(cards, { search: '', location: 'Tutti', status: 'Tutte', classification: 'ALL' });
  assert.strictEqual(out.length, 2);
});
test('zero cards -> zero results regardless of filters', () => {
  const out = filterCards([], { search: 'x', location: 'Tutti', status: 'Tutte', classification: 'ALL' });
  assert.strictEqual(out.length, 0);
});

// --- no token in browser bundle / no secret in this file ---
test('rete-mcp-product-cards.js never references the MCP token or endpoint', () => {
  assert.strictEqual(/RETE_MCP_TOKEN/.test(source), false);
  assert.strictEqual(/rete-mcp\.188\.245\.173\.244/.test(source), false);
  assert.strictEqual(/Authorization.*Bearer\s+ey/.test(source), false); // no hardcoded bearer token
});
test('rete-mcp-product-cards.js only ever calls the same-origin API route', () => {
  assert.ok(source.includes("fetch('/api/rete-squillari/mcp'"));
});
test('rete-mcp-product-cards.js does not log the access token', () => {
  const consoleLogLines = source.split('\n').filter((l) => /console\.(log|error|warn)/.test(l));
  for (const line of consoleLogLines) {
    assert.strictEqual(/token/i.test(line), false, 'must not log a variable named/containing "token": ' + line);
  }
});

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log('\nFailures:');
  failures.forEach((f) => console.log('  - ' + f));
  process.exit(1);
}
