import type { Metadata } from "next";
import type { Route } from "next";
import Link from "next/link";

export const metadata: Metadata = {
  title: "Agenti AI per il vino — Affari Divini",
  description:
    "Un ecosistema di agenti intelligenti specializzati per enoteche, cantine, wine club e professionisti del vino. Contenuti, analisi, buyer intelligence e personalizzazione cliente."
};

// ── Dati agenti ───────────────────────────────────────────────────────────────

type Agent = {
  name: string;
  description: string;
};

type AgentSection = {
  eyebrow: string;
  title: string;
  accent: "bottle" | "burgundy" | "gold" | "ink";
  agents: Agent[];
};

const sections: AgentSection[] = [
  {
    eyebrow: "Vendite & Marketing",
    title: "Agenti che vendono",
    accent: "bottle",
    agents: [
      {
        name: "Agente Social",
        description:
          "Crea caption, calendari editoriali, idee reel e rubriche vino pronti da pubblicare."
      },
      {
        name: "Agente Newsletter",
        description:
          "Genera email per promo, nuovi arrivi, eventi, stagionalità e riattivazione clienti."
      },
      {
        name: "Agente SEO Vino",
        description:
          "Trova keyword e crea testi per migliorare la visibilità organica del sito."
      },
      {
        name: "Agente Descrizioni Ecommerce",
        description:
          "Scrive descrizioni persuasive per bottiglie, box, distillati e confezioni regalo."
      },
      {
        name: "Agente Quiz del Gusto",
        description:
          "Aiuta il visitatore a trovare il vino giusto con domande mirate — aumenta la conversione."
      }
    ]
  },
  {
    eyebrow: "Cliente & Esperienza",
    title: "Agenti per il cliente",
    accent: "burgundy",
    agents: [
      {
        name: "Agente Sommelier Virtuale",
        description:
          "Consiglia vini in base a budget, piatto, occasione e stile del cliente."
      },
      {
        name: "Agente Box Personalizzate",
        description:
          "Compone selezioni vino su misura per cena, regalo, aperitivo o fascia prezzo."
      },
      {
        name: "Agente Assistenza Clienti",
        description:
          "Risponde automaticamente su spedizioni, abbinamenti, temperature e scelta regalo."
      },
      {
        name: "Agente Guide Vino",
        description:
          "Crea mini-guide scaricabili su vitigni, abbinamenti, aperitivi, rosati e bollicine."
      },
      {
        name: "Agente Wine Club",
        description:
          "Suggerisce box, membership e campagne per aumentare retention e acquisti ripetuti."
      }
    ]
  },
  {
    eyebrow: "Catalogo & Contenuti",
    title: "Agenti per il catalogo",
    accent: "gold",
    agents: [
      {
        name: "Agente Schede Vino",
        description:
          "Trasforma dati tecnici e note degustative in schede prodotto chiare e persuasive."
      },
      {
        name: "Agente QR Wine Cards",
        description:
          "Genera schede digitali collegate a QR code con video, musica, ricette e storytelling."
      },
      {
        name: "Agente Script Video",
        description:
          "Scrive script per reel, storytelling di cantina, video educativi e presentazioni."
      },
      {
        name: "Agente Presentazioni Commerciali",
        description:
          "Crea brochure e materiali per buyer, importatori e distributori."
      },
      {
        name: "Agente Traduzione Cataloghi",
        description:
          "Adatta schede e cataloghi per buyer e clienti esteri in francese o inglese."
      }
    ]
  },
  {
    eyebrow: "Strategia & Operatività",
    title: "Agenti per decidere",
    accent: "ink",
    agents: [
      {
        name: "Agente Analisi Listini",
        description:
          "Confronta offerte fornitore, riassume differenze e individua le migliori opportunità di acquisto."
      },
      {
        name: "Agente Analisi Clienti",
        description:
          "Legge preferenze e comportamenti d'acquisto per creare offerte mirate e aumentare il valore medio."
      },
      {
        name: "Agente Ricerca di Mercato",
        description:
          "Riassume trend, competitor, segmenti cliente e opportunità nel settore vino."
      },
      {
        name: "Agente Degustazioni Guidate",
        description:
          "Prepara testi e scalette per eventi, serate tematiche, corsi e tasting experience."
      },
      {
        name: "Agente Formazione Staff",
        description:
          "Genera materiale didattico per personale di enoteca, sala e consulenti vendita."
      }
    ]
  }
];

