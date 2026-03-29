import { QuizForm } from "@/components/QuizForm";

export default function QuizPage() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="mb-10 max-w-3xl">
        <p className="section-eyebrow">Quiz di preferenza</p>
        <h1 className="mt-3 text-4xl sm:text-5xl text-ink">
          Scopri il tuo prossimo passo nel mondo Divino.
        </h1>
        <p className="mt-4 leading-8 text-ink/75">
          Quattro step, pochi minuti: il result engine segmenta il profilo,
          applica regole di scoring chiare e restituisce lead magnet, offerta
          primaria, CTA post-quiz e vini coerenti con il tuo momento.
        </p>
      </div>
      <QuizForm />
    </section>
  );
}
