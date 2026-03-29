import Link from "next/link";

const features = [
  "Prompt e workflow per contenuti wine",
  "Struttura funnel per lead e conversione",
  "Sistema di offerte tra free, low ticket e premium",
  "Esempi pratici per creator, enoteche e consulenti"
];

export default function WineAiMasteryPage() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="card-surface overflow-hidden">
        <div className="grid lg:grid-cols-[1.1fr_0.9fr]">
          <div className="p-8 sm:p-10">
            <p className="section-eyebrow">Sales page</p>
            <h1 className="mt-3 text-4xl sm:text-5xl text-ink">
              Wine AI Mastery: il prodotto digitale per far crescere progetti wine con AI e strategia.
            </h1>
            <p className="mt-5 max-w-3xl leading-8 text-ink/75">
              Pensato per chi vuole trasformare il settore vino in un sistema di
              contenuti, autorevolezza e vendite. Meno improvvisazione, più asset
              replicabili e decisioni veloci.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/quiz"
                className="rounded-full bg-burgundy px-6 py-3 text-center text-sm font-semibold text-cream"
              >
                Capisci se fa per te
              </Link>
              <Link
                href="/academy"
                className="rounded-full border border-burgundy/15 px-6 py-3 text-center text-sm font-semibold text-burgundy"
              >
                Sei un buyer? Vedi Academy
              </Link>
            </div>
          </div>
          <div className="bg-burgundy p-8 text-cream sm:p-10">
            <p className="text-xs uppercase tracking-[0.28em] text-gold/90">
              Per chi
            </p>
            <p className="mt-4 text-lg leading-8 text-cream/90">
              Creator, formatori, enoteche, consulenti e business wine che vogliono
              usare l’AI per acquisire lead, creare offerte e migliorare il posizionamento.
            </p>
            <p className="mt-8 text-4xl text-gold">€249</p>
          </div>
        </div>
      </div>

      <section className="mt-16 grid gap-5 md:grid-cols-2">
        {features.map((feature) => (
          <article key={feature} className="card-surface p-6">
            <p className="section-eyebrow">Incluso</p>
            <h2 className="mt-3 text-2xl text-ink">{feature}</h2>
            <p className="mt-4 leading-7 text-ink/75">
              Materiale progettato per essere usato subito, adattato al tuo
              progetto e integrato con una strategia commerciale concreta.
            </p>
          </article>
        ))}
      </section>

      <section className="mt-16">
        <div className="card-surface p-8 sm:p-10">
          <p className="section-eyebrow">Perché adesso</p>
          <h2 className="mt-3 text-3xl text-ink">
            Il mercato non premia più solo la conoscenza: premia sistemi chiari e ripetibili.
          </h2>
          <p className="mt-4 max-w-3xl leading-8 text-ink/75">
            Wine AI Mastery ti aiuta a costruire un motore editoriale e commerciale
            in cui contenuto, AI e offerta parlano la stessa lingua.
          </p>
        </div>
      </section>
    </section>
  );
}
