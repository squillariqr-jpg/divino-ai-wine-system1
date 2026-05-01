import type {
  AgentDecision,
  BusinessQuizAnswers,
  BusinessSystemId,
  LeadProfile
} from "@/lib/agents/types";
import type { RecommendationResponse } from "@/lib/types";

type BusinessSystemConfig = {
  systemName: string;
  diagnosisSentence: string;
  features: string[];
  benefits: string[];
  accentClass: string;
  accentTextClass: string;
};

export const BUSINESS_TYPE_LABELS: Record<
  BusinessQuizAnswers["businessType"],
  string
> = {
  "creator-media": "creator o progetto editoriale wine",
  "cantina-enoteca": "cantina, enoteca o wine shop",
  "horeca-buyer": "realtà horeca o funzione buyer",
  "consulenza-distribuzione": "consulenza, distribuzione o progetto commerciale"
};

export const MAIN_PROBLEM_LABELS: Record<
  BusinessQuizAnswers["mainProblem"],
  string
> = {
  "acquisizione-instabile": "acquisizione discontinua",
  "clienti-non-ritornano": "ritorno clienti troppo debole",
  "processi-manuali": "processi ancora troppo manuali",
  "contenuti-incostanti":
    "contenuti discontinui e poco collegati alla vendita"
};

export const SYSTEM_LEVEL_LABELS: Record<
  BusinessQuizAnswers["systemLevel"],
  string
> = {
  "nessun-sistema": "quasi assente",
  parziale: "solo parziale",
  frammentato: "frammentato",
  strutturato: "gia strutturato ma ottimizzabile"
};

export const TOOLS_LABELS: Record<BusinessQuizAnswers["toolsUsed"], string> = {
  manuale: "manuali o sparsi tra chat e fogli",
  "contenuti-base": "centrati su contenuti ma con poca orchestrazione",
  "crm-automation": "gia orientati a CRM e automazioni",
  "stack-misto": "numerosi ma non ancora coordinati"
};

export const MAIN_GOAL_LABELS: Record<BusinessQuizAnswers["mainGoal"], string> = {
  "piu-lead": "piu lead qualificati",
  "piu-riacquisti": "piu riacquisti e continuita",
  "piu-automazione": "piu automazione operativa",
  "piu-contenuti": "piu contenuti che convertono"
};

export const BUSINESS_SYSTEM_LIBRARY: Record<
  BusinessSystemId,
  BusinessSystemConfig
