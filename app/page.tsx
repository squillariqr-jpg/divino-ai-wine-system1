import type { Route } from "next";
import Link from "next/link";

import { FunnelOfferSection } from "@/components/FunnelOfferSection";
import { Hero } from "@/components/Hero";
import { LeadCaptureForm } from "@/components/LeadCaptureForm";
import { ProductCard } from "@/components/ProductCard";
import { SommelierCTA } from "@/components/SommelierCTA";
import { TestimonialPlaceholders } from "@/components/TestimonialPlaceholders";
import { ThreePathwaysSection } from "@/components/ThreePathwaysSection";
import products from "@/data/products.json";
import type { Product } from "@/lib/types";

const funnelSteps = [
  {
    title: "Attrazione",
    description:
      "Lead magnet, Cantina Minima e contenuti di ingresso costruiscono fiducia e raccolgono interesse."
  },
  {
    title: "Classificazione",
    description:
      "Il quiz assegna un segmento, calcola punteggi e attiva CTA e follow-up coerenti."
  },
  {
    title: "Monetizzazione",
    description:
      "Il funnel indirizza verso corso, Wine AI Mastery o Wine Buyer Academy in base al profilo."
  }
];

const masteryRoute: Route = "/wine-ai-mastery";
const quizRoute: Route = "/quiz";
const academyRoute: Route = "/academy";
const productList = products as Product[];

