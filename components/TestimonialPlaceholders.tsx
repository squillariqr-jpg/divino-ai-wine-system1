const testimonials = [
  {
    name: "Giulia, appassionata",
    quote:
      "Finalmente un percorso sul vino elegante ma chiaro. Mi ha aiutata a scegliere meglio e con più sicurezza."
  },
  {
    name: "Marco, consulente digitale",
    quote:
      "La parte AI ha reso concreto un progetto che volevo lanciare da mesi nel settore wine."
  },
  {
    name: "Elena, buyer horeca",
    quote:
      "Approccio molto pulito: meno teoria astratta, più criteri seri per selezionare bottiglie e opportunità."
  }
];

export function TestimonialPlaceholders() {
  return (
    <section className="container-shell py-14 sm:py-20">
      <div className="mb-10 max-w-2xl">
        <p className="section-eyebrow">Prova sociale</p>
        <h2 className="mt-3 text-3xl sm:text-4xl text-ink">
          Prime impressioni, tono premium, risultati concreti.
        </h2>
      </div>
      <div className="grid gap-5 md:grid-cols-3">
        {testimonials.map((testimonial) => (
          <article key={testimonial.name} className="card-surface p-6">
            <p className="text-lg leading-8 text-ink/80">“{testimonial.quote}”</p>
            <p className="mt-6 text-sm font-semibold uppercase tracking-[0.18em] text-burgundy">
              {testimonial.name}
            </p>
          </article>
        ))}
      </div>
    </section>
  );
}
