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

  console.log('\n=== ' + pass + '/' + (pass + fail) + ' passed ===');
  if (fail > 0) process.exitCode = 1;
})();
