import type {
  AgentDecision,
  LeadProfile
} from "@/lib/agents/types";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

function describeWineStyle(answers: QuizAnswers) {
  const tasteMap: Record<QuizAnswers["taste"], string> = {
    morbido: "ami rotondita, comfort e vini facili da leggere",
    fresco: "cerchi energia, bevibilita e scelte piu dinamiche",
    strutturato: "preferisci profondita, materia e intensita",
    elegante: "ti orienti verso finezza, precisione e bottiglie piu curate",
    esploratore: "vuoi varieta, scoperta e una selezione che non ti annoi"
  };

  const budgetMap: Record<QuizAnswers["budget"], string> = {
    basso: "con una soglia d'ingresso agile",
    medio: "con un budget equilibrato e sostenibile",
    alto: "con spazio per bottiglie piu ambiziose",
    "molto-alto": "con un budget premium che merita selezione attenta"
  };

  return `Nel vino ${tasteMap[answers.taste]}, ${budgetMap[answers.budget]}.`;
}

export function runConsumerAgent(input: {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
}): AgentDecision {
  const { answers, recommendation } = input;

  return {
    agentName: "consumer_agent",
    task: "educate_consumer",
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
    internalNote: `Lead consumer con segmento ${recommendation.segment}. Proporre ${recommendation.productRecommendation.name} dopo invio di ${recommendation.leadMagnet.title}.`
  };
}
