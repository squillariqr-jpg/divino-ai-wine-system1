import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import type { RecommendationResponse } from "@/lib/types";

type RecommendationCardProps = {
  result: RecommendationResponse;
};

export function RecommendationCard({ result }: RecommendationCardProps) {
  return (
    <section className="space-y-6">

      {/* 1 — Profilo: primo elemento visibile, grande e chiaro */}
      <div className="card-surface p-6 sm:p-8">
        <p className="section-eyebrow">Il tuo profilo</p>
        <h2 className="mt-2 text-4xl font-bold text-ink">{result.persona.label}</h2>
        <p className="mt-4 max-w-2xl leading-7 text-ink/75">
          {result.persona.summary}
        </p>
        {result.persona.whyRight ? (
          <div className="mt-5 rounded-[20px] border border-bottle/15 bg-bottle/5 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-bottle/80">
              Perché è giusto per te
            </p>
            <p className="mt-2 leading-7 text-ink/80">{result.persona.whyRight}</p>
          </div>
        ) : null}
      </div>

      {/* 2 — CTA principale: subito dopo il profilo, massima visibilità */}
      <article className="card-surface bg-burgundy p-6 sm:p-8 text-cream">
        <p className="section-eyebrow text-gold/90">Il tuo prossimo passo</p>
        <h3 className="mt-3 text-2xl sm:text-3xl">{result.postQuizCta.title}</h3>
        <p className="mt-4 leading-7 text-cream/85">{result.postQuizCta.description}</p>
        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <a
            href={result.postQuizCta.primaryHref}
            className="rounded-full bg-cream px-6 py-3 text-center text-sm font-semibold text-burgundy transition hover:bg-gold"
          >
            {result.postQuizCta.primaryLabel}
          </a>
          <a
            href={result.postQuizCta.secondaryHref}
            className="rounded-full border border-cream/25 px-6 py-3 text-center text-sm font-semibold text-cream transition hover:border-cream/60"
          >
            {result.postQuizCta.secondaryLabel}
          </a>
        </div>
      </article>

      {/* 3 — Offerta primaria */}
      <article className="card-surface p-6">
        <p className="section-eyebrow">Offerta consigliata</p>
        <div className="mt-3 flex items-baseline gap-4">
          <h3 className="text-2xl text-ink">{result.productRecommendation.name}</h3>
          <span className="text-xl font-semibold text-burgundy">
            {result.productRecommendation.price}
          </span>
        </div>
        <p className="mt-4 leading-7 text-ink/75">
          {result.productRecommendation.description}
        </p>
        <a
          href={`/${result.productRecommendation.slug}`}
          className="mt-6 inline-flex rounded-full bg-burgundy px-6 py-3 text-sm font-semibold text-cream transition hover:bg-burgundy/85"
        >
          {result.productRecommendation.cta}
        </a>
      </article>

      {/* 4 — 2 vini */}
      <div className="card-surface p-6 sm:p-8">
        <p className="section-eyebrow">2 vini da esplorare adesso</p>
        <div className="mt-6 grid gap-4 md:grid-cols-2">
          {result.wines.map((wine) => (
            <article
              key={wine.id}
              className="rounded-[24px] border border-burgundy/10 bg-cream/55 p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h4 className="text-xl text-ink">{wine.name}</h4>
                  <p className="mt-1 text-sm uppercase tracking-[0.16em] text-bottle/80">
                    {wine.region} · {wine.grape}
                  </p>
                </div>
                <span className="rounded-full bg-burgundy/8 px-3 py-1 text-xs font-semibold text-burgundy">
                  {wine.priceTier === "basso" ? "sotto €20" : wine.priceTier === "medio" ? "€20–50" : "oltre €50"}
                </span>
              </div>
              <p className="mt-4 leading-7 text-ink/75">{wine.description}</p>
            </article>
          ))}
        </div>
      </div>

      {/* 5 — Lead capture */}
      <LeadCaptureForm
        title="Ricevi il percorso completo via email"
        description="Lascia la tua email: ti mando subito il lead magnet giusto per il tuo profilo e i prossimi step del percorso Divino."
        buttonLabel="Invia il percorso"
        source="quiz-risultato"
        segment={result.segment}
        interest={result.productRecommendation.name}
      />
    </section>
  );
}
