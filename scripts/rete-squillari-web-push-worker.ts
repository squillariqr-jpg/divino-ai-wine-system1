#!/usr/bin/env node
// One-shot Web Push outbox sender. Claims a batch of PENDING deliveries via
// rete_push_claim_pending_deliveries (FOR UPDATE SKIP LOCKED - safe for a
// single active worker instance), resolves the subscription's endpoint/
// keys and the event's title/body/deep link (service_role only, direct
// table reads - never exposed to any authenticated grant), sends via the
// injectable adapter, and records the outcome with
// rete_push_record_delivery_result. NOT scheduled by this file - no cron,
// no setInterval, no timer. Uncertain sends are never auto-retried; a
// permanent failure (404/410-equivalent) revokes the subscription.
//
// Usage: npx tsx scripts/rete-squillari-web-push-worker.ts [--dry-run] [--limit N]
import { createClient } from '@supabase/supabase-js';
import { createWebPushAdapter, MockWebPushAdapter, PushRateLimiter, type PushProviderAdapter } from '../lib/rete-squillari/notifications/push-adapter';
import { maskPushEndpoint } from '../lib/rete-squillari/notifications/redact';
import { resolveStoredDeepLink } from '../lib/rete-squillari/whatsapp/deep-link';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key);
}

async function main() {
  const args = process.argv.slice(2);
  const dryRun = args.includes('--dry-run');
  const limitArg = args.find((a) => a.startsWith('--limit'));
  const limit = limitArg ? Number(limitArg.split('=')[1] || args[args.indexOf(limitArg) + 1]) : 20;

  // In-app-first rollout gate: the channel must be BOTH configured
  // (VAPID keys present, checked by createWebPushAdapter()) AND
  // explicitly enabled - never active solely because credentials exist.
  // --dry-run bypasses this (it never sends for real either way) so the
  // worker's claim/route/rate-limit logic can still be exercised locally.
  if (!dryRun && process.env.RETE_NOTIFICATIONS_WEB_PUSH_ENABLED !== 'true') {
    console.log(JSON.stringify({ WORKER_RUN: false, REASON: 'RETE_NOTIFICATIONS_WEB_PUSH_ENABLED is not "true"', CLAIMED_COUNT: 0 }));
    return;
  }

  const supabase = getSupabase();
  const adapter: PushProviderAdapter = dryRun ? new MockWebPushAdapter() : createWebPushAdapter();
  const rateLimiter = new PushRateLimiter();

  const { data: claimed, error: claimErr } = await supabase.rpc('rete_push_claim_pending_deliveries', { p_limit: limit });
  if (claimErr) throw new Error('claim failed: ' + claimErr.message);
  const deliveries = (claimed || []) as Array<{ id: string; notification_event_id: string; recipient_reference: string }>;

  console.log(JSON.stringify({ WORKER_RUN: true, DRY_RUN: dryRun, CLAIMED_COUNT: deliveries.length }));

  for (const delivery of deliveries) {
    const subscriptionId = delivery.recipient_reference.split(':')[1];
    const rateCheck = rateLimiter.checkAndConsume(subscriptionId, delivery.notification_event_id);
    if (!rateCheck.allowed) {
      await supabase.rpc('rete_push_record_delivery_result', { p_delivery_id: delivery.id, p_outcome: 'TEMPORARY', p_error_code: rateCheck.reason });
      continue;
    }

    const { data: sub } = await supabase
      .from('rete_push_subscriptions')
      .select('endpoint_ciphertext, p256dh, auth_secret, revoked_at')
      .eq('id', subscriptionId)
      .single();
    if (!sub || sub.revoked_at) {
      await supabase.rpc('rete_push_record_delivery_result', { p_delivery_id: delivery.id, p_outcome: 'PERMANENT', p_error_code: 'SUBSCRIPTION_REVOKED' });
      continue;
    }

    const { data: event } = await supabase
      .from('rete_notification_events')
      .select('title, body, deep_link, priority')
      .eq('id', delivery.notification_event_id)
      .single();
    if (!event) {
      await supabase.rpc('rete_push_record_delivery_result', { p_delivery_id: delivery.id, p_outcome: 'PERMANENT', p_error_code: 'EVENT_NOT_FOUND' });
      continue;
    }

    const result = await adapter.send(
      { endpoint: sub.endpoint_ciphertext, p256dh: sub.p256dh, authSecret: sub.auth_secret },
      { title: event.title, body: event.body, deepLink: resolveStoredDeepLink(event.deep_link), priority: event.priority, notificationId: delivery.notification_event_id }
    );

    console.log(JSON.stringify({ delivery_id: delivery.id, endpoint: maskPushEndpoint(sub.endpoint_ciphertext), outcome: result.outcome }));
    await supabase.rpc('rete_push_record_delivery_result', { p_delivery_id: delivery.id, p_outcome: result.outcome, p_error_code: result.errorCode });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
