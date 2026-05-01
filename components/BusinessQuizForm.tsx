"use client";

import { useEffect, useState } from "react";

import { RecommendationCard } from "@/components/RecommendationCard";
import { track } from "@/lib/track";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

type BusinessFocus = "creator" | "buyer";

type BusinessQuizAnswers = {
  role:
    | "creator-formatore"
    | "cantina-enoteca"
    | "consulente-brand"
    | "buyer-horeca";
  priority: "contenuti" | "lead" | "vendite" | "selezione";
  stage: "base" | "attivo" | "scala" | "premium";
  approach: QuizAnswers["journey"];
};

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

const steps: BusinessStepDefinition<BusinessStepKey>[] = [
  {
    key: "role",
    label: "Che tipo di progetto o ruolo hai oggi?",
    description:
      "Questa risposta ci dice da quale lato del business del vino stai operando davvero.",
    options: [
      { value: "creator-formatore", label: "Creator, formatore o progetto media wine" },
      { value: "cantina-enoteca", label: "Cantina, enoteca o wine shop" },
      { value: "consulente-brand", label: "Consulenza, brand o progetto commerciale" },
      { value: "buyer-horeca", label: "Buyer, horeca o selezione professionale" }
    ]
  },
  {
    key: "priority",
    label: "Qual è la priorità più urgente?",
    description:
      "Così il quiz capisce se il collo di bottiglia è contenuto, acquisizione, conversione o selezione.",
    options: [
      { value: "contenuti", label: "Produrre contenuti migliori e più veloci" },
      { value: "lead", label: "Generare più lead e richieste" },
      { value: "vendite", label: "Vendere con un sistema più chiaro" },
      { value: "selezione", label: "Migliorare selezione, acquisti e marginalità" }
    ]
  },
  {
    key: "stage",
    label: "Quanto è strutturato oggi il tuo business?",
    description:
      "Serve a capire se hai bisogno di partire da un impianto snello o da un framework più avanzato.",
    options: [
      { value: "base", label: "Sto costruendo la base" },
      { value: "attivo", label: "Ho già un'attività o un pubblico attivo" },
      { value: "scala", label: "Voglio scalare un sistema già funzionante" },
      { value: "premium", label: "Gestisco già decisioni o budget rilevanti" }
    ]
  },
  {
    key: "approach",
    label: "Che tipo di percorso cerchi?",
    description:
      "L'ultimo segnale ci aiuta a capire tono, profondità e stile della soluzione migliore.",
    options: [
      { value: "semplice-pratico", label: "Snello e pratico" },
      { value: "creativo-moderno", label: "Creativo e moderno" },
      { value: "professionale-tecnico", label: "Professionale e tecnico" },
      { value: "esclusivo-approfondito", label: "Premium e approfondito" }
    ]
  }
];

function getInitialAnswers(focus?: BusinessFocus): BusinessQuizAnswers {
  if (focus === "buyer") {
    return {
      role: "buyer-horeca",
      priority: "selezione",
      stage: "premium",
      approach: "professionale-tecnico"
    };
  }

  if (focus === "creator") {
    return {
      role: "creator-formatore",
      priority: "contenuti",
      stage: "attivo",
      approach: "creativo-moderno"
    };
  }

  return {
    role: "cantina-enoteca",
    priority: "lead",
    stage: "attivo",
    approach: "semplice-pratico"
  };
}

function mapBusinessQuizToQuizAnswers(
  answers: BusinessQuizAnswers
): QuizAnswers {
  const mapped: QuizAnswers = {
    level: "intermedio",
    goal: "business-crescita",
    taste: "esploratore",
    budget: "medio",
    journey: answers.approach
  };

  if (answers.role === "creator-formatore") {
    mapped.level = "intermedio";
    mapped.goal = "business-ai";
    mapped.taste = "esploratore";
    mapped.budget = "medio";
  }

  if (answers.role === "cantina-enoteca") {
    mapped.level = "professionista";
    mapped.goal = "business-crescita";
    mapped.taste = "strutturato";
    mapped.budget = "alto";
  }

  if (answers.role === "consulente-brand") {
    mapped.level = "intermedio";
    mapped.goal = "business-crescita";
    mapped.taste = "elegante";
    mapped.budget = "medio";
  }

  if (answers.role === "buyer-horeca") {
    mapped.level = "professionista";
    mapped.goal = "acquisto-professionale";
    mapped.taste = "elegante";
    mapped.budget = "alto";
  }

  if (answers.priority === "contenuti") {
    mapped.goal = "business-ai";
    mapped.taste = "esploratore";
  }

  if (answers.priority === "lead") {
    mapped.goal = "business-crescita";
    mapped.taste =
      answers.role === "creator-formatore" ? "esploratore" : "elegante";
  }

  if (answers.priority === "vendite") {
    mapped.goal = "business-crescita";
    mapped.taste = "strutturato";
    mapped.budget = "alto";
  }

  if (answers.priority === "selezione") {
    mapped.goal = "acquisto-professionale";
    mapped.level = "professionista";
    mapped.taste = "elegante";
    mapped.budget = "alto";
  }

  if (answers.stage === "base") {
    mapped.level = "intermedio";
    mapped.budget = "medio";
  }

  if (answers.stage === "scala") {
    mapped.level = "professionista";
    mapped.budget = "alto";
  }

  if (answers.stage === "premium") {
    mapped.level = "esperto";
    mapped.budget = "molto-alto";
  }

  return mapped;
}