> = {
  acquisition: {
    systemName: "Acquisition System",
    diagnosisSentence:
      "La diagnosi e netta: il tuo business wine ha bisogno prima di tutto di un sistema di acquisizione.",
    features: [
      "Lead magnet e CTA collegati a una promessa chiara",
      "Landing e raccolta contatti orientate alla conversione",
      "Sequenza iniziale per trasformare interesse in richiesta",
      "Allineamento tra traffico, contenuti e primo follow-up"
    ],
    benefits: [
      "Piu lead qualificati e meno dipendenza dal caso",
      "Messaggio commerciale piu leggibile",
      "Crescita piu stabile delle opportunita in ingresso"
    ],
    accentClass: "bg-burgundy",
    accentTextClass: "text-cream"
  },
  retention: {
    systemName: "Retention System",
    diagnosisSentence:
      "La tua crescita passa dalla continuita: oggi ti serve soprattutto un sistema di retention.",
    features: [
      "Segmentazione clienti e follow-up post acquisto",
      "Sequenze di riattivazione e ritorno cliente",
      "Calendario offerte e momenti di contatto ricorrenti",
      "Messaggi coerenti per aumentare frequenza e valore"
    ],
    benefits: [
      "Piu riacquisti con meno dispersione commerciale",
      "Relazione piu forte con i clienti gia esistenti",
      "Maggiore valore per cliente nel medio periodo"
    ],
    accentClass: "bg-bottle",
    accentTextClass: "text-cream"
  },
  automation: {
    systemName: "Automation System",
    diagnosisSentence:
      "Il tuo limite oggi non e il mercato: e la quantita di energia che sprechi in processi manuali.",
    features: [
      "Workflow chiari per lead, richieste e follow-up",
      "Automazioni su email, reminder e passaggi operativi",
      "Priorita commerciali piu leggibili per il team",
      "Riduzione dei punti morti tra interesse e azione"
    ],
    benefits: [
      "Meno lavoro ripetitivo e piu tempo strategico",
      "Follow-up piu veloci e coerenti",
      "Sistema piu scalabile senza aumentare il caos"
    ],
    accentClass: "bg-ink",
    accentTextClass: "text-cream"
  },
  content: {
    systemName: "Content System",
    diagnosisSentence:
      "Il problema non e pubblicare di piu: e avere un sistema contenuti che porta davvero business.",
    features: [
      "Prompt, format e workflow editoriali replicabili",
      "Calendario contenuti con obiettivi commerciali chiari",
      "Riutilizzo intelligente di contenuti per piu canali",
      "Ponte tra contenuto, lead generation e vendita"
    ],
    benefits: [
      "Piu contenuti utili in meno tempo",
      "Autorevolezza piu alta senza improvvisazione",
      "Migliore conversione dai contenuti alle richieste"
    ],
    accentClass: "bg-bottle",
    accentTextClass: "text-cream"
  }
};

const SYSTEM_ORDER_BY_GOAL: Record<
  BusinessQuizAnswers["mainGoal"],
  BusinessSystemId[]
> = {
  "piu-lead": ["acquisition", "content", "automation", "retention"],
  "piu-riacquisti": ["retention", "automation", "acquisition", "content"],
  "piu-automazione": ["automation", "retention", "content", "acquisition"],
  "piu-contenuti": ["content", "acquisition", "automation", "retention"]
};

function createSystemScores(): Record<BusinessSystemId, number> {
  return {
    acquisition: 0,
    retention: 0,
    automation: 0,
    content: 0
  };
}

export function detectBusinessSystem(
  answers: BusinessQuizAnswers
): BusinessSystemId {
  const scores = createSystemScores();

  const weights: Record<
    keyof BusinessQuizAnswers,
    Record<string, Partial<Record<BusinessSystemId, number>>>
  > = {
    businessType: {
      "creator-media": { content: 3, acquisition: 1 },
      "cantina-enoteca": { acquisition: 2, retention: 2, automation: 1 },
      "horeca-buyer": { retention: 2, automation: 1, acquisition: 1 },
      "consulenza-distribuzione": { automation: 2, acquisition: 2, content: 1 }
    },
    mainProblem: {
      "acquisizione-instabile": { acquisition: 6 },
      "clienti-non-ritornano": { retention: 6 },
      "processi-manuali": { automation: 6 },
      "contenuti-incostanti": { content: 6 }
    },
    systemLevel: {
      "nessun-sistema": { acquisition: 2, content: 2 },
      parziale: { acquisition: 1, content: 1, retention: 1 },
      frammentato: { automation: 3, retention: 1 },
      strutturato: { retention: 2, automation: 2 }
    },
    toolsUsed: {
      manuale: { automation: 3, acquisition: 1 },
      "contenuti-base": { content: 3, acquisition: 1 },
      "crm-automation": { retention: 2, automation: 2 },
      "stack-misto": { automation: 3, retention: 1 }
    },
    mainGoal: {
      "piu-lead": { acquisition: 5 },
      "piu-riacquisti": { retention: 5 },
      "piu-automazione": { automation: 5 },
      "piu-contenuti": { content: 5 }
    }
  };

  (Object.keys(weights) as (keyof BusinessQuizAnswers)[]).forEach((key) => {
    const stepWeights = weights[key][answers[key]];

    Object.entries(stepWeights).forEach(([system, value]) => {
      scores[system as BusinessSystemId] += value ?? 0;
    });
  });

  const maxScore = Math.max(...Object.values(scores));
  return (
    SYSTEM_ORDER_BY_GOAL[answers.mainGoal].find(
      (system) => scores[system] === maxScore
    ) ?? "acquisition"
  );
}

