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
          <p className="section-eyebrow">Diagnosi business</p>
          <h1 className="mt-3 text-4xl text-ink sm:text-5xl">
            Scopri quale sistema manca davvero al tuo business wine.
          </h1>
          <p className="mt-4 leading-8 text-ink/75">
            Questa diagnosi è pensata per creator, cantine, enoteche, buyer,
            horeca e consulenti. In pochi step individua il collo di bottiglia
            principale e ti porta al sistema più utile da attivare adesso.
          </p>
        </div>

        <div className="rounded-[28px] bg-burgundy p-6 text-cream shadow-soft">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">
            Output atteso
          </p>
          <ul className="mt-5 space-y-3 leading-7 text-cream/86">
            <li>Diagnosi del problema più costoso da risolvere</li>
            <li>Sistema consigliato tra acquisition, retention, automation e content</li>
            <li>Direzione finale chiara verso il percorso più adatto</li>
          </ul>
        </div>
      </div>

      <BusinessQuizForm focus={focus} />
    </section>
  );
}
