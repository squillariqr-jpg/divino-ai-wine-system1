import Link from "next/link";

export function Hero() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <p className="section-eyebrow">Educazione, AI e commercio del vino</p>
          <h1 className="max-w-3xl text-4xl leading-tight text-ink sm:text-5xl lg:text-6xl">
            Il sistema premium per imparare il vino e trasformarlo in un
            percorso di scelta, crescita e vendita.
          </h1>
          <p className="max-w-2xl text-lg leading-8 text-ink/75">
            Divino AI Wine System unisce contenuti gratuiti, formazione guidata,
            prodotti digitali e raccomandazioni intelligenti per appassionati,
            creator e buyer professionali.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row">
            <Link
              href="/quiz"
              className="rounded-full bg-burgundy px-6 py-3 text-center text-sm font-semibold text-cream transition hover:bg-burgundy/90"
            >
              Fai il quiz personalizzato
            </Link>
            <Link
              href="/academy"
              className="rounded-full border border-gold/70 px-6 py-3 text-center text-sm font-semibold text-burgundy transition hover:bg-white/60"
            >
              Scopri la Academy
            </Link>
          </div>
        </div>
        <div className="card-surface gold-ring overflow-hidden p-6 sm:p-8">
          <div className="rounded-[24px] bg-burgundy bg-vignette p-6 text-cream">
            <p className="text-xs uppercase tracking-[0.32em] text-gold/90">
              Ecosistema Divino
            </p>
            <div className="mt-8 space-y-4">
              {[
                "Cantina Minima + Ebook gratuito",
                "Corso introduttivo in 5 lezioni",
                "Wine AI Mastery per business digitali",
                "Wine Buyer Academy per professionisti"
              ].map((item) => (
                <div
                  key={item}
                  className="rounded-2xl border border-cream/15 bg-white/10 px-4 py-4"
                >
                  <p className="text-base leading-7">{item}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