function buildProblemExplanation(answers: BusinessQuizAnswers, systemName: string) {
  return `Oggi operi come ${BUSINESS_TYPE_LABELS[answers.businessType]}, con un sistema ${SYSTEM_LEVEL_LABELS[answers.systemLevel]} e strumenti ${TOOLS_LABELS[answers.toolsUsed]}. Il nodo piu evidente e ${MAIN_PROBLEM_LABELS[answers.mainProblem]}, mentre il tuo obiettivo piu forte resta ${MAIN_GOAL_LABELS[answers.mainGoal]}. Questo e il punto in cui un ${systemName} crea piu leva.`;
}

function resolveTarget(
  answers: BusinessQuizAnswers,
  recommendation: RecommendationResponse
) {
  if (
    recommendation.segment === "buyer-professionale" ||
    answers.businessType === "horeca-buyer"
  ) {
    return {
      label: "Wine Buyer Academy",
      href: "/academy"
    };
  }

  return {
    label:
      recommendation.productRecommendation.slug === "wine-ai-mastery"
        ? recommendation.productRecommendation.name
        : "Wine AI Mastery",
    href: "/wine-ai-mastery"
  };
}

export function runBusinessAgent(input: {
  answers: BusinessQuizAnswers;
  recommendation: RecommendationResponse;
  leadProfile: LeadProfile;
}): AgentDecision {
  const { answers, recommendation } = input;
  const system = detectBusinessSystem(answers);
  const systemConfig = BUSINESS_SYSTEM_LIBRARY[system];
  const target = resolveTarget(answers, recommendation);
  const problemExplanation = buildProblemExplanation(
    answers,
    systemConfig.systemName
  );

  return {
    agentName: "business_agent",
    task: "diagnose_business",
    segment: recommendation.segment,
    profileLabel: BUSINESS_TYPE_LABELS[answers.businessType],
    diagnosis: systemConfig.diagnosisSentence,
    rationale: [
      `Problema prioritario: ${MAIN_PROBLEM_LABELS[answers.mainProblem]}.`,
      `Obiettivo dominante: ${MAIN_GOAL_LABELS[answers.mainGoal]}.`,
      `Livello attuale del sistema: ${SYSTEM_LEVEL_LABELS[answers.systemLevel]}.`
    ],
    recommendedSystem: {
      name: systemConfig.systemName,
      summary: problemExplanation,
      features: systemConfig.features,
      benefits: systemConfig.benefits
    },
    recommendedContent: recommendation.contentRecommendation,
    nextAction: `Attivare ${systemConfig.systemName} e spostare il lead verso ${target.label}.`,
    nextActionLabel: "Attiva il tuo sistema",
    nextActionHref: target.href,
    followUpEmailSubject: `Divino AI | Diagnosi pronta: ${systemConfig.systemName}`,
    followUpEmailBody: `Ciao, abbiamo completato la tua diagnosi business. Il punto di leva piu chiaro e ${systemConfig.systemName}: ${MAIN_PROBLEM_LABELS[answers.mainProblem]} sta rallentando la crescita, mentre l'obiettivo rimane ${MAIN_GOAL_LABELS[answers.mainGoal]}. Il prossimo passo consigliato e ${target.label}. Se vuoi, partiamo da qui e costruiamo il sistema piu adatto al tuo business del vino.`,
    internalNote: `Lead business (${BUSINESS_TYPE_LABELS[answers.businessType]}). Diagnosi: ${systemConfig.systemName}. Next action: ${target.label}.`
  };
}
