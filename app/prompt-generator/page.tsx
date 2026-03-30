"use client";

import { useState } from "react";

const GOALS = [
  { value: "social", label: "Post Social" },
  { value: "email", label: "Email Marketing" },
  { value: "degustazione", label: "Scheda Degustazione" },
  { value: "vendita", label: "Testo di Vendita" },
  { value: "analisi", label: "Analisi Vino" },
];

const TARGETS = [
  { value: "beginner", label: "Principiante" },
  { value: "enthusiast", label: "Appassionato" },
  { value: "professional", label: "Professionista" },
  { value: "creator", label: "Creator / Blogger" },
];

const STYLES = [
  { value: "emozionale", label: "Emozionale" },
  { value: "tecnico", label: "Tecnico" },
  { value: "persuasivo", label: "Persuasivo" },
  { value: "educativo", label: "Educativo" },
];

function buildPrompt(form: {
  goal: string;
  wine: string;
  region: string;
  target: string;
  style: string;
  context: string;
}): string {
  const goalMap: Record<string, string> = {
    social: "Scrivi un post social (Instagram/LinkedIn) sul vino indicato.",
    email: "Scrivi una email di marketing per promuovere o presentare il vino indicato.",
    degustazione:
      "Crea una scheda di degustazione professionale (vista, olfatto, gusto, finale, abbinamenti).",
    vendita:
      "Scrivi un testo di vendita persuasivo per il vino indicato, adatto a un e-commerce o scheda prodotto.",
    analisi:
      "Fai un'analisi approfondita del vino indicato: territorio, produttore, caratteristiche, posizionamento di mercato.",
  };

  const targetMap: Record<string, string> = {
    beginner: "Il target è un principiante: usa un linguaggio accessibile, evita termini tecnici.",
    enthusiast: "Il target è un appassionato: puoi usare riferimenti tecnici ma mantieni il tono coinvolgente.",
    professional:
      "Il target è un professionista del settore: linguaggio preciso, riferimenti tecnici corretti.",
    creator:
      "Il target è un creator o blogger: il tono deve essere narrativo, visivo, condivisibile.",
  };

  const styleMap: Record<string, string> = {
    emozionale: "Stile emozionale: evoca sensazioni, esperienze, memoria. Usa immagini vivide.",
    tecnico: "Stile tecnico: dati precisi, terminologia corretta, struttura chiara.",
    persuasivo: "Stile persuasivo: crea desiderio, evidenzia benefici, includi una CTA forte.",
    educativo: "Stile educativo: spiega, insegna, usa esempi pratici e progressivi.",
  };

  const parts: string[] = [];

  parts.push(`Sei un esperto sommelier e consulente di marketing enologico.`);
  parts.push(``);

  const goalInstruction = goalMap[form.goal] || "Produci un contenuto professionale sul vino indicato.";
  parts.push(`COMPITO: ${goalInstruction}`);
  parts.push(``);

  if (form.wine) {
    parts.push(`VINO: ${form.wine}${form.region ? ` — ${form.region}` : ""}`);
  }

  if (form.target) {
    parts.push(`TARGET: ${targetMap[form.target] || form.target}`);
  }

  if (form.style) {
    parts.push(`STILE: ${styleMap[form.style] || form.style}`);
  }

  if (form.context.trim()) {
    parts.push(``);
    parts.push(`CONTESTO AGGIUNTIVO:`);
    parts.push(form.context.trim());
  }

  parts.push(``);
  parts.push(`REGOLE:`);
  parts.push(`- Usa un linguaggio corretto dal punto di vista enologico`);
  parts.push(`- Evita banalità e frasi fatte`);
  parts.push(`- Adatta tono e vocabolario al target indicato`);
  parts.push(`- Se il compito è un post social: max 150 parole, includi CTA finale`);
  parts.push(`- Se il compito è una email: includi oggetto, corpo e firma`);
  parts.push(`- Se mancano informazioni importanti, chiedi prima di procedere`);

  return parts.join("\n");
}

