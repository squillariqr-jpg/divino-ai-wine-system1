import type { AgentDecision, LeadProfile } from "@/lib/hermes/types";
import type { RecommendationResponse } from "@/lib/types";

export function runContentAgent(input: {
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
  segmentRationale: string[];
}): AgentDecision {
  const { recommendation, leadProfile, segmentRationale } = input;

  return {
    orchestrator: "hermes_orchestrator",
    agentName: "content_agent",
    supportingAgents: [],
    task: "generate_content",
    userSegment: "business",
    segmentRationale,
    segment: recommendation.segment,
    profileLabel: "Creator e content builder wine",
    diagnosis:
      "Il collo di bottiglia non è il vino: è il sistema contenuti che deve generare domanda, fiducia e continuità.",
    rationale: [
      "L'obiettivo punta a contenuti, AI o posizionamento digitale.",
      "Il segmento builder-digitale richiede asset, workflow e sequenze replicabili.",
      "La priorità è connettere contenuto, lead capture e offerta."
    ],
    recommendedSystem: {
      name: "Content System",
      summary:
        "Una macchina editoriale che collega prompt, calendari, lead magnet e CTA di vendita.",
      features: [
        "Format e prompt riutilizzabili",
        "Calendario contenuti allineato al funnel",
        "CTA e lead magnet integrati nei contenuti"
      ],
      benefits: [
        "Più coerenza editoriale",
        "Più conversione dai contenuti",
        "Meno dipendenza dall'improvvisazione"
      ]
    },
    recommendedContent: recommendation.contentRecommendation,
    nextAction:
      "Attivare un sistema contenuti che accompagni il traffico fino a Wine AI Mastery.",
    nextActionLabel: "Diagnosi Business Vino",
    nextActionHref: "/quiz-business",
    followUpEmailSubject:
      "Divino AI | Il tuo prossimo sistema è quello dei contenuti",
    followUpEmailBody:
      "Ciao, il tuo profilo mostra che la leva principale è un sistema contenuti più orchestrato. Il passaggio giusto è ordinare workflow, prompt e CTA in modo da trasformare l'attenzione in lead e vendite. Se vuoi, partiamo dalla diagnosi business e costruiamo il percorso.",
    internalNote:
      `Lead content-oriented (${leadProfile.segment ?? "no-segment"}). Spingere quiz business e poi Wine AI Mastery.`
  };
}