type BusinessPreviewKind = "neutral" | "creator" | "commerciale" | "buyer";

function detectBusinessPreview(answers: BusinessQuizAnswers): BusinessPreviewKind {
  if (answers.role === "buyer-horeca" || answers.priority === "selezione") {
    return "buyer";
  }

  if (
    answers.role === "creator-formatore" ||
    answers.priority === "contenuti" ||
    answers.approach === "creativo-moderno"
  ) {
    return "creator";
  }

  if (
    answers.priority === "lead" ||
    answers.priority === "vendite" ||
    answers.role === "cantina-enoteca" ||
    answers.role === "consulente-brand"
  ) {
    return "commerciale";
  }

  return "neutral";
}

const PREVIEW_CONTENT: Record<
  BusinessPreviewKind,
  {
    eyebrow: string;
    title: string;
    description: string;
    accentClass: string;
    offerLabel?: string;
    offerPrice?: string;
  }
> = {
  neutral: {
    eyebrow: "Diagnosi business",
    title: "Qui vedrai il percorso business più adatto",
    description:
      "Il quiz distingue tra crescita contenuti, crescita commerciale e decisione buyer, poi ti indirizza all’offerta più coerente.",
    accentClass: "bg-white/70"
  },
  creator: {
    eyebrow: "Preview percorso",
    title: "Creator & AI",
    description:
      "Stai segnalando bisogno di contenuti migliori, sistemi più veloci e un impianto editoriale che converte.",
    accentClass: "bg-bottle text-cream",
    offerLabel: "Wine AI Mastery",
    offerPrice: "€249"
  },
  commerciale: {
    eyebrow: "Preview percorso",
    title: "Business Growth",
    description:
      "Il tuo caso sembra commerciale: lead, vendite, posizionamento e chiarezza di offerta contano più della semplice produzione contenuti.",
    accentClass: "bg-burgundy text-cream",
    offerLabel: "Wine AI Mastery",
    offerPrice: "€249"
  },
  buyer: {
    eyebrow: "Preview percorso",
    title: "Buyer Premium",
    description:
      "Il tuo profilo richiede un framework più tecnico: selezione, marginalità, acquisti e metodo decisionale.",
    accentClass: "bg-ink text-cream",
    offerLabel: "Wine Buyer Academy",
    offerPrice: "€1.490"
  }
};

function BusinessPreviewPanel({
  answers,
  hasInteracted
}: {
  answers: BusinessQuizAnswers;
  hasInteracted: boolean;
}) {
  const preview = hasInteracted ? detectBusinessPreview(answers) : "neutral";
  const content = PREVIEW_CONTENT[preview];

  if (preview === "neutral") {
    return (
      <div className="card-surface flex h-full min-h-[430px] flex-col justify-center p-8">
        <p className="section-eyebrow">{content.eyebrow}</p>
        <h3 className="mt-4 text-3xl text-ink">{content.title}</h3>
        <p className="mt-4 max-w-xl leading-7 text-ink/75">
          {content.description}
        </p>
        <div className="mt-8 grid gap-3">
          {[
            "Creator & AI",
            "Business Growth",
            "Buyer Premium"
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
    <div className="card-surface flex h-full min-h-[430px] flex-col justify-between overflow-hidden p-0">
      <div className="flex-1 p-8">
        <p className="section-eyebrow">{content.eyebrow}</p>
        <h3 className="mt-4 text-4xl font-bold text-ink">{content.title}</h3>
        <p className="mt-4 leading-7 text-ink/75">{content.description}</p>
      </div>
      <div className={`${content.accentClass} px-8 py-6`}>
        <p className="text-xs uppercase tracking-[0.22em] text-gold/85">
          Offerta più probabile
        </p>
        <div className="mt-2 flex items-baseline gap-3">
          <span className="text-xl font-semibold">{content.offerLabel}</span>
          <span className="text-2xl font-bold text-gold">{content.offerPrice}</span>
        </div>
      </div>
    </div>
  );
}

export function BusinessQuizForm({ focus }: { focus?: BusinessFocus }) {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<BusinessQuizAnswers>(
    getInitialAnswers(focus)
  );
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasInteracted, setHasInteracted] = useState(Boolean(focus));

  const step = steps[currentStep];

  useEffect(() => {
    setAnswers(getInitialAnswers(focus));
    setCurrentStep(0);
    setResult(null);
    setError(null);
    setHasInteracted(Boolean(focus));
  }, [focus]);

  useEffect(() => {
    track("quiz_business_started", { focus: focus ?? "generic" });
  }, [focus]);

  function updateAnswer(value: BusinessQuizAnswers[BusinessStepKey]) {
    setHasInteracted(true);
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
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload)
      });

      if (!response.ok) {
        throw new Error("Impossibile generare la raccomandazione business.");
      }

      const data = (await response.json()) as RecommendationResponse;
      setResult(data);
      track("quiz_business_completed", {
        focus: focus ?? "generic",
        resultSegment: data.segment,
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
              {isSubmitting ? "Sto preparando la diagnosi..." : "Vedi la diagnosi business"}
            </button>
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-burgundy">{error}</p> : null}
      </section>

      <div>
        {result ? (
          <RecommendationCard result={result} />
        ) : (
          <BusinessPreviewPanel answers={answers} hasInteracted={hasInteracted} />
        )}
      </div>
    </div>
  );
}
