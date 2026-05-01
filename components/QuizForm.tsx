"use client";

import { useState, useEffect } from "react";

import { RecommendationCard } from "@/components/RecommendationCard";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";
import { track } from "@/lib/track";

type StepKey = keyof QuizAnswers;

type StepOption<T extends StepKey> = {
  value: QuizAnswers[T];
  label: string;
};

type StepDefinition<T extends StepKey> = {
  key: T;
  label: string;
  description: string;
  options: StepOption<T>[];
};

const steps: StepDefinition<StepKey>[] = [
  {
    key: "level",
    label: "Qual è il tuo livello nel vino?",
    description: "Per capire da dove partire con il giusto ritmo.",
    options: [
      { value: "principiante", label: "Sto iniziando da zero" },
      { value: "intermedio", label: "Ho una base e voglio capire di più" },
      { value: "professionista", label: "Lavoro già nel settore" },
      { value: "esperto", label: "Sono appassionato avanzato / collezionista" }
    ]
  },
  {
    key: "goal",
    label: "Cosa vuoi ottenere soprattutto?",
    description: "Così il sistema ti accompagna verso il prossimo passo migliore.",
    options: [
      { value: "scegliere-meglio", label: "Bere e scegliere meglio" },
      { value: "imparare", label: "Imparare in modo semplice e guidato" },
      { value: "business-ai", label: "Creare contenuti / usare l'AI nel vino" },
      { value: "business-crescita", label: "Far crescere un business nel vino" },
      { value: "acquisto-professionale", label: "Migliorare acquisti, selezione o strategia" }
    ]
  },
  {
    key: "taste",
    label: "Quale stile di vino ti rappresenta di più?",
    description: "Ogni suggerimento parte dal tuo gusto reale, non da etichette vuote.",
    options: [
      { value: "fresco", label: "Fresco e leggero" },
      { value: "morbido", label: "Morbido e rotondo" },
      { value: "strutturato", label: "Strutturato e intenso" },
      { value: "elegante", label: "Elegante e complesso" },
      { value: "esploratore", label: "Amo esplorare un po' tutto" }
    ]
  },
  {
    key: "budget",
    label: "Qual è il tuo budget medio per bottiglia?",
    description: "Serve a suggerire etichette coerenti con il tuo momento di acquisto.",
    options: [
      { value: "basso", label: "Sotto i 15€" },
      { value: "medio", label: "15€–30€" },
      { value: "alto", label: "30€–60€" },
      { value: "molto-alto", label: "Oltre 60€" }
    ]
  },
  {
    key: "journey",
    label: "Vuoi un percorso più…",
    description: "L'ultimo segnale che affina il tuo profilo e il prodotto consigliato.",
    options: [
      { value: "semplice-pratico", label: "Semplice e pratico" },
      { value: "creativo-moderno", label: "Creativo e moderno" },
      { value: "professionale-tecnico", label: "Professionale e tecnico" },
      { value: "esclusivo-approfondito", label: "Esclusivo e approfondito" }
    ]
  }
] as const;

const initialAnswers: QuizAnswers = {
  level: "principiante",
  goal: "imparare",
  taste: "morbido",
  budget: "medio",
  journey: "semplice-pratico"
};

type PreviewSegment = "neutral" | "creator" | "business";

function detectPreview(answers: QuizAnswers): PreviewSegment {
  if (answers.goal === "business-ai") return "creator";
  if (answers.goal === "acquisto-professionale") return "business";
  if (answers.goal === "business-crescita") {
    if (answers.journey === "creativo-moderno") return "creator";
    return "business";
  }
  return "neutral";
}

