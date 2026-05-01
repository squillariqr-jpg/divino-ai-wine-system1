import Link from "next/link";
import { SommelierCTA } from "@/components/SommelierCTA";

export function Hero() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-center">
        <div className="space-y-6">
          <p className="section-eyebrow">Educazione, AI e commercio del vino</p>
          <h1 className="max-w-3xl text-4xl leading-tight text-ink sm:text-5xl lg:text-6xl">
            Capisci il vino.{" "}
            <span className="text-burgundy">Scegli meglio.</span>{" "}
            Costruisci qualcosa di serio.
          </h1>
          <p className="max-w-2xl text-xl font-semibold leading-8 text-burgundy sm:text-2xl">
            Per appassionati, creator e business del vino: trasforma clienti,
            contenuti e dati in vendite automatiche.
          </p>
          <p className="max-w-2xl text-lg leading-8 text-ink/75">
            Formazione guidata, strumenti AI e prodotti digitali per appassionati,
            creator e buyer professionali. Senza elitismo, con metodo.
          </p>
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            <Link
              href="/quiz"
              className="rounded-full bg-burgundy px-7 py-3.5 text-center text-sm font-semibold text-cream transition hover:bg-burgundy/90"
            >
              Scopri il tuo percorso
            </Link>
            <Link
              href="/quiz-business"
              className="rounded-full border border-gold/70 px-7 py-3.5 text-center text-sm font-semibold text-burgundy transition hover:bg-white/60"
            >
              Diagnosi Business Vino
            </Link>
            <Link
              href="/academy"
              className="rounded-full border border-burgundy/15 px-7 py-3.5 text-center text-sm font-semibold text-ink transition hover:bg-white/70"
            >
              Percorso Professionale
            </Link>
          </div>
          <div className="flex items-center gap-3 pt-1">
            <span className="text-sm text-ink/50">Oppure</span>
            <SommelierCTA
              source="hero"
              className="inline-flex items-center gap-2 rounded-full border border-burgundy/20 bg-white/60 px-4 py-2 text-sm font-semibold text-burgundy transition hover:border-burgundy/50 hover:bg-white/80"
            />
          </div>
        </div>
        <div className="card-surface gold-ring overflow-hidden p-6 sm:p-8">
          <div className="rounded-[24px] bg-burgundy bg-vignette p-6 text-cream">
            <p className="text-xs uppercase tracking-[0.32em] text-gold/90">
              Tre percorsi
            </p>
            <div className="mt-8 space-y-4">
              {[
                "Percorso Degustazione per appassionati",
                "Percorso Creator & Business con AI",
                "Percorso Buyer & Academy premium"
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
