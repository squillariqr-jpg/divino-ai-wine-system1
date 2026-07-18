// Local-only E2E scenario for the governed Rete Squillari adapter.
// Runs exclusively against 127.0.0.1 local Supabase. No remote calls, no real PINs.
const { createClient } = require('@supabase/supabase-js');
const status = require('/tmp/local_status.json');
const users = require('/tmp/synthetic_users.json');

global.window = undefined; // force the adapter's UMD guard to attach to globalThis
require('../public/rete-squillari/rete-backend-adapter.js');
const ADAPTER = globalThis.RETE_BACKEND_ADAPTER;

const PASSWORD = 'synthetic-local-only-pw-1!';
const results = [];
function record(name, pass, detail) {
  results.push({ name, pass, detail: detail || '' });
  console.log((pass ? 'PASS' : 'FAIL') + ' - ' + name + (detail ? ' :: ' + detail : ''));
}
async function expectReject(name, fn) {
  try { await fn(); record(name, false, 'expected rejection but call succeeded'); }
  catch (e) { record(name, true, e.code + ': ' + (e.raw || e.message)); }
}

async function loginAs(key) {
  const client = createClient(status.API_URL, status.ANON_KEY);
  const { data, error } = await client.auth.signInWithPassword({ email: users[key].email, password: PASSWORD });
  if (error) throw new Error('login failed for ' + key + ': ' + error.message);
  const adapter = ADAPTER.create(client);
  const actor = await adapter.initialize(data.session);
  return { client, adapter, actor, session: data.session };
}

async function raw(client, table) {
  return client.from(table).select('*');
}