const PREVIEW_CONTENT: Record<PreviewSegment, {
  eyebrow: string;
  title: string;
  description: string;
  hint: string;
  accent: string;
  product?: string;
  price?: string;
}> = {
  neutral: {
    eyebrow: "Risultato personalizzato",
    title: "Il tuo profilo Divino sta prendendo forma",
    description: "Rispondi a poche domande e qui vedrai comparire l'anteprima del percorso più adatto a te.",
    hint: "",
    accent: "neutral",
  },
  creator: {
    eyebrow: "Profilo in costruzione",
    title: "Creator",
    description: "Stai costruendo un sistema per creare contenuti wine che attirano, educano e convertono.",
    hint: "Continua il quiz per vedere il tuo piano consigliato.",
    accent: "bottle",
    product: "Wine AI Mastery",
    price: "€249",
  },
  business: {
    eyebrow: "Profilo in costruzione",
    title: "Business",
    description: "Stai ottimizzando decisioni di acquisto, margini e selezione con un approccio più strutturato.",
    hint: "Continua il quiz per vedere il tuo piano consigliato.",
    accent: "burgundy",
    product: "Wine Buyer Academy",
    price: "€1.490",
  },
};

function QuizPreviewPanel({ answers }: { answers: QuizAnswers }) {
  const segment = detectPreview(answers);
  const content = PREVIEW_CONTENT[segment];

  if (segment === "creator") {
    return (
      <div className="card-surface flex h-full min-h-[420px] flex-col justify-between overflow-hidden p-0">
        <div className="flex-1 p-8">
          <p className="section-eyebrow text-bottle/80">{content.eyebrow}</p>
          <h3 className="mt-4 text-4xl font-bold text-ink">{content.title}</h3>
          <p className="mt-4 leading-7 text-ink/75">{content.description}</p>
          <p className="mt-6 text-sm text-ink/45 italic">{content.hint}</p>
        </div>
        <div className="bg-bottle px-8 py-6 text-cream">
          <p className="text-xs uppercase tracking-[0.22em] text-gold/80">Percorso consigliato</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-xl font-semibold">{content.product}</span>
            <span className="text-2xl font-bold text-gold">{content.price}</span>
          </div>
        </div>
      </div>
    );
  }

  if (segment === "business") {
    return (
      <div className="card-surface flex h-full min-h-[420px] flex-col justify-between overflow-hidden p-0">
        <div className="flex-1 p-8">
          <p className="section-eyebrow text-burgundy/70">{content.eyebrow}</p>
          <h3 className="mt-4 text-4xl font-bold text-ink">{content.title}</h3>
          <p className="mt-4 leading-7 text-ink/75">{content.description}</p>
          <p className="mt-6 text-sm text-ink/45 italic">{content.hint}</p>
        </div>
        <div className="bg-burgundy px-8 py-6 text-cream">
          <p className="text-xs uppercase tracking-[0.22em] text-gold/80">Percorso consigliato</p>
          <div className="mt-2 flex items-baseline gap-3">
            <span className="text-xl font-semibold">{content.product}</span>
            <span className="text-2xl font-bold text-gold">{content.price}</span>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="card-surface flex h-full min-h-[420px] flex-col justify-center p-8">
      <p className="section-eyebrow">{content.eyebrow}</p>
      <h3 className="mt-4 text-3xl text-ink">{content.title}</h3>
      <p className="mt-4 max-w-xl leading-7 text-ink/75">{content.description}</p>
    </div>
  );
}

export function QuizForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(initialAnswers);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[currentStep];

  useEffect(() => {
    track("quiz_started");
  }, []);

  function updateAnswer(value: QuizAnswers[StepKey]) {
    setAnswers((prev) => ({
      ...prev,
      [step.key]: value
    }) as QuizAnswers);
  }

  async function handleSubmit() {
    setIsSubmitting(true);
    setError(null);

    try {
      const response = await fetch("/api/recommend", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(answers)
      });

      if (!response.ok) {
        throw new Error("Impossibile generare la raccomandazione.");
      }

      const payload = (await response.json()) as RecommendationResponse;
      setResult(payload);
      track("quiz_completed", { segment: payload.segment, answers });
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
    <div className="grid gap-8 lg:grid-cols-[0.9fr_1.1fr]">
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
                track("quiz_step_completed", { step: currentStep + 1, key: step.key, answer: answers[step.key] });
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
              {isSubmitting ? "Sto preparando i consigli..." : "Vedi il risultato"}
            </button>
          )}
        </div>

        {error ? <p className="mt-4 text-sm text-burgundy">{error}</p> : null}
      </section>

      <div>
        {result ? (
          <RecommendationCard result={result} />
        ) : (
          <QuizPreviewPanel answers={answers} />
        )}
      </div>
    </div>
  );
}
