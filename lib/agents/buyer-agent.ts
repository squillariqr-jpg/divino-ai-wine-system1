import type {
  AgentDecision,
  LeadProfile
} from "@/lib/agents/types";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

export function runBuyerAgent(input: {
  answers: QuizAnswers;
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
}): AgentDecision {
  const { recommendation } = input;

  return {
    agentName: "buyer_agent",
    task: "qualify_buyer",
    segment: recommendation.segment,
    profileLabel: "Buyer e decision maker wine",
    diagnosis:
      "Il profilo e professionale: qui non serve solo contenuto, serve un metodo di acquisto piu strutturato.",
    rationale: [
      "L'intento espresso e vicino a selezione, margine o acquisto professionale.",
      "Il segmento risultante richiede criterio decisionale e non solo ispirazione.",
      "La proposta deve portare verso un percorso premium con applicazione concreta."
    ],
    recommendedSystem: {
      name: "Wine Buyer Academy",
      summary:
        "Un percorso premium per lavorare su selezione, criteri di acquisto, rotazione e posizionamento.",
      features: [
        "Framework di selezione e valutazione fornitori",
        "Lettura di marginalita e coerenza di assortimento",
        "Metodo replicabile per carta vini e acquisti"
      ],
      benefits: [
        "Decisioni piu nitide e meno acquisti impulsivi",
        "Più controllo su rotazione e marginalita",
        "Posizionamento piu professionale della proposta vino"
      ]
    },
    nextAction:
      "Inviare briefing premium e accompagnare il lead verso la Wine Buyer Academy con una conversazione dedicata.",
    nextActionLabel: "Percorso Professionale",
    nextActionHref: "/academy",
    followUpEmailSubject:
      "Divino AI | Il prossimo passo per strutturare i tuoi acquisti wine",
    followUpEmailBody:
      "Ciao, dal tuo profilo emerge una necessita chiara: portare selezione e acquisti su un metodo piu strutturato. Il passo giusto e la Wine Buyer Academy, pensata per chi vuole criteri, margine e decisioni replicabili. Se vuoi, ti inviamo il briefing iniziale e fissiamo il prossimo step.",
    internalNote:
      "Lead buyer da priorizzare. Proporre Academy e verificare ruolo decisionale su acquisti, carta vini o selezione."
  };
}