export default function PromptGeneratorPage() {
  const [form, setForm] = useState({
    goal: "",
    wine: "",
    region: "",
    target: "",
    style: "",
    context: "",
  });

  const [prompt, setPrompt] = useState("");
  const [copied, setCopied] = useState(false);

  const handleGenerate = () => {
    if (!form.goal || !form.wine) return;
    const result = buildPrompt(form);
    setPrompt(result);
    setCopied(false);
  };

  const handleCopy = () => {
    navigator.clipboard.writeText(prompt);
    setCopied(true);
    setTimeout(() => setCopied(false), 2500);
  };

  const isReady = form.goal && form.wine;

  return (
    <div className="min-h-screen py-16">
      <div className="container-shell">
        {/* Header */}
        <div className="mx-auto mb-12 max-w-2xl text-center">
          <p className="section-eyebrow mb-3">Affari Divini</p>
          <h1 className="mb-4 font-serif text-4xl font-bold text-ink">
            Wine Prompt Engine
          </h1>
          <p className="text-lg text-ink/65">
            Costruisci prompt professionali per il vino in pochi secondi.
            Copialo e usalo su ChatGPT, Claude o qualsiasi AI.
          </p>
        </div>

        <div className="mx-auto max-w-4xl grid gap-8 lg:grid-cols-2">
          {/* Form */}
          <div className="card-surface p-8">
            <h2 className="mb-6 font-serif text-xl font-semibold text-ink">
              Configura il prompt
            </h2>

            {/* Obiettivo */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Obiettivo *
              </label>
              <div className="flex flex-wrap gap-2">
                {GOALS.map((g) => (
                  <button
                    key={g.value}
                    onClick={() => setForm({ ...form, goal: g.value })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      form.goal === g.value
                        ? "border-burgundy bg-burgundy text-cream"
                        : "border-burgundy/25 text-ink/70 hover:border-burgundy/60"
                    }`}
                  >
                    {g.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Vino */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Vino *
              </label>
              <input
                type="text"
                placeholder="es. Barolo, Brunello, Franciacorta…"
                value={form.wine}
                onChange={(e) => setForm({ ...form, wine: e.target.value })}
                className="w-full rounded-xl border border-burgundy/20 bg-white/60 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink/35 focus:border-burgundy/60"
              />
            </div>

            {/* Regione */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Regione / Produttore
              </label>
              <input
                type="text"
                placeholder="es. Piemonte, Cantina X…"
                value={form.region}
                onChange={(e) => setForm({ ...form, region: e.target.value })}
                className="w-full rounded-xl border border-burgundy/20 bg-white/60 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink/35 focus:border-burgundy/60"
              />
            </div>

            {/* Target */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Target
              </label>
              <div className="flex flex-wrap gap-2">
                {TARGETS.map((t) => (
                  <button
                    key={t.value}
                    onClick={() => setForm({ ...form, target: t.value })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      form.target === t.value
                        ? "border-burgundy bg-burgundy text-cream"
                        : "border-burgundy/25 text-ink/70 hover:border-burgundy/60"
                    }`}
                  >
                    {t.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Stile */}
            <div className="mb-5">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Stile Output
              </label>
              <div className="flex flex-wrap gap-2">
                {STYLES.map((s) => (
                  <button
                    key={s.value}
                    onClick={() => setForm({ ...form, style: s.value })}
                    className={`rounded-full border px-4 py-2 text-sm transition ${
                      form.style === s.value
                        ? "border-burgundy bg-burgundy text-cream"
                        : "border-burgundy/25 text-ink/70 hover:border-burgundy/60"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            </div>

            {/* Contesto */}
            <div className="mb-6">
              <label className="mb-2 block text-xs font-semibold uppercase tracking-widest text-burgundy/70">
                Contesto aggiuntivo
              </label>
              <textarea
                rows={3}
                placeholder="es. È per una degustazione verticale, prezzo €45, pubblico di buyer…"
                value={form.context}
                onChange={(e) => setForm({ ...form, context: e.target.value })}
                className="w-full rounded-xl border border-burgundy/20 bg-white/60 px-4 py-3 text-sm text-ink outline-none placeholder:text-ink/35 focus:border-burgundy/60 resize-none"
              />
            </div>

            <button
              onClick={handleGenerate}
              disabled={!isReady}
              className={`w-full rounded-full py-3 font-semibold transition ${
                isReady
                  ? "bg-burgundy text-cream hover:bg-burgundy/90"
                  : "bg-ink/10 text-ink/30 cursor-not-allowed"
              }`}
            >
              Genera Prompt
            </button>
          </div>

          {/* Output */}
          <div className="card-surface flex flex-col p-8">
            <div className="mb-4 flex items-center justify-between">
              <h2 className="font-serif text-xl font-semibold text-ink">
                Il tuo prompt
              </h2>
              {prompt && (
                <button
                  onClick={handleCopy}
                  className="rounded-full border border-burgundy/30 px-4 py-1.5 text-xs font-semibold text-burgundy transition hover:bg-burgundy hover:text-cream"
                >
                  {copied ? "Copiato ✓" : "Copia"}
                </button>
              )}
            </div>

            {prompt ? (
              <pre className="flex-1 overflow-auto whitespace-pre-wrap rounded-xl bg-ink/5 p-5 text-xs leading-6 text-ink/80">
                {prompt}
              </pre>
            ) : (
              <div className="flex flex-1 flex-col items-center justify-center text-center text-ink/35">
                <p className="text-5xl mb-4">🍷</p>
                <p className="text-sm">
                  Seleziona obiettivo e vino,<br />poi premi &quot;Genera Prompt&quot;
                </p>
              </div>
            )}

            {prompt && (
              <div className="mt-4 rounded-xl border border-gold/30 bg-gold/8 p-4 text-xs text-ink/60">
                <strong className="text-ink/80">Come usarlo:</strong> copia il prompt e incollalo in
                ChatGPT, Claude, o qualsiasi AI. Per risultati migliori aggiungi eventuali
                dettagli specifici dopo aver incollato.
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
