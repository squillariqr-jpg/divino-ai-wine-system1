import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import type { RecommendationResponse } from "@/lib/types";

type RecommendationCardProps = {
  result: RecommendationResponse;
};

export function RecommendationCard({ result }: RecommendationCardProps) {
  return (
    <section className="space-y-6">
      <div className="card-surface p-6 sm:p-8">
        <p className="section-eyebrow">Il tuo profilo</p>
        <h2 className="mt-3 text-3xl text-ink">{result.persona.label}</h2>
        <p className="mt-4 max-w-2xl leading-7 text-ink/75">
          {result.persona.summary}
        </p>
        {result.persona.whyRight ? (
          <div className="mt-5 rounded-[20px] border border-bottle/15 bg-bottle/5 px-5 py-4">
            <p className="text-sm font-semibold uppercase tracking-[0.14em] text-bottle/80">Perché è giusto per te</p>
            <p className="mt-2 leading-7 text-ink/80">{result.persona.whyRight}</p>
          </div>
        ) : null}
        <div className="mt-6 grid gap-3 md:grid-cols-2">
          {result.rationale.map((item) => (
            <div
              key={item}
              className="rounded-[22px] border border-burgundy/10 bg-cream/55 px-4 py-4 text-sm leading-6 text-ink/75"
            >
              {item}
            </div>
          ))}
        </div>
      </div>

      <div className="card-surface p-6 sm:p-8">
        <p className="section-eyebrow">Result engine</p>
        <div className="mt-5 space-y-4">
          {result.scoreSummary.map((item) => (
            <div key={item.segment}>
              <div className="mb-2 flex items-center justify-between gap-3">
                <p className="text-sm font-semibold uppercase tracking-[0.16em] text-ink/75">
                  {item.label}
                </p>
                <p className="text-sm font-semibold text-burgundy">{item.score} pt</p>
              </div>
              <div className="h-2.5 rounded-full bg-burgundy/10">
                <div
                  className="h-2.5 rounded-full bg-burgundy"
                  style={{ width: `${Math.min(item.score * 8, 100)}%` }}
                />
              </div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <article className="card-surface p-6">
          <p className="section-eyebrow">Lead magnet consigliato</p>
          <h3 className="mt-3 text-2xl text-ink">{result.leadMagnet.title}</h3>
          <p className="mt-4 leading-7 text-ink/75">
            {result.leadMagnet.description}
          </p>
          <a
            href={result.leadMagnet.ctaHref}
            className="mt-6 inline-flex rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy transition hover:bg-burgundy hover:text-cream"
          >
            {result.leadMagnet.ctaLabel}
          </a>
        </article>

        <article className="card-surface p-6">
          <p className="section-eyebrow">Contenuto consigliato</p>
          <h3 className="mt-3 text-2xl text-ink">{result.contentRecommendation.title}</h3>
          <p className="mt-4 leading-7 text-ink/75">
            {result.contentRecommendation.description}
          </p>
        </article>
      </div>

      <div className="grid gap-6 lg:grid-cols-[0.95fr_1.05fr]">
        <article className="card-surface p-6">
          <p className="section-eyebrow">Offerta primaria</p>
          <h3 className="mt-3 text-2xl text-ink">
            {result.productRecommendation.name}
          </h3>
          <p className="mt-2 text-lg font-semibold text-burgundy">
            {result.productRecommendation.price}
          </p>
          <p className="mt-4 leading-7 text-ink/75">
            {result.productRecommendation.description}
          </p>
        </article>

        <article className="card-surface bg-burgundy p-6 text-cream">
          <p className="section-eyebrow text-gold/90">CTA post-quiz</p>
          <h3 className="mt-3 text-2xl">{result.postQuizCta.title}</h3>
          <p className="mt-4 leading-7 text-cream/85">
            {result.postQuizCta.description}
          </p>
          <div className="mt-6 flex flex-col gap-3">
            <a
              href={result.postQuizCta.primaryHref}
              className="rounded-full bg-cream px-5 py-3 text-center text-sm font-semibold text-burgundy"
            >
              {result.postQuizCta.primaryLabel}
            </a>
            <a
              href={result.postQuizCta.secondaryHref}
              className="rounded-full border border-cream/20 px-5 py-3 text-center text-sm font-semibold text-cream"
            >
              {result.postQuizCta.secondaryLabel}
            </a>
          </div>
        </article>
      </div>

      {result.upsellRecommendation ? (
        <div className="card-surface p-6 sm:p-8">
          <p className="section-eyebrow">Upsell rule attiva</p>
          <h3 className="mt-3 text-2xl text-ink">
            {result.upsellRecommendation.title}
          </h3>
          <p className="mt-4 max-w-3xl leading-7 text-ink/75">
            {result.upsellRecommendation.description}
          </p>
          <a
            href={result.upsellRecommendation.href}
            className="mt-6 inline-flex rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy transition hover:bg-burgundy hover:text-cream"
          >
            Scopri {result.upsellRecommendation.target}
          </a>
        </div>
      ) : null}

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
                <span className="rounded-full bg-burgundy/8 px-3 py-1 text-xs font-semibold uppercase tracking-[0.18em] text-burgundy">
                  {wine.priceTier}
                </span>
              </div>
              <p className="mt-4 leading-7 text-ink/75">{wine.description}</p>
            </article>
          ))}
        </div>
      </div>

      <LeadCaptureForm
        title="Blocca il tuo prossimo step nel funnel"
        description="Lascia il contatto per ricevere il lead magnet giusto e attivare il follow-up più coerente con il tuo segmento."
        buttonLabel="Attiva il follow-up"
        source="quiz-risultato"
        segment={result.segment}
        interest={result.productRecommendation.name}
      />
    </section>
  );
}
