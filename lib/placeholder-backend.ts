import type { AgentDecision, AgentName } from "@/lib/hermes/types";
import type { LeadCapturePayload, SegmentId } from "@/lib/types";

export type PlaceholderLeadRecord = {
  leadId: string;
  storedAt: string;
  destination: string;
  source: string;
  segment?: SegmentId;
  agentName?: AgentName;
  nextStep: string;
  agentDecision?: AgentDecision;
  payload: LeadCapturePayload;
};

export type PlaceholderAdminSnapshot = {
  totalLeads: number;
  consumerLeads: number;
  businessLeads: number;
  buyerLeads: number;
  lastAgentDecisions: PlaceholderLeadRecord[];
  leads: PlaceholderLeadRecord[];
};

function resolveNextStep(payload: LeadCapturePayload) {
  if (payload.nextAction) {
    return payload.nextAction;
  }

  if (payload.agentDecision?.nextAction) {
    return payload.agentDecision.nextAction;
  }

  if (payload.segment === "buyer-professionale") {
    return "Inviare briefing premium e proporre una call per la Wine Buyer Academy.";
  }

  if (payload.segment === "builder-digitale") {
    return "Inviare il lead magnet AI e aprire il follow-up verso Wine AI Mastery.";
  }

  if (payload.interest?.includes("Corso")) {
    return "Inviare il materiale gratuito e attivare la sequenza verso il corso in 5 lezioni.";
  }

  return "Inviare l'asset gratuito e nutrire il contatto con il funnel iniziale.";
}

function createStarterLead(
  partial: Omit<PlaceholderLeadRecord, "leadId" | "storedAt" | "destination">
): PlaceholderLeadRecord {
  return {
    leadId: `lead_${crypto.randomUUID().slice(0, 8)}`,
    storedAt: new Date(Date.now() - Math.floor(Math.random() * 86_400_000 * 3)).toISOString(),
    destination: "placeholder-crm",
    ...partial
  };
}

