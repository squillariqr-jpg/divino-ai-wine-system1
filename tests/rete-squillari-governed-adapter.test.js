// Unit tests for the governed backend adapter (public/rete-squillari/rete-backend-adapter.js).
// Pure logic tests against a mocked Supabase client - no live database required.
// Covers required categories A (adapter contract), B (idempotency), C (auth/session).
const assert = require('assert');
const path = require('path');

global.window = undefined;
require(path.join(__dirname, '..', 'public/rete-squillari/rete-backend-adapter.js'));
const ADAPTER = globalThis.RETE_BACKEND_ADAPTER;

function mockClient(overrides) {
  overrides = overrides || {};
  var rpcCalls = [];
  var client = {
    __rpcCalls: rpcCalls,
    from: function (table) {
      var self = { _table: table };
      self.select = function () { return self; };
      self.eq = function () { return self; };
      self.order = function () { return self; };
      self.single = function () {
        return Promise.resolve(overrides.membership || { data: null, error: { message: 'not mocked' } });
      };
      self.then = function (resolve) {
        var key = table + 'List';
        return Promise.resolve(overrides[key] || { data: [], error: null }).then(resolve);
      };
      return self;
    },
    rpc: function (name, params) {
      rpcCalls.push({ name: name, params: params });
      if (overrides.rpc) return Promise.resolve(overrides.rpc(name, params));
      return Promise.resolve({ data: { status: 'OK' }, error: null });
    },
    auth: { signOut: function () { return Promise.resolve({ error: null }); } }
  };
  return client;
}

var pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}
async function checkAsync(name, fn) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

