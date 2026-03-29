"use client";

import { useState } from "react";

import { RecommendationCard } from "@/components/RecommendationCard";
import type { QuizAnswers, RecommendationResponse } from "@/lib/types";

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
    label: "Il tuo livello",
    description: "Per capire da dove partire con il giusto ritmo.",
    options: [
      { value: "principiante", label: "Principiante" },
      { value: "intermedio", label: "Intermedio" },
      { value: "professionista", label: "Professionista" }
    ]
  },
  {
    key: "goal",
    label: "Il tuo obiettivo",
    description: "Così il sistema ti accompagna verso il prossimo passo migliore.",
    options: [
      { value: "imparare", label: "Imparare con metodo" },
      { value: "scegliere-meglio", label: "Scegliere vini migliori" },
      { value: "business-ai", label: "Usare AI e business nel vino" },
      { value: "acquisto-professionale", label: "Acquisto professionale" }
    ]
  },
  {
    key: "taste",
    label: "Stile che preferisci",
    description: "Ogni suggerimento parte dal tuo gusto reale, non da etichette vuote.",
    options: [
      { value: "morbido", label: "Morbido e avvolgente" },
      { value: "fresco", label: "Fresco e teso" },
      { value: "strutturato", label: "Strutturato e intenso" },
      { value: "elegante", label: "Elegante e raffinato" }
    ]
  },
  {
    key: "budget",
    label: "Budget medio per bottiglia",
    description: "Serve a suggerire etichette coerenti con il tuo momento di acquisto.",
    options: [
      { value: "basso", label: "Sotto i 20€" },
      { value: "medio", label: "Tra 20€ e 50€" },
      { value: "alto", label: "Oltre 50€" }
    ]
  }
] as const;

const initialAnswers: QuizAnswers = {
  level: "principiante",
  goal: "imparare",
  taste: "morbido",
  budget: "medio"
};

export function QuizForm() {
  const [currentStep, setCurrentStep] = useState(0);
  const [answers, setAnswers] = useState<QuizAnswers>(initialAnswers);
  const [result, setResult] = useState<RecommendationResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const step = steps[currentStep];

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
              onClick={() =>
                setCurrentStep((prev) => Math.min(prev + 1, steps.length - 1))
              }
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
          <div className="card-surface flex h-full min-h-[420px] flex-col justify-center p-8">
            <p className="section-eyebrow">Risultato personalizzato</p>
            <h3 className="mt-4 text-3xl text-ink">
              Qui comparirà la tua selezione Divino.
            </h3>
            <p className="mt-4 max-w-xl leading-7 text-ink/75">
              Alla fine del quiz vedrai segmento assegnato, punteggi del motore
              decisionale, lead magnet, offerta primaria, CTA post-quiz e due
              vini coerenti con gusto e budget.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
