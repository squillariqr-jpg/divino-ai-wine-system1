// Pure unit tests for digest grouping, rendering, hashing, and destination
// masking - no database, no network, no real send (MockEmailAdapter is
// the only adapter ever exercised here).
import assert from 'node:assert';
import { groupDigestEntries, renderDigest, computeDigestHash, maskedDestination, DIGEST_SUBJECT, type DigestEntryInput } from '../lib/rete-squillari/notifications/digest';
import { MockEmailAdapter } from '../lib/rete-squillari/notifications/email-adapter';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

function entry(overrides: Partial<DigestEntryInput>): DigestEntryInput {
  return { notificationId: 'n', eventType: 'GOODS_TO_PREPARE', title: 't', body: 'b', deepLink: '/rete-squillari', createdAt: '2026-07-29T08:00:00Z', ...overrides };
}

check('entries are grouped into the correct sections, in the fixed section order', () => {
  const entries = [
    entry({ notificationId: '1', eventType: 'EXCESS_STOCK_RESERVED' }),
    entry({ notificationId: '2', eventType: 'GOODS_TO_PREPARE' }),
    entry({ notificationId: '3', eventType: 'TRASTA_FULL_ARRIVAL' }),
    entry({ notificationId: '4', eventType: 'SYSTEM_EXCEPTION' }),
  ];
  const groups = groupDigestEntries(entries);
  assert.deepStrictEqual(groups.map((g) => g.section), ['DA_PREPARARE', 'ARRIVI_A_TRASTA', 'ECCEDENZE', 'ECCEZIONI']);
  assert.strictEqual(groups.find((g) => g.section === 'DA_PREPARARE')!.entries[0].notificationId, '2');
});

check('an event included in the digest appears exactly once, in exactly one section', () => {
  const entries = [entry({ notificationId: 'dup-1', eventType: 'GOODS_READY' })];
  const groups = groupDigestEntries(entries);
  const occurrences = groups.flatMap((g) => g.entries).filter((e) => e.notificationId === 'dup-1');
  assert.strictEqual(occurrences.length, 1);
});

check('renderDigest uses the exact required Italian subject', () => {
  const rendered = renderDigest('Malta', '2026-07-29', [entry({})], 'https://divino-ai-wine-system1.vercel.app');
  assert.strictEqual(rendered.subject, DIGEST_SUBJECT);
  assert.strictEqual(DIGEST_SUBJECT, 'Rete Squillari - riepilogo operativo del giorno');
});

check('renderDigest with zero entries still produces a valid, non-empty body', () => {
  const rendered = renderDigest('Malta', '2026-07-29', [], 'https://divino-ai-wine-system1.vercel.app');
  assert.ok(rendered.textBody.includes('Nessuna novita'));
  assert.strictEqual(rendered.notificationIds.length, 0);
});

check('renderDigest never includes supplier prices, phone numbers, or attachments-shaped content', () => {
  const rendered = renderDigest('Malta', '2026-07-29', [
    entry({ notificationId: 'p1', eventType: 'GOODS_TO_PREPARE', body: 'Malta deve preparare 2 unità di Liquore Basilico Allara.' }),
  ], 'https://divino-ai-wine-system1.vercel.app');
  assert.ok(!/costo\s*fornitore/i.test(rendered.textBody));
  assert.ok(!/\b\d{7,15}\b/.test(rendered.textBody));
  assert.ok(!rendered.htmlBody.includes('<img'));
});

check('computeDigestHash is deterministic for the same inputs and changes when notification ids change', () => {
  const h1 = computeDigestHash('2', '2026-07-29', ['a', 'b'], DIGEST_SUBJECT);
  const h2 = computeDigestHash('2', '2026-07-29', ['b', 'a'], DIGEST_SUBJECT); // order-independent
  const h3 = computeDigestHash('2', '2026-07-29', ['a', 'c'], DIGEST_SUBJECT);
  assert.strictEqual(h1, h2);
  assert.notStrictEqual(h1, h3);
  assert.strictEqual(h1.length, 64);
});

check('maskedDestination reports NOT_CONFIGURED when no contact exists, masked otherwise', () => {
  assert.strictEqual(maskedDestination(null), 'NOT_CONFIGURED');
  const masked = maskedDestination('magazzino@sestri.example.com');
  assert.notStrictEqual(masked, 'NOT_CONFIGURED');
  assert.ok(!masked.startsWith('magazzino@'));
});

async function main() {
  await checkAsync('MockEmailAdapter never performs a real send and records the exact rendered content', async () => {
    const adapter = new MockEmailAdapter();
    const rendered = renderDigest('Sestri', '2026-07-29', [entry({})], 'https://divino-ai-wine-system1.vercel.app');
    const result = await adapter.send({ to: 'magazzino@sestri.example.com', subject: rendered.subject, text: rendered.textBody, html: rendered.htmlBody });
    assert.strictEqual(result.success, true);
    assert.strictEqual(adapter.calls.length, 1);
    assert.strictEqual(adapter.calls[0].subject, DIGEST_SUBJECT);
  });

  console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
  if (fail > 0) process.exitCode = 1;
}

main();
