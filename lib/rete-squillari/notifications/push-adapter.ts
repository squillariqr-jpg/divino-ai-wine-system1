import crypto from 'crypto';
import { redactPushError } from './redact';

export interface PushSubscriptionTarget {
  endpoint: string;
  p256dh: string; // base64url, uncompressed P-256 point (65 bytes)
  authSecret: string; // base64url, 16 bytes
}

export interface PushPayload {
  title: string;
  body: string;
  deepLink: string;
  priority: 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';
  notificationId: string;
}

export type PushOutcome = 'SUCCESS' | 'TEMPORARY' | 'PERMANENT' | 'UNCERTAIN';

export interface PushSendResult {
  outcome: PushOutcome;
  httpStatus: number | null;
  errorCode: string | null;
}

export interface PushProviderAdapter {
  send(target: PushSubscriptionTarget, payload: PushPayload): Promise<PushSendResult>;
}

function base64UrlToBuffer(value: string): Buffer {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
  return Buffer.from(padded, 'base64');
}

function bufferToBase64Url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function hkdfExtract(salt: Buffer, ikm: Buffer): Buffer {
  return crypto.createHmac('sha256', salt).update(ikm).digest();
}

function hkdfExpand(prk: Buffer, info: Buffer, length: number): Buffer {
  if (length > 32) throw new Error('hkdfExpand: single-block expand only supports up to 32 bytes');
  return crypto.createHmac('sha256', prk).update(Buffer.concat([info, Buffer.from([1])])).digest().subarray(0, length);
}

export interface EncryptedPushMessage {
  body: Buffer;
  serverPublicKey: Buffer;
}

// RFC 8291 (Message Encryption for Web Push) + RFC 8188 (aes128gcm content
// encoding) - the standards-based encryption every browser push service
// (Chrome/FCM, Firefox/autopush, Edge) requires. Pure function, no network -
// safe to unit test byte-for-byte without a live subscription.
export function encryptWebPushPayload(plaintext: Buffer, target: PushSubscriptionTarget): EncryptedPushMessage {
  const clientPublicKey = base64UrlToBuffer(target.p256dh);
  const authSecret = base64UrlToBuffer(target.authSecret);
  if (clientPublicKey.length !== 65) throw new Error('p256dh must be a 65-byte uncompressed P-256 point');
  if (authSecret.length !== 16) throw new Error('authSecret must be 16 bytes');

  const ecdh = crypto.createECDH('prime256v1');
  ecdh.generateKeys();
  const serverPublicKey = ecdh.getPublicKey(undefined, 'uncompressed') as unknown as Buffer;
  const sharedSecret = ecdh.computeSecret(clientPublicKey);

  const salt = crypto.randomBytes(16);

  const prkKey = hkdfExtract(authSecret, sharedSecret);
  const keyInfo = Buffer.concat([Buffer.from('WebPush: info\0', 'utf8'), clientPublicKey, serverPublicKey]);
  const ikm = hkdfExpand(prkKey, keyInfo, 32);

  const prk = hkdfExtract(salt, ikm);
  const cek = hkdfExpand(prk, Buffer.from('Content-Encoding: aes128gcm\0', 'utf8'), 16);
  const nonce = hkdfExpand(prk, Buffer.from('Content-Encoding: nonce\0', 'utf8'), 12);

  const padded = Buffer.concat([plaintext, Buffer.from([2])]); // delimiter octet, single record, no extra padding
  const cipher = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const ciphertext = Buffer.concat([cipher.update(padded), cipher.final()]);
  const tag = cipher.getAuthTag();

  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096, 0);
  const idLen = Buffer.from([serverPublicKey.length]);

  const header = Buffer.concat([salt, recordSize, idLen, serverPublicKey]);
  return { body: Buffer.concat([header, ciphertext, tag]), serverPublicKey };
}

// RFC 8292 VAPID JWT - proves to the push service that this server owns
// the key pair named in the subscription's original permission grant.
export function buildVapidAuthorizationHeader(
  endpoint: string,
  subjectMailto: string,
  vapidPublicKeyB64Url: string,
  vapidPrivateKeyB64Url: string
): string {
  const { origin } = new URL(endpoint);
  const header = { typ: 'JWT', alg: 'ES256' };
  const payload = { aud: origin, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: subjectMailto };
  const encHeader = bufferToBase64Url(Buffer.from(JSON.stringify(header)));
  const encPayload = bufferToBase64Url(Buffer.from(JSON.stringify(payload)));
  const signingInput = `${encHeader}.${encPayload}`;

  const publicKeyBytes = base64UrlToBuffer(vapidPublicKeyB64Url);
  const x = publicKeyBytes.subarray(1, 33);
  const y = publicKeyBytes.subarray(33, 65);
  const d = base64UrlToBuffer(vapidPrivateKeyB64Url);

  const jwk = { kty: 'EC', crv: 'P-256', d: bufferToBase64Url(d), x: bufferToBase64Url(x), y: bufferToBase64Url(y) };
  const keyObject = crypto.createPrivateKey({ key: jwk, format: 'jwk' } as unknown as { key: string; format: 'pem' });
  const signature = crypto.sign('sha256', Buffer.from(signingInput), { key: keyObject, dsaEncoding: 'ieee-p1363' });

  return `vapid t=${signingInput}.${bufferToBase64Url(signature)}, k=${vapidPublicKeyB64Url}`;
}

