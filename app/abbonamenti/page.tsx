import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Abbonamenti — Affari Divini",
  description:
    "Accedi al sistema AI per il vino. Scegli il piano adatto al tuo obiettivo."
};

const tiers = [
  {
    name: "Access",
    price: "€19",
    period: "/mese",
    desc: "Per iniziare a usare l'AI nel vino",
    forWho: "Appassionati e curiosi che vogliono capire come l'AI può migliorare le loro scelte enologiche.",
    features: [
      "10 template prompt pronti all'uso",
      "Wine Prompt Engine — utilizzo base",
      "1 risorsa premium al mese",
      "Libreria introduttiva sul vino",
      "Aggiornamenti mensili",
    ],
    highlight: false,
    cta: "Inizia con Access",
  },
  {
    name: "Creator",
    price: "€49",
    period: "/mese",
    desc: "Per creare contenuti vino che convertono",
    forWho: "Content creator, wine blogger, appassionati che producono contenuti e vogliono distinguersi.",
    features: [
      "Tutto di Access",
      "Prompt avanzati per social, email e schede",
      "Wine Prompt Engine — accesso completo",
      "Template social + email marketing",
      "Archivio contenuti completo aggiornato",
      "Nuovi prompt ogni mese",
    ],
    highlight: true,
    cta: "Scegli Creator",
  },
  {
    name: "Professional",
    price: "€99",
    period: "/mese",
    desc: "Per chi vende vino o lavora nel settore",
    forWho: "Enoteche, agenti, consulenti e operatori wine che vogliono un vantaggio commerciale concreto.",
    features: [
      "Tutto di Creator",
      "Toolkit business vino completo",
      "Email marketing + funnel avanzati",
      "Materiali B2B e strategie vendita",
      "Schede tecniche professionali",
      "Analisi posizionamento e concorrenza",
    ],
    highlight: false,
    cta: "Passa a Professional",
  },
  {
    name: "Master",
    price: "€199",
    period: "/mese",
    desc: "Vantaggio competitivo reale nel vino",
    forWho: "Buyer professionali, importatori, responsabili acquisti e figure con portafogli complessi.",
    features: [
      "Tutto di Professional",
      "Strategie buyer e investment vino",
      "Use case reali e casi studio settoriali",
      "Contenuti esclusivi Master",
      "Priorità supporto diretto",
      "Accesso anticipato alle nuove funzionalità",
    ],
    highlight: false,
    cta: "Diventa Master",
  },
];

const faq = [
  {
    q: "Posso cancellare quando voglio?",
    a: "Sì, puoi cancellare in qualsiasi momento direttamente dal pannello account. Nessuna penale, nessun vincolo.",
  },
  {
    q: "Cosa succede ai miei contenuti se cancello?",
    a: "Tutto quello che hai scaricato rimane tuo. Perdi solo l'accesso ai nuovi contenuti futuri.",
  },
  {
    q: "È adatto anche a chi parte da zero?",
    a: "Sì. Il piano Access è pensato proprio per chi vuole iniziare ad usare l'AI nel vino senza esperienza tecnica.",
  },
  {
    q: "Come ricevo i nuovi contenuti ogni mese?",
    a: "Ogni mese trovi nuovi prompt, template e risorse nell'area riservata. Ricevi anche una notifica via email.",
  },
  {
    q: "C'è una garanzia di rimborso?",
    a: "Sì. Se entro 14 giorni dall'acquisto non sei soddisfatto, ti rimborsiamo senza domande.",
  },
  {
    q: "Posso cambiare piano in seguito?",
    a: "Sì. Puoi passare a un piano superiore (o inferiore) in qualsiasi momento. Il cambio è immediato.",
  },
];