async function main() {
  // 1. Centrale authenticates
  const centrale = await loginAs('central');
  record('1. Centrale authenticates (GOVERNED_BACKEND, role=central)',
    centrale.actor.mode === 'GOVERNED_BACKEND' && centrale.actor.role === 'central', 'mode=' + centrale.actor.mode);

  const malta = await loginAs('malta');
  const sestri = await loginAs('sestri');
  const cantore = await loginAs('cantore'); // non-pilot
  record('non-pilot fixture confirmed DEMO_LOCAL', cantore.actor.mode === 'DEMO_LOCAL', 'mode=' + cantore.actor.mode);

  var maltaLocId = malta.actor.locationId;
  var sestriLocId = sestri.actor.locationId;

  // 2. Centrale publishes one request (requester = Malta's location)
  const pub = await centrale.adapter.publishRequest({
    locationId: maltaLocId, productCode: 'E2E-001', productDescription: 'E2E Test Wine A', quantity: 10, urgency: 'NORMALE'
  });
  record('2. Centrale publishes request', pub.status === 'DA_TROVARE', JSON.stringify(pub));

  var maltaDash = await malta.adapter.loadDashboard();
  var reqRow = maltaDash.requests.find(function (r) { return r.code === 'E2E-001'; });
  if (!reqRow) throw new Error('published request not visible to Malta');

  // 3. Malta authenticates and creates a partial offer -- but Malta IS the
  // requester here, so Malta cannot offer on its own request (RPC-enforced
  // guard). Sestri (a different store) creates the partial offer instead;
  // this is the correct governed-contract equivalent of "Malta creates a
  // partial offer" using a store that is actually eligible.
  await expectReject('3a. Requesting store cannot offer on its own request (Malta on its own request)', async function () {
    await malta.adapter.createOffer({ requestLocalId: reqRow.id, quantity: 3 });
  });
  // Each adapter instance keeps its own local-id space (mirrors independent
  // browser sessions); Sestri must resolve E2E-001 through its own
  // dashboard load before referencing it by local id.
  var sestriDash1 = await sestri.adapter.loadDashboard();
  var reqRowForSestri = sestriDash1.requests.find(function (r) { return r.code === 'E2E-001'; });
  var sestriOffer = await sestri.adapter.createOffer({ requestLocalId: reqRowForSestri.id, quantity: 4 });
  record('3b. Sestri creates a partial offer', sestriOffer.status === 'PROPOSTA', JSON.stringify(sestriOffer));

  // Second request + second offer, used purely for the withdrawal test (4-5).
  var pub2 = await centrale.adapter.publishRequest({
    locationId: maltaLocId, productCode: 'E2E-002', productDescription: 'E2E Test Wine B', quantity: 5, urgency: 'NORMALE'
  });
  var sestriDash2 = await sestri.adapter.loadDashboard();
  var reqRow2 = sestriDash2.requests.find(function (r) { return r.code === 'E2E-002'; });
  var throwawayOffer = await sestri.adapter.createOffer({ requestLocalId: reqRow2.id, quantity: 2 });
  record('4. Sestri creates a second (throwaway) offer for withdrawal test', throwawayOffer.status === 'PROPOSTA');

  var sestriDash3 = await sestri.adapter.loadDashboard();
  var throwawayLocal = sestriDash3.offers.find(function (o) { return o.backendId === throwawayOffer.offer_id; });
  var withdrawn = await sestri.adapter.withdrawOffer({ offerLocalId: throwawayLocal.id });
  record('5. Sestri withdraws its own unapproved offer', withdrawn.status === 'RITIRATA', JSON.stringify(withdrawn));

  // Cross-store guard: Malta (not the offering store) may not withdraw Sestri's offer.
  var sestriOfferLocalForMalta = (await malta.adapter.loadDashboard()).offers.find(function (o) { return o.backendId === sestriOffer.offer_id; });
  await expectReject('wrong-location: Malta cannot withdraw Sestri\'s offer', async function () {
    await malta.adapter.withdrawOffer({ offerLocalId: sestriOfferLocalForMalta.id });
  });

  // 6. Centrale approves Sestri's offer on request E2E-001
  var centraleDash = await centrale.adapter.loadDashboard();
  var offerForApproval = centraleDash.offers.find(function (o) { return o.backendId === sestriOffer.offer_id; });
  var approved = await centrale.adapter.approveOffer({ offerLocalId: offerForApproval.id, approvedQuantity: 4 });
  record('6. Centrale approves Sestri\'s offer', approved.status === 'APPROVATA', JSON.stringify(approved));

  // 7. Centrale rejects another offer. A store may only hold one offer per
  // request (unique constraint on request_id+offering_location_id, even
  // across withdrawn rows), so this needs a fresh request rather than
  // reusing E2E-002 (Sestri already has a withdrawn offer there).
  var pubReject = await centrale.adapter.publishRequest({
    locationId: maltaLocId, productCode: 'E2E-002B', productDescription: 'E2E Reject Wine', quantity: 3, urgency: 'NORMALE'
  });
  var sestriDashReject = await sestri.adapter.loadDashboard();
  var reqRowReject = sestriDashReject.requests.find(function (r) { return r.code === 'E2E-002B'; });
  var rejectCandidateRaw = await sestri.adapter.createOffer({ requestLocalId: reqRowReject.id, quantity: 1 });
  var centraleDash2 = await centrale.adapter.loadDashboard();
  var rejectCandidate = centraleDash2.offers.find(function (o) { return o.backendId === rejectCandidateRaw.offer_id; });
  var rejected = await centrale.adapter.rejectOffer({ offerLocalId: rejectCandidate.id });
  record('7. Centrale rejects another offer', rejected.status === 'RIFIUTATA', JSON.stringify(rejected));

  // 8. Origin store (Sestri, offering_location) marks transfer ready
  var sestriDash4 = await sestri.adapter.loadDashboard();
  var transferRow = sestriDash4.transfers.find(function (t) { return t.backendId === approved.transfer_id; });
  var ready = await sestri.adapter.markTransferReady({ transferLocalId: transferRow.id });
  record('8. Sestri marks transfer ready (PRONTA)', ready.status === 'PRONTA', JSON.stringify(ready));

  // wrong-role guard: Centrale cannot mark a transfer ready (store-only action)
  var centraleTransferView = (await centrale.adapter.loadDashboard()).transfers.find(function (t) { return t.backendId === approved.transfer_id; });
  await expectReject('wrong-role: Centrale cannot mark transfer ready', async function () {
    await centrale.adapter.markTransferReady({ transferLocalId: centraleTransferView.id });
  });

  // 9. Origin store marks transfer departed
  var departed = await sestri.adapter.markTransferDeparted({ transferLocalId: transferRow.id });
  record('9. Sestri marks transfer departed (IN_TRASFERIMENTO)', departed.status === 'IN_TRASFERIMENTO', JSON.stringify(departed));

  // 10. Destination store (Malta, requesting location) receives transfer
  var maltaDash2 = await malta.adapter.loadDashboard();
  var maltaTransferView = maltaDash2.transfers.find(function (t) { return t.backendId === approved.transfer_id; });
  var received = await malta.adapter.receiveTransfer({ transferLocalId: maltaTransferView.id, receivedQuantity: 4 });
  record('10. Malta receives transfer', received.status === 'RICEVUTA', JSON.stringify(received));

  // 11. Centrale records a Trasta arrival against the SEPARATE E2E-002 request
  var centraleDash3 = await centrale.adapter.loadDashboard();
  var req2ForArrival = centraleDash3.requests.find(function (r) { return r.code === 'E2E-002'; });
  var arrival = await centrale.adapter.recordTrastaArrival({
    targetRequestLocalId: req2ForArrival.id, productCode: 'E2E-002', quantity: 5, sourceReference: 'e2e-scenario'
  });
  record('11. Centrale records Trasta arrival on separate request', !!arrival.arrival_id, JSON.stringify(arrival));

  // 12. Dashboard refreshes from backend data (already exercised throughout; confirm final counts)
  var finalDash = await centrale.adapter.loadDashboard();
  record('12. Dashboard refresh reflects backend state',
    finalDash.requests.length >= 2 && finalDash.offers.length >= 3 && finalDash.transfers.length >= 1,
    'requests=' + finalDash.requests.length + ' offers=' + finalDash.offers.length + ' transfers=' + finalDash.transfers.length);

  // 13. Audit and idempotency records verified directly (service-role read, local only)
  const { createClient: cc } = require('@supabase/supabase-js');
  const admin = cc(status.API_URL, status.SERVICE_ROLE_KEY);
  var auditRes = await raw(admin, 'rete_audit_events');
  var idemRes = await raw(admin, 'rete_idempotent_operations');
  record('13. Audit rows created', auditRes.data.length > 0, 'count=' + auditRes.data.length);
  record('13. Idempotency rows created', idemRes.data.length > 0, 'count=' + idemRes.data.length);

  // 14. Duplicate retry with the same key returns the same result: publish a
  // fresh request and immediately re-invoke the adapter's internal retry
  // path by calling the same high-level operation twice for the identical
  // target/payload while the first call's idempotency slot is still fresh.
  // The adapter's claimIdempotencyKey reuses the key only while state is
  // SUBMITTING/RESULT_UNKNOWN; to prove server-side idempotency directly
  // (not just adapter-side key reuse), call the RPC twice with the SAME
  // explicit key via the raw client.
  var directClient = malta.client;
  var idKey = require('crypto').randomUUID();
  var first = await directClient.rpc('rete_offer_create', { p_request_id: pub2.request_id, p_offered_quantity: 1, p_idempotency_key: idKey });
  // Malta cannot offer on its own request (pub2 requester = Malta) -- use Sestri's raw client instead for a valid target.
  var sClient = sestri.client;
  var pub3 = await centrale.adapter.publishRequest({ locationId: maltaLocId, productCode: 'E2E-003', productDescription: 'E2E Retry Wine', quantity: 6, urgency: 'NORMALE' });
  var d3 = await sestri.adapter.loadDashboard();
  var req3 = d3.requests.find(function (r) { return r.code === 'E2E-003'; });
  var retryKey = require('crypto').randomUUID();
  var callA = await sClient.rpc('rete_offer_create', { p_request_id: req3.backendId, p_offered_quantity: 2, p_idempotency_key: retryKey });
  var callB = await sClient.rpc('rete_offer_create', { p_request_id: req3.backendId, p_offered_quantity: 2, p_idempotency_key: retryKey });
  record('14. Duplicate retry (same key, same payload) returns same result',
    !callA.error && !callB.error && callA.data.offer_id === callB.data.offer_id,
    'A=' + JSON.stringify(callA.data) + ' B=' + JSON.stringify(callB.data));

  // 15. Same key with different payload is rejected
  var callC = await sClient.rpc('rete_offer_create', { p_request_id: req3.backendId, p_offered_quantity: 5, p_idempotency_key: retryKey });
  record('15. Same key + different payload rejected', !!callC.error, callC.error && callC.error.message);

  // 16. Non-pilot user (Cantore) is rejected calling a governed RPC directly
  var cantoreRpc = await cantore.client.rpc('rete_offer_create', { p_request_id: req3.backendId, p_offered_quantity: 1, p_idempotency_key: require('crypto').randomUUID() });
  record('16. Non-pilot (Cantore, pilot_enabled=false) rejected', !!cantoreRpc.error, cantoreRpc.error && cantoreRpc.error.message);

  // 17. Wrong-role action rejected (already also proven at step 8's guard; add an explicit store-cannot-publish check)
  await expectReject('17. Wrong-role: store cannot publish a request (central-only)', async function () {
    await malta.adapter.publishRequest({ locationId: sestriLocId, productCode: 'X', productDescription: 'X', quantity: 1 });
  });

  // 18. Wrong-location action rejected (already proven above: Malta cannot withdraw Sestri's offer,
  // and Centrale cannot mark-ready). Add: Sestri (not the destination) cannot receive Malta's transfer.
  var sestriViewOfReceivedTransfer = (await sestri.adapter.loadDashboard()).transfers.find(function (t) { return t.backendId === approved.transfer_id; });
  await expectReject('18. Wrong-location: Sestri cannot receive a transfer addressed to Malta', async function () {
    await sestri.adapter.receiveTransfer({ transferLocalId: sestriViewOfReceivedTransfer.id, receivedQuantity: 1 });
  });

  var failed = results.filter(function (r) { return !r.pass; });
  console.log('\n=== SUMMARY: ' + (results.length - failed.length) + '/' + results.length + ' passed ===');
  if (failed.length) { console.log('FAILED:', failed.map(function (f) { return f.name; })); process.exitCode = 1; }
}

main().catch(function (e) { console.error('FATAL', e); process.exitCode = 1; });
