import type { AgentDecision, LeadProfile } from "@/lib/hermes/types";
import type { RecommendationResponse } from "@/lib/types";

export function runSalesAgent(input: {
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
  segmentRationale: string[];
}): AgentDecision {
  const { recommendation, leadProfile, segmentRationale } = input;

  return {
    orchestrator: "hermes_orchestrator",
    agentName: "sales_agent",
    supportingAgents: [],
    task: "convert_lead",
    userSegment: "business",
    segmentRationale,
    segment: recommendation.segment,
    profileLabel: "Business wine orientato alla crescita",
    diagnosis:
      "Il profilo ha bisogno di un sistema commerciale più leggibile: acquisizione, follow-up e offerta devono muoversi insieme.",
    rationale: [
      "L'obiettivo dichiarato è crescita commerciale.",
      "Il segmento builder-digitale suggerisce leva su funnel e conversione.",
      "Prima di scalare traffico serve più chiarezza sul sistema di vendita."
    ],
    recommendedSystem: {
      name: "Sales System",
      summary:
        "Un impianto che coordina CTA, lead, follow-up e proposta commerciale.",
      features: [
        "Offerta e CTA piu chiare",
        "Sequenza lead e follow-up iniziale",
        "Punti di conversione leggibili lungo il funnel"
      ],
      benefits: [
        "Più conversione dei lead esistenti",
        "Minore dispersione commerciale",
        "Più controllo sul percorso fino alla vendita"
      ]
    },
    recommendedContent: recommendation.contentRecommendation,
    nextAction:
      "Portare il lead in diagnosi business e poi verso il sistema di vendita piu adatto.",
    nextActionLabel: "Diagnosi Business Vino",
    nextActionHref: "/quiz-business",
    followUpEmailSubject:
      "Divino AI | Cosa manca oggi al tuo sistema di vendita wine",
    followUpEmailBody:
      "Ciao, dal tuo profilo emerge che il prossimo salto non passa da più attività sparse, ma da un sistema commerciale più ordinato. La diagnosi business serve proprio a capire dove agire prima: acquisizione, retention, automazione o contenuti.",
    internalNote:
      `Lead sales-oriented (${leadProfile.segment ?? "no-segment"}). Inviare verso quiz business e proposta sistemica.`
  };
}
