// Exercises the notification engine's core design invariants (dedup,
// in-app fan-out, identity scoping, idempotent mark-read/mark-all-read)
// against the in-memory reference model in tests/helpers/notification-reference-engine.ts.
//
// IMPORTANT LIMITATION: this is a logic-parity test of the DESIGN, not of
// the deployed SQL RPCs or Postgres RLS themselves - local Docker (and
// therefore a local Supabase instance to run the real migrations and
// RPCs against) was not available this session. The real RLS/RPC
// enforcement (direct-table-write-blocked, RLS-scoped visibility, etc.)
// has not been executed against a live database this session; this file
// documents and verifies the intended behavior at the design level only.
// See the final report's BLOCKERS/WARNINGS section.
import assert from 'node:assert';
import { NotificationReferenceEngine, type Identity } from './helpers/notification-reference-engine';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

const malta: Identity = { role: 'store', locationId: 2, userId: 'user-malta' };
const sestri: Identity = { role: 'store', locationId: 4, userId: 'user-sestri' };
const central: Identity = { role: 'central', locationId: null, userId: 'user-central' };

check('one business event creates exactly one canonical notification', () => {
  const engine = new NotificationReferenceEngine();
  const r1 = engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'GOODS_TO_PREPARE:t1', recipientLocationId: 2, title: 'x', body: 'y', deepLink: '/z' });
  assert.strictEqual(r1.created, true);
  assert.strictEqual(engine.list(malta).length, 1);
});

check('a duplicate event (same deduplication key) is blocked - no second event, no second delivery', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'GOODS_TO_PREPARE:t1', recipientLocationId: 2, title: 'x', body: 'y', deepLink: '/z' });
  const r2 = engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'GOODS_TO_PREPARE:t1', recipientLocationId: 2, title: 'x-retry', body: 'y-retry', deepLink: '/z' });
  assert.strictEqual(r2.created, false);
  assert.strictEqual(engine.list(malta).length, 1);
  assert.strictEqual(engine.list(malta)[0].title, 'x'); // the retry's payload never overwrote the original
});

check('a store sees only its own notifications, never another store\'s', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e1', recipientLocationId: 2, title: 'for malta', body: 'b', deepLink: '/z' });
  engine.enqueue({ eventType: 'GOODS_READY', dedupKey: 'e2', recipientLocationId: 4, title: 'for sestri', body: 'b', deepLink: '/z' });
  assert.deepStrictEqual(engine.list(malta).map((n) => n.title), ['for malta']);
  assert.deepStrictEqual(engine.list(sestri).map((n) => n.title), ['for sestri']);
});

check('a central exception routed to a specific central user is not visible to any store', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'SYSTEM_EXCEPTION', dedupKey: 'exc-1', recipientUserId: 'user-central', title: 'exception', body: 'b', deepLink: '/z', priority: 'URGENT' });
  assert.strictEqual(engine.list(central).length, 1);
  assert.strictEqual(engine.list(malta).length, 0);
  assert.strictEqual(engine.list(sestri).length, 0);
});

check('central does not see ordinary store-routed traffic (only its own explicitly-routed exceptions)', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e3', recipientLocationId: 2, title: 'store traffic', body: 'b', deepLink: '/z' });
  assert.strictEqual(engine.list(central).length, 0);
});

check('unread count matches the number of unread deliveries visible to that identity', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e4', recipientLocationId: 2, title: 'a', body: 'b', deepLink: '/z' });
  engine.enqueue({ eventType: 'GOODS_READY', dedupKey: 'e5', recipientLocationId: 2, title: 'b', body: 'b', deepLink: '/z' });
  assert.strictEqual(engine.unreadCount(malta), 2);
  engine.markRead(malta, engine.list(malta)[0].deliveryId);
  assert.strictEqual(engine.unreadCount(malta), 1);
});

check('mark-read is idempotent - marking the same delivery read twice does not error or double count', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e6', recipientLocationId: 2, title: 'a', body: 'b', deepLink: '/z' });
  const deliveryId = engine.list(malta)[0].deliveryId;
  const r1 = engine.markRead(malta, deliveryId);
  const r2 = engine.markRead(malta, deliveryId);
  assert.strictEqual(r1.ok, true);
  assert.strictEqual(r2.ok, true);
  assert.strictEqual(engine.unreadCount(malta), 0);
});

check('a store cannot mark another store\'s delivery as read', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e7', recipientLocationId: 2, title: 'for malta', body: 'b', deepLink: '/z' });
  const deliveryId = engine.list(malta)[0].deliveryId;
  const result = engine.markRead(sestri, deliveryId);
  assert.strictEqual(result.ok, false);
  assert.strictEqual(engine.unreadCount(malta), 1); // untouched
});

check('mark-all-read is scoped to the caller\'s own identity only', () => {
  const engine = new NotificationReferenceEngine();
  engine.enqueue({ eventType: 'GOODS_TO_PREPARE', dedupKey: 'e8', recipientLocationId: 2, title: 'a', body: 'b', deepLink: '/z' });
  engine.enqueue({ eventType: 'GOODS_READY', dedupKey: 'e9', recipientLocationId: 4, title: 'b', body: 'b', deepLink: '/z' });
  const result = engine.markAllRead(malta);
  assert.strictEqual(result.markedRead, 1);
  assert.strictEqual(engine.unreadCount(malta), 0);
  assert.strictEqual(engine.unreadCount(sestri), 1); // sestri's own unread notification is untouched
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
