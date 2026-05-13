import type { ReactNode } from "react";

type FunnelOfferSectionProps = {
  id: string;
  eyebrow: string;
  title: string;
  description: string;
  bullets: string[];
  ctaLabel: string;
  ctaHref: string;
  accent: "burgundy" | "bottle";
  priceTag?: string;
  reverse?: boolean;
  children?: ReactNode;
};

export function FunnelOfferSection({
  id,
  eyebrow,
  title,
  description,
  bullets,
  ctaLabel,
  ctaHref,
  accent,
  priceTag,
  reverse = false,
  children
}: FunnelOfferSectionProps) {
  const accentClass =
    accent === "burgundy" ? "bg-burgundy text-cream" : "bg-bottle text-cream";

  return (
    <section id={id} className="container-shell py-8 sm:py-10">
      <div className="card-surface overflow-hidden">
        <div className="grid gap-0 lg:grid-cols-[1.05fr_0.95fr]">
          <div className={`p-8 sm:p-10 ${reverse ? "lg:order-2" : ""}`}>
            <p className="section-eyebrow">{eyebrow}</p>
            <h2 className="mt-3 text-3xl sm:text-4xl text-ink">{title}</h2>
            <p className="mt-4 max-w-2xl leading-8 text-ink/75">{description}</p>
            <ul className="mt-6 space-y-3 text-ink/80">
              {bullets.map((bullet) => (
                <li key={bullet} className="rounded-2xl border border-burgundy/10 bg-cream/45 px-4 py-3">
                  {bullet}
                </li>
              ))}
            </ul>
            <div className="mt-8">
              <a
                href={ctaHref}
                className="inline-flex rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy transition hover:bg-burgundy hover:text-cream"
              >
                {ctaLabel}
              </a>
            </div>
          </div>
          <div className={`${accentClass} p-8 sm:p-10 ${reverse ? "lg:order-1" : ""}`}>
            <p className="text-xs uppercase tracking-[0.28em] text-gold/90">
              Posizione nel funnel
            </p>
            {priceTag ? <p className="mt-4 text-4xl text-gold">{priceTag}</p> : null}
            <div className="mt-8">
              {children ? (
                children
              ) : (
                <p className="text-lg leading-8 text-cream/88">
                  Offerta progettata per far avanzare il contatto al passo
                  successivo con una promessa chiara e misurabile.
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
