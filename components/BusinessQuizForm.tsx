"use client";

import type { FormEvent } from "react";
import { useEffect, useState } from "react";

import type {
  BusinessQuizAnswers,
  RecommendApiResponse,
  RecommendRequestPayload
} from "@/lib/hermes/types";
import {
  BUSINESS_TYPE_LABELS,
  detectBusinessSystem,
  MAIN_GOAL_LABELS,
  MAIN_PROBLEM_LABELS,
  SYSTEM_LEVEL_LABELS,
  TOOLS_LABELS
} from "@/lib/hermes/agents/business-agent";
import { track } from "@/lib/track";
import type {
  LeadCapturePayload,
  LeadCaptureResponse,
  QuizAnswers
} from "@/lib/types";
type BusinessFocus = "creator" | "buyer";
type BusinessSystemId = "acquisition" | "retention" | "automation" | "content";

type BusinessStepKey = keyof BusinessQuizAnswers;

type BusinessStepOption<T extends BusinessStepKey> = {
  value: BusinessQuizAnswers[T];
  label: string;
};

type BusinessStepDefinition<T extends BusinessStepKey> = {
  key: T;
  label: string;
  description: string;
  options: BusinessStepOption<T>[];
};

type BusinessDiagnosticResult = {
  system: BusinessSystemId;
  systemName: string;
  diagnosisSentence: string;
  problemExplanation: string;
  features: string[];
  benefits: string[];
  accentClass: string;
  accentTextClass: string;
  targetLabel: string;
  targetHref: string;
  targetPrice: string;
};

type BusinessLeadCaptureCardProps = {
  businessTypeLabel: string;
  diagnosis: BusinessDiagnosticResult;
  recommendation: RecommendApiResponse;
};

const steps: BusinessStepDefinition<BusinessStepKey>[] = [
  {
    key: "businessType",
    label: "Che tipo di business wine stai guidando?",
    description:
      "Partiamo dalla struttura reale del business, non dal ruolo ideale che vorresti avere.",
    options: [
      { value: "creator-media", label: "Creator, media o formazione wine" },
      { value: "cantina-enoteca", label: "Cantina, enoteca o wine shop" },
      { value: "horeca-buyer", label: "Horeca, buyer o gestione selezione" },
      { value: "consulenza-distribuzione", label: "Consulenza, distribuzione o brand commerciale" }
    ]
  },
  {
    key: "mainProblem",
    label: "Qual è il problema che oggi ti sta rallentando di più?",
    description:
      "Qui individuiamo il collo di bottiglia operativo che ti impedisce di scalare bene.",
    options: [
      { value: "acquisizione-instabile", label: "Entrano poche richieste o in modo irregolare" },
      { value: "clienti-non-ritornano", label: "I clienti comprano ma non ritornano abbastanza" },
      { value: "processi-manuali", label: "Segui tutto a mano e perdi tempo operativo" },
      { value: "contenuti-incostanti", label: "I contenuti escono male o troppo lentamente" }
    ]
  },
  {
    key: "systemLevel",
    label: "A che livello è oggi il tuo sistema?",
    description:
      "Così capiamo se devi costruire una base, ordinare un sistema frammentato o ottimizzare uno già esistente.",
    options: [
      { value: "nessun-sistema", label: "Non c'è ancora un vero sistema" },
      { value: "parziale", label: "Esiste qualcosa ma funziona solo a tratti" },
      { value: "frammentato", label: "Ci sono pezzi utili ma non lavorano insieme" },
      { value: "strutturato", label: "Esiste già un sistema ma va reso più profittevole" }
    ]
  },
  {
    key: "toolsUsed",
    label: "Quali strumenti usi davvero oggi?",
    description:
      "Il punto non è quanti tool hai, ma quanto sono collegati a un flusso commerciale coerente.",
    options: [
      { value: "manuale", label: "Chat, note, fogli e molta gestione manuale" },
      { value: "contenuti-base", label: "Social, newsletter o contenuti base" },
      { value: "crm-automation", label: "CRM, email o automazioni già impostate" },
      { value: "stack-misto", label: "Uno stack misto con tool non del tutto integrati" }
    ]
  },
  {
    key: "mainGoal",
    label: "Qual è l'obiettivo più importante dei prossimi mesi?",
    description:
      "L'ultima risposta trasforma la diagnosi in una direzione di crescita chiara.",
    options: [
      { value: "piu-lead", label: "Aumentare i lead qualificati" },
      { value: "piu-riacquisti", label: "Far tornare clienti e richieste con più continuità" },
      { value: "piu-automazione", label: "Ridurre il lavoro manuale con più automazioni" },
      { value: "piu-contenuti", label: "Produrre contenuti migliori che portano vendite" }
    ]
  }
] as const;

