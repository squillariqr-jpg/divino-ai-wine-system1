import Link from "next/link";

const academyModules = [
  {
    title: "Criteri di selezione delle etichette",
    learn: "Come valutare un vino su identità, territorio, produttore e coerenza stilistica. Costruisci un metodo di analisi replicabile.",
    outcome: "Selezioni più consapevoli, meno acquisti sbagliati.",
  },
  {
    title: "Marginalità, rotazione e posizionamento",
    learn: "Come costruire un portafoglio vini redditizio: rotazione, margini, coerenza con il format e il cliente.",
    outcome: "Carta vini più leggibile, più profittevole, meno dispersiva.",
  },
  {
    title: "Linguaggio commerciale e storytelling utile",
    learn: "Come comunicare il vino al cliente finale con precisione e senza retorica vuota. Copy che vende senza vendere.",
    outcome: "Descrizioni e pitch che convertono, in sala e online.",
  },
  {
    title: "Metodo di acquisto per horeca e retail",
    learn: "Come sistematizzare il processo di acquisto: criteri, fornitori, negoziazione, tracciamento. Un framework operativo.",
    outcome: "Acquisti strutturati, ripetibili e difendibili nel tempo.",
  },
];

export default function AcademyPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="container-shell py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1fr_0.9fr]">
          <div>
            <p className="section-eyebrow">Wine Buyer Academy</p>
            <h1 className="mt-3 text-4xl sm:text-5xl text-ink">
              Il percorso premium per chi compra vino con responsabilità e visione.
            </h1>
            <p className="mt-5 max-w-2xl leading-8 text-ink/75">
              Un training avanzato pensato per buyer, operatori horeca e figure che
              devono selezionare etichette con criteri reali: identità, margine,
              coerenza di carta e posizionamento.
            </p>
            <div className="mt-6 flex items-center gap-3">
              <span className="text-3xl font-bold text-ink">€1.490</span>
              <span className="text-sm text-ink/50">accesso completo · una tantum</span>
            </div>
            <div className="mt-6 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/quiz"
                className="rounded-full bg-burgundy px-7 py-3.5 text-center text-sm font-semibold text-cream transition hover:bg-burgundy/90"
              >
                Verifica se è il percorso giusto
              </Link>
              <a
                href="#programma"
                className="rounded-full border border-burgundy/15 px-7 py-3.5 text-center text-sm font-semibold text-burgundy transition hover:bg-white/60"
              >
                Vedi il programma
              </a>
            </div>
          </div>

          <div className="rounded-[28px] bg-bottle shadow-soft p-8 text-cream">
            <p className="text-xs uppercase tracking-[0.28em] text-gold/90">
              Outcome atteso
            </p>
            <ul className="mt-6 space-y-4 leading-8 text-cream/90">
              <li className="flex items-start gap-3">
                <span className="mt-1 text-gold text-sm">✓</span>
                Scelte più coerenti con clientela e format
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-gold text-sm">✓</span>
                Meno acquisti istintivi, più metodo decisionale
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-gold text-sm">✓</span>
                Portafoglio vini più leggibile e profittevole
              </li>
              <li className="flex items-start gap-3">
                <span className="mt-1 text-gold text-sm">✓</span>
                Framework d&apos;acquisto replicabile nel tempo
              </li>
            </ul>
          </div>
        </div>
      </section>

      {/* Curriculum */}
      <section id="programma" className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="mb-10">
            <p className="section-eyebrow">Programma</p>
            <h2 className="mt-3 text-3xl text-ink">4 moduli operativi.</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {academyModules.map((module, index) => (
              <article key={module.title} className="card-surface p-6 sm:p-8">
                <div className="flex items-center gap-4 mb-4">
                  <span className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-bottle text-sm font-semibold text-cream">
                    0{index + 1}
                  </span>
                  <p className="section-eyebrow">Modulo {index + 1}</p>
                </div>
                <h3 className="text-xl text-ink">{module.title}</h3>
                <p className="mt-3 leading-7 text-ink/70">{module.learn}</p>
                <div className="mt-4 rounded-xl border border-bottle/15 bg-bottle/5 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-bottle/70">
                    Risultato
                  </p>
                  <p className="mt-1 text-sm text-ink/75">{module.outcome}</p>
                </div>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Format */}
      <section className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="card-surface p-8 sm:p-10">
            <p className="section-eyebrow">Formato</p>
            <h2 className="mt-3 text-3xl text-ink">
              Un&apos;esperienza premium, non una libreria dispersiva.
            </h2>
            <p className="mt-4 max-w-3xl leading-8 text-ink/75">
              La Academy unisce lezioni guidate, framework di valutazione, esercizi
              di selezione e momenti di confronto. L&apos;obiettivo non è sapere di più
              in astratto, ma comprare meglio in modo replicabile.
            </p>
            <div className="mt-8 grid gap-4 sm:grid-cols-3">
              {[
                { label: "Lezioni guidate", desc: "Strutturate per essere applicate subito" },
                { label: "Framework pratici", desc: "Criteri e checklist per ogni scenario" },
                { label: "Confronto diretto", desc: "Sessioni con altri professionisti del settore" },
              ].map((item) => (
                <div key={item.label} className="rounded-xl bg-ink/4 px-4 py-4">
                  <p className="font-semibold text-ink text-sm">{item.label}</p>
                  <p className="mt-1 text-xs text-ink/55">{item.desc}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* Final CTA */}
      <section className="py-16">
        <div className="container-shell">
          <div className="rounded-[28px] bg-burgundy shadow-soft p-8 text-cream sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">Pronto a iniziare?</p>
            <h2 className="mt-3 max-w-2xl text-3xl text-cream">
              Verifica se la Academy è giusta per il tuo percorso.
            </h2>
            <p className="mt-4 text-cream/75 max-w-xl leading-7">
              Fai il quiz: ti indica se la Academy è l&apos;offerta più adatta al tuo livello e ai tuoi obiettivi.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/quiz"
                className="rounded-full bg-cream px-7 py-3.5 text-center text-sm font-semibold text-burgundy transition hover:bg-gold"
              >
                Scopri il tuo percorso
              </Link>
              <a
                href="#programma"
                className="rounded-full border border-cream/25 px-7 py-3.5 text-center text-sm font-semibold text-cream transition hover:border-cream/60"
              >
                Rivedi il programma
              </a>
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
