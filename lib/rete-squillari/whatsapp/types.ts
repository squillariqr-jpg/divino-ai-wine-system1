export type WhatsAppEventType =
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

export type WhatsAppNotificationStatus =
  | 'PENDING'
  | 'SENDING'
  | 'SENT'
  | 'RETRY'
  | 'FAILED'
  | 'SKIPPED_NO_OPT_IN'
  | 'SKIPPED_DISABLED';

export type WhatsAppOptInStatus = 'PENDING' | 'OPTED_IN' | 'OPTED_OUT';

export type WhatsAppOptInSource =
  | 'SIGNED_FORM'
  | 'EMAIL_CONFIRMATION'
  | 'WHATSAPP_INITIATED_MESSAGE'
  | 'MANUAL_RECORDED_CONSENT';

export interface WhatsAppNotificationEventRow {
  id: string;
  event_type: WhatsAppEventType;
  recipient_location_id: number;
  request_id: string | null;
  offer_id: string | null;
  transfer_id: string | null;
  template_name: string;
  template_parameters: Record<string, unknown>;
  deep_link: string;
  deduplication_key: string;
  available_at: string;
  status: WhatsAppNotificationStatus;
  attempt_count: number;
  last_attempt_at: string | null;
  sent_at: string | null;
  provider_message_id: string | null;
  last_error_code: string | null;
  last_error_redacted: string | null;
  created_at: string;
}

export interface SendUtilityTemplateInput {
  phoneE164: string;
  templateName: string;
  languageCode: string;
  parameters: string[];
  deepLink: string;
  idempotencyKey: string;
}

export interface SendUtilityTemplateResult {
  success: boolean;
  providerMessageId: string | null;
  errorCode: string | null;
  errorRedacted: string | null;
  isPermanentError: boolean;
}

export interface WhatsAppProviderAdapter {
  sendUtilityTemplate(input: SendUtilityTemplateInput): Promise<SendUtilityTemplateResult>;
}
