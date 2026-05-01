import type {
  AgentDecision,
  BusinessQuizAnswers,
  BusinessSystemId,
  LeadProfile
} from "@/lib/hermes/types";
import type { RecommendationResponse } from "@/lib/types";

type BusinessSystemConfig = {
  systemName: string;
  diagnosisSentence: string;
  features: string[];
  benefits: string[];
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
  strutturato: "già strutturato ma ottimizzabile"
};

export const TOOLS_LABELS: Record<BusinessQuizAnswers["toolsUsed"], string> = {
  manuale: "manuali o sparsi tra chat e fogli",
  "contenuti-base": "centrati su contenuti ma con poca orchestrazione",
  "crm-automation": "già orientati a CRM e automazioni",
  "stack-misto": "numerosi ma non ancora coordinati"
};

export const MAIN_GOAL_LABELS: Record<BusinessQuizAnswers["mainGoal"], string> = {
  "piu-lead": "più lead qualificati",
  "piu-riacquisti": "più riacquisti e continuità",
  "piu-automazione": "più automazione operativa",
  "piu-contenuti": "più contenuti che convertono"
};

const BUSINESS_SYSTEM_LIBRARY: Record<BusinessSystemId, BusinessSystemConfig> = {
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
      "Più lead qualificati e meno dipendenza dal caso",
      "Messaggio commerciale più leggibile",
      "Crescita più stabile delle opportunità in ingresso"
    ]
  },
  retention: {
    systemName: "Retention System",
    diagnosisSentence:
      "La tua crescita passa dalla continuità: oggi ti serve soprattutto un sistema di retention.",
    features: [
      "Segmentazione clienti e follow-up post acquisto",
      "Sequenze di riattivazione e ritorno cliente",
      "Calendario offerte e momenti di contatto ricorrenti",
      "Messaggi coerenti per aumentare frequenza e valore"
    ],
    benefits: [
      "Più riacquisti con meno dispersione commerciale",
      "Relazione più forte con i clienti già esistenti",
      "Maggiore valore per cliente nel medio periodo"
    ]
  },
  automation: {
    systemName: "Automation System",
    diagnosisSentence:
      "Il tuo limite oggi non è il mercato: è la quantità di energia che sprechi in processi manuali.",
    features: [
      "Workflow chiari per lead, richieste e follow-up",
      "Automazioni su email, reminder e passaggi operativi",
      "Priorità commerciali più leggibili per il team",
      "Riduzione dei punti morti tra interesse e azione"
    ],
    benefits: [
      "Meno lavoro ripetitivo e più tempo strategico",
      "Follow-up più veloci e coerenti",
      "Sistema più scalabile senza aumentare il caos"
    ]
  },
  content: {
    systemName: "Content System",
    diagnosisSentence:
      "Il problema non è pubblicare di più: è avere un sistema contenuti che porta davvero business.",
    features: [
      "Prompt, format e workflow editoriali replicabili",
      "Calendario contenuti con obiettivi commerciali chiari",
      "Riutilizzo intelligente di contenuti per più canali",
      "Ponte tra contenuto, lead generation e vendita"
    ],
    benefits: [
      "Più contenuti utili in meno tempo",
      "Autorevolezza più alta senza improvvisazione",
      "Migliore conversione dai contenuti alle richieste"
    ]
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
  return `Oggi operi come ${BUSINESS_TYPE_LABELS[answers.businessType]}, con un sistema ${SYSTEM_LEVEL_LABELS[answers.systemLevel]} e strumenti ${TOOLS_LABELS[answers.toolsUsed]}. Il nodo più evidente è ${MAIN_PROBLEM_LABELS[answers.mainProblem]}, mentre il tuo obiettivo più forte resta ${MAIN_GOAL_LABELS[answers.mainGoal]}. Questo è il punto in cui un ${systemName} crea più leva.`;
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
  segmentRationale: string[];
}): AgentDecision {
  const { answers, recommendation, segmentRationale } = input;
  const system = detectBusinessSystem(answers);
  const systemConfig = BUSINESS_SYSTEM_LIBRARY[system];
  const target = resolveTarget(answers, recommendation);
  const problemExplanation = buildProblemExplanation(
    answers,
    systemConfig.systemName
  );

  return {
    orchestrator: "hermes_orchestrator",
    agentName: "business_agent",
    supportingAgents: [],
    task: "diagnose_business_growth",
    userSegment: "business",
    segmentRationale,
    segment: recommendation.segment,
    systemKey: system,
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
    workflowAction:
      system === "retention" ? "send_followup" : "send_email_offer",
    contentJobs: [
      {
        jobType: "email",
        templateId: "divino_email",
        title: "Email diagnosi business vino",
        goal: "Spiegare il problema e proporre il sistema corretto con invito a call.",
        variables: {
          business_type: BUSINESS_TYPE_LABELS[answers.businessType],
          problem: MAIN_PROBLEM_LABELS[answers.mainProblem],
          system: systemConfig.systemName
        }
      },
      {
        jobType: "sales_offer",
        templateId: "divino_sales",
        title: "Proposta commerciale",
        goal: "Preparare una proposta concreta orientata alla conversione.",
        variables: {
          business_type: BUSINESS_TYPE_LABELS[answers.businessType],
          problem: MAIN_PROBLEM_LABELS[answers.mainProblem],
          system: systemConfig.systemName
        }
      }
    ],
    followUpEmailSubject: `Divino AI | Diagnosi pronta: ${systemConfig.systemName}`,
    followUpEmailBody: `Ciao, abbiamo completato la tua diagnosi business. Il punto di leva più chiaro è ${systemConfig.systemName}: ${MAIN_PROBLEM_LABELS[answers.mainProblem]} sta rallentando la crescita, mentre l'obiettivo rimane ${MAIN_GOAL_LABELS[answers.mainGoal]}. Il prossimo passo consigliato è ${target.label}. Se vuoi, partiamo da qui e costruiamo il sistema più adatto al tuo business del vino.`,
    internalNote: `Lead business (${BUSINESS_TYPE_LABELS[answers.businessType]}). Diagnosi: ${systemConfig.systemName}. Next action: ${target.label}.`
  };
}
