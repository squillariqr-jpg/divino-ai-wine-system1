#!/usr/bin/env node
// One-shot WhatsApp outbox sender. Claims a batch of PENDING/RETRY
// notification events, resolves display names/product info, sends via the
// provider adapter, and records the outcome. NOT scheduled by this file -
// no cron, no setInterval, no timer. Activating a recurring run is an
// explicit, separate, future gate (per Phase 13 of the pilot plan).
//
// Usage: npx tsx scripts/rete-squillari-whatsapp-worker.ts [--dry-run] [--limit N]
import { createClient } from '@supabase/supabase-js';
import { createWhatsAppAdapter, MockWhatsAppAdapter } from '../lib/rete-squillari/whatsapp/adapter';
import { buildTemplateParameters, renderTemplateBody } from '../lib/rete-squillari/whatsapp/templates';
import { resolveStoredDeepLink } from '../lib/rete-squillari/whatsapp/deep-link';
import type { WhatsAppNotificationEventRow } from '../lib/rete-squillari/whatsapp/types';

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

  const supabase = getSupabase();
  const adapter = dryRun ? new MockWhatsAppAdapter() : createWhatsAppAdapter();

  const { data: claimed, error: claimErr } = await supabase.rpc('rete_whatsapp_claim_pending_events', { p_limit: limit });
  if (claimErr) throw new Error('claim failed: ' + claimErr.message);
  const events = (claimed || []) as WhatsAppNotificationEventRow[];

  console.log(JSON.stringify({ WORKER_RUN: true, DRY_RUN: dryRun, CLAIMED_COUNT: events.length }));

  const locationCache = new Map<number, string>();
  async function locationName(id: number): Promise<string> {
    if (locationCache.has(id)) return locationCache.get(id)!;
    const { data } = await supabase.from('rete_locations').select('name').eq('id', id).single();
    const name = data?.name || `Sede ${id}`;
    locationCache.set(id, name);
    return name;
  }

  const requestCache = new Map<string, { product_code: string; product_description: string }>();
  async function requestInfo(requestId: string) {
    if (requestCache.has(requestId)) return requestCache.get(requestId)!;
    const { data } = await supabase.from('rete_requests').select('product_code, product_description').eq('id', requestId).single();
    const info = { product_code: data?.product_code || '', product_description: data?.product_description || '' };
    requestCache.set(requestId, info);
    return info;
  }

  let sent = 0, failed = 0, retried = 0, skippedNoContact = 0;

  for (const event of events) {
    const { data: contact } = await supabase
      .from('rete_whatsapp_contacts')
      .select('phone_e164, opt_in_status, active, whatsapp_enabled')
      .eq('location_id', event.recipient_location_id)
      .maybeSingle();

    if (!contact || contact.opt_in_status !== 'OPTED_IN' || !contact.active || !contact.whatsapp_enabled) {
      // Contact state changed between enqueue and send (e.g. opted out
      // after this row was created but before the opt-out reclassification
      // UPDATE ran) - fail closed, never send, record as a permanent skip.
      await supabase.rpc('rete_whatsapp_record_send_result', {
        p_event_id: event.id, p_success: false, p_error_code: 'NO_ELIGIBLE_CONTACT',
        p_error_redacted: 'recipient not opted-in/active at send time', p_is_permanent_error: true,
      });
      skippedNoContact++;
      continue;
    }

    const params = event.template_parameters as Record<string, unknown>;
    const quantity = typeof params.quantity === 'number' ? params.quantity : null;
    const remainingQuantity = typeof params.remaining_quantity === 'number' ? params.remaining_quantity : null;
    const counterpartLocationId = typeof params.counterpart_location_id === 'number' ? params.counterpart_location_id : null;
    const toLocationId = typeof params.to_location_id === 'number' ? params.to_location_id : null;

    const productDescription = event.request_id ? (await requestInfo(event.request_id)).product_description : null;
    const counterpartStoreName = counterpartLocationId != null ? await locationName(counterpartLocationId) : null;
    const toStoreName = toLocationId != null ? await locationName(toLocationId) : null;

    const orderedParams = buildTemplateParameters(event.template_name, {
      quantity, remainingQuantity, productDescription, counterpartStoreName, toStoreName,
    });
    const deepLink = resolveStoredDeepLink(event.deep_link);
    const bodyPreview = renderTemplateBody(event.template_name, orderedParams);

    const result = await adapter.sendUtilityTemplate({
      phoneE164: contact.phone_e164,
      templateName: event.template_name,
      languageCode: 'it',
      parameters: orderedParams,
      deepLink,
      idempotencyKey: event.deduplication_key,
    });

    await supabase.rpc('rete_whatsapp_record_send_result', {
      p_event_id: event.id,
      p_success: result.success,
      p_provider_message_id: result.providerMessageId,
      p_error_code: result.errorCode,
      p_error_redacted: result.errorRedacted,
      p_is_permanent_error: result.isPermanentError,
      p_max_attempts: 5,
      p_backoff_seconds: 60,
    });

    if (result.success) sent++;
    else if (result.isPermanentError || event.attempt_count >= 5) failed++;
    else retried++;

    console.log(JSON.stringify({ event_id: event.id, event_type: event.event_type, success: result.success, bodyPreview }));
  }

  console.log(JSON.stringify({ WORKER_SUMMARY: { sent, failed, retried, skippedNoContact, total: events.length } }));
}

main().then(() => process.exit(0)).catch((e) => { console.error('WORKER_FATAL', e.message || e); process.exit(1); });