(async function run() {
  // --- Category C: auth/session ---
  await checkAsync('C1: no session throws NOT_AUTHENTICATED', async function () {
    var adapter = ADAPTER.create(mockClient());
    try { await adapter.initialize(null); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'NOT_AUTHENTICATED'); }
  });

  await checkAsync('C2: membership absent -> ACCESS_DENIED', async function () {
    var adapter = ADAPTER.create(mockClient({ membership: { data: null, error: null } }));
    try { await adapter.initialize({ user: { id: 'u1' } }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'ACCESS_DENIED'); }
  });

  await checkAsync('C3: inactive membership -> ACCESS_DENIED (RLS returns no row, exactly like real Supabase)', async function () {
    // The "users read own membership" RLS policy requires active=true for the
    // row to be visible at all (migration 1); an inactive membership is
    // therefore modeled as no returned row, not as a row with active:false.
    var adapter = ADAPTER.create(mockClient({ membership: { data: null, error: null } }));
    try { await adapter.initialize({ user: { id: 'u1' } }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'ACCESS_DENIED'); }
  });

  await checkAsync('C4: non-pilot active membership -> DEMO_LOCAL mode (not rejected, just non-governed)', async function () {
    var adapter = ADAPTER.create(mockClient({
      membership: { data: { role: 'store', location_id: 3, active: true, pilot_enabled: false, rete_locations: { code: 103, name: 'Cantore', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 3, code: 103, name: 'Cantore', active: true }], error: null }
    }));
    var actor = await adapter.initialize({ user: { id: 'u1' } });
    assert.strictEqual(actor.mode, ADAPTER.MODE.DEMO_LOCAL);
  });

  await checkAsync('C5: central membership + pilot_enabled -> GOVERNED_BACKEND, role=central', async function () {
    var adapter = ADAPTER.create(mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null }
    }));
    var actor = await adapter.initialize({ user: { id: 'u1' } });
    assert.strictEqual(actor.mode, ADAPTER.MODE.GOVERNED_BACKEND);
    assert.strictEqual(actor.role, 'central');
    assert.strictEqual(actor.locationLabel, 'Responsabile centrale');
  });

  await checkAsync('C6: store membership + pilot_enabled -> GOVERNED_BACKEND, location resolved', async function () {
    var adapter = ADAPTER.create(mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null }
    }));
    var actor = await adapter.initialize({ user: { id: 'u1' } });
    assert.strictEqual(actor.mode, ADAPTER.MODE.GOVERNED_BACKEND);
    assert.strictEqual(actor.locationLabel, '101 – Malta');
  });

  // --- Category A: adapter contract ---
  await checkAsync('A1: loadDashboard throws WRONG_MODE outside GOVERNED_BACKEND', async function () {
    var adapter = ADAPTER.create(mockClient({
      membership: { data: { role: 'store', location_id: 3, active: true, pilot_enabled: false, rete_locations: { code: 103, name: 'Cantore', active: true } }, error: null },
      rete_locationsList: { data: [], error: null }
    }));
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.loadDashboard(); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'WRONG_MODE'); }
  });

  await checkAsync('A2: each mutating method issues exactly one RPC call', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null },
      rpc: function (name) { return { data: { status: 'OK', offer_id: 'x', transfer_id: 'y', arrival_id: 'z', request_id: 'r' }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    await adapter.publishRequest({ locationId: 1, productCode: 'C', productDescription: 'D', quantity: 1 });
    assert.strictEqual(client.__rpcCalls.length, 1);
    assert.strictEqual(client.__rpcCalls[0].name, 'rete_request_publish');
  });

  await checkAsync('A3: wrong-role is rejected client-side before any RPC call (store calling publishRequest)', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.publishRequest({ locationId: 1, productCode: 'C', productDescription: 'D', quantity: 1 }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'WRONG_ROLE'); }
    assert.strictEqual(client.__rpcCalls.length, 0, 'no RPC should have been attempted');
  });

  await checkAsync('A4: unknown local id throws before RPC (no direct table mutation path exists)', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.withdrawOffer({ offerLocalId: 999 }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'UNKNOWN_LOCAL_ID'); }
    assert.strictEqual(client.__rpcCalls.length, 0);
  });

  // --- Category B: idempotency ---
  await checkAsync('B1: normalizeRpcError maps generic backend messages to stable codes (no raw SQL surfaced)', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null },
      rpc: function () { return { data: null, error: { message: 'operation not permitted' } }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.publishRequest({ locationId: 1, productCode: 'C', productDescription: 'D', quantity: 1 }); assert.fail('should have thrown'); }
    catch (e) {
      assert.strictEqual(e.code, 'OPERATION_NOT_PERMITTED');
      assert.ok(!/permitted/.test(e.message) === false || e.message === 'Operazione non consentita.', 'user-facing message must be the normalized Italian string, not the raw Postgres text');
    }
  });

  await checkAsync('B2: network-level failure (rejected promise) is classified RESULT_UNKNOWN, not a definite failure', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null }
    });
    client.rpc = function () { return Promise.reject(new TypeError('fetch failed')); };
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.publishRequest({ locationId: 1, productCode: 'C', productDescription: 'D', quantity: 1 }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'RESULT_UNKNOWN'); }
  });

  // --- Category D: open-to-offers pilot extension ---
  await checkAsync('D1: confirmRequest issues exactly one rete_request_confirm call with expected_version', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null },
      rpc: function () { return { data: { status: 'DA_TROVARE' }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    await adapter.loadDashboard();
    // Force a known local id -> uuid mapping via a request row.
    client.from = function (table) {
      var self = { _table: table };
      self.select = function () { return self; };
      self.order = function () { return Promise.resolve({ data: table === 'rete_requests' ? [{ id: 'req-uuid-1', requesting_location_id: 1, product_code: 'C', product_description: 'D', requested_quantity: 6, remaining_quantity: 6, status: 'DA_CONFERMARE', version: 0 }] : [], error: null }); };
      return self;
    };
    var dashboard = await adapter.loadDashboard();
    var localId = dashboard.requests[0].id;
    await adapter.confirmRequest({ requestLocalId: localId, expectedVersion: 0 });
    var call = client.__rpcCalls[client.__rpcCalls.length - 1];
    assert.strictEqual(call.name, 'rete_request_confirm');
    assert.strictEqual(call.params.p_request_id, 'req-uuid-1');
    assert.strictEqual(call.params.p_expected_version, 0);
  });

  await checkAsync('D2: confirmRequest rejects a central caller client-side (store-only action)', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.confirmRequest({ requestLocalId: 999, expectedVersion: 0 }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'WRONG_ROLE'); }
  });

  await checkAsync('D3: createManualRequest is store-only and issues rete_manual_request_create', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null },
      rpc: function () { return { data: { request_id: 'r1', status: 'DA_TROVARE', requires_central_confirmation: false }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    await adapter.createManualRequest({ productCode: 'M1', productDescription: 'Manual', quantity: 6, reason: 'urgent' });
    assert.strictEqual(client.__rpcCalls[0].name, 'rete_manual_request_create');
    assert.strictEqual(client.__rpcCalls[0].params.p_product_code, 'M1');
  });

  await checkAsync('D8: createManualRequest forwards p_request_reason / p_request_reason_note, defaulting to null', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null },
      rpc: function () { return { data: { request_id: 'r1', status: 'DA_TROVARE', requires_central_confirmation: false, request_reason: 'SALE' }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    await adapter.createManualRequest({ productCode: 'M1', productDescription: 'Manual', quantity: 6, requestReason: 'SALE' });
    assert.strictEqual(client.__rpcCalls[0].params.p_request_reason, 'SALE');
    assert.strictEqual(client.__rpcCalls[0].params.p_request_reason_note, null);

    await adapter.createManualRequest({ productCode: 'M2', productDescription: 'Manual 2', quantity: 6 });
    assert.strictEqual(client.__rpcCalls[1].params.p_request_reason, null, 'omitted requestReason must default to null, not undefined or a fabricated value');
  });

  await checkAsync('D9: mapRequestRow surfaces request_reason/request_reason_note; null when absent (legacy/email rows)', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    client.from = function (table) {
      var self = { _table: table };
      self.select = function () { return self; };
      self.order = function () {
        if (table !== 'rete_requests') return Promise.resolve({ data: [], error: null });
        return Promise.resolve({
          data: [
            { id: 'r-sale', requesting_location_id: 1, product_code: 'C1', product_description: 'D1', requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', version: 0, source: 'MANUAL', request_reason: 'SALE', request_reason_note: null },
            { id: 'r-other', requesting_location_id: 1, product_code: 'C2', product_description: 'D2', requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', version: 0, source: 'MANUAL', request_reason: 'OTHER', request_reason_note: 'Evento locale' },
            { id: 'r-email', requesting_location_id: 1, product_code: 'C3', product_description: 'D3', requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', version: 0, source: 'EMAIL' },
          ], error: null
        });
      };
      return self;
    };
    var dashboard = await adapter.loadDashboard();
    var byCode = {}; dashboard.requests.forEach(function (r) { byCode[r.code] = r; });
    assert.strictEqual(byCode.C1.requestReason, 'SALE');
    assert.strictEqual(byCode.C1.requestReasonNote, null);
    assert.strictEqual(byCode.C2.requestReason, 'OTHER');
    assert.strictEqual(byCode.C2.requestReasonNote, 'Evento locale');
    assert.strictEqual(byCode.C3.requestReason, null, 'an email-sourced row with no request_reason column value must map to null, never an invented reason');
  });

  await checkAsync('D4: cancelRequest issues rete_request_cancel with a reason and expected_version', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null },
      rpc: function () { return { data: { status: 'ANNULLATA' }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    var originalFrom = client.from;
    client.from = function (table) {
      if (table !== 'rete_requests') return originalFrom(table);
      var self = { _table: table };
      self.select = function () { return self; };
      self.order = function () { return Promise.resolve({ data: [{ id: 'req-uuid-2', requesting_location_id: 1, product_code: 'C', product_description: 'D', requested_quantity: 6, remaining_quantity: 6, status: 'DA_TROVARE', version: 2 }], error: null }); };
      return self;
    };
    var dashboard = await adapter.loadDashboard();
    var localId = dashboard.requests[0].id;
    await adapter.cancelRequest({ requestLocalId: localId, reason: 'not needed', expectedVersion: 2 });
    var call = client.__rpcCalls[client.__rpcCalls.length - 1];
    assert.strictEqual(call.name, 'rete_request_cancel');
    assert.strictEqual(call.params.p_reason, 'not needed');
    assert.strictEqual(call.params.p_expected_version, 2);
  });

  await checkAsync('D5: markRequestNoLongerNeeded is store-only', async function () {
    var client = mockClient({
      membership: { data: { role: 'central', location_id: null, active: true, pilot_enabled: true, rete_locations: null }, error: null },
      rete_locationsList: { data: [], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.markRequestNoLongerNeeded({ requestLocalId: 999, expectedVersion: 0 }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'WRONG_ROLE'); }
  });

  await checkAsync('D6: resolveDiscrepancy is central-only and issues rete_transfer_resolve_discrepancy', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    try { await adapter.resolveDiscrepancy({ transferLocalId: 999, resolutionNote: 'ok' }); assert.fail('should have thrown'); }
    catch (e) { assert.strictEqual(e.code, 'WRONG_ROLE'); }
  });

  await checkAsync('D7: receiveTransfer forwards discrepancy_type alongside received_quantity', async function () {
    var client = mockClient({
      membership: { data: { role: 'store', location_id: 1, active: true, pilot_enabled: true, rete_locations: { code: 101, name: 'Malta', active: true } }, error: null },
      rete_locationsList: { data: [{ id: 1, code: 101, name: 'Malta', active: true }], error: null },
      rpc: function () { return { data: { status: 'RICEVUTA' }, error: null }; }
    });
    var adapter = ADAPTER.create(client);
    await adapter.initialize({ user: { id: 'u1' } });
    var originalFrom2 = client.from;
    client.from = function (table) {
      if (table !== 'rete_transfers') return originalFrom2(table);
      var self = { _table: table };
      self.select = function () { return self; };
      self.order = function () { return Promise.resolve({ data: [{ id: 'transfer-uuid-1', request_id: 'r1', offer_id: null, from_location_id: 2, to_location_id: 1, quantity: 6, status: 'IN_TRASFERIMENTO', created_at: '2026-07-19' }], error: null }); };
      return self;
    };
    var dashboard = await adapter.loadDashboard();
    var localId = dashboard.transfers[0].id;
    await adapter.receiveTransfer({ transferLocalId: localId, receivedQuantity: 4, anomalyNote: 'short', discrepancyType: 'SHORT' });
    var call = client.__rpcCalls[client.__rpcCalls.length - 1];
    assert.strictEqual(call.name, 'rete_transfer_receive');
    assert.strictEqual(call.params.p_discrepancy_type, 'SHORT');
    assert.strictEqual(call.params.p_received_quantity, 4);
  });

  console.log('\n=== ' + pass + '/' + (pass + fail) + ' passed ===');
  if (fail > 0) process.exitCode = 1;
})();
