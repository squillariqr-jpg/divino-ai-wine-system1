export type Wine = {
  id: string;
  name: string;
  region: string;
  style: "morbido" | "fresco" | "strutturato" | "elegante" | "esploratore";
  priceTier: "basso" | "medio" | "alto";
  grape: string;
  description: string;
};

export type Product = {
  id: string;
  name: string;
  slug: string;
  type: "free" | "course" | "digital" | "premium";
  price: string;
  audience: string;
  description: string;
  cta: string;
  highlight: string;
};

export type Persona = {
  id: string;
  label: string;
  summary: string;
  bestFor: string;
  whyRight?: string;
};

export type SegmentId =
  | "novizio-curioso"
  | "appassionato-pratico"
  | "builder-digitale"
  | "buyer-professionale";

export type QuizAnswers = {
  level: "principiante" | "intermedio" | "professionista" | "esperto";
  goal:
    | "imparare"
    | "scegliere-meglio"
    | "business-ai"
    | "business-crescita"
    | "acquisto-professionale";
  taste: "morbido" | "fresco" | "strutturato" | "elegante" | "esploratore";
  budget: "basso" | "medio" | "alto" | "molto-alto";
  journey:
    | "semplice-pratico"
    | "creativo-moderno"
    | "professionale-tecnico"
    | "esclusivo-approfondito";
};

export type ScoreMap = Record<SegmentId, number>;

export type ScoreSummaryItem = {
  segment: SegmentId;
  label: string;
  score: number;
};

export type LeadMagnetRecommendation = {
  title: string;
  description: string;
  ctaLabel: string;
  ctaHref: string;
};

export type PostQuizCta = {
  title: string;
  description: string;
  primaryLabel: string;
  primaryHref: string;
  secondaryLabel: string;
  secondaryHref: string;
};

export type UpsellRecommendation = {
  title: string;
  description: string;
  target: string;
  href: string;
};

export type RecommendationResponse = {
  segment: SegmentId;
  persona: Persona;
  scores: ScoreMap;
  scoreSummary: ScoreSummaryItem[];
  rationale: string[];
  leadMagnet: LeadMagnetRecommendation;
  contentRecommendation: {
    title: string;
    description: string;
  };
  productRecommendation: Product;
  upsellRecommendation: UpsellRecommendation | null;
  postQuizCta: PostQuizCta;
  wines: Wine[];
};

export type LeadCapturePayload = {
  name?: string;
  email: string;
  source: string;
  segment?: SegmentId;
  interest?: string;
  businessType?: string;
  quizResult?: string;
  message?: string;
  notes?: string;
};

export type LeadCaptureResponse = {
  success: boolean;
  message: string;
  leadId?: string;
  destination?: string;
  nextStep?: string;
};
