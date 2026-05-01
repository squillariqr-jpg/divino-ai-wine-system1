import type {
  QuizAnswers,
  RecommendationResponse,
  SegmentId,
  Wine
} from "@/lib/types";

export type AgentName =
  | "consumer_agent"
  | "business_agent"
  | "buyer_agent"
  | "sommelier_agent"
  | "content_agent"
  | "sales_agent";

export type AgentTask =
  | "educate_consumer"
  | "diagnose_business"
  | "qualify_buyer"
  | "guide_sommelier"
  | "orchestrate_content"
  | "activate_sales";

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

export type AgentDecision = {
  agentName: AgentName;
  task: AgentTask;
  segment?: SegmentId;
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
  followUpEmailSubject?: string;
  followUpEmailBody?: string;
  internalNote?: string;
};

export type RecommendApiResponse = RecommendationResponse & {
  agentDecision: AgentDecision;
};

export type AgentRouterInput = {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  context?: RecommendRequestContext;
  source?: string;
};