function priorityToUrgency(priority: PushPayload['priority']): string {
  switch (priority) {
    case 'URGENT': return 'high';
    case 'HIGH': return 'high';
    case 'LOW': return 'low';
    default: return 'normal';
  }
}

const REQUEST_TIMEOUT_MS = 10_000;

// Server-side only, real network adapter. Never imported by anything
// under public/ - reads VAPID key material exclusively from process.env,
// matching MetaCloudApiAdapter's own server-only pattern. NEVER used by
// the test suite (MockWebPushAdapter is) and never invoked during this
// gate - no worker is scheduled, no test exercises .send().
export class WebPushAdapter implements PushProviderAdapter {
  private readonly publicKey: string;
  private readonly privateKey: string;
  private readonly subject: string;

  constructor() {
    const publicKey = process.env.RETE_WEB_PUSH_VAPID_PUBLIC_KEY;
    const privateKey = process.env.RETE_WEB_PUSH_VAPID_PRIVATE_KEY;
    const subject = process.env.RETE_WEB_PUSH_VAPID_SUBJECT || 'mailto:ai@divinomarket.it';
    if (!publicKey || !privateKey) {
      throw new Error('Web Push not configured: RETE_WEB_PUSH_VAPID_PUBLIC_KEY/RETE_WEB_PUSH_VAPID_PRIVATE_KEY missing');
    }
    this.publicKey = publicKey;
    this.privateKey = privateKey;
    this.subject = subject;
  }

  async send(target: PushSubscriptionTarget, payload: PushPayload): Promise<PushSendResult> {
    const plaintext = Buffer.from(JSON.stringify({
      title: payload.title,
      body: payload.body,
      deepLink: payload.deepLink,
      notificationId: payload.notificationId,
    }), 'utf8');

    const { body } = encryptWebPushPayload(plaintext, target);
    const authorization = buildVapidAuthorizationHeader(target.endpoint, this.subject, this.publicKey, this.privateKey);

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
    try {
      const res = await fetch(target.endpoint, {
        method: 'POST',
        headers: {
          'Content-Encoding': 'aes128gcm',
          'Content-Type': 'application/octet-stream',
          TTL: '86400',
          Urgency: priorityToUrgency(payload.priority),
          Authorization: authorization,
        },
        body,
        signal: controller.signal,
      });

      if (res.ok) {
        return { outcome: 'SUCCESS', httpStatus: res.status, errorCode: null };
      }
      if (res.status === 404 || res.status === 410) {
        return { outcome: 'PERMANENT', httpStatus: res.status, errorCode: `HTTP_${res.status}` };
      }
      if (res.status === 429 || res.status >= 500) {
        return { outcome: 'TEMPORARY', httpStatus: res.status, errorCode: `HTTP_${res.status}` };
      }
      return { outcome: 'PERMANENT', httpStatus: res.status, errorCode: `HTTP_${res.status}` };
    } catch (err) {
      const aborted = err instanceof Error && err.name === 'AbortError';
      return { outcome: 'UNCERTAIN', httpStatus: null, errorCode: aborted ? 'TIMEOUT' : redactPushError(err) };
    } finally {
      clearTimeout(timeout);
    }
  }
}

// Test/preview-only adapter. Records every call it would have made and
// NEVER performs network I/O - used by every automated test and the
// preview script, exactly like MockWhatsAppAdapter.
export class MockWebPushAdapter implements PushProviderAdapter {
  public readonly calls: Array<{ target: PushSubscriptionTarget; payload: PushPayload }> = [];
  private readonly forcedResult: Partial<PushSendResult> | undefined;

  constructor(forcedResult?: Partial<PushSendResult>) {
    this.forcedResult = forcedResult;
  }

  async send(target: PushSubscriptionTarget, payload: PushPayload): Promise<PushSendResult> {
    this.calls.push({ target, payload });
    return { outcome: 'SUCCESS', httpStatus: 201, errorCode: null, ...this.forcedResult };
  }
}

export function createWebPushAdapter(): PushProviderAdapter {
  return new WebPushAdapter();
}

// Simple in-memory rate limiter - one instance per worker process, which
// is consistent with the gate's "one active worker per channel" rule (no
// distributed rate-limit table is introduced; a second concurrent worker
// is prevented at the claim-RPC level via FOR UPDATE SKIP LOCKED, not by
// this limiter).
export class PushRateLimiter {
  private readonly dailyCounts = new Map<string, { day: string; count: number }>();
  private readonly eventCounts = new Map<string, number>();

  constructor(private readonly maxPerDayPerSubscription = 50, private readonly maxPerEventPerSubscription = 1) {}

  private today(now: Date): string {
    return now.toISOString().slice(0, 10);
  }

  checkAndConsume(subscriptionId: string, notificationEventId: string, now: Date = new Date()): { allowed: boolean; reason?: string } {
    const eventKey = `${subscriptionId}:${notificationEventId}`;
    const eventCount = this.eventCounts.get(eventKey) ?? 0;
    if (eventCount >= this.maxPerEventPerSubscription) {
      return { allowed: false, reason: 'PER_EVENT_LIMIT' };
    }

    const day = this.today(now);
    const daily = this.dailyCounts.get(subscriptionId);
    const dailyCount = daily && daily.day === day ? daily.count : 0;
    if (dailyCount >= this.maxPerDayPerSubscription) {
      return { allowed: false, reason: 'DAILY_LIMIT' };
    }

    this.eventCounts.set(eventKey, eventCount + 1);
    this.dailyCounts.set(subscriptionId, { day, count: dailyCount + 1 });
    return { allowed: true };
  }
}
