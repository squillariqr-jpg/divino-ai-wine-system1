import Link from "next/link";

const academyModules = [
  "Criteri di selezione delle etichette",
  "Marginalità, rotazione e posizionamento",
  "Linguaggio commerciale e storytelling utile",
  "Metodo di acquisto per horeca e retail"
];

export default function AcademyPage() {
  return (
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
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href="/quiz"
              className="rounded-full bg-burgundy px-6 py-3 text-center text-sm font-semibold text-cream"
            >
              Verifica se è il percorso giusto
            </Link>
            <a
              href="#programma"
              className="rounded-full border border-burgundy/15 px-6 py-3 text-center text-sm font-semibold text-burgundy"
            >
              Vedi il programma
            </a>
          </div>
        </div>

        <div className="card-surface bg-bottle p-8 text-cream">
          <p className="text-xs uppercase tracking-[0.28em] text-gold/90">
            Outcome atteso
          </p>
          <ul className="mt-6 space-y-4 text-lg leading-8 text-cream/90">
            <li>Scelte più coerenti con clientela e format</li>
            <li>Meno acquisti istintivi, più metodo decisionale</li>
            <li>Portafoglio vini più leggibile e profittevole</li>
          </ul>
        </div>
      </div>

      <section id="programma" className="mt-16 grid gap-5 md:grid-cols-2">
        {academyModules.map((module, index) => (
          <article key={module} className="card-surface p-6">
            <p className="section-eyebrow">Modulo {index + 1}</p>
            <h2 className="mt-3 text-2xl text-ink">{module}</h2>
            <p className="mt-4 leading-7 text-ink/75">
              Contenuti operativi e casi d’uso per costruire una logica di acquisto
              più solida, elegante e sostenibile nel tempo.
            </p>
          </article>
        ))}
      </section>

      <section className="mt-16">
        <div className="card-surface p-8 sm:p-10">
          <p className="section-eyebrow">Formato</p>
          <h2 className="mt-3 text-3xl text-ink">Un’esperienza premium, non una libreria dispersiva.</h2>
          <p className="mt-4 max-w-3xl leading-8 text-ink/75">
            La Academy unisce lezioni guidate, framework di valutazione, esercizi
            di selezione e momenti di confronto. L’obiettivo non è sapere di più
            in astratto, ma comprare meglio in modo replicabile.
          </p>
        </div>
      </section>
    </section>
  );
}
