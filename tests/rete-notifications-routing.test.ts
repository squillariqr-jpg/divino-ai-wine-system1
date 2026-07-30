// Cross-checks the TypeScript DEFAULT_ROUTING_MATRIX literal (used for
// testing/preview) against the literal seed rows actually written into
// supabase/migrations/20260729080100_rete_notification_routing_policy.sql -
// the two must never drift silently. Also asserts the specific routing
// facts the gate spec calls out by name. Static/text-based, since local
// Docker (and therefore a real Postgres to query the seeded table
// directly) was not available this session - see the final report.
import assert from 'node:assert';
import fs from 'node:fs';
import path from 'node:path';
import { DEFAULT_ROUTING_MATRIX } from '../lib/rete-squillari/notifications/types';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

const migrationPath = path.join(__dirname, '..', 'supabase', 'migrations', '20260729080100_rete_notification_routing_policy.sql');
const migrationSql = fs.readFileSync(migrationPath, 'utf8');

function parseSeedRows(sql: string): Array<{ eventType: string; channel: string; mode: string }> {
  const rows: Array<{ eventType: string; channel: string; mode: string }> = [];
  const rowRe = /\('([A-Z_]+)',\s*'(IN_APP|WEB_PUSH|EMAIL|WHATSAPP)',\s*'([A-Z_]+)'\)/g;
  let m: RegExpExecArray | null;
  while ((m = rowRe.exec(sql))) {
    rows.push({ eventType: m[1], channel: m[2], mode: m[3] });
  }
  return rows;
}

check('the routing seed migration file exists and contains INSERT rows', () => {
  assert.ok(migrationSql.includes('rete_notification_routing_defaults'));
  const rows = parseSeedRows(migrationSql);
  assert.ok(rows.length >= 19 * 4, 'expected at least one row per (event_type, channel) pair, got ' + rows.length);
});

check('every (event_type, channel) pair in the TS matrix has an identical mode in the SQL seed', () => {
  const rows = parseSeedRows(migrationSql);
  const sqlByKey = new Map(rows.map((r) => [r.eventType + ':' + r.channel, r.mode]));
  for (const [eventType, channels] of Object.entries(DEFAULT_ROUTING_MATRIX)) {
    for (const [channel, mode] of Object.entries(channels)) {
      const sqlMode = sqlByKey.get(eventType + ':' + channel);
      assert.strictEqual(sqlMode, mode, `${eventType}/${channel}: TS says ${mode}, SQL seed says ${sqlMode}`);
    }
  }
});

check('IN_APP is YES for every currently defined event type (never disabled by default)', () => {
  for (const [eventType, channels] of Object.entries(DEFAULT_ROUTING_MATRIX)) {
    assert.strictEqual(channels.IN_APP, 'YES', eventType + ' IN_APP should default to YES');
  }
});

check('WEB_PUSH is enabled only for urgent operational events, never for excess publication', () => {
  assert.strictEqual(DEFAULT_ROUTING_MATRIX.GOODS_TO_PREPARE.WEB_PUSH, 'YES');
  assert.strictEqual(DEFAULT_ROUTING_MATRIX.OFFER_AUTO_ACCEPTED.WEB_PUSH, 'YES');
  assert.strictEqual(DEFAULT_ROUTING_MATRIX.EXCESS_STOCK_PUBLISHED.WEB_PUSH, 'NO');
  assert.strictEqual(DEFAULT_ROUTING_MATRIX.OFFER_RECEIVED.WEB_PUSH, 'NO');
});

check('WHATSAPP is never YES for any event type - only NO or OPTIONAL_DISABLED', () => {
  for (const [eventType, channels] of Object.entries(DEFAULT_ROUTING_MATRIX)) {
    assert.notStrictEqual(channels.WHATSAPP, 'YES', eventType + ' WHATSAPP must never default to YES');
    assert.ok(['NO', 'OPTIONAL_DISABLED'].includes(channels.WHATSAPP), eventType + ' WHATSAPP has unexpected mode ' + channels.WHATSAPP);
  }
});

check('EMAIL is DIGEST for ordinary events and IMMEDIATE only for the central system exception', () => {
  assert.strictEqual(DEFAULT_ROUTING_MATRIX.SYSTEM_EXCEPTION.EMAIL, 'IMMEDIATE');
  for (const [eventType, channels] of Object.entries(DEFAULT_ROUTING_MATRIX)) {
    if (eventType === 'SYSTEM_EXCEPTION') continue;
    assert.strictEqual(channels.EMAIL, 'DIGEST', eventType + ' EMAIL should default to DIGEST');
  }
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