const SYSTEM_LIBRARY: Record<
  BusinessSystemId,
  {
    systemName: string;
    diagnosisSentence: string;
    features: string[];
    benefits: string[];
    accentClass: string;
    accentTextClass: string;
  }
> = {
  acquisition: {
    systemName: "Acquisition System",
    diagnosisSentence:
      "La diagnosi è netta: il tuo business wine ha bisogno prima di tutto di un sistema di acquisizione.",
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
    ],
    accentClass: "bg-burgundy",
    accentTextClass: "text-cream"
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
    ],
    accentClass: "bg-bottle",
    accentTextClass: "text-cream"
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
    ],
    accentClass: "bg-ink",
    accentTextClass: "text-cream"
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
    ],
    accentClass: "bg-bottle",
    accentTextClass: "text-cream"
  }
};

function getInitialAnswers(focus?: BusinessFocus): BusinessQuizAnswers {
  if (focus === "buyer") {
    return {
      businessType: "horeca-buyer",
      mainProblem: "processi-manuali",
      systemLevel: "frammentato",
      toolsUsed: "manuale",
      mainGoal: "piu-riacquisti"
    };
  }

  if (focus === "creator") {
    return {
      businessType: "creator-media",
      mainProblem: "contenuti-incostanti",
      systemLevel: "parziale",
      toolsUsed: "contenuti-base",
      mainGoal: "piu-contenuti"
    };
  }

  return {
    businessType: "cantina-enoteca",
    mainProblem: "acquisizione-instabile",
    systemLevel: "parziale",
    toolsUsed: "contenuti-base",
    mainGoal: "piu-lead"
  };
}

function mapBusinessQuizToQuizAnswers(answers: BusinessQuizAnswers): QuizAnswers {
  const mapped: QuizAnswers = {
    level: "intermedio",
    goal: "business-crescita",
    taste: "esploratore",
    budget: "medio",
    journey: "semplice-pratico"
  };

  if (answers.businessType === "creator-media") {
    mapped.level = "intermedio";
    mapped.goal = "business-ai";
    mapped.taste = "esploratore";
    mapped.journey = "creativo-moderno";
  }

  if (answers.businessType === "cantina-enoteca") {
    mapped.level = "professionista";
    mapped.goal = "business-crescita";
    mapped.taste = "strutturato";
    mapped.budget = "alto";
    mapped.journey = "semplice-pratico";
  }

  if (answers.businessType === "horeca-buyer") {
    mapped.level = "professionista";
    mapped.goal = "acquisto-professionale";
    mapped.taste = "elegante";
    mapped.budget = "alto";
    mapped.journey = "professionale-tecnico";
  }

  if (answers.businessType === "consulenza-distribuzione") {
    mapped.level = "esperto";
    mapped.goal = "business-crescita";
    mapped.taste = "elegante";
    mapped.budget = "alto";
    mapped.journey = "professionale-tecnico";
  }

  if (answers.mainProblem === "contenuti-incostanti") {
    mapped.goal = "business-ai";
    mapped.taste = "esploratore";
    mapped.journey = "creativo-moderno";
  }

  if (answers.mainProblem === "processi-manuali") {
    mapped.goal = "business-ai";
    mapped.journey = "professionale-tecnico";
  }

  if (answers.mainProblem === "clienti-non-ritornano") {
    mapped.goal = "business-crescita";
    mapped.taste = "morbido";
  }

  if (answers.mainProblem === "acquisizione-instabile") {
    mapped.goal = "business-crescita";
    mapped.taste = "fresco";
  }

  if (answers.systemLevel === "nessun-sistema") {
    mapped.level = "intermedio";
    mapped.budget = "medio";
  }

  if (answers.systemLevel === "frammentato") {
    mapped.level = "professionista";
  }

  if (answers.systemLevel === "strutturato") {
    mapped.level = "esperto";
    mapped.budget = "molto-alto";
  }

  if (answers.toolsUsed === "crm-automation") {
    mapped.level = mapped.level === "intermedio" ? "professionista" : mapped.level;
    mapped.journey = "professionale-tecnico";
  }

  if (answers.toolsUsed === "stack-misto") {
    mapped.level = "esperto";
    mapped.journey = "esclusivo-approfondito";
  }

  if (answers.mainGoal === "piu-lead") {
    mapped.goal = "business-crescita";
  }

  if (answers.mainGoal === "piu-riacquisti") {
    mapped.goal =
      answers.businessType === "horeca-buyer"
        ? "acquisto-professionale"
        : "business-crescita";
    mapped.taste = "elegante";
  }

  if (answers.mainGoal === "piu-automazione") {
    mapped.goal = "business-ai";
    mapped.journey = "professionale-tecnico";
  }

  if (answers.mainGoal === "piu-contenuti") {
    mapped.goal = "business-ai";
    mapped.journey = "creativo-moderno";
    mapped.taste = "esploratore";
  }

  return mapped;
}

