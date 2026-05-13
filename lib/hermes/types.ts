import type {
  QuizAnswers,
  RecommendationResponse,
  SegmentId,
  Wine
} from "@/lib/types";

export type AgentName =
  | "segment_agent"
  | "sommelier_agent"
  | "business_agent"
  | "content_agent"
  | "sales_agent"
  | "buyer_agent"
  | "memory_agent";

export type AgentTask =
  | "segment_user"
  | "diagnose_wine_profile"
  | "diagnose_business_growth"
  | "generate_content"
  | "convert_lead"
  | "orient_buyer"
  | "persist_memory";

export type HermesSegment = "appassionato" | "business" | "buyer";

export type BusinessSystemId =
  | "acquisition"
  | "retention"
  | "automation"
  | "content";

export type BusinessQuizAnswers = {
  businessType:
    | "creator-media"
    | "cantina-enoteca"
    | "horeca-buyer"
    | "consulenza-distribuzione";
  mainProblem:
    | "acquisizione-instabile"
    | "clienti-non-ritornano"
    | "processi-manuali"
    | "contenuti-incostanti";
  systemLevel:
    | "nessun-sistema"
    | "parziale"
    | "frammentato"
    | "strutturato";
  toolsUsed:
    | "manuale"
    | "contenuti-base"
    | "crm-automation"
    | "stack-misto";
  mainGoal:
    | "piu-lead"
    | "piu-riacquisti"
    | "piu-automazione"
    | "piu-contenuti";
};

export type RecommendFlow = "consumer" | "business" | "buyer";

export type RecommendRequestContext = {
  flow?: RecommendFlow;
  source?: string;
  businessQuizAnswers?: BusinessQuizAnswers;
  professionalIntent?: "buyer" | "sommelier";
};

export type RecommendRequestPayload = QuizAnswers & {
  context?: RecommendRequestContext;
};

export type LeadProfile = {
  source: string;
  quizFlow: RecommendFlow | "unknown";
  segment?: SegmentId;
  level?: QuizAnswers["level"];
  goal?: QuizAnswers["goal"];
  taste?: QuizAnswers["taste"];
  budget?: QuizAnswers["budget"];
  businessType?: BusinessQuizAnswers["businessType"];
  businessProblem?: BusinessQuizAnswers["mainProblem"];
  systemLevel?: BusinessQuizAnswers["systemLevel"];
  toolsUsed?: BusinessQuizAnswers["toolsUsed"];
  businessGoal?: BusinessQuizAnswers["mainGoal"];
  name?: string;
  email?: string;
  interest?: string;
  quizResult?: string;
};

export type AgentSystemRecommendation = {
  name: string;
  summary: string;
  features?: string[];
  benefits?: string[];
};

export type WorkflowActionCode =
  | "send_email_offer"
  | "send_followup"
  | "send_content"
  | "send_sales_offer"
  | "send_buyer_brief";

export type OpenWebUITemplateId =
  | "divino_email"
  | "divino_wine_sheet"
  | "divino_social"
  | "divino_sales";

export type OpenWebUIJobType =
  | "email"
  | "wine_sheet"
  | "social_post"
  | "sales_offer";

export type OpenWebUIJob = {
  jobType: OpenWebUIJobType;
  templateId: OpenWebUITemplateId;
  title: string;
  goal: string;
  variables: Record<string, string>;
};

export type MemorySnapshot = {
  profileTag: string;
  preferences: string[];
  history: string[];
  nextActions: string[];
  lastUpdatedAt: string;
};

export type SegmentAgentOutput = {
  userSegment: HermesSegment;
  rationale: string[];
};

export type AgentDecision = {
  orchestrator: "hermes_orchestrator";
  agentName: AgentName;
  supportingAgents: AgentName[];
  task: AgentTask;
  userSegment: HermesSegment;
  segmentRationale: string[];
  segment?: SegmentId;
  systemKey?: string;
  profileLabel: string;
  diagnosis: string;
  rationale: string[];
  recommendedSystem?: AgentSystemRecommendation;
  recommendedContent?: {
    title: string;
    description: string;
  };
  wineStyleSummary?: string;
  suggestedWines?: Wine[];
  nextAction: string;
  nextActionLabel: string;
  nextActionHref: string;
  workflowAction: WorkflowActionCode;
  contentJobs: OpenWebUIJob[];
  followUpEmailSubject?: string;
  followUpEmailBody?: string;
  internalNote?: string;
  memory?: MemorySnapshot;
};

export type RecommendApiResponse = RecommendationResponse & {
  agentDecision: AgentDecision;
};

export type HermesInput = {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  context?: RecommendRequestContext;
  source?: string;
};

export type DecideActionInput = {
  problem?: string;
  businessType?: string;
  userSegment?: HermesSegment;
  businessGoal?: string;
  recommendationSegment?: SegmentId;
};

export type DecideActionOutput = {
  agent: AgentName;
  system: string;
  nextAction: WorkflowActionCode;
};