const starterLeads: PlaceholderLeadRecord[] = [
  createStarterLead({
    source: "quiz-risultato",
    segment: "novizio-curioso",
    agentName: "sommelier_agent",
    nextStep:
      "Inviare ebook introduttivo e nudging verso il corso in 5 lezioni.",
    agentDecision: {
      orchestrator: "hermes_orchestrator",
      agentName: "sommelier_agent",
      supportingAgents: ["segment_agent", "memory_agent"],
      task: "diagnose_wine_profile",
      userSegment: "appassionato",
      segmentRationale: [
        "Lead orientato al gusto e alla scoperta.",
        "Serve accompagnamento educativo prima della vendita."
      ],
      segment: "novizio-curioso",
      systemKey: "content",
      profileLabel: "Novizio curioso",
      diagnosis:
        "Serve una guida semplice e ordinata prima di spingere prodotti avanzati.",
      rationale: [
        "Lead consumer a inizio percorso.",
        "Ha bisogno di fiducia e contenuto gratuito.",
        "L'offerta corretta e il corso introduttivo."
      ],
      recommendedContent: {
        title: "Cantina Minima + guida ai primi acquisti",
        description: "Un onboarding leggero per entrare bene nel sistema."
      },
      nextAction: "Inviare asset gratuito e poi corso introduttivo.",
      nextActionLabel: "Scopri il tuo percorso",
      nextActionHref: "/quiz",
      workflowAction: "send_content",
      contentJobs: [
        {
          jobType: "wine_sheet",
          templateId: "divino_wine_sheet",
          title: "Scheda vino introduttiva",
          goal: "Generare una scheda vino coerente col profilo del lead.",
          variables: {
            wine_name: "Selezione Divino",
            denominazione: "Cantina Minima",
            caratteristiche: "Profilo morbido e introduttivo"
          }
        }
      ],
      memory: {
        profileTag: "Novizio curioso",
        preferences: ["Livello: principiante", "Obiettivo: imparare"],
        history: ["Source: quiz-risultato", "Agente primario: sommelier_agent"],
        nextActions: [
          "Inviare asset gratuito e poi corso introduttivo.",
          "Scopri il tuo percorso"
        ],
        lastUpdatedAt: new Date().toISOString()
      }
    },
    payload: {
      name: "Marta",
      email: "marta@example.com",
      source: "quiz-risultato",
      segment: "novizio-curioso",
      interest: "Corso Introduttivo in 5 Lezioni",
      agentName: "sommelier_agent",
      nextAction: "Inviare asset gratuito e poi corso introduttivo."
    }
  }),
  createStarterLead({
    source: "quiz-business-result",
    segment: "builder-digitale",
    agentName: "business_agent",
    nextStep:
      "Aprire follow-up commerciale su Content System e portare verso Wine AI Mastery.",
    agentDecision: {
      orchestrator: "hermes_orchestrator",
      agentName: "business_agent",
      supportingAgents: ["segment_agent", "memory_agent", "content_agent"],
      task: "diagnose_business_growth",
      userSegment: "business",
      segmentRationale: [
        "Lead business con problema di contenuti e conversione.",
        "Serve diagnosi di sistema prima del follow-up commerciale."
      ],
      segment: "builder-digitale",
      systemKey: "content",
      profileLabel: "creator o progetto editoriale wine",
      diagnosis:
        "Il business ha bisogno di un Content System che colleghi contenuti e conversione.",
      rationale: [
        "Problema principale: contenuti incostanti.",
        "Obiettivo: piu contenuti che convertono.",
        "Sistema attuale ancora parziale."
      ],
      recommendedSystem: {
        name: "Content System",
        summary:
          "Workflow, prompt e CTA devono lavorare insieme per generare lead e vendite.",
        features: [
          "Prompt library",
          "Calendario contenuti",
          "CTA collegate al funnel"
        ],
        benefits: [
          "Piu continuita editoriale",
          "Piu conversione",
          "Meno improvvisazione"
        ]
      },
      nextAction:
        "Attivare Content System e portare il lead verso Wine AI Mastery.",
      nextActionLabel: "Attiva il tuo sistema",
      nextActionHref: "/wine-ai-mastery",
      workflowAction: "send_email_offer",
      contentJobs: [
        {
          jobType: "email",
          templateId: "divino_email",
          title: "Email diagnosi business",
          goal: "Spiegare il problema e proporre il sistema corretto.",
          variables: {
            business_type: "creator o progetto editoriale wine",
            problem: "contenuti incostanti",
            system: "Content System"
          }
        },
        {
          jobType: "sales_offer",
          templateId: "divino_sales",
          title: "Proposta commerciale content system",
          goal: "Preparare una proposta premium orientata alla conversione.",
          variables: {
            business_type: "creator o progetto editoriale wine",
            problem: "contenuti incostanti",
            system: "Content System"
          }
        }
      ],
      memory: {
        profileTag: "creator o progetto editoriale wine",
        preferences: [
          "Tipo business: creator-media",
          "Goal business: piu-contenuti"
        ],
        history: [
          "Source: quiz-business-result",
          "Agente primario: business_agent"
        ],
        nextActions: [
          "Attivare Content System e portare il lead verso Wine AI Mastery.",
          "Attiva il tuo sistema"
        ],
        lastUpdatedAt: new Date().toISOString()
      }
    },
    payload: {
      name: "Giulia",
      email: "giulia@example.com",
      source: "quiz-business-result",
      segment: "builder-digitale",
      interest: "Content System",
      businessType: "creator o progetto editoriale wine",
      quizResult: "Content System → Wine AI Mastery",
      agentName: "business_agent",
      nextAction:
        "Attivare Content System e portare il lead verso Wine AI Mastery."
    }
  }),
  createStarterLead({
    source: "academy-page",
    segment: "buyer-professionale",
    agentName: "buyer_agent",
    nextStep:
      "Inviare briefing Academy e proposta call per criterio acquisti.",
    agentDecision: {
      orchestrator: "hermes_orchestrator",
      agentName: "buyer_agent",
      supportingAgents: ["segment_agent", "memory_agent"],
      task: "orient_buyer",
      userSegment: "buyer",
      segmentRationale: [
        "Lead con intento professionale.",
        "Richiede percorso Academy e gestione premium."
      ],
      segment: "buyer-professionale",
      systemKey: "buyer_academy",
      profileLabel: "Buyer e decision maker wine",
      diagnosis:
        "Profilo da gestire come lead premium con focus su selezione e marginalita.",
      rationale: [
        "Intento professionale.",
        "Serve metodo di acquisto.",
        "Proposta corretta: Wine Buyer Academy."
      ],
      nextAction:
        "Inviare briefing premium e accompagnare verso Wine Buyer Academy.",
      nextActionLabel: "Percorso Professionale",
      nextActionHref: "/academy",
      workflowAction: "send_buyer_brief",
      contentJobs: [
        {
          jobType: "email",
          templateId: "divino_email",
          title: "Email buyer academy",
          goal: "Inviare un follow-up professionale e orientato alla call.",
          variables: {
            business_type: "buyer o professionista wine",
            problem: "serve un metodo di acquisto più strutturato",
            system: "Wine Buyer Academy"
          }
        }
      ],
      memory: {
        profileTag: "Buyer e decision maker wine",
        preferences: [
          "Segmento recommendation: buyer-professionale"
        ],
        history: ["Source: academy-page", "Agente primario: buyer_agent"],
        nextActions: [
          "Inviare briefing premium e accompagnare verso Wine Buyer Academy.",
          "Percorso Professionale"
        ],
        lastUpdatedAt: new Date().toISOString()
      }
    },
    payload: {
      name: "Lorenzo",
      email: "lorenzo@example.com",
      source: "academy-page",
      segment: "buyer-professionale",
      interest: "Wine Buyer Academy",
      agentName: "buyer_agent",
      nextAction:
        "Inviare briefing premium e accompagnare verso Wine Buyer Academy."
    }
  })
];

