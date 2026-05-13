import type { Route } from "next";
import Link from "next/link";

const pathways: {
  eyebrow: string;
  audience: string;
  title: string;
  description: string;
  bullets: string[];
  href: Route | { pathname: Route; query: { focus: "creator" | "buyer" } };
  cta: string;
  theme: "light" | "burgundy" | "bottle";
}[] = [
  {
    eyebrow: "Percorso 01",
    audience: "Appassionati",
    title: "Capisci il tuo gusto e scegli bottiglie migliori.",
    description:
      "Un percorso pensato per chi vuole bere meglio, acquistare con più sicurezza e ricevere consigli davvero personali.",
    bullets: [
      "Quiz vino con profilo personalizzato",
      "2 vini consigliati in base a gusto e budget",
      "Ingresso naturale a Cantina Minima e corso introduttivo"
    ],
    href: "/quiz",
    cta: "Scopri il tuo stile di vino",
    theme: "light"
  },
  {
    eyebrow: "Percorso 02",
    audience: "Creator & Business",
    title: "Trasforma contenuti, AI e funnel in un sistema wine.",
    description:
      "Per creator, cantine, consulenti ed enoteche che vogliono crescere con contenuti più utili, più veloci e più orientati alla conversione.",
    bullets: [
      "Diagnosi business focalizzata su contenuti e lead",
      "Output coerente verso Wine AI Mastery",
      "Tono moderno, operativo e subito applicabile"
    ],
    href: { pathname: "/quiz-business", query: { focus: "creator" } },
    cta: "Analizza il tuo sistema di vendita",
    theme: "bottle"
  },
  {
    eyebrow: "Percorso 03",
    audience: "Buyer & Horeca",
    title: "Acquista, seleziona e posiziona il vino con metodo.",
    description:
      "Per buyer, operatori horeca e professionisti che devono prendere decisioni di acquisto con margine, criterio e visione.",
    bullets: [
      "Diagnosi business orientata a selezione e marginalità",
      "Output coerente verso Wine Buyer Academy",
      "Approccio premium e decisionale, non teorico"
    ],
    href: { pathname: "/quiz-business", query: { focus: "buyer" } },
    cta: "Scopri il percorso professionale",
    theme: "burgundy"
  }
];

function cardTheme(theme: (typeof pathways)[number]["theme"]) {
  if (theme === "burgundy") {
    return {
      wrapper: "rounded-[28px] bg-burgundy p-6 text-cream shadow-soft",
      eyebrow: "text-gold/90",
      title: "text-cream",
      description: "text-cream/82",
      bullet: "border-cream/15 bg-white/10 text-cream/88",
      cta: "bg-cream text-burgundy hover:bg-gold"
    };
  }

  if (theme === "bottle") {
    return {
      wrapper: "rounded-[28px] bg-bottle p-6 text-cream shadow-soft",
      eyebrow: "text-gold/90",
      title: "text-cream",
      description: "text-cream/82",
      bullet: "border-cream/15 bg-white/10 text-cream/88",
      cta: "bg-cream text-bottle hover:bg-gold"
    };
  }

  return {
    wrapper: "card-surface p-6",
    eyebrow: "text-burgundy/80",
    title: "text-ink",
    description: "text-ink/75",
    bullet: "border-burgundy/10 bg-cream/50 text-ink/75",
    cta: "bg-burgundy text-cream hover:bg-burgundy/90"
  };
}

export function ThreePathwaysSection() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="mb-10 max-w-3xl">
        <p className="section-eyebrow">Homepage a 3 percorsi</p>
        <h2 className="mt-3 text-3xl text-ink sm:text-4xl">
          Scegli l’ingresso giusto: personale, business o professionale.
        </h2>
        <p className="mt-4 leading-8 text-ink/75">
          Affari Divini non porta tutti nello stesso posto. Ti fa entrare
          dalla porta giusta in base a ciò che vuoi costruire davvero.
        </p>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {pathways.map((pathway) => {
          const theme = cardTheme(pathway.theme);

          return (
            <article key={pathway.title} className={theme.wrapper}>
              <p
                className={`text-xs font-semibold uppercase tracking-[0.28em] ${theme.eyebrow}`}
              >
                {pathway.eyebrow}
              </p>
              <p className="mt-4 text-sm font-semibold uppercase tracking-[0.18em] opacity-80">
                {pathway.audience}
              </p>
              <h3 className={`mt-3 text-3xl ${theme.title}`}>{pathway.title}</h3>
              <p className={`mt-4 leading-7 ${theme.description}`}>
                {pathway.description}
              </p>
              <div className="mt-6 space-y-3">
                {pathway.bullets.map((bullet) => (
                  <div
                    key={bullet}
                    className={`rounded-2xl border px-4 py-3 text-sm leading-6 ${theme.bullet}`}
                  >
                    {bullet}
                  </div>
                ))}
              </div>
              <Link
                href={pathway.href}
                className={`mt-8 inline-flex w-full justify-center rounded-full px-6 py-3 text-center text-sm font-semibold transition sm:w-auto ${theme.cta}`}
              >
                {pathway.cta}
              </Link>
            </article>
          );
        })}
      </div>
    </section>
  );
}