// ── Palette accento ───────────────────────────────────────────────────────────

const accentStyles: Record<AgentSection["accent"], { badge: string; dot: string }> = {
  bottle:  { badge: "bg-bottle/10 text-bottle",    dot: "bg-bottle" },
  burgundy:{ badge: "bg-burgundy/10 text-burgundy", dot: "bg-burgundy" },
  gold:    { badge: "bg-gold/15 text-ink",          dot: "bg-gold" },
  ink:     { badge: "bg-ink/8 text-ink",            dot: "bg-ink" }
};

// ── Componente card agente ────────────────────────────────────────────────────

function AgentCard({ agent, dot }: { agent: Agent; dot: string }) {
  return (
    <article className="card-surface p-6">
      <div className="mb-4 flex items-center gap-3">
        <span className={`h-2 w-2 shrink-0 rounded-full ${dot}`} />
        <h3 className="text-lg font-semibold text-ink">{agent.name}</h3>
      </div>
      <p className="leading-7 text-ink/70">{agent.description}</p>
    </article>
  );
}

// ── Pagina ────────────────────────────────────────────────────────────────────

export default function AgentiPage() {
  return (
    <>
      {/* HERO */}
      <section className="container-shell py-16 sm:py-24">
        <div className="mx-auto max-w-3xl text-center">
          <p className="section-eyebrow mb-5">Wine AI System</p>
          <h1 className="text-4xl leading-tight text-ink sm:text-5xl sm:leading-tight">
            Una squadra di agenti AI<br />per il business del vino
          </h1>
          <p className="mt-6 text-lg leading-8 text-ink/70">
            Non un semplice sito. Un sistema intelligente che crea contenuti,
            analizza dati, consiglia vini e automatizza le vendite — progettato
            per enoteche, cantine, wine club e professionisti del settore.
          </p>
          <div className="mt-10 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
            <Link
              href={"/quiz" as Route}
              className="rounded-full bg-burgundy px-6 py-3 text-sm font-semibold text-cream transition hover:bg-burgundy/90"
            >
              Scopri il tuo profilo
            </Link>
            <Link
              href={"#agenti" as Route}
              className="rounded-full border border-burgundy/20 px-6 py-3 text-sm font-semibold text-burgundy transition hover:border-burgundy/50"
            >
              Esplora gli agenti
            </Link>
          </div>
        </div>
      </section>

      {/* COME FUNZIONA */}
      <section className="container-shell py-12 sm:py-16">
        <div className="card-surface overflow-hidden">
          <div className="grid gap-0 lg:grid-cols-[1fr_0.85fr]">
            <div className="p-8 sm:p-10">
              <p className="section-eyebrow">Come funziona</p>
              <h2 className="mt-3 text-3xl text-ink">
                Agenti specializzati che lavorano insieme.
              </h2>
              <p className="mt-4 max-w-xl leading-7 text-ink/75">
                Ogni agente ha un ruolo preciso. Separati sono già utili;
                coordinati diventano un sistema capace di gestire contenuti,
                dati, relazione con il cliente e decisioni di acquisto senza
                moltiplicare il lavoro manuale.
              </p>
            </div>
            <div className="bg-bottle px-8 py-10 text-cream">
              <ol className="space-y-5 text-base leading-7 text-cream/90">
                {[
                  "Analizza clienti, catalogo e dati fornitore",
                  "Genera contenuti pronti all'uso",
                  "Suggerisce prodotti e strategie mirate",
                  "Automatizza attività ripetitive",
                  "Migliora vendite e relazione col cliente"
                ].map((step, i) => (
                  <li key={i} className="flex items-start gap-4">
                    <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-cream/15 text-xs font-semibold text-cream">
                      {i + 1}
                    </span>
                    {step}
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>
      </section>

      {/* AGENTI — 4 sezioni */}
      <section id="agenti" className="container-shell py-12 sm:py-16">
        <div className="mb-10 max-w-2xl">
          <p className="section-eyebrow">Gli agenti</p>
          <h2 className="mt-3 text-3xl text-ink sm:text-4xl">
            20 agenti, 4 aree operative.
          </h2>
        </div>

        <div className="space-y-16">
          {sections.map((section) => {
            const { badge, dot } = accentStyles[section.accent];
            return (
              <div key={section.eyebrow}>
                <div className="mb-6 flex items-center gap-3">
                  <span className={`rounded-full px-3 py-1 text-xs font-semibold uppercase tracking-widest ${badge}`}>
                    {section.eyebrow}
                  </span>
                  <h3 className="text-xl font-semibold text-ink">{section.title}</h3>
                </div>
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {section.agents.map((agent) => (
                    <AgentCard key={agent.name} agent={agent} dot={dot} />
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* PER CHI È */}
      <section className="container-shell py-12 sm:py-16">
        <div className="rounded-[28px] bg-burgundy p-8 sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">
            Per chi è pensato
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl text-cream">
            Progettato per chi lavora nel vino — a qualsiasi livello.
          </h2>
          <div className="mt-8 flex flex-wrap gap-3">
            {[
              "Enoteche",
              "Cantine",
              "Wine Club",
              "Buyer e distributori",
              "Ecommerce vino",
              "Creator e formatori"
            ].map((label) => (
              <span
                key={label}
                className="rounded-full border border-cream/25 px-4 py-2 text-sm text-cream/90"
              >
                {label}
              </span>
            ))}
          </div>
        </div>
      </section>

      {/* ECOSISTEMA */}
      <section className="container-shell py-12 sm:py-16">
        <div className="grid gap-8 lg:grid-cols-2">
          <div className="card-surface p-8 sm:p-10">
            <p className="section-eyebrow">Non strumenti — un sistema</p>
            <h2 className="mt-3 text-3xl text-ink">
              Gli agenti condividono dati e si coordinano.
            </h2>
            <p className="mt-4 leading-7 text-ink/75">
              La maggior parte delle soluzioni AI offre strumenti isolati. Questo
              sistema è pensato diversamente: ogni agente conosce il contesto
              degli altri, condivide informazioni e migliora nel tempo.
            </p>
            <p className="mt-4 leading-7 text-ink/75">
              Il risultato: meno lavoro manuale, più controllo e decisioni migliori
              — sia sui contenuti sia sugli acquisti.
            </p>
          </div>

          <div className="card-surface p-8 sm:p-10">
            <p className="section-eyebrow">Esempio reale</p>
            <h2 className="mt-3 text-3xl text-ink">
              Cosa succede in pratica.
            </h2>
            <ol className="mt-6 space-y-3 text-sm leading-7 text-ink/75">
              {[
                "Un cliente visita il sito e compila il quiz",
                "L'agente sommelier suggerisce vini e una box su misura",
                "L'agente email prepara una proposta personalizzata",
                "L'agente catalogo genera la scheda del prodotto consigliato",
                "L'agente analytics traccia il comportamento",
                "L'agente buyer migliora le prossime offerte fornitore"
              ].map((step, i) => (
                <li key={i} className="flex items-start gap-3">
                  <span className="mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-burgundy/10 text-[10px] font-bold text-burgundy">
                    {i + 1}
                  </span>
                  {step}
                </li>
              ))}
            </ol>
            <p className="mt-6 text-sm font-semibold text-bottle">
              Tutto collegato. Tutto coordinato.
            </p>
          </div>
        </div>
      </section>

      {/* CTA FINALE */}
      <section className="container-shell pb-20 pt-8 sm:pb-28">
        <div className="rounded-[28px] border border-gold/25 bg-ink p-8 text-cream shadow-soft sm:p-10">
          <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">
            Wine AI System
          </p>
          <h2 className="mt-3 max-w-2xl text-3xl text-cream sm:text-4xl">
            Inizia con un agente.<br />Costruisci il tuo ecosistema.
          </h2>
          <p className="mt-4 max-w-xl leading-7 text-cream/70">
            Fai il quiz per scoprire quale agente ti serve davvero, o entra
            direttamente nel sistema con il Sommelier AI.
          </p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Link
              href={"/quiz" as Route}
              className="rounded-full bg-cream px-6 py-3 text-center text-sm font-semibold text-ink transition hover:bg-gold"
            >
              Scopri il tuo percorso
            </Link>
            <Link
              href={"/academy" as Route}
              className="rounded-full border border-cream/20 px-6 py-3 text-center text-sm font-semibold text-cream transition hover:border-cream/50"
            >
              Percorso Professionale
            </Link>
          </div>
        </div>
      </section>
    </>
  );
}
