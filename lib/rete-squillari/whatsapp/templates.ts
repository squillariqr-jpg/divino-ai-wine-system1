import type { WhatsAppEventType } from './types';

// Canonical, not-yet-submitted-to-Meta Utility template bodies. Placeholder
// numbering ({{1}}, {{2}}, ...) matches Meta's own WhatsApp template syntax
// exactly, so these strings can be pasted into Meta's template submission
// form unchanged once a WABA exists. The CTA button URL is always the deep
// link, rendered separately - never counted in the body's own {{n}} numbering,
// matching how a real WhatsApp URL-button component works.
export const TEMPLATE_BODIES: Record<string, string> = {
  rete_offerta_ricevuta_v1: 'Rete Squillari: {{1}} ha offerto {{2}} unità di {{3}} per la tua richiesta.',
  rete_merce_da_preparare_v1: 'Rete Squillari: prepara {{1}} unità di {{2}} per {{3}}.',
  rete_merce_pronta_v1: 'Rete Squillari: {{1}} unità di {{2}} sono pronte, in arrivo da {{3}}.',
  rete_trasferimento_partito_v1: 'Rete Squillari: il trasferimento di {{1}} unità di {{2}} con {{3}} è partito.',
  rete_merce_ricevuta_v1: 'Rete Squillari: {{3}} ha ricevuto {{1}} unità di {{2}}.',
  rete_arrivo_trasta_v1: 'Rete Squillari: sono arrivate {{1}} unità di {{2}}.\nRestano da trovare: {{3}}.',
  rete_richiesta_annullata_v1: 'Rete Squillari: la richiesta per {{1}} non è più disponibile - è stata annullata.',
  rete_eccezione_operativa_v1: 'Rete Squillari: si è verificata un\'eccezione operativa da verificare: {{1}}.',
};

export const TEMPLATE_BUTTON_LABEL = 'Apri la scheda';

export const EVENT_TEMPLATE_NAME: Record<WhatsAppEventType, string | null> = {
  OFFER_RECEIVED: 'rete_offerta_ricevuta_v1',
  OFFER_AUTO_ACCEPTED: null, // no trigger point yet - automatic offer acceptance is not implemented
  GOODS_TO_PREPARE: 'rete_merce_da_preparare_v1',
  GOODS_READY: 'rete_merce_pronta_v1',
  TRANSFER_STARTED: 'rete_trasferimento_partito_v1',
  TRANSFER_RECEIVED: 'rete_merce_ricevuta_v1',
  TRASTA_PARTIAL_ARRIVAL: 'rete_arrivo_trasta_v1',
  TRASTA_FULL_ARRIVAL: 'rete_arrivo_trasta_v1',
  REQUEST_CANCELLED: 'rete_richiesta_annullata_v1',
  SYSTEM_EXCEPTION: 'rete_eccezione_operativa_v1', // designed, no wired trigger point in this pilot (no central WhatsApp contact configured)
  // Excess stock reuses the existing templates - same message shapes
  // (quantity/product/counterpart store), no new Meta template needed.
  EXCESS_STOCK_PUBLISHED: null, // deliberately unwired - Phase 10: no immediate broadcast on publish
  EXCESS_STOCK_RESERVED: 'rete_offerta_ricevuta_v1',
  EXCESS_STOCK_PARTIALLY_RESERVED: 'rete_merce_da_preparare_v1',
  EXCESS_STOCK_FULLY_RESERVED: 'rete_merce_da_preparare_v1',
  EXCESS_GOODS_TO_PREPARE: 'rete_merce_da_preparare_v1',
  EXCESS_TRANSFER_STARTED: 'rete_trasferimento_partito_v1',
  EXCESS_TRANSFER_RECEIVED: 'rete_merce_ricevuta_v1',
  EXCESS_STOCK_EXPIRED: 'rete_richiesta_annullata_v1',
  EXCESS_STOCK_WITHDRAWN: 'rete_richiesta_annullata_v1',
};

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bpin\b/i,
  /token/i,
  /password/i,
  /\bcredenzial/i,
  /costo\s*fornitore/i,
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // raw UUID
];

export function escapeTemplateParameter(value: string): string {
  // WhatsApp template parameters cannot contain newlines/tabs or the
  // literal "{{"/"}}" sequence (Meta rejects these at send time); strip
  // them defensively rather than let a malformed parameter reach the API.
  return String(value ?? '')
    .replace(/[\n\t\r]/g, ' ')
    .replace(/\{\{|\}\}/g, '')
    .trim()
    .slice(0, 300);
}

export function assertNoSecretLikeContent(parameters: string[]): void {
  for (const p of parameters) {
    for (const pattern of FORBIDDEN_PATTERNS) {
      if (pattern.test(p)) {
        throw new Error(`WhatsApp template parameter rejected: matches forbidden pattern ${pattern}`);
      }
    }
  }
}

export function renderTemplateBody(templateName: string, parameters: string[]): string {
  const body = TEMPLATE_BODIES[templateName];
  if (!body) throw new Error(`Unknown WhatsApp template: ${templateName}`);
  assertNoSecretLikeContent(parameters);
  let rendered = body;
  parameters.forEach((raw, index) => {
    const escaped = escapeTemplateParameter(raw);
    rendered = rendered.split(`{{${index + 1}}}`).join(escaped);
  });
  return rendered;
}

export function renderFullMessagePreview(templateName: string, parameters: string[], deepLink: string): string {
  const body = renderTemplateBody(templateName, parameters);
  return `${body}\n\n${TEMPLATE_BUTTON_LABEL}:\n${deepLink}`;
}

export interface ResolvedTemplateContext {
  quantity?: number | null;
  remainingQuantity?: number | null;
  productDescription?: string | null;
  counterpartStoreName?: string | null;
  toStoreName?: string | null;
  detail?: string | null;
}

// Maps the generic resolved-name/quantity context to the exact positional
// {{n}} order each template body expects. Keyed by template_name (not event
// type) since TRASTA_PARTIAL_ARRIVAL/TRASTA_FULL_ARRIVAL intentionally share
// one template.
export function buildTemplateParameters(templateName: string, ctx: ResolvedTemplateContext): string[] {
  const qty = ctx.quantity != null ? String(ctx.quantity) : '';
  const product = ctx.productDescription ?? '';
  switch (templateName) {
    case 'rete_offerta_ricevuta_v1':
      return [ctx.counterpartStoreName ?? '', qty, product];
    case 'rete_merce_da_preparare_v1':
    case 'rete_merce_pronta_v1':
    case 'rete_trasferimento_partito_v1':
      return [qty, product, ctx.counterpartStoreName ?? ''];
    case 'rete_merce_ricevuta_v1':
      return [qty, product, ctx.toStoreName ?? ''];
    case 'rete_arrivo_trasta_v1':
      return [qty, product, ctx.remainingQuantity != null ? String(ctx.remainingQuantity) : '0'];
    case 'rete_richiesta_annullata_v1':
      return [product];
    case 'rete_eccezione_operativa_v1':
      return [ctx.detail ?? ''];
    default:
      throw new Error(`No parameter mapping defined for template: ${templateName}`);
  }
}
