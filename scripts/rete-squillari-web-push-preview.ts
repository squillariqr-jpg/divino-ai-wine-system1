#!/usr/bin/env node
// Network-free Web Push preview generator (Phase 13). Builds one of four
// fixture payloads, encrypts it against a locally-generated throwaway
// P-256 subscription keypair (never a real subscriber), and reports the
// resulting title/body/deep link/priority/payload size. Sends nothing -
// no fetch call is ever made by this script.
//
// Usage: npx tsx scripts/rete-squillari-web-push-preview.ts --fixture <1-4>
import crypto from 'crypto';
import { renderNotificationCopy } from '../lib/rete-squillari/notifications/copy';
import { encryptWebPushPayload } from '../lib/rete-squillari/notifications/push-adapter';
import type { NotificationEventType, NotificationPriority } from '../lib/rete-squillari/notifications/types';

interface Fixture {
  id: number;
  label: string;
  eventType: NotificationEventType;
  priority: NotificationPriority;
  deepLink: string;
  ctx: Parameters<typeof renderNotificationCopy>[1];
}

const FIXTURES: Fixture[] = [
  {
    id: 1,
    label: 'merce da preparare',
    eventType: 'GOODS_TO_PREPARE',
    priority: 'HIGH',
    deepLink: '/rete-squillari?transfer=11111111-1111-4111-8111-111111111111',
    ctx: { own_name: 'Malta', quantity: 2, product: 'Liquore Basilico Allara' },
  },
  {
    id: 2,
    label: 'trasferimento partito',
    eventType: 'TRANSFER_STARTED',
    priority: 'HIGH',
    deepLink: '/rete-squillari?transfer=22222222-2222-4222-8222-222222222222',
    ctx: { counterpart_name: 'De Ferrari', quantity: 4, product: 'Vermentino Gallura', direction: 'DEPARTING' },
  },
  {
    id: 3,
    label: 'arrivo completo a Trasta',
    eventType: 'TRASTA_FULL_ARRIVAL',
    priority: 'HIGH',
    deepLink: '/rete-squillari?request=33333333-3333-4333-8333-333333333333',
    ctx: {},
  },
  {
    id: 4,
    label: 'eccedenza prenotata',
    eventType: 'EXCESS_STOCK_RESERVED',
    priority: 'HIGH',
    deepLink: '/rete-squillari?transfer=44444444-4444-4444-8444-444444444444',
    ctx: { counterpart_name: 'Sestri', quantity: 1, product: 'Vermentino Gallura' },
  },
];

function generateThrowawaySubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const p256dh = (ecdh.getPublicKey(undefined, 'uncompressed') as unknown as Buffer).toString('base64url');
  const authSecret = crypto.randomBytes(16).toString('base64url');
  return { endpoint: 'https://push.example.invalid/throwaway-preview-subscription', p256dh, authSecret };
}

function main() {
  const args = process.argv.slice(2);
  const idx = args.indexOf('--fixture');
  const fixtureId = idx >= 0 ? Number(args[idx + 1]) : NaN;
  const fixture = FIXTURES.find((f) => f.id === fixtureId);
  if (!fixture) {
    console.log('Usage: npx tsx scripts/rete-squillari-web-push-preview.ts --fixture <1-4>');
    console.log('Fixtures: 1=merce da preparare, 2=trasferimento partito, 3=arrivo completo a Trasta, 4=eccedenza prenotata');
    process.exitCode = 1;
    return;
  }

  const copy = renderNotificationCopy(fixture.eventType, fixture.ctx);
  const subscription = generateThrowawaySubscription();
  const plaintext = Buffer.from(JSON.stringify({ title: copy.title, body: copy.body, deepLink: fixture.deepLink, notificationId: 'preview' }), 'utf8');
  const { body } = encryptWebPushPayload(plaintext, subscription);

  console.log('TITLE:');
  console.log(copy.title);
  console.log('BODY:');
  console.log(copy.body);
  console.log('DEEPLINK:');
  console.log(fixture.deepLink);
  console.log('PRIORITY:');
  console.log(fixture.priority);
  console.log('PAYLOAD_SIZE:');
  console.log(body.length + ' bytes (encrypted aes128gcm wire payload)');
  console.log('VALID:');
  console.log(body.length > 0 && body.length < 4096 ? 'YES' : 'NO');
  console.log('NETWORK_CONNECTION:');
  console.log('NO');
  console.log('PUSH_SENT:');
  console.log('NO');
}

main();
