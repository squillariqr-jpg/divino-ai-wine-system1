import Link from "next/link";

export function Footer() {
  return (
    <footer className="mt-16 border-t border-burgundy/10 bg-[#efe4cc]">
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
            <Link href="/quiz">Quiz</Link>
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
