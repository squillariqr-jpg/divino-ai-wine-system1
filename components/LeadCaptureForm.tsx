"use client";

import type { FormEvent } from "react";
import { useState } from "react";

import type {
  LeadCapturePayload,
  LeadCaptureResponse,
  SegmentId
} from "@/lib/types";

type LeadCaptureFormProps = {
  title: string;
  description: string;
  buttonLabel: string;
  source: string;
  segment?: SegmentId;
  interest?: string;
};

export function LeadCaptureForm({
  title,
  description,
  buttonLabel,
  source,
  segment,
  interest
}: LeadCaptureFormProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<LeadCaptureResponse | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setStatus(null);

    const payload: LeadCapturePayload = {
      name: name || undefined,
      email,
      source,
      segment,
      interest
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
      setStatus(result);

      if (response.ok) {
        setName("");
        setEmail("");
      }
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
    <div className="rounded-[28px] border border-burgundy/12 bg-white/80 p-6 shadow-soft">
      <p className="section-eyebrow">Lead capture</p>
      <h3 className="mt-3 text-2xl text-ink">{title}</h3>
      <p className="mt-3 leading-7 text-ink/75">{description}</p>

      <form className="mt-6 space-y-3" onSubmit={handleSubmit}>
        <input
          type="text"
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Nome"
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
        <button
          type="submit"
          disabled={isSubmitting}
          className="w-full rounded-full bg-burgundy px-5 py-3 text-sm font-semibold text-cream disabled:opacity-60"
        >
          {isSubmitting ? "Invio in corso..." : buttonLabel}
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
          {status.nextStep ? <p className="mt-1">{status.nextStep}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
