export type NotificationEventType =
  | 'OFFER_RECEIVED'
  | 'OFFER_AUTO_ACCEPTED'
  | 'GOODS_TO_PREPARE'
  | 'GOODS_READY'
  | 'TRANSFER_STARTED'
  | 'TRANSFER_RECEIVED'
  | 'TRASTA_PARTIAL_ARRIVAL'
  | 'TRASTA_FULL_ARRIVAL'
  | 'REQUEST_CANCELLED'
  | 'SYSTEM_EXCEPTION'
  | 'EXCESS_STOCK_PUBLISHED'
  | 'EXCESS_STOCK_RESERVED'
  | 'EXCESS_STOCK_PARTIALLY_RESERVED'
  | 'EXCESS_STOCK_FULLY_RESERVED'
  | 'EXCESS_GOODS_TO_PREPARE'
  | 'EXCESS_TRANSFER_STARTED'
  | 'EXCESS_TRANSFER_RECEIVED'
  | 'EXCESS_STOCK_EXPIRED'
  | 'EXCESS_STOCK_WITHDRAWN';

export type NotificationPriority = 'LOW' | 'NORMAL' | 'HIGH' | 'URGENT';

export type NotificationChannel = 'IN_APP' | 'WEB_PUSH' | 'EMAIL' | 'WHATSAPP';

export type RoutingMode = 'YES' | 'NO' | 'DIGEST' | 'IMMEDIATE' | 'OPTIONAL_DISABLED';

export type DeliveryStatus =
  | 'PENDING'
  | 'READY'
  | 'SENDING'
  | 'DELIVERED'
  | 'READ'
  | 'SKIPPED_DISABLED'
  | 'SKIPPED_NO_DESTINATION'
  | 'SKIPPED_NO_CONSENT'
  | 'FAILED_TEMPORARY'
  | 'FAILED_PERMANENT'
  | 'FAILED_UNCERTAIN';

export interface NotificationEventRow {
  id: string;
  event_type: NotificationEventType;
  event_reference: string | null;
  request_id: string | null;
  offer_id: string | null;
  transfer_id: string | null;
  excess_stock_id: string | null;
  reservation_id: string | null;
  recipient_location_id: number | null;
  recipient_user_id: string | null;
  title: string;
  body: string;
  deep_link: string;
  priority: NotificationPriority;
  created_at: string;
  expires_at: string | null;
  deduplication_key: string;
  payload_version: number;
}

export interface NotificationDeliveryRow {
  id: string;
  notification_event_id: string;
  channel: NotificationChannel;
  recipient_reference: string;
  status: DeliveryStatus;
  attempt_count: number;
  next_attempt_at: string | null;
  sent_at: string | null;
  read_at: string | null;
  error_code: string | null;
  created_at: string;
  updated_at: string;
}

// Mirrors supabase/migrations/20260729080100_rete_notification_routing_policy.sql
// exactly - keep the two in sync (tests/rete-notifications-routing.test.ts
// cross-checks this literal against the migration's seed rows).
export const DEFAULT_ROUTING_MATRIX: Record<NotificationEventType, Record<NotificationChannel, RoutingMode>> = {
  OFFER_RECEIVED: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  OFFER_AUTO_ACCEPTED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  GOODS_TO_PREPARE: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'OPTIONAL_DISABLED' },
  GOODS_READY: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  TRANSFER_STARTED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  TRANSFER_RECEIVED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  TRASTA_PARTIAL_ARRIVAL: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  TRASTA_FULL_ARRIVAL: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  REQUEST_CANCELLED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_STOCK_PUBLISHED: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_STOCK_RESERVED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_GOODS_TO_PREPARE: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_TRANSFER_STARTED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_TRANSFER_RECEIVED: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  SYSTEM_EXCEPTION: { IN_APP: 'YES', WEB_PUSH: 'YES', EMAIL: 'IMMEDIATE', WHATSAPP: 'NO' },
  EXCESS_STOCK_PARTIALLY_RESERVED: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_STOCK_FULLY_RESERVED: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_STOCK_EXPIRED: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
  EXCESS_STOCK_WITHDRAWN: { IN_APP: 'YES', WEB_PUSH: 'NO', EMAIL: 'DIGEST', WHATSAPP: 'NO' },
};
