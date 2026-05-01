import { runBusinessAgent } from "@/lib/agents/business-agent";
import { runBuyerAgent } from "@/lib/agents/buyer-agent";
import { runConsumerAgent } from "@/lib/agents/consumer-agent";
import type {
  AgentDecision,
  AgentRouterInput,
  LeadProfile
} from "@/lib/agents/types";
import type { QuizAnswers } from "@/lib/types";

function buildLeadProfile(input: AgentRouterInput): LeadProfile {
  const { answers, recommendation, context, source } = input;

  return {
    source: source ?? context?.source ?? "recommendation-api",
    quizFlow: context?.flow ?? "unknown",
    segment: recommendation.segment,
    level: answers.level,
    goal: answers.goal,
    taste: answers.taste,
    budget: answers.budget,
    businessType: context?.businessQuizAnswers?.businessType,
    businessProblem: context?.businessQuizAnswers?.mainProblem,
    systemLevel: context?.businessQuizAnswers?.systemLevel,
    toolsUsed: context?.businessQuizAnswers?.toolsUsed,
    businessGoal: context?.businessQuizAnswers?.mainGoal
  };
}

function runContentAgent(input: AgentRouterInput, leadProfile: LeadProfile): AgentDecision {
  const { recommendation } = input;

  return {
    agentName: "content_agent",
    task: "orchestrate_content",
    segment: recommendation.segment,
    profileLabel: "Creator e content builder wine",
    diagnosis:
      "Il collo di bottiglia non e il vino: e il sistema contenuti che deve generare domanda, fiducia e continuita.",
    rationale: [
      "L'obiettivo punta a contenuti, AI o posizionamento digitale.",
      "Il segmento builder-digitale richiede asset, workflow e sequenze replicabili.",
      "La priorita e connettere contenuto, lead capture e offerta."
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
        "Piu coerenza editoriale",
        "Piu conversione dai contenuti",
        "Meno dipendenza dall'improvvisazione"
      ]
    },
    recommendedContent: recommendation.contentRecommendation,
    nextAction:
      "Attivare un sistema contenuti che accompagni il traffico fino a Wine AI Mastery.",
    nextActionLabel: "Diagnosi Business Vino",
    nextActionHref: "/quiz-business",
    followUpEmailSubject:
      "Divino AI | Il tuo prossimo sistema e quello dei contenuti",
    followUpEmailBody:
      "Ciao, il tuo profilo mostra che la leva principale e un sistema contenuti piu orchestrato. Il passaggio giusto e ordinare workflow, prompt e CTA in modo da trasformare l'attenzione in lead e vendite. Se vuoi, partiamo dalla diagnosi business e costruiamo il percorso.",
    internalNote:
      `Lead content-oriented (${leadProfile.segment ?? "no-segment"}). Spingere quiz business e poi Wine AI Mastery.`
  };
}

function runSalesAgent(input: AgentRouterInput, leadProfile: LeadProfile): AgentDecision {
  const { recommendation } = input;

  return {
    agentName: "sales_agent",
    task: "activate_sales",
    segment: recommendation.segment,
    profileLabel: "Business wine orientato alla crescita",
    diagnosis:
      "Il profilo ha bisogno di un sistema commerciale piu leggibile: acquisizione, follow-up e offerta devono muoversi insieme.",
    rationale: [
      "L'obiettivo dichiarato e crescita commerciale.",
      "Il segmento builder-digitale suggerisce leva su funnel e conversione.",
      "Prima di scalare traffico serve piu chiarezza sul sistema di vendita."
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
        "Piu conversione dei lead esistenti",
        "Minore dispersione commerciale",
        "Piu controllo sul percorso fino alla vendita"
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
      "Ciao, dal tuo profilo emerge che il prossimo salto non passa da piu attivita sparse, ma da un sistema commerciale piu ordinato. La diagnosi business serve proprio a capire dove agire prima: acquisizione, retention, automazione o contenuti.",
    internalNote:
      `Lead sales-oriented (${leadProfile.segment ?? "no-segment"}). Inviare verso quiz business e proposta sistemica.`
  };
}

function runSommelierAgent(input: AgentRouterInput): AgentDecision {
  const { answers, recommendation } = input;
  const tasteMap: Record<QuizAnswers["taste"], string> = {
    morbido: "rotondita e comfort",
    fresco: "slancio e bevibilita",
    strutturato: "profondita e intensita",
    elegante: "finezza e precisione",
    esploratore: "varieta e scoperta"
  };

  return {
    agentName: "sommelier_agent",
    task: "guide_sommelier",
    segment: recommendation.segment,
    profileLabel: "Profilo degustazione evoluto",
    diagnosis:
      "Hai segnali da degustatore avanzato: qui la guida deve essere piu selettiva, meno introduttiva.",
    rationale: [
      `Il gusto punta verso ${tasteMap[answers.taste]}.`,
      "Il livello dichiarato richiede consigli meno generici.",
      "Il budget suggerisce selezione piu curata e ragionata."
    ],
    recommendedContent: recommendation.contentRecommendation,
    wineStyleSummary:
      "Ti conviene lavorare su confronto tra bottiglie, criterio di scelta e lettura piu fine dello stile.",
    suggestedWines: recommendation.wines.slice(0, 2),
    nextAction: recommendation.postQuizCta.description,
    nextActionLabel: recommendation.postQuizCta.primaryLabel,
    nextActionHref: recommendation.postQuizCta.primaryHref,
    internalNote:
      "Lead da gestire con tono sommelieriale: piu selezione, meno onboarding generico."
  };
}

export function routeAgentDecision(input: AgentRouterInput): AgentDecision {
  const leadProfile = buildLeadProfile(input);
  const { answers, recommendation, context } = input;

  // TODO: this router is intentionally deterministic. A future OpenAI,
  // Anthropic, LangChain or OpenClaw layer can replace or enrich these
  // branches while keeping the same AgentDecision contract.
  if (context?.flow === "business" && context.businessQuizAnswers) {
    return runBusinessAgent({
      answers: context.businessQuizAnswers,
      recommendation,
      leadProfile
    });
  }

  if (
    context?.flow === "buyer" ||
    context?.professionalIntent === "buyer" ||
    answers.goal === "acquisto-professionale" ||
    recommendation.segment === "buyer-professionale"
  ) {
    return runBuyerAgent({ answers, recommendation, leadProfile });
  }

  if (recommendation.segment === "builder-digitale") {
    if (answers.goal === "business-ai") {
      return runContentAgent(input, leadProfile);
    }

    if (answers.goal === "business-crescita") {
      return runSalesAgent(input, leadProfile);
    }
  }

  if (
    context?.professionalIntent === "sommelier" ||
    (answers.level === "esperto" &&
      (answers.taste === "elegante" || answers.budget === "molto-alto"))
  ) {
    return runSommelierAgent(input);
  }

  return runConsumerAgent({ answers, recommendation, leadProfile });
}
