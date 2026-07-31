#!/usr/bin/env node
// Read-only email digest preview (Phase 12). Renders the exact Italian
// subject/body for one store's daily digest, lists included notification
// ids, shows a masked (or NOT_CONFIGURED) destination, and computes a
// digest hash - performs zero sends and zero writes of any kind. Because
// the notification schema in this branch has not been applied to any
// database (production or local) as part of this gate, this preview
// renders from fixture data representative of each store's real request/
// transfer/excess activity rather than a live query - the same
// zero-writes, zero-sends guarantee either way.
//
// Usage: npx tsx scripts/rete-squillari-email-digest-preview.ts --location <code> --date <YYYY-MM-DD>
import { randomUUID } from 'crypto';
import { renderNotificationCopy } from '../lib/rete-squillari/notifications/copy';
import { renderDigest, computeDigestHash, maskedDestination, type DigestEntryInput } from '../lib/rete-squillari/notifications/digest';
import { RETE_SQUILLARI_APP_BASE } from '../lib/rete-squillari/whatsapp/deep-link';
import type { NotificationEventType } from '../lib/rete-squillari/notifications/types';

interface StoreFixture {
  code: string;
  name: string;
  configuredEmail: string | null;
  events: Array<{ eventType: NotificationEventType; ctx: Parameters<typeof renderNotificationCopy>[1]; deepLink: string }>;
}

const STORES: StoreFixture[] = [
  {
    code: '2',
    name: 'Malta',
    configuredEmail: null,
    events: [
      { eventType: 'GOODS_TO_PREPARE', ctx: { own_name: 'Malta', quantity: 2, product: 'Liquore Basilico Allara' }, deepLink: '/rete-squillari?transfer=aaaaaaaa-0000-4000-8000-000000000001' },
      { eventType: 'TRASTA_PARTIAL_ARRIVAL', ctx: { quantity: 3, product: 'Vermentino Gallura', remaining_quantity: 1 }, deepLink: '/rete-squillari?request=aaaaaaaa-0000-4000-8000-000000000002' },
    ],
  },
  {
    code: '4',
    name: 'Sestri',
    configuredEmail: 'magazzino@sestri.example.com',
    events: [
      { eventType: 'EXCESS_STOCK_RESERVED', ctx: { counterpart_name: 'Malta', quantity: 1, product: 'Vermentino Gallura' }, deepLink: '/rete-squillari?transfer=bbbbbbbb-0000-4000-8000-000000000001' },
      { eventType: 'TRANSFER_RECEIVED', ctx: { to_name: 'Sestri', quantity: 4, product: 'Rossese di Dolceacqua' }, deepLink: '/rete-squillari?transfer=bbbbbbbb-0000-4000-8000-000000000002' },
    ],
  },
  {
    code: '7',
    name: 'De Ferrari',
    configuredEmail: 'ordini@deferrari.example.com',
    events: [
      { eventType: 'TRANSFER_STARTED', ctx: { counterpart_name: 'De Ferrari', quantity: 4, product: 'Vermentino Gallura', direction: 'ARRIVING' }, deepLink: '/rete-squillari?transfer=cccccccc-0000-4000-8000-000000000001' },
    ],
  },
];

function parseArgs(argv: string[]) {
  const locIdx = argv.indexOf('--location');
  const dateIdx = argv.indexOf('--date');
  return {
    location: locIdx >= 0 ? argv[locIdx + 1] : null,
    date: dateIdx >= 0 ? argv[dateIdx + 1] : new Date().toISOString().slice(0, 10),
  };
}

function renderStore(store: StoreFixture, dateISO: string) {
  const entries: DigestEntryInput[] = store.events.map((e) => {
    const copy = renderNotificationCopy(e.eventType, e.ctx);
    return { notificationId: randomUUID(), eventType: e.eventType, title: copy.title, body: copy.body, deepLink: e.deepLink, createdAt: `${dateISO}T08:00:00Z` };
  });
  const rendered = renderDigest(store.name, dateISO, entries, new URL(RETE_SQUILLARI_APP_BASE).origin);
  const hash = computeDigestHash(store.code, dateISO, rendered.notificationIds, rendered.subject);

  console.log('STORE:');
  console.log(store.name);
  console.log('EVENTS_INCLUDED:');
  console.log(rendered.notificationIds.length + ' (' + rendered.notificationIds.join(', ') + ')');
  console.log('SUBJECT:');
  console.log(rendered.subject);
  console.log('BODY_PREVIEW:');
  console.log(rendered.textBody);
  console.log('DESTINATION:');
  console.log(maskedDestination(store.configuredEmail));
  console.log('DIGEST_HASH:');
  console.log(hash);
  console.log('REAL_EMAIL_SENT:');
  console.log('NO');
  console.log('---');
}

function main() {
  const { location, date } = parseArgs(process.argv.slice(2));
  const targets = location ? STORES.filter((s) => s.code === location) : STORES;
  if (targets.length === 0) {
    console.log('Unknown --location code. Known fixture codes: ' + STORES.map((s) => s.code).join(', '));
    process.exitCode = 1;
    return;
  }
  for (const store of targets) renderStore(store, date);
}

main();
