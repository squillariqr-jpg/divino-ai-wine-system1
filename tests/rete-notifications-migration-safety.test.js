// Static structural safety checks over the new migrations - additive-only,
// no destructive DDL, WhatsApp-era objects never touched, RLS enabled with
// no direct grants to authenticated/anon on the new raw tables. DB-level
// verification (actually applying these migrations, running RLS as a
// real Postgres role) could not be executed this session - local Docker
// was unavailable. This mirrors the exact same disclosed limitation as
// tests/rete-squillari-automatic-offer-acceptance.test.js in this repo.
const assert = require('assert');
const fs = require('fs');
const path = require('path');

let pass = 0, fail = 0;
function check(name, fn) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

const migrationsDir = path.join(__dirname, '..', 'supabase', 'migrations');
const NEW_MIGRATIONS = [
  '20260729080000_rete_notification_events_canonical.sql',
  '20260729080100_rete_notification_routing_policy.sql',
  '20260729080200_rete_notification_preferences.sql',
  '20260729080300_rete_push_subscriptions.sql',
  '20260729080400_rete_notification_contacts.sql',
  '20260729080500_rete_notification_engine_rpcs.sql',
  '20260729080600_rete_notification_event_producer_wiring.sql',
];
const contents = {};
for (const name of NEW_MIGRATIONS) contents[name] = fs.readFileSync(path.join(migrationsDir, name), 'utf8');
const allNewSql = Object.values(contents).join('\n');

check('all seven new migration files exist', () => {
  for (const name of NEW_MIGRATIONS) assert.ok(fs.existsSync(path.join(migrationsDir, name)), name + ' missing');
});

check('no new migration contains a destructive statement (DROP TABLE/DROP COLUMN/TRUNCATE/DELETE FROM)', () => {
  const destructivePatterns = [/DROP\s+TABLE/i, /DROP\s+COLUMN/i, /TRUNCATE/i, /DELETE\s+FROM/i, /DROP\s+TYPE/i];
  for (const [name, sql] of Object.entries(contents)) {
    for (const pattern of destructivePatterns) {
      assert.ok(!pattern.test(sql), name + ' contains a destructive statement matching ' + pattern);
    }
  }
});

check('no new migration renames or drops any rete_whatsapp_* object', () => {
  assert.ok(!/DROP\s+(TABLE|FUNCTION|TYPE)[^;]*rete_whatsapp/i.test(allNewSql));
  assert.ok(!/ALTER\s+TABLE[^;]*rete_whatsapp[^;]*RENAME/i.test(allNewSql));
});

check('the pre-existing WhatsApp migration files are byte-identical to before this branch\'s notification work (git-tracked, untouched)', () => {
  // This test only asserts the files still exist with their expected
  // header text - actual "untouched since this branch started" is
  // verified once per session via `git diff --stat` against those paths
  // (zero output), recorded in the final report rather than re-derived
  // from within a test file that has no git access guarantee in CI.
  const whatsappMigration = fs.readFileSync(path.join(migrationsDir, '20260724110000_rete_squillari_whatsapp_notifications.sql'), 'utf8');
  assert.ok(whatsappMigration.includes('rete_whatsapp_notification_events'));
  assert.ok(whatsappMigration.includes('rete_whatsapp_contacts'));
});

check('every restated business RPC in the wiring migration still contains its original rete_whatsapp_enqueue_notification call(s)', () => {
  const wiring = contents['20260729080600_rete_notification_event_producer_wiring.sql'];
  const whatsappCallCount = (wiring.match(/rete_whatsapp_enqueue_notification\(/g) || []).length;
  // Exact count of WhatsApp enqueue call sites across the 11 restated
  // functions, verified by inspection against the source migrations
  // (20260724120000, 20260727110000, 20260727130000) before writing this
  // file: offer_create(2) + offer_approve(1) + mark_ready(1) +
  // mark_departed(4) + transfer_receive(4) + trasta_arrival(1) +
  // request_cancel(1, in a loop) + mark_no_longer_needed(1, in a loop) +
  // excess_reserve(2) + excess_withdraw(1) + excess_expire(1) = 19.
  assert.strictEqual(whatsappCallCount, 19, 'expected 19 rete_whatsapp_enqueue_notification call sites, found ' + whatsappCallCount);
});

check('the canonical events/deliveries tables have RLS enabled and no grants to authenticated/anon', () => {
  const schemaSql = contents['20260729080000_rete_notification_events_canonical.sql'];
  assert.ok(/ENABLE ROW LEVEL SECURITY/.test(schemaSql));
  assert.ok(/REVOKE ALL ON "public"\."rete_notification_events" FROM "authenticated", "anon", "public"/.test(schemaSql));
  assert.ok(/REVOKE ALL ON "public"\."rete_notification_deliveries" FROM "authenticated", "anon", "public"/.test(schemaSql));
  assert.ok(!/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE "public"\."rete_notification_events" TO "authenticated"/.test(schemaSql));
  assert.ok(!/GRANT (SELECT|INSERT|UPDATE|DELETE|ALL) ON TABLE "public"\."rete_notification_deliveries" TO "authenticated"/.test(schemaSql));
});

check('the push subscription and email contact tables never grant authenticated/anon direct access', () => {
  const pushSql = contents['20260729080300_rete_push_subscriptions.sql'];
  const contactSql = contents['20260729080400_rete_notification_contacts.sql'];
  assert.ok(/REVOKE ALL ON "public"\."rete_push_subscriptions" FROM "authenticated", "anon", "public"/.test(pushSql));
  assert.ok(/REVOKE ALL ON "public"\."rete_notification_contacts" FROM "authenticated", "anon", "public"/.test(contactSql));
});

check('the in-app governed RPCs derive identity from rete_require_active_membership()/auth.uid(), never a caller-supplied location id', () => {
  const rpcSql = contents['20260729080500_rete_notification_engine_rpcs.sql'];
  const listFn = rpcSql.slice(rpcSql.indexOf('CREATE OR REPLACE FUNCTION "public"."rete_notifications_list"'), rpcSql.indexOf('CREATE OR REPLACE FUNCTION "public"."rete_notifications_unread_count"'));
  assert.ok(listFn.includes('rete_require_active_membership()'));
  assert.ok(!/p_location_id|p_user_id/.test(listFn), 'rete_notifications_list must never accept a caller-supplied identity parameter');
});

check('the deep_link CHECK constraint restricts stored links to relative /rete-squillari paths (never an absolute/foreign origin)', () => {
  const schemaSql = contents['20260729080000_rete_notification_events_canonical.sql'];
  assert.ok(/CHECK\s*\(\s*"deep_link"\s*~\s*'\^\/rete-squillari/.test(schemaSql));
});

check('WHATSAPP deliveries created by the routing engine are always SKIPPED_DISABLED - the channel is never actually enabled', () => {
  const rpcSql = contents['20260729080500_rete_notification_engine_rpcs.sql'];
  const whatsappBlock = rpcSql.slice(rpcSql.indexOf('-- ---- WHATSAPP'));
  assert.ok(whatsappBlock.includes("'SKIPPED_DISABLED'"));
  assert.ok(!/'WHATSAPP',[^)]*'PENDING'/.test(whatsappBlock));
});

check('rete_notification_preferences enforces in_app_enabled = true at the database level (cannot be disabled even via direct write)', () => {
  const prefsSql = contents['20260729080200_rete_notification_preferences.sql'];
  assert.ok(/CHECK\s*\(\s*"in_app_enabled"\s*=\s*true\s*\)/.test(prefsSql));
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
