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
    systemKey: "content",
    profileLabel: recommendation.persona.label,
    diagnosis: `Ti stiamo guidando come ${recommendation.persona.label.toLowerCase()}: prima chiarezza, poi scelta, poi progressione verso il prodotto giusto.`,
    rationale: recommendation.rationale,
    recommendedContent: recommendation.contentRecommendation,
    wineStyleSummary: describeWineStyle(answers),
    suggestedWines: recommendation.wines.slice(0, 2),
    nextAction: recommendation.postQuizCta.description,
    nextActionLabel: recommendation.postQuizCta.primaryLabel,
    nextActionHref: recommendation.postQuizCta.primaryHref,
    workflowAction: "send_content",
    contentJobs: [
      {
        jobType: "wine_sheet",
        templateId: "divino_wine_sheet",
        title: "Scheda vino personalizzata",
        goal: "Tradurre il gusto del lead in una scheda vino utile e convincente.",
        variables: {
          wine_name: recommendation.wines[0]?.name ?? "Selezione Divino",
          denominazione: recommendation.wines[0]?.region ?? "Selezione premium",
          caratteristiche:
            recommendation.wines[0]?.description ??
            "Profilo elegante, accessibile e coerente col gusto dichiarato"
        }
      },
      {
        jobType: "email",
        templateId: "divino_email",
        title: "Email percorso wine",
        goal: "Inviare un follow-up editoriale premium con suggerimenti e prossimo step.",
        variables: {
          business_type: "appassionato vino",
          problem: "vuole orientarsi meglio tra stile, gusto e acquisto",
          system: recommendation.postQuizCta.title
        }
      }
    ],
    internalNote: `Lead appassionato con segmento ${recommendation.segment}. Proporre ${recommendation.productRecommendation.name} dopo invio di ${recommendation.leadMagnet.title}.`
  };
}