export default function AbbonamentiPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="bg-vignette py-20 text-center">
        <div className="container-shell">
          <p className="section-eyebrow mb-4">Affari Divini Access</p>
          <h1
            className="mb-6 font-serif text-4xl font-bold text-ink sm:text-5xl"
            style={{ fontFamily: "Georgia, serif" }}
          >
            Il sistema AI per il vino.{" "}
            <span className="text-burgundy">Scegli il tuo livello.</span>
          </h1>
          <p className="mx-auto max-w-2xl text-lg text-ink/70">
            Non è un corso. Non è teoria. È un sistema per usare l&apos;AI nel vino
            in modo concreto: contenuti, selezione, vendita.
          </p>
        </div>
      </section>

      {/* Pricing grid */}
      <section className="py-20">
        <div className="container-shell">
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {tiers.map((tier) => (
              <div
                key={tier.name}
                className={`relative flex flex-col rounded-[24px] p-7 transition-shadow ${
                  tier.highlight
                    ? "gold-ring scale-[1.03] bg-burgundy text-cream"
                    : "card-surface"
                }`}
              >
                {tier.highlight && (
                  <div className="absolute -top-3 left-1/2 -translate-x-1/2 rounded-full bg-gold px-4 py-1 text-xs font-semibold tracking-widest text-ink">
                    PIÙ SCELTO
                  </div>
                )}

                <div className="mb-4">
                  <p
                    className={`text-xs uppercase tracking-[0.25em] ${
                      tier.highlight ? "text-gold/80" : "text-burgundy/70"
                    }`}
                  >
                    {tier.name}
                  </p>
                  <div className="mt-2 flex items-end gap-1">
                    <span
                      className={`text-4xl font-bold ${
                        tier.highlight ? "text-gold" : "text-ink"
                      }`}
                    >
                      {tier.price}
                    </span>
                    <span
                      className={`mb-1 text-sm ${
                        tier.highlight ? "text-cream/60" : "text-ink/50"
                      }`}
                    >
                      {tier.period}
                    </span>
                  </div>
                  <p
                    className={`mt-2 text-sm ${
                      tier.highlight ? "text-cream/75" : "text-ink/65"
                    }`}
                  >
                    {tier.desc}
                  </p>
                </div>

                {/* Per chi è */}
                <div
                  className={`mb-4 rounded-xl px-4 py-3 text-xs leading-5 ${
                    tier.highlight
                      ? "bg-white/10 text-cream/70"
                      : "bg-burgundy/5 text-ink/60"
                  }`}
                >
                  <span
                    className={`font-semibold uppercase tracking-wider text-[10px] ${
                      tier.highlight ? "text-gold/70" : "text-burgundy/60"
                    }`}
                  >
                    Per chi è
                  </span>
                  <p className="mt-1">{tier.forWho}</p>
                </div>

                <ul className="mb-8 flex-1 space-y-3">
                  {tier.features.map((f) => (
                    <li
                      key={f}
                      className={`flex items-start gap-2 text-sm ${
                        tier.highlight ? "text-cream/85" : "text-ink/75"
                      }`}
                    >
                      <span
                        className={`mt-0.5 text-xs ${
                          tier.highlight ? "text-gold" : "text-burgundy"
                        }`}
                      >
                        ✓
                      </span>
                      {f}
                    </li>
                  ))}
                </ul>

                <button
                  className={`w-full rounded-full py-3 text-sm font-semibold transition ${
                    tier.highlight
                      ? "bg-gold text-ink hover:bg-gold/90"
                      : "border border-burgundy/40 bg-burgundy text-cream hover:bg-burgundy/90"
                  }`}
                >
                  {tier.cta}
                </button>
              </div>
            ))}
          </div>

          {/* Reassurance */}
          <div className="mt-10 rounded-2xl border border-bottle/15 bg-bottle/5 px-6 py-5 text-center">
            <p className="text-sm text-ink/65">
              <strong className="text-ink/80">Nessun rischio.</strong>{" "}
              Cancelli quando vuoi · Rimborso entro 14 giorni · Pagamento sicuro · Nessun vincolo di durata
            </p>
          </div>
        </div>
      </section>

      {/* Value section */}
      <section className="border-t border-burgundy/10 py-20">
        <div className="container-shell">
          <div className="mx-auto max-w-3xl">
            <p className="section-eyebrow mb-4 text-center">Cosa ottieni davvero</p>
            <h2 className="mb-12 text-center font-serif text-3xl text-ink">
              Non stai comprando contenuti.<br />
              Stai comprando un vantaggio.
            </h2>
            <div className="grid gap-6 sm:grid-cols-3">
              {[
                {
                  title: "Prompt pronti all'uso",
                  body: "Template costruiti su casi reali del settore vino. Non generici, non teorici.",
                },
                {
                  title: "Prompt Engine",
                  body: "Genera prompt personalizzati per il tuo obiettivo specifico in pochi secondi.",
                },
                {
                  title: "Aggiornamenti continui",
                  body: "Il settore evolve. Il toolkit si aggiorna ogni mese con nuovi casi d'uso reali.",
                },
              ].map((item) => (
                <div key={item.title} className="card-surface p-6">
                  <p className="mb-2 font-semibold text-ink">{item.title}</p>
                  <p className="text-sm leading-6 text-ink/65">{item.body}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* FAQ */}
      <section className="border-t border-burgundy/10 py-20">
        <div className="container-shell">
          <div className="mx-auto max-w-2xl">
            <p className="section-eyebrow mb-4 text-center">FAQ</p>
            <h2 className="mb-10 text-center font-serif text-3xl text-ink">
              Domande frequenti
            </h2>
            <div className="space-y-4">
              {faq.map((item) => (
                <div key={item.q} className="card-surface p-6">
                  <p className="font-semibold text-ink">{item.q}</p>
                  <p className="mt-2 text-sm leading-6 text-ink/65">{item.a}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
