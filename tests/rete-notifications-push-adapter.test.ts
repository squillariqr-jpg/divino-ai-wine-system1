// Pure unit tests for the Web Push encryption pipeline, mock adapter, rate
// limiter, and log redaction. Zero network calls - encryptWebPushPayload
// and buildVapidAuthorizationHeader are pure functions exercised against
// locally generated throwaway keys, never a real subscription.
import assert from 'node:assert';
import crypto from 'node:crypto';
import { encryptWebPushPayload, buildVapidAuthorizationHeader, MockWebPushAdapter, PushRateLimiter } from '../lib/rete-squillari/notifications/push-adapter';
import { maskPushEndpoint, maskEmailAddress, redactPushError } from '../lib/rete-squillari/notifications/redact';

let pass = 0, fail = 0;
function check(name: string, fn: () => void) {
  try { fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}
async function checkAsync(name: string, fn: () => Promise<void>) {
  try { await fn(); console.log('PASS - ' + name); pass++; }
  catch (e: any) { console.log('FAIL - ' + name + ' :: ' + e.message); fail++; }
}

function throwawaySubscription() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const p256dh = (ecdh.getPublicKey(undefined, 'uncompressed') as unknown as Buffer).toString('base64url');
  const authSecret = crypto.randomBytes(16).toString('base64url');
  return { endpoint: 'https://push.example.invalid/x', p256dh, authSecret };
}

function throwawayVapidKeypair() {
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const publicKey = (ecdh.getPublicKey(undefined, 'uncompressed') as unknown as Buffer).toString('base64url');
  const privateKey = (ecdh.getPrivateKey() as unknown as Buffer).toString('base64url');
  return { publicKey, privateKey };
}

check('encryptWebPushPayload produces a well-formed RFC 8188 aes128gcm record', () => {
  const target = throwawaySubscription();
  const plaintext = Buffer.from(JSON.stringify({ title: 'T', body: 'B', deepLink: '/x', notificationId: 'n' }));
  const { body, serverPublicKey } = encryptWebPushPayload(plaintext, target);

  assert.strictEqual(serverPublicKey.length, 65, 'ephemeral server public key must be an uncompressed 65-byte P-256 point');
  const salt = body.subarray(0, 16);
  const recordSize = body.readUInt32BE(16);
  const idLen = body.readUInt8(20);
  const keyId = body.subarray(21, 21 + idLen);
  assert.strictEqual(salt.length, 16);
  assert.strictEqual(recordSize, 4096);
  assert.strictEqual(idLen, 65);
  assert.deepStrictEqual(keyId, serverPublicKey);
  // ciphertext = plaintext + 1 delimiter byte + 16-byte GCM tag
  assert.strictEqual(body.length, 21 + idLen + plaintext.length + 1 + 16);
});

check('encryptWebPushPayload is non-deterministic across calls (fresh salt/ephemeral key each time)', () => {
  const target = throwawaySubscription();
  const plaintext = Buffer.from('same plaintext');
  const a = encryptWebPushPayload(plaintext, target);
  const b = encryptWebPushPayload(plaintext, target);
  assert.notDeepStrictEqual(a.body, b.body);
});

check('encryptWebPushPayload rejects malformed subscription keys', () => {
  assert.throws(() => encryptWebPushPayload(Buffer.from('x'), { endpoint: 'https://x', p256dh: Buffer.from([1, 2, 3]).toString('base64url'), authSecret: crypto.randomBytes(16).toString('base64url') }));
  assert.throws(() => encryptWebPushPayload(Buffer.from('x'), { endpoint: 'https://x', p256dh: throwawaySubscription().p256dh, authSecret: Buffer.from([1]).toString('base64url') }));
});

check('buildVapidAuthorizationHeader produces a vapid-scheme header with a 3-part JWT', () => {
  const { publicKey, privateKey } = throwawayVapidKeypair();
  const header = buildVapidAuthorizationHeader('https://push.example.invalid/endpoint-path', 'mailto:test@example.com', publicKey, privateKey);
  assert.ok(header.startsWith('vapid t='), header);
  assert.ok(header.includes(', k=' + publicKey), header);
  const jwt = header.slice('vapid t='.length, header.indexOf(', k='));
  assert.strictEqual(jwt.split('.').length, 3, 'JWT must have header.payload.signature');
  const [encHeader, encPayload] = jwt.split('.');
  const payload = JSON.parse(Buffer.from(encPayload, 'base64url').toString('utf8'));
  assert.strictEqual(payload.aud, 'https://push.example.invalid');
  assert.strictEqual(payload.sub, 'mailto:test@example.com');
  const jwtHeader = JSON.parse(Buffer.from(encHeader, 'base64url').toString('utf8'));
  assert.strictEqual(jwtHeader.alg, 'ES256');
});

