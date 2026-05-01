import Link from "next/link";
import { SommelierCTA } from "@/components/SommelierCTA";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-burgundy/10 bg-[#efe4cc]">
      {/* Sommelier AI strip */}
      <div className="border-b border-burgundy/10 bg-burgundy/5">
        <div className="container-shell flex flex-col items-start gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.22em] text-burgundy/70">
              🍷 Sommelier AI
            </p>
            <p className="mt-0.5 text-sm text-ink/60">
              Descrivi cosa cerchi e ricevi un consiglio personalizzato.
            </p>
          </div>
          <SommelierCTA
            source="footer"
            className="inline-flex items-center gap-2 rounded-full border border-burgundy/30 bg-white/70 px-5 py-2.5 text-sm font-semibold text-burgundy transition hover:bg-white hover:border-burgundy/60 whitespace-nowrap"
          />
        </div>
      </div>

      <div className="container-shell flex flex-col gap-6 py-10 sm:flex-row sm:items-end sm:justify-between">
        <div className="max-w-xl">
          <p className="text-xs uppercase tracking-[0.28em] text-burgundy/80">
            Affari Divini
          </p>
          <p className="mt-3 text-sm leading-7 text-ink/75">
            Usa l&apos;intelligenza artificiale per capire, scegliere e vendere vino
            meglio della media. Formazione, strumenti AI e prodotti digitali sul vino.
          </p>
        </div>
        <div className="flex flex-col gap-4 sm:items-end">
          <div className="flex flex-wrap gap-5 text-sm text-ink/75">
            <Link href="/">Home</Link>
            <Link href="/quiz">Quiz Vino</Link>
            <Link href="/quiz-business">Quiz Business</Link>
            <Link href={"/prompt-generator" as never}>Prompt Engine</Link>
            <Link href={"/abbonamenti" as never}>Abbonamenti</Link>
            <Link href="/academy">Academy</Link>
          </div>
          <div className="flex gap-5 text-xs text-ink/50">
            <a href="/privacy" className="hover:text-burgundy transition">Privacy Policy</a>
            <a href="mailto:luca@divinomarket.it" className="hover:text-burgundy transition">Contatti</a>
          </div>
          <p className="text-xs text-ink/40">
            Contenuti riservati ai maggiorenni · 18+
          </p>
        </div>
      </div>
    </footer>
  );
}
