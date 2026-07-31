// Pure unit tests for Italian notification copy rendering - no database,
// no network. Cross-checked against the exact sample sentences quoted in
// the gate spec (Phase 4) and against the mirrored SQL function in
// supabase/migrations/20260729080500_rete_notification_engine_rpcs.sql.
import assert from 'node:assert';
import { renderNotificationCopy, assertNoForbiddenContent } from '../lib/rete-squillari/notifications/copy';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

check('GOODS_TO_PREPARE matches the exact spec sample sentence', () => {
  const { body } = renderNotificationCopy('GOODS_TO_PREPARE', { own_name: 'Malta', quantity: 2, product: 'Liquore Basilico Allara' });
  assert.strictEqual(body, 'Malta deve preparare 2 unità di Liquore Basilico Allara.');
});

check('EXCESS_STOCK_RESERVED matches the exact spec sample sentence', () => {
  const { body } = renderNotificationCopy('EXCESS_STOCK_RESERVED', { counterpart_name: 'Sestri', quantity: 1 });
  assert.strictEqual(body, 'Sestri ha prenotato 1 unità dalla tua eccedenza.');
});

check('TRANSFER_STARTED (departing donor copy) matches the exact spec sample sentence', () => {
  const { body } = renderNotificationCopy('TRANSFER_STARTED', { counterpart_name: 'De Ferrari', direction: 'DEPARTING' });
  assert.strictEqual(body, 'Il trasferimento verso De Ferrari è partito.');
});

check('TRANSFER_STARTED (arriving recipient copy) is distinct from the departing copy', () => {
  const { body } = renderNotificationCopy('TRANSFER_STARTED', { counterpart_name: 'De Ferrari', direction: 'ARRIVING' });
  assert.strictEqual(body, 'Il trasferimento da De Ferrari è partito.');
});

check('TRASTA_FULL_ARRIVAL matches the exact spec sample sentence', () => {
  const { body } = renderNotificationCopy('TRASTA_FULL_ARRIVAL', {});
  assert.strictEqual(body, 'Arrivo completo a Trasta: richiesta coperta.');
});

check('every defined event type renders a non-empty title and body', () => {
  const eventTypes: any[] = [
    'OFFER_RECEIVED', 'OFFER_AUTO_ACCEPTED', 'GOODS_TO_PREPARE', 'GOODS_READY', 'TRANSFER_STARTED', 'TRANSFER_RECEIVED',
    'TRASTA_PARTIAL_ARRIVAL', 'TRASTA_FULL_ARRIVAL', 'REQUEST_CANCELLED', 'SYSTEM_EXCEPTION', 'EXCESS_STOCK_PUBLISHED',
    'EXCESS_STOCK_RESERVED', 'EXCESS_STOCK_PARTIALLY_RESERVED', 'EXCESS_STOCK_FULLY_RESERVED', 'EXCESS_GOODS_TO_PREPARE',
    'EXCESS_TRANSFER_STARTED', 'EXCESS_TRANSFER_RECEIVED', 'EXCESS_STOCK_EXPIRED', 'EXCESS_STOCK_WITHDRAWN',
  ];
  for (const eventType of eventTypes) {
    const { title, body } = renderNotificationCopy(eventType, { quantity: 1, product: 'Test', counterpart_name: 'X', own_name: 'Y', to_name: 'Z', detail: 'd' });
    assert.ok(title.length > 0, eventType + ' title empty');
    assert.ok(body.length > 0, eventType + ' body empty');
  }
});

check('PIN/token-shaped content is rejected', () => {
  assert.throws(() => assertNoForbiddenContent('il PIN è 1234'));
  assert.throws(() => assertNoForbiddenContent('token abc123'));
  assert.throws(() => assertNoForbiddenContent('costo fornitore: 12.50'));
  assert.throws(() => assertNoForbiddenContent('+39 3331234567 contattaci'));
  assert.throws(() => assertNoForbiddenContent('id 550e8400-e29b-41d4-a716-446655440000'));
});

check('ordinary Italian notification body is accepted', () => {
  assertNoForbiddenContent('Malta deve preparare 2 unità di Liquore Basilico Allara.');
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
