#!/usr/bin/env node
// One-shot email digest sender. Claims the set of locations with at least
// one PENDING EMAIL delivery, claims that location's deliveries, renders
// one digest email, sends via the injectable adapter, and records the
// bulk result. NOT scheduled by this file - no cron, no setInterval, no
// timer. Never sends to an unverified or missing contact - the routing
// engine (20260729080500) already refuses to create a PENDING EMAIL
// delivery for those cases, so this worker only ever sees eligible rows.
//
// Usage: npx tsx scripts/rete-squillari-email-digest-send.ts [--dry-run]
import { createClient } from '@supabase/supabase-js';
import { createEmailAdapter, MockEmailAdapter, type EmailProviderAdapter } from '../lib/rete-squillari/notifications/email-adapter';
import { renderDigest, computeDigestHash } from '../lib/rete-squillari/notifications/digest';
import { maskEmailAddress } from '../lib/rete-squillari/notifications/redact';
import { RETE_SQUILLARI_APP_BASE } from '../lib/rete-squillari/whatsapp/deep-link';

function getSupabase() {
  const url = process.env.SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) throw new Error('SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY must be set');
  return createClient(url, key);
}

async function main() {
  const dryRun = process.argv.includes('--dry-run');

  // In-app-first rollout gate: the channel must be BOTH configured
  // (AgentMail credentials present, checked by createEmailAdapter()) AND
  // explicitly enabled - never active solely because credentials exist.
  // --dry-run bypasses this (it never sends for real either way) so the
  // worker's claim/render/digest logic can still be exercised locally.
  if (!dryRun && process.env.RETE_NOTIFICATIONS_EMAIL_ENABLED !== 'true') {
    console.log(JSON.stringify({ WORKER_RUN: false, REASON: 'RETE_NOTIFICATIONS_EMAIL_ENABLED is not "true"', LOCATIONS_WITH_PENDING: 0 }));
    return;
  }

  const supabase = getSupabase();
  const adapter: EmailProviderAdapter = dryRun ? new MockEmailAdapter() : createEmailAdapter();
  const dateISO = new Date().toISOString().slice(0, 10);

  const { data: locations, error: locErr } = await supabase.rpc('rete_email_digest_claim_locations');
  if (locErr) throw new Error('claim locations failed: ' + locErr.message);

  console.log(JSON.stringify({ WORKER_RUN: true, DRY_RUN: dryRun, LOCATIONS_WITH_PENDING: (locations || []).length }));

  for (const row of (locations || []) as Array<{ location_id: number }>) {
    const { data: deliveries, error: claimErr } = await supabase.rpc('rete_email_digest_claim_deliveries', { p_location_id: row.location_id });
    if (claimErr) { console.error('claim deliveries failed for location ' + row.location_id + ': ' + claimErr.message); continue; }
    const rows = (deliveries || []) as Array<{ delivery_id: string; event_type: string; title: string; body: string; deep_link: string; created_at: string }>;
    if (rows.length === 0) continue;

    const { data: contact } = await supabase.from('rete_notification_contacts').select('email_address').eq('location_id', row.location_id).single();
    const { data: location } = await supabase.from('rete_locations').select('name').eq('id', row.location_id).single();
    if (!contact?.email_address || !location?.name) {
      await supabase.rpc('rete_email_digest_record_result', { p_delivery_ids: rows.map((r) => r.delivery_id), p_success: false, p_error_code: 'NO_DESTINATION' });
      continue;
    }

    const entries = rows.map((r) => ({ notificationId: r.delivery_id, eventType: r.event_type as any, title: r.title, body: r.body, deepLink: r.deep_link, createdAt: r.created_at }));
    const rendered = renderDigest(location.name, dateISO, entries, new URL(RETE_SQUILLARI_APP_BASE).origin);
    const hash = computeDigestHash(String(row.location_id), dateISO, rendered.notificationIds, rendered.subject);

    console.log(JSON.stringify({ location_id: row.location_id, destination: maskEmailAddress(contact.email_address), digest_hash: hash, entries: rows.length }));

    const sendResult = await adapter.send({ to: contact.email_address, subject: rendered.subject, text: rendered.textBody, html: rendered.htmlBody });
    await supabase.rpc('rete_email_digest_record_result', {
      p_delivery_ids: rows.map((r) => r.delivery_id),
      p_success: sendResult.success,
      p_error_code: sendResult.errorCode,
    });
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
