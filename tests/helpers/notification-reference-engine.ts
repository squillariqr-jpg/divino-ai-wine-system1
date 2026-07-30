// Test-only in-memory reference model of the notification engine's core
// invariants (dedup, IN_APP fan-out, identity scoping, idempotent
// mark-read). This is NOT the shipped implementation - the real logic
// lives in SQL (supabase/migrations/20260729080500_rete_notification_engine_rpcs.sql)
// and could not be executed against a real Postgres this session (local
// Docker was unavailable, see the final report). This model mirrors that
// SQL's documented behavior closely enough to exercise the design's
// invariants deterministically and catch logic errors before they ever
// reach a real migration - it is not a substitute for RLS/RPC-level
// testing against a live database.
import type { NotificationEventType, NotificationPriority } from '../../lib/rete-squillari/notifications/types';

export interface Identity {
  role: 'store' | 'central';
  locationId: number | null;
  userId: string;
}

interface EventRow {
  id: string;
  eventType: NotificationEventType;
  dedupKey: string;
  recipientLocationId: number | null;
  recipientUserId: string | null;
  title: string;
  body: string;
  deepLink: string;
  priority: NotificationPriority;
  createdAt: number;
}

interface DeliveryRow {
  id: string;
  eventId: string;
  channel: 'IN_APP';
  readAt: number | null;
}

export class NotificationReferenceEngine {
  private events: EventRow[] = [];
  private deliveries: DeliveryRow[] = [];
  private seq = 0;

  private nextId(): string {
    this.seq += 1;
    return 'id-' + this.seq;
  }

  // Mirrors rete_notification_enqueue_event: returns the existing event id
  // on a duplicate dedup key without creating a second event or a second
  // IN_APP delivery.
  enqueue(input: {
    eventType: NotificationEventType;
    dedupKey: string;
    recipientLocationId?: number | null;
    recipientUserId?: string | null;
    title: string;
    body: string;
    deepLink: string;
    priority?: NotificationPriority;
  }): { eventId: string; created: boolean } {
    const existing = this.events.find((e) => e.dedupKey === input.dedupKey);
    if (existing) return { eventId: existing.id, created: false };

    const event: EventRow = {
      id: this.nextId(),
      eventType: input.eventType,
      dedupKey: input.dedupKey,
      recipientLocationId: input.recipientLocationId ?? null,
      recipientUserId: input.recipientUserId ?? null,
      title: input.title,
      body: input.body,
      deepLink: input.deepLink,
      priority: input.priority ?? 'NORMAL',
      createdAt: Date.now() + this.seq,
    };
    this.events.push(event);

    if (event.recipientLocationId != null || event.recipientUserId != null) {
      this.deliveries.push({ id: this.nextId(), eventId: event.id, channel: 'IN_APP', readAt: null });
    }
    return { eventId: event.id, created: true };
  }

  private visibleTo(event: EventRow, identity: Identity): boolean {
    if (identity.role === 'store') {
      return event.recipientLocationId != null && event.recipientLocationId === identity.locationId;
    }
    // central: only events explicitly addressed to this central user
    // (e.g. a routed SYSTEM_EXCEPTION) - never a store's general traffic.
    return event.recipientUserId != null && event.recipientUserId === identity.userId;
  }

  list(identity: Identity, opts: { unreadOnly?: boolean } = {}) {
    return this.deliveries
      .map((d) => ({ delivery: d, event: this.events.find((e) => e.id === d.eventId)! }))
      .filter(({ event }) => this.visibleTo(event, identity))
      .filter(({ delivery }) => !opts.unreadOnly || delivery.readAt == null)
      .sort((a, b) => b.event.createdAt - a.event.createdAt)
      .map(({ delivery, event }) => ({
        deliveryId: delivery.id, eventId: event.id, eventType: event.eventType,
        title: event.title, body: event.body, deepLink: event.deepLink, readAt: delivery.readAt,
      }));
  }

  unreadCount(identity: Identity): number {
    return this.list(identity, { unreadOnly: true }).length;
  }

  // Idempotent: marking an already-read (or nonexistent-for-this-identity)
  // delivery read again never errors and never double-counts.
  markRead(identity: Identity, deliveryId: string): { ok: boolean } {
    const delivery = this.deliveries.find((d) => d.id === deliveryId);
    if (!delivery) return { ok: false };
    const event = this.events.find((e) => e.id === delivery.eventId)!;
    if (!this.visibleTo(event, identity)) return { ok: false };
    if (delivery.readAt == null) delivery.readAt = Date.now();
    return { ok: true };
  }

  markAllRead(identity: Identity): { markedRead: number } {
    const unread = this.list(identity, { unreadOnly: true });
    for (const item of unread) this.markRead(identity, item.deliveryId);
    return { markedRead: unread.length };
  }
}