function buildBusinessDiagnosticResult(
  answers: BusinessQuizAnswers,
  recommendation: RecommendApiResponse
): BusinessDiagnosticResult {
  const system = detectBusinessSystem(answers);
  const systemConfig = SYSTEM_LIBRARY[system];
  const recommendedSystem = recommendation.agentDecision.recommendedSystem;
  const isBuyerTrack = recommendation.segment === "buyer-professionale";
  const targetLabel = isBuyerTrack
    ? "Wine Buyer Academy"
    : recommendation.productRecommendation.name;
  const targetHref = isBuyerTrack ? "/academy" : "/wine-ai-mastery";
  const targetPrice = isBuyerTrack ? "€1.490" : "€249";

  return {
    system,
    systemName: recommendedSystem?.name ?? systemConfig.systemName,
    diagnosisSentence:
      recommendation.agentDecision.diagnosis ?? systemConfig.diagnosisSentence,
    problemExplanation:
      recommendedSystem?.summary ??
      `Oggi operi come ${
      BUSINESS_TYPE_LABELS[answers.businessType]
    }, con un sistema ${
      SYSTEM_LEVEL_LABELS[answers.systemLevel]
    } e strumenti ${TOOLS_LABELS[answers.toolsUsed]}. Il nodo più evidente è ${
      MAIN_PROBLEM_LABELS[answers.mainProblem]
    }, mentre il tuo obiettivo più forte resta ${
      MAIN_GOAL_LABELS[answers.mainGoal]
    }. Questo è esattamente il punto in cui un ${systemConfig.systemName} crea più leva.`,
    features: recommendedSystem?.features ?? systemConfig.features,
    benefits: recommendedSystem?.benefits ?? systemConfig.benefits,
    accentClass: systemConfig.accentClass,
    accentTextClass: systemConfig.accentTextClass,
    targetLabel,
    targetHref,
    targetPrice
  };
}

