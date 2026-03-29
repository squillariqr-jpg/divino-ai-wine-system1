import type {
  LeadCapturePayload,
  QuizAnswers,
  RecommendationResponse,
  ScoreMap,
  SegmentId
} from "@/lib/types";

export type LeadProfileRecord = {
  id: string;
  email: string;
  name?: string;
  segment?: SegmentId;
  scores?: ScoreMap;
  source: string;
  interest?: string;
  lastQuizAnswers?: QuizAnswers;
  createdAt: string;
  updatedAt: string;
};

export type WorkflowTriggerPayload = {
  lead: LeadCapturePayload;
  segment?: SegmentId;
  recommendation?: RecommendationResponse;
};

export type EditorialDraftPayload = {
  title: string;
  category: string;
  slug: string;
  summary: string;
};

// Future integration contracts:
// - Supabase adapter: implement LeadsRepository and store profile snapshots.
// - n8n adapter: implement WorkflowAutomationClient and trigger webhook-based sequences.
// - OpenClaw or another agent layer: implement RecommendationAgentClient to enrich
//   scoring, follow-up copy and next-best-action decisions while preserving the local fallback.
// - Notion adapter: implement EditorialBackofficeClient for optional editorial sync.
export interface LeadsRepository {
  upsertLead(payload: LeadCapturePayload): Promise<{ id: string }>;
  updateProfile(record: LeadProfileRecord): Promise<void>;
  findByEmail(email: string): Promise<LeadProfileRecord | null>;
}

export interface WorkflowAutomationClient {
  triggerLeadCapture(payload: WorkflowTriggerPayload): Promise<void>;
  triggerPostQuizFollowUp(payload: WorkflowTriggerPayload): Promise<void>;
}

export interface RecommendationAgentClient {
  scoreProfile(answers: QuizAnswers): Promise<RecommendationResponse>;
  draftFollowUp(payload: WorkflowTriggerPayload): Promise<{ subject: string; body: string }>;
}

export interface EditorialBackofficeClient {
  createDraft(payload: EditorialDraftPayload): Promise<{ id: string; url?: string }>;
  syncBrief(payload: EditorialDraftPayload): Promise<void>;
}
