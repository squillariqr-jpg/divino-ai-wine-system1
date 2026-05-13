import type { AgentDecision, LeadProfile } from "@/lib/hermes/types";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

export function runBuyerAgent(input: {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
  segmentRationale: string[];
}): AgentDecision {
  const { recommendation, segmentRationale, leadProfile } = input;

  return {
    orchestrator: "hermes_orchestrator",
    agentName: "buyer_agent",
    supportingAgents: [],
    task: "orient_buyer",
    userSegment: "buyer",
    segmentRationale,
    segment: recommendation.segment,
    systemKey: "buyer_academy",
    profileLabel: "Buyer e decision maker wine",
    diagnosis:
      "Il profilo è professionale: qui non serve solo contenuto, serve un metodo di acquisto più strutturato.",
    rationale: [
      "L'intento espresso è vicino a selezione, margine o acquisto professionale.",
      "Il segmento risultante richiede criterio decisionale e non solo ispirazione.",
      "La proposta deve portare verso un percorso premium con applicazione concreta."
    ],
    recommendedSystem: {
      name: "Wine Buyer Academy",
      summary:
        "Un percorso premium per lavorare su selezione, criteri di acquisto, rotazione e posizionamento.",
      features: [
        "Framework di selezione e valutazione fornitori",
        "Lettura di marginalità e coerenza di assortimento",
        "Metodo replicabile per carta vini e acquisti"
      ],
      benefits: [
        "Decisioni più nitide e meno acquisti impulsivi",
        "Più controllo su rotazione e marginalità",
        "Posizionamento più professionale della proposta vino"
      ]
    },
    nextAction:
      "Inviare briefing premium e accompagnare il lead verso la Wine Buyer Academy con una conversazione dedicata.",
    nextActionLabel: "Percorso Professionale",
    nextActionHref: "/academy",
    workflowAction: "send_buyer_brief",
    contentJobs: [
      {
        jobType: "email",
        templateId: "divino_email",
        title: "Email buyer academy",
        goal: "Inviare un invito professionale e orientato alla call.",
        variables: {
          business_type: leadProfile.businessType ?? "buyer o professionista wine",
          problem: "serve un metodo di acquisto più strutturato",
          system: "Wine Buyer Academy"
        }
      },
      {
        jobType: "sales_offer",
        templateId: "divino_sales",
        title: "Proposta buyer academy",
        goal: "Preparare un'offerta premium orientata a buyer e decision maker.",
        variables: {
          business_type: leadProfile.businessType ?? "buyer o professionista wine",
          problem: "serve un metodo di acquisto più strutturato",
          system: "Wine Buyer Academy"
        }
      }
    ],
    followUpEmailSubject:
      "Divino AI | Il prossimo passo per strutturare i tuoi acquisti wine",
    followUpEmailBody:
      "Ciao, dal tuo profilo emerge una necessità chiara: portare selezione e acquisti su un metodo più strutturato. Il passo giusto è la Wine Buyer Academy, pensata per chi vuole criteri, margine e decisioni replicabili. Se vuoi, ti inviamo il briefing iniziale e fissiamo il prossimo step.",
    internalNote:
      "Lead buyer da priorizzare. Proporre Academy e verificare ruolo decisionale su acquisti, carta vini o selezione."
  };
}