const leadStore = [...starterLeads];

function classifyLead(record: PlaceholderLeadRecord) {
  if (
    record.segment === "buyer-professionale" ||
    record.agentName === "buyer_agent"
  ) {
    return "buyer";
  }

  if (
    record.agentName === "business_agent" ||
    record.agentName === "content_agent" ||
    record.agentName === "sales_agent" ||
    record.source.includes("business") ||
    record.segment === "builder-digitale"
  ) {
    return "business";
  }

  return "consumer";
}

export async function submitLeadToPlaceholderBackend(
  payload: LeadCapturePayload
): Promise<PlaceholderLeadRecord> {
  // Placeholder only:
  // when Supabase or another DB is fully introduced, keep this boundary as the
  // adapter point. n8n, AgentMail or WBOS can listen here after persistence.
  await new Promise((resolve) => {
    setTimeout(resolve, 120);
  });

  const record: PlaceholderLeadRecord = {
    leadId: `lead_${crypto.randomUUID().slice(0, 8)}`,
    storedAt: new Date().toISOString(),
    destination: "placeholder-crm",
    source: payload.source,
    segment: payload.segment,
    agentName: payload.agentName ?? payload.agentDecision?.agentName,
    nextStep: resolveNextStep(payload),
    agentDecision: payload.agentDecision,
    payload
  };

  leadStore.unshift(record);
  return record;
}

export function listPlaceholderLeads() {
  return [...leadStore];
}

export function getPlaceholderAdminSnapshot(): PlaceholderAdminSnapshot {
  const leads = listPlaceholderLeads();
  const consumerLeads = leads.filter((lead) => classifyLead(lead) === "consumer").length;
  const businessLeads = leads.filter((lead) => classifyLead(lead) === "business").length;
  const buyerLeads = leads.filter((lead) => classifyLead(lead) === "buyer").length;

  return {
    totalLeads: leads.length,
    consumerLeads,
    businessLeads,
    buyerLeads,
    lastAgentDecisions: leads.filter((lead) => lead.agentDecision).slice(0, 5),
    leads: leads.slice(0, 12)
  };
}