function BusinessPreviewPanel({
  answers,
  hasInteracted
}: {
  answers: BusinessQuizAnswers;
  hasInteracted: boolean;
}) {
  const system = hasInteracted ? detectBusinessSystem(answers) : null;
  const preview = system ? SYSTEM_LIBRARY[system] : null;

  if (!preview) {
    return (
      <div className="card-surface flex h-full min-h-[450px] flex-col justify-center p-8">
        <p className="section-eyebrow">Diagnosi business</p>
        <h3 className="mt-4 text-3xl text-ink">
          Qui vedrai il sistema che oggi manca davvero al tuo business wine.
        </h3>
        <p className="mt-4 max-w-xl leading-7 text-ink/75">
          La diagnosi non ti dirà solo “chi sei”, ma quale impianto devi
          costruire per far crescere contenuti, clienti e vendite in modo più
          ordinato.
        </p>
        <div className="mt-8 grid gap-3">
          {[
            "Acquisition System",
            "Retention System",
            "Automation System",
            "Content System"
          ].map((item) => (
            <div
              key={item}
              className="rounded-2xl border border-burgundy/10 bg-cream/55 px-4 py-4 text-sm font-semibold text-ink/75"
            >
              {item}
            </div>
          ))}
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface flex h-full min-h-[450px] flex-col justify-between overflow-hidden p-0">
      <div className="flex-1 p-8">
        <p className="section-eyebrow">Preview diagnosi</p>
        <h3 className="mt-4 text-4xl font-bold text-ink">{preview.systemName}</h3>
        <p className="mt-4 leading-7 text-ink/75">{preview.diagnosisSentence}</p>
      </div>
      <div className={`${preview.accentClass} ${preview.accentTextClass} px-8 py-6`}>
        <p className="text-xs uppercase tracking-[0.22em] text-gold/85">
          Probabile priorità di sistema
        </p>
        <p className="mt-2 text-lg font-semibold">
          {MAIN_GOAL_LABELS[answers.mainGoal]}
        </p>
      </div>
    </div>
  );
}

function BusinessDiagnosisResult({
  answers,
  recommendation,
  diagnosis
}: {
  answers: BusinessQuizAnswers;
  recommendation: RecommendApiResponse;
  diagnosis: BusinessDiagnosticResult;
}) {
  const [showLeadForm, setShowLeadForm] = useState(false);
  const businessTypeLabel = BUSINESS_TYPE_LABELS[answers.businessType];

  return (
    <section className="space-y-6">
      <div className={`${diagnosis.accentClass} ${diagnosis.accentTextClass} rounded-[28px] p-6 shadow-soft sm:p-8`}>
        <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">
          Diagnosi completata
        </p>
        <h2 className="mt-3 text-3xl sm:text-4xl">{diagnosis.systemName}</h2>
        <p className="mt-4 max-w-3xl text-lg leading-8 opacity-90">
          {diagnosis.diagnosisSentence}
        </p>
        <div className="mt-6 inline-flex rounded-full border border-white/15 bg-white/10 px-4 py-2 text-sm font-semibold">
          Destinazione consigliata: {diagnosis.targetLabel} · {diagnosis.targetPrice}
        </div>
      </div>

      <div className="card-surface p-6 sm:p-8">
        <p className="section-eyebrow">Perché questa diagnosi</p>
        <p className="mt-4 leading-8 text-ink/75">{diagnosis.problemExplanation}</p>
      </div>

      <div className="grid gap-6 lg:grid-cols-[1.05fr_0.95fr]">
        <article className="card-surface p-6 sm:p-8">
          <p className="section-eyebrow">Sistema consigliato</p>
          <h3 className="mt-3 text-2xl text-ink">{diagnosis.systemName}</h3>
          <div className="mt-6 space-y-3">
            {diagnosis.features.map((feature) => (
              <div
                key={feature}
                className="rounded-2xl border border-burgundy/10 bg-cream/50 px-4 py-4 text-sm leading-6 text-ink/75"
              >
                {feature}
              </div>
            ))}
          </div>
        </article>

        <article className="card-surface p-6 sm:p-8">
          <p className="section-eyebrow">Benefici</p>
          <ul className="mt-6 space-y-4">
            {diagnosis.benefits.map((benefit) => (
              <li
                key={benefit}
                className="rounded-2xl border border-bottle/10 bg-bottle/5 px-4 py-4 leading-6 text-ink/75"
              >
                {benefit}
              </li>
            ))}
          </ul>

          <div className="mt-8 rounded-[24px] bg-burgundy p-6 text-cream">
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-gold/90">
              Next best step
            </p>
            <h4 className="mt-3 text-2xl">{diagnosis.targetLabel}</h4>
            <p className="mt-3 leading-7 text-cream/82">
              {recommendation.agentDecision.nextAction}
            </p>
            <button
              type="button"
              onClick={() => {
                setShowLeadForm(true);
                track("quiz_business_activate_system_click", {
                  system: diagnosis.system,
                  destination: diagnosis.targetLabel,
                  segment: recommendation.segment
                });
              }}
              className="mt-6 inline-flex w-full justify-center rounded-full bg-cream px-6 py-3 text-center text-sm font-semibold text-burgundy transition hover:bg-gold sm:w-auto"
            >
              Attiva il tuo sistema
            </button>
          </div>
        </article>
      </div>

      {showLeadForm ? (
        <BusinessLeadCaptureCard
          businessTypeLabel={businessTypeLabel}
          diagnosis={diagnosis}
          recommendation={recommendation}
        />
      ) : null}
    </section>
  );
}

function BusinessLeadCaptureCard({
  businessTypeLabel,
  diagnosis,
  recommendation
}: BusinessLeadCaptureCardProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<LeadCaptureResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  const quizResultLabel = `${diagnosis.systemName} → ${diagnosis.targetLabel}`;

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    const payload: LeadCapturePayload = {
      name,
      email,
      source: "quiz-business-result",
      segment: recommendation.segment,
      interest: quizResultLabel,
      businessType: businessTypeLabel,
      quizResult: quizResultLabel,
      message: message || undefined,
      notes: message || undefined,
      agentName: recommendation.agentDecision.agentName,
      nextAction: recommendation.agentDecision.nextAction,
      agentDecision: recommendation.agentDecision
    };

    try {
      const response = await fetch("/api/lead", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      const result = (await response.json()) as LeadCaptureResponse;

      if (!response.ok) {
        setStatus(result);
        return;
      }

      setStatus({
        success: true,
        message:
          "Richiesta ricevuta. Ti ricontatteremo per costruire il sistema più adatto al tuo business del vino."
      });
      track("business_lead_submitted", {
        system: diagnosis.system,
        destination: diagnosis.targetLabel,
        segment: recommendation.segment,
        businessType: businessTypeLabel
      });
      setName("");
      setEmail("");
      setMessage("");
    } catch {
      setStatus({
        success: false,
        message: "Invio non riuscito. Riprova tra un momento."
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="card-surface p-6 sm:p-8">
      <p className="section-eyebrow">Attivazione sistema</p>
      <h3 className="mt-3 text-2xl text-ink">
        Lascia i dati e costruiamo il sistema giusto
      </h3>
      <p className="mt-3 max-w-3xl leading-7 text-ink/75">
        Ti ricontattiamo partendo dalla diagnosi che hai appena ottenuto, senza
        farti ripetere tutto da capo.
      </p>

      <form className="mt-6 space-y-4" onSubmit={handleSubmit}>
        <div className="grid gap-4 sm:grid-cols-2">
          <input
            type="text"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Nome"
            required
            className="w-full rounded-2xl border border-burgundy/10 bg-cream/55 px-4 py-3 text-sm text-ink outline-none transition focus:border-burgundy"
          />
          <input
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Email"
            required
            className="w-full rounded-2xl border border-burgundy/10 bg-cream/55 px-4 py-3 text-sm text-ink outline-none transition focus:border-burgundy"
          />
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <div className="rounded-2xl border border-burgundy/10 bg-white/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-burgundy/70">
              Tipo attivita
            </p>
            <p className="mt-2 text-sm text-ink/80">{businessTypeLabel}</p>
          </div>
          <div className="rounded-2xl border border-burgundy/10 bg-white/70 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-burgundy/70">
              Risultato quiz / sistema consigliato
            </p>
            <p className="mt-2 text-sm text-ink/80">{quizResultLabel}</p>
          </div>
        </div>

        <textarea
          value={message}
          onChange={(event) => setMessage(event.target.value)}
          placeholder="Messaggio opzionale"
          rows={4}
          className="w-full rounded-2xl border border-burgundy/10 bg-cream/55 px-4 py-3 text-sm text-ink outline-none transition focus:border-burgundy"
        />

        <button
          type="submit"
          disabled={isSubmitting}
          className="inline-flex w-full justify-center rounded-full bg-burgundy px-6 py-3 text-center text-sm font-semibold text-cream transition hover:bg-burgundy/90 disabled:opacity-60 sm:w-auto"
        >
          {isSubmitting ? "Invio in corso..." : "Attiva il tuo sistema"}
        </button>
      </form>

      {status ? (
        <div
          className={`mt-4 rounded-2xl px-4 py-4 text-sm leading-6 ${
            status.success
              ? "bg-bottle/10 text-bottle"
              : "bg-burgundy/10 text-burgundy"
          }`}
        >
          <p className="font-semibold">{status.message}</p>
        </div>
      ) : null}
    </div>
  );
}

export function BusinessQuizForm({ focus }: { focus?: BusinessFocus }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<BusinessQuizAnswers>(
    getInitialAnswers(focus)
  );
  const [result, setResult] = useState<RecommendApiResponse | null>(null);
  const [diagnosis, setDiagnosis] = useState<BusinessDiagnosticResult | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(Boolean(focus));

  const step = steps[currentStep];

  useEffect(() => {
    setAnswers(getInitialAnswers(focus));
    setCurrentStep(0);
    setResult(null);
    setDiagnosis(null);
    setError(null);
    setHasInteracted(Boolean(focus));
  }, [focus]);

  useEffect(() => {
    track("quiz_business_started", { focus: focus ?? "generic" });
  }, [focus]);

  function updateAnswer(value: BusinessQuizAnswers[BusinessStepKey]) {
    setHasInteracted(true);
    setResult(null);
    setDiagnosis(null);
    setAnswers((prev) => ({
      ...prev,
      [step.key]: value
    }) as BusinessQuizAnswers);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    const payload = mapBusinessQuizToQuizAnswers(answers);

    try {
      const requestBody: RecommendRequestPayload = {
        ...payload,
        context: {
          flow: "business",
          source: "quiz-business",
          businessQuizAnswers: answers
        }
      };

      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(requestBody)
      });

      if (!response.ok) {
        throw new Error("Impossibile generare la diagnosi business.");
      }

      const data = (await response.json()) as RecommendApiResponse;
      const diagnosticResult = buildBusinessDiagnosticResult(answers, data);

      setResult(data);
      setDiagnosis(diagnosticResult);
      track("business_quiz_completed", {
        focus: focus ?? "generic",
        resultSegment: data.segment,
        agent: data.agentDecision.agentName,
        system: diagnosticResult.system,
        answers
      });
    } catch (submissionError) {
      setError(
        submissionError instanceof Error
          ? submissionError.message
          : "Si è verificato un errore inatteso."
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className="grid gap-8 lg:grid-cols-[0.92fr_1.08fr]">
      <section className="card-surface p-6 sm:p-8">
        <div className="flex items-center justify-between gap-4">
          <p className="section-eyebrow">
            Step {currentStep + 1} di {steps.length}
          </p>
          <div className="flex gap-2">
            {steps.map((_, index) => (
              <span
                key={index}
                className={`h-2.5 w-10 rounded-full ${
                  index <= currentStep ? "bg-burgundy" : "bg-burgundy/15"
                }`}
              />
            ))}
          </div>
        </div>

        <h2 className="mt-5 text-3xl text-ink">{step.label}</h2>
        <p className="mt-3 leading-7 text-ink/75">{step.description}</p>

        <div className="mt-8 space-y-3">
          {step.options.map((option) => {
            const isActive = answers[step.key] === option.value;

            return (
              <button
                key={option.value}
                type="button"
                onClick={() => updateAnswer(option.value)}
                className={`w-full rounded-[22px] border px-4 py-4 text-left transition ${
                  isActive
                    ? "border-burgundy bg-burgundy text-cream"
                    : "border-burgundy/10 bg-white/60 text-ink hover:border-burgundy/30"
                }`}
              >
                <span className="text-base font-semibold">{option.label}</span>
              </button>
            );
          })}
        </div>

        <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:justify-between">
          <button
            type="button"
            disabled={currentStep === 0}
            onClick={() => setCurrentStep((prev) => Math.max(prev - 1, 0))}
            className="rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy disabled:cursor-not-allowed disabled:opacity-40"
          >
            Indietro
          </button>
          {currentStep < steps.length - 1 ? (
            <button
              type="button"
              onClick={() => {
                track("quiz_business_step_completed", {
                  step: currentStep + 1,
                  key: step.key,
                  answer: answers[step.key]
                });
                setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1));
              }}
              className="rounded-full bg-burgundy px-5 py-3 text-sm font-semibold text-cream"
            >
              Continua
            </button>
          ) : (
            <button
              type="button"
              onClick={handleSubmit}
              disabled={isSubmitting}
              className="rounded-full bg-bottle px-5 py-3 text-sm font-semibold text-cream disabled:opacity-60"
            >
              {isSubmitting ? "Sto preparando la diagnosi..." : "Vedi la diagnosi"}
            </button>
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-burgundy">{error}</p> : null}
      </section>

      <div>
        {result && diagnosis ? (
          <BusinessDiagnosisResult
            answers={answers}
            recommendation={result}
            diagnosis={diagnosis}
          />
        ) : (
          <BusinessPreviewPanel answers={answers} hasInteracted={hasInteracted} />
        )}
      </div>
    </div>
  );
}
