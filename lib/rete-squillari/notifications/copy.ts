import type { NotificationEventType } from './types';

export interface NotificationCopyContext {
  quantity?: number | string | null;
  product?: string | null;
  counterpart_name?: string | null;
  own_name?: string | null;
  to_name?: string | null;
  remaining_quantity?: number | string | null;
  detail?: string | null;
  direction?: 'DEPARTING' | 'ARRIVING' | null;
}

export interface RenderedNotificationCopy {
  title: string;
  body: string;
}

// Mirrors public.rete_notification_render_copy in
// supabase/migrations/20260729080500_rete_notification_engine_rpcs.sql
// string-for-string - the SQL function is the one that actually writes
// title/body into rete_notification_events at enqueue time (a plain RLS
// RPC can't do a service-role join to resolve store names later), so this
// TS copy exists purely so the exact Italian strings can be unit-tested
// and reused by the read-only preview CLIs without a database. Keep the
// two in sync - tests/rete-notifications-copy.test.ts checks both this
// module's output AND the literal strings inside the migration file.
export function renderNotificationCopy(eventType: NotificationEventType, ctx: NotificationCopyContext): RenderedNotificationCopy {
  const qty = ctx.quantity != null ? String(ctx.quantity) : '';
  const product = ctx.product ?? '';
  const counterpart = ctx.counterpart_name ?? '';
  const own = ctx.own_name ?? '';
  const to = ctx.to_name ?? '';
  const remaining = ctx.remaining_quantity != null ? String(ctx.remaining_quantity) : '0';
  const detail = ctx.detail ?? '';
  const direction = ctx.direction ?? 'ARRIVING';

  switch (eventType) {
    case 'OFFER_RECEIVED':
      return { title: 'Nuova offerta', body: `${counterpart} ha offerto ${qty} unità di ${product} per la tua richiesta.` };
    case 'OFFER_AUTO_ACCEPTED':
      return { title: 'Offerta accettata', body: `${counterpart} fornirà ${qty} unità di ${product} per la tua richiesta.` };
    case 'GOODS_TO_PREPARE':
    case 'EXCESS_GOODS_TO_PREPARE':
      return { title: 'Merce da preparare', body: `${own} deve preparare ${qty} unità di ${product}.` };
    case 'GOODS_READY':
      return { title: 'Merce pronta', body: `${qty} unità di ${product} sono pronte, in arrivo da ${counterpart}.` };
    case 'TRANSFER_STARTED':
    case 'EXCESS_TRANSFER_STARTED':
      return {
        title: 'Trasferimento partito',
        body: direction === 'DEPARTING' ? `Il trasferimento verso ${counterpart} è partito.` : `Il trasferimento da ${counterpart} è partito.`,
      };
    case 'TRANSFER_RECEIVED':
    case 'EXCESS_TRANSFER_RECEIVED':
      return { title: 'Merce ricevuta', body: `${to} ha ricevuto ${qty} unità di ${product}.` };
    case 'TRASTA_PARTIAL_ARRIVAL':
      return { title: 'Arrivo parziale a Trasta', body: `Sono arrivate ${qty} unità di ${product} a Trasta. Restano da trovare: ${remaining}.` };
    case 'TRASTA_FULL_ARRIVAL':
      return { title: 'Arrivo completo a Trasta', body: 'Arrivo completo a Trasta: richiesta coperta.' };
    case 'REQUEST_CANCELLED':
      return { title: 'Richiesta annullata', body: `La richiesta per ${product} non è più disponibile - è stata annullata.` };
    case 'EXCESS_STOCK_PUBLISHED':
      return { title: 'Nuova eccedenza', body: `${own} ha pubblicato ${qty} unità di ${product} in eccedenza.` };
    case 'EXCESS_STOCK_RESERVED':
      return { title: 'Eccedenza prenotata', body: `${counterpart} ha prenotato ${qty} unità dalla tua eccedenza.` };
    case 'EXCESS_STOCK_PARTIALLY_RESERVED':
      return { title: 'Eccedenza parzialmente prenotata', body: `${counterpart} ha prenotato ${qty} unità dalla tua eccedenza (parziale).` };
    case 'EXCESS_STOCK_FULLY_RESERVED':
      return { title: 'Eccedenza esaurita', body: `La tua eccedenza di ${product} è stata interamente prenotata.` };
    case 'EXCESS_STOCK_EXPIRED':
      return { title: 'Eccedenza scaduta', body: `La tua eccedenza di ${product} è scaduta e non è più visibile.` };
    case 'EXCESS_STOCK_WITHDRAWN':
      return { title: 'Eccedenza ritirata', body: `Hai ritirato la tua eccedenza di ${product}.` };
    case 'SYSTEM_EXCEPTION':
      return { title: 'Eccezione operativa', body: `Si è verificata un'eccezione operativa da verificare: ${detail}.` };
    default: {
      const _exhaustive: never = eventType;
      throw new Error(`No copy defined for event_type: ${_exhaustive}`);
    }
  }
}

const FORBIDDEN_PATTERNS: RegExp[] = [
  /\bpin\b/i,
  /token/i,
  /password/i,
  /\bcredenzial/i,
  /costo\s*fornitore/i,
  /\b\d{7,15}\b/, // phone-number-shaped digit runs
  /\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/i, // raw UUID
];

export function assertNoForbiddenContent(text: string): void {
  for (const pattern of FORBIDDEN_PATTERNS) {
    if (pattern.test(text)) {
      throw new Error(`Notification content rejected: matches forbidden pattern ${pattern}`);
    }
  }
}
