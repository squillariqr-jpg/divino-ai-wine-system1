#!/usr/bin/env node
// Read-only preview generator. Builds sample WhatsApp message text for
// Malta/Sestri/De Ferrari using real (but unmodified) open-request data.
// Sends nothing - never touches the adapter, never calls Meta, never
// writes to the outbox.
import { getSupabase } from '../lib/supabase';
import { buildTemplateParameters, renderFullMessagePreview } from '../lib/rete-squillari/whatsapp/templates';
import { buildDeepLink } from '../lib/rete-squillari/whatsapp/deep-link';

async function main() {
  const supabase = getSupabase();
  const { data: locs } = await supabase.from('rete_locations').select('id, code, name');
  const byCode = new Map((locs || []).map((l: any) => [String(l.code), l]));
  const malta = byCode.get('2');
  const sestri = byCode.get('4');
  const deFerrari = byCode.get('7');

  async function oneOpenRequest(locationId: number) {
    const { data } = await supabase
      .from('rete_requests')
      .select('id, product_code, product_description, remaining_quantity')
      .eq('requesting_location_id', locationId)
      .eq('status', 'DA_TROVARE')
      .limit(1)
      .maybeSingle();
    return data;
  }

  const maltaReq = await oneOpenRequest(malta.id);
  const sestriReq = await oneOpenRequest(sestri.id);
  const deFerrariReq = await oneOpenRequest(deFerrari.id);

  const previews: Record<string, string> = {};

  // OFFERTA RICEVUTA -> Malta's request, offered by Sestri
  if (maltaReq) {
    const link = buildDeepLink('request', maltaReq.id);
    const params = buildTemplateParameters('rete_offerta_ricevuta_v1', {
      counterpartStoreName: sestri.name, quantity: 4, productDescription: maltaReq.product_description,
    });
    previews['MALTA — OFFERTA RICEVUTA'] = renderFullMessagePreview('rete_offerta_ricevuta_v1', params, link);
  }

  // MERCE DA PREPARARE -> Sestri prepares for De Ferrari
  if (sestriReq) {
    const link = buildDeepLink('request', sestriReq.id);
    const params = buildTemplateParameters('rete_merce_da_preparare_v1', {
      quantity: 4, productDescription: sestriReq.product_description, counterpartStoreName: deFerrari.name,
    });
    previews['SESTRI — MERCE DA PREPARARE'] = renderFullMessagePreview('rete_merce_da_preparare_v1', params, link);
  }

  // TRASFERIMENTO PARTITO -> De Ferrari <-> Malta
  if (deFerrariReq) {
    const link = buildDeepLink('request', deFerrariReq.id);
    const params = buildTemplateParameters('rete_trasferimento_partito_v1', {
      quantity: 2, productDescription: deFerrariReq.product_description, counterpartStoreName: malta.name,
    });
    previews['DE FERRARI — TRASFERIMENTO PARTITO'] = renderFullMessagePreview('rete_trasferimento_partito_v1', params, link);
  }

  // ARRIVO PARZIALE A TRASTA -> Malta
  if (maltaReq) {
    const link = buildDeepLink('request', maltaReq.id);
    const params = buildTemplateParameters('rete_arrivo_trasta_v1', {
      quantity: 2, productDescription: maltaReq.product_description, remainingQuantity: 4,
    });
    previews['MALTA — ARRIVO PARZIALE A TRASTA'] = renderFullMessagePreview('rete_arrivo_trasta_v1', params, link);
  }

  // ARRIVO COMPLETO A TRASTA -> Sestri
  if (sestriReq) {
    const link = buildDeepLink('request', sestriReq.id);
    const params = buildTemplateParameters('rete_arrivo_trasta_v1', {
      quantity: sestriReq.remaining_quantity, productDescription: sestriReq.product_description, remainingQuantity: 0,
    });
    previews['SESTRI — ARRIVO COMPLETO A TRASTA'] = renderFullMessagePreview('rete_arrivo_trasta_v1', params, link);
  }

  console.log(JSON.stringify({ PREVIEW_NOTIFICATIONS: previews, REAL_MESSAGES_SENT: 0 }, null, 2));
}

main().then(() => process.exit(0)).catch((e) => { console.error('PREVIEW_FATAL', e.message || e); process.exit(1); });
