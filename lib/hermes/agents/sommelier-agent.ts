import type { AgentDecision, LeadProfile } from "@/lib/hermes/types";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

function describeWineStyle(answers: QuizAnswers) {
  const tasteMap: Record<QuizAnswers["taste"], string> = {
    morbido: "ami rotondità, comfort e vini facili da leggere",
    fresco: "cerchi energia, bevibilità e scelte più dinamiche",
    strutturato: "preferisci profondità, materia e intensità",
    elegante: "ti orienti verso finezza, precisione e bottiglie più curate",
    esploratore: "vuoi varietà, scoperta e una selezione che non ti annoi"
  };

  const budgetMap: Record<QuizAnswers["budget"], string> = {
    basso: "con una soglia d'ingresso agile",
    medio: "con un budget equilibrato e sostenibile",
    alto: "con spazio per bottiglie più ambiziose",
    "molto-alto": "con un budget premium che merita selezione attenta"
  };

  return `Nel vino ${tasteMap[answers.taste]}, ${budgetMap[answers.budget]}.`;
}

export function runSommelierAgent(input: {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
  segmentRationale: string[];
}): AgentDecision {
  const { answers, recommendation, segmentRationale } = input;

  return {
    orchestrator: "hermes_orchestrator",
    agentName: "sommelier_agent",
    supportingAgents: [],
    task: "diagnose_wine_profile",
    userSegment: "appassionato",
    segmentRationale,
    segment: recommendation.segment,
    profileLabel: recommendation.persona.label,
    diagnosis: `Ti stiamo guidando come ${recommendation.persona.label.toLowerCase()}: prima chiarezza, poi scelta, poi progressione verso il prodotto giusto.`,
    rationale: recommendation.rationale,
    recommendedContent: recommendation.contentRecommendation,
    wineStyleSummary: describeWineStyle(answers),
    suggestedWines: recommendation.wines.slice(0, 2),
    nextAction: recommendation.postQuizCta.description,
    nextActionLabel: recommendation.postQuizCta.primaryLabel,
    nextActionHref: recommendation.postQuizCta.primaryHref,
    internalNote: `Lead appassionato con segmento ${recommendation.segment}. Proporre ${recommendation.productRecommendation.name} dopo invio di ${recommendation.leadMagnet.title}.`
  };
}
