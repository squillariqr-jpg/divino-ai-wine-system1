import { BusinessQuizForm } from "@/components/BusinessQuizForm";

type QuizBusinessPageProps = {
  searchParams?: {
    focus?: string;
  };
};

export default function QuizBusinessPage({
  searchParams
}: QuizBusinessPageProps) {
  const focus =
    searchParams?.focus === "creator" || searchParams?.focus === "buyer"
      ? searchParams.focus
      : undefined;

  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="mb-10 grid gap-6 lg:grid-cols-[1fr_0.86fr] lg:items-end">
        <div className="max-w-3xl">
          <p className="section-eyebrow">Quiz business</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">
            Scopri quale percorso business wine ti fa crescere davvero.
          </h1>
          <p className="mt-4 leading-8 text-ink/75">
            Questo quiz è pensato per creator, cantine, enoteche, consulenti,
            buyer e horeca. In pochi step capisce se il tuo prossimo passo è un
            sistema contenuti più forte o un framework più tecnico di acquisto e
            selezione.
          </p>
        </div>

        <div className="rounded-[28px] bg-burgundy p-6 text-cream shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">
            Output atteso
          </p>
          <ul className="mt-5 space-y-3 leading-7 text-cream/86">
            <li>Diagnosi del profilo business</li>
            <li>Raccomandazione chiara tra Wine AI Mastery e Academy</li>
            <li>CTA coerenti con fase, priorità e stile operativo</li>
          </ul>
        </div>
      </div>

      <BusinessQuizForm focus={focus} />
    </section>
  );
}