async function main() {

await checkAsync('MockWebPushAdapter records calls and performs zero network I/O', async () => {
  const adapter = new MockWebPushAdapter();
  const target = throwawaySubscription();
  const result = await adapter.send(target, { title: 'T', body: 'B', deepLink: '/x', priority: 'HIGH', notificationId: 'n1' });
  assert.strictEqual(result.outcome, 'SUCCESS');
  assert.strictEqual(adapter.calls.length, 1);
  assert.strictEqual(adapter.calls[0].payload.notificationId, 'n1');
});

await checkAsync('MockWebPushAdapter honors a forced outcome (for exercising failure paths)', async () => {
  const adapter = new MockWebPushAdapter({ outcome: 'PERMANENT', httpStatus: 410, errorCode: 'HTTP_410' });
  const result = await adapter.send(throwawaySubscription(), { title: 'T', body: 'B', deepLink: '/x', priority: 'NORMAL', notificationId: 'n2' });
  assert.strictEqual(result.outcome, 'PERMANENT');
  assert.strictEqual(result.httpStatus, 410);
});

check('PushRateLimiter blocks a second push for the same (subscription, event) pair', () => {
  const limiter = new PushRateLimiter(50, 1);
  const first = limiter.checkAndConsume('sub-1', 'event-1');
  const second = limiter.checkAndConsume('sub-1', 'event-1');
  assert.strictEqual(first.allowed, true);
  assert.strictEqual(second.allowed, false);
  assert.strictEqual(second.reason, 'PER_EVENT_LIMIT');
});

check('PushRateLimiter enforces a daily cap across distinct events', () => {
  const limiter = new PushRateLimiter(2, 10);
  const now = new Date('2026-07-29T10:00:00Z');
  assert.strictEqual(limiter.checkAndConsume('sub-2', 'event-a', now).allowed, true);
  assert.strictEqual(limiter.checkAndConsume('sub-2', 'event-b', now).allowed, true);
  const third = limiter.checkAndConsume('sub-2', 'event-c', now);
  assert.strictEqual(third.allowed, false);
  assert.strictEqual(third.reason, 'DAILY_LIMIT');
});

check('PushRateLimiter resets the daily cap on a new day', () => {
  const limiter = new PushRateLimiter(1, 10);
  const day1 = new Date('2026-07-29T23:00:00Z');
  const day2 = new Date('2026-07-30T01:00:00Z');
  assert.strictEqual(limiter.checkAndConsume('sub-3', 'event-a', day1).allowed, true);
  assert.strictEqual(limiter.checkAndConsume('sub-3', 'event-b', day1).allowed, false);
  assert.strictEqual(limiter.checkAndConsume('sub-3', 'event-c', day2).allowed, true);
});

check('maskPushEndpoint never returns the raw endpoint', () => {
  const raw = 'https://fcm.googleapis.com/fcm/send/super-secret-token-abc123';
  const masked = maskPushEndpoint(raw);
  assert.ok(!masked.includes('super-secret-token-abc123'));
  assert.ok(masked.includes('fcm.googleapis.com'));
});

check('maskEmailAddress never returns the raw local part', () => {
  const masked = maskEmailAddress('magazzino@sestri.example.com');
  assert.ok(!masked.startsWith('magazzino@'));
  assert.ok(masked.endsWith('@sestri.example.com'));
});

check('redactPushError strips URLs and long key-like tokens from error messages', () => {
  const redacted = redactPushError(new Error('failed for https://fcm.googleapis.com/fcm/send/abc with key AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ'));
  assert.ok(!redacted.includes('fcm.googleapis.com'));
  assert.ok(!redacted.includes('AAAABBBBCCCCDDDDEEEEFFFFGGGGHHHHIIIIJJJJ'));
});

console.log(JSON.stringify({ PASS: pass, FAIL: fail }));
if (fail > 0) process.exitCode = 1;
}

main();