export default function HomePage() {
  return (
    <>
      <Hero />
      <ThreePathwaysSection />

      <section className="container-shell py-14 sm:py-20">
        <div className="mb-10 max-w-3xl">
          <p className="section-eyebrow">Funnel overview</p>
          <h2 className="mt-3 text-3xl sm:text-4xl text-ink">
            Un sistema che accompagna il visitatore dall’interesse iniziale fino
            alla migliore offerta successiva.
          </h2>
        </div>
        <div className="grid gap-5 md:grid-cols-3">
          {funnelSteps.map((step, index) => (
            <article key={step.title} className="card-surface p-6">
              <span className="inline-flex h-10 w-10 items-center justify-center rounded-full bg-bottle text-sm font-semibold text-cream">
                0{index + 1}
              </span>
              <h3 className="mt-5 text-2xl text-ink">{step.title}</h3>
              <p className="mt-4 leading-7 text-ink/75">{step.description}</p>
            </article>
          ))}
        </div>
      </section>

      <section className="container-shell py-14 sm:py-20">
        <div className="mb-10 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div className="max-w-2xl">
            <p className="section-eyebrow">Product ladder</p>
            <h2 className="mt-3 text-3xl sm:text-4xl text-ink">
              Le offerte sono già organizzate lungo il funnel.
            </h2>
          </div>
          <Link
            href={quizRoute}
            className="rounded-full border border-burgundy/15 px-5 py-3 text-sm font-semibold text-burgundy transition hover:bg-burgundy hover:text-cream"
          >
            Scopri il tuo percorso
          </Link>
        </div>
        <div className="grid gap-5 md:grid-cols-2 xl:grid-cols-4">
          {productList.map((product) => (
            <ProductCard
              key={product.id}
              product={product}
              href={
                product.slug === "wine-ai-mastery"
                  ? masteryRoute
                  : product.slug === "wine-buyer-academy"
                    ? academyRoute
                    : quizRoute
              }
            />
          ))}
        </div>
      </section>

      <FunnelOfferSection
        id="ebook-lead-magnet"
        eyebrow="Lead magnet"
        title="Ebook gratuito per entrare nel sistema con leggerezza."
        description="Il primo asset del funnel cattura lead, crea fiducia e apre la conversazione in modo semplice ma premium."
        bullets={[
          "Promessa rapida e immediatamente comprensibile",
          "Raccolta lead collegata al backend placeholder",
          "Punto di ingresso ideale per traffico freddo e social"
        ]}
        ctaLabel="Scopri il tuo percorso"
        ctaHref="/quiz"
        accent="burgundy"
      >
        <LeadCaptureForm
          title="Ricevi l'ebook lead magnet"
          description="Lascia l'email per simulare l'ingresso nel funnel e ricevere il primo asset gratuito."
          buttonLabel="Ricevi l'ebook"
          source="homepage-ebook"
          interest="Ebook Lead Magnet"
        />
      </FunnelOfferSection>

      <FunnelOfferSection
        id="cantina-minima"
        eyebrow="Entry content"
        title="Cantina Minima: il contenuto gratuito che stabilizza il rapporto."
        description="Qui il contatto capisce il tono del brand e riceve una prima utilità concreta, ideale per aumentare fiducia e intenzione."
        bullets={[
          "Contenuto evergreen da usare in nurture e retargeting",
          "Ponte naturale verso il corso introduttivo",
          "Utile sia per principianti sia per profili pratici"
        ]}
        ctaLabel="Scopri il tuo percorso"
        ctaHref="/quiz"
        accent="bottle"
        reverse
      />

      <FunnelOfferSection
        id="corso-5-lezioni"
        eyebrow="Low ticket"
        title="Il corso in 5 lezioni è il primo vero passo formativo del funnel."
        description="L’offerta più adatta a chi ha bisogno di metodo, struttura e un primo investimento chiaro per iniziare bene."
        bullets={[
          "Offerta ideale per segmenti novice ed explorer",
          "Base formativa ordinata per lessico, degustazione e acquisto",
          "Primo snodo commerciale dopo lead magnet e Cantina Minima"
        ]}
        ctaLabel="Scopri il tuo percorso"
        ctaHref="/quiz"
        accent="burgundy"
        priceTag="€79"
      />

      <FunnelOfferSection
        id="wine-ai-mastery-offer"
        eyebrow="Digital product"
        title="Wine AI Mastery è il cuore digitale del funnel per chi pensa in termini di business."
        description="Pensato per creator, consulenti, enoteche e progetti wine che vogliono usare AI, contenuti e automazioni per crescere."
        bullets={[
          "CTA principale per segmenti builder-digitale",
          "Compatibile con future automazioni n8n e layer agentico",
          "Offerta ideale per follow-up su profili ad alto intent business"
        ]}
        ctaLabel="Vedi Wine AI Mastery"
        ctaHref="/wine-ai-mastery"
        accent="bottle"
        reverse
        priceTag="€249"
      />

      <FunnelOfferSection
        id="wine-buyer-academy-offer"
        eyebrow="Premium path"
        title="Wine Buyer Academy porta il funnel nel territorio professionale."
        description="Per buyer, horeca e operatori che hanno bisogno di criteri seri, visione commerciale e selezione più lucida."
        bullets={[
          "Offerta premium per segmenti buyer-professionale",
          "Può diventare anche output di workflow qualificati in futuro",
          "È la destinazione più alta del funnel attuale"
        ]}
        ctaLabel="Percorso Professionale"
        ctaHref="/academy"
        accent="burgundy"
        priceTag="€1.490"
      />

      <section className="container-shell py-14 sm:py-20">
        <div className="card-surface overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1fr_0.9fr]">
            <div className="p-8 sm:p-10">
              <p className="section-eyebrow">Quiz + result engine</p>
              <h2 className="mt-3 text-3xl sm:text-4xl text-ink">
                Raccomandazioni su misura che collegano contenuto, offerta e follow-up.
              </h2>
              <p className="mt-4 max-w-2xl leading-8 text-ink/75">
                Oggi il motore usa regole esplicite e scoring. In seguito potrà
                delegare classificazione, copy di follow-up e suggerimenti a un
                layer agentico senza riscrivere il funnel.
              </p>
              <div className="mt-8">
                <Link
                  href={quizRoute}
                  className="rounded-full bg-burgundy px-6 py-3 text-sm font-semibold text-cream"
                >
                  Scopri il tuo percorso
                </Link>
              </div>
            </div>
            <div className="bg-bottle px-8 py-10 text-cream">
              <p className="text-xs uppercase tracking-[0.28em] text-gold/90">
                Oggi e domani
              </p>
              <ul className="mt-6 space-y-4 text-lg leading-8 text-cream/90">
                <li>Oggi: scoring locale, API placeholder, CTA segmentate</li>
                <li>Domani: Supabase, n8n, agent layer e sync editoriale</li>
                <li>Sempre: due vini consigliati su gusto e budget</li>
              </ul>
            </div>
          </div>
        </div>
      </section>

      <TestimonialPlaceholders />

      <section className="container-shell pb-16 pt-6 sm:pb-24">
        <div className="rounded-[28px] bg-burgundy p-8 text-cream shadow-soft sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">Da dove vuoi iniziare?</p>
          <h2 className="mt-3 max-w-3xl text-3xl text-cream sm:text-4xl">
            Fai il quiz, esplora i prodotti, o scrivi direttamente al Sommelier AI.
          </h2>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={quizRoute}
              className="rounded-full bg-cream px-6 py-3 text-center text-sm font-semibold text-burgundy transition hover:bg-gold"
            >
              Scopri il tuo percorso
            </Link>
            <Link
              href={academyRoute}
              className="rounded-full border border-cream/25 px-6 py-3 text-center text-sm font-semibold text-cream transition hover:border-cream/60"
            >
              Percorso Professionale
            </Link>
            <SommelierCTA
              source="homepage_cta"
              className="rounded-full border border-gold/40 px-6 py-3 text-center text-sm font-semibold text-gold transition hover:border-gold/80"
            />
          </div>
        </div>
      </section>
    </>
  );
}
