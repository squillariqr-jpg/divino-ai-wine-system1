import type { SegmentId } from "@/lib/types";

export type EmailIntent =
  | "wine_advice"
  | "fit_check"
  | "price_objection"
  | "human_help"
  | "unknown";

export type AgentMailInboundMessage = {
  inbox_id: string;
  thread_id: string;
  message_id: string;
  from: string;
  to: string[];
  subject: string;
  text: string;
  extracted_text?: string;
  in_reply_to?: string;
  timestamp: string;
};

export type AgentMailWebhookPayload = {
  type: "event";
  event_type: "message.received" | string;
  event_id: string;
  message: AgentMailInboundMessage;
  thread: {
    inbox_id: string;
    thread_id: string;
    subject: string;
    senders: string[];
    message_count: number;
  };
};

export type ClassificationResult = {
  intent: EmailIntent;
  confidence: "high" | "medium" | "low";
  matchedKeywords: string[];
};

export type LeadContext = {
  leadId?: string;
  name?: string;
  segment?: SegmentId;
  productName?: string;
  emailsSent?: number;
};

export type ReplyContext = {
  inboundMessage: AgentMailInboundMessage;
  intent: ClassificationResult;
  lead: LeadContext;
};

export type SafetyCheckResult = {
  approved: boolean;
  wordCount: number;
  ctaCount: number;
  reasons: string[];
};

export type AgentReply = {
  subject: string;
  text: string;
  approved: boolean;
  intent: EmailIntent;
  safetyCheck: SafetyCheckResult;
};
