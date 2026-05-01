import Link from "next/link";
import { SommelierCTA } from "@/components/SommelierCTA";

const whatYouGet = [
  {
    title: "Template pronti per post e video",
    desc: "Instagram, LinkedIn, newsletter, Reels. Non scrivi da zero: parti da strutture che funzionano già.",
  },
  {
    title: "Prompt già strutturati per il vino",
    desc: "Prompt testati per schede degustazione, copy di vendita, script video e email marketing enologico.",
  },
  {
    title: "Sistema per creare contenuti veloce",
    desc: "Un metodo editoriale per passare da idea a contenuto pubblicabile in minuti, non ore.",
  },
  {
    title: "Metodo per trasformare contenuti in vendite",
    desc: "Come collegare ogni pezzo di contenuto a un obiettivo commerciale concreto: lead, vendite, autorevolezza.",
  },
];

const problems = [
  "Pubblichi ma non cresci — l'engagement è basso e le vendite non arrivano",
  "Perdi troppo tempo a scrivere post, reel, newsletter da zero",
  "I tuoi contenuti sono tecnici ma non convertono chi legge",
  "Non sai come collegare contenuto wine a un risultato commerciale",
];

export default function WineAiMasteryPage() {
  return (
    <div className="min-h-screen">
      {/* Hero */}
      <section className="container-shell py-14 sm:py-20">
        <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-start">
          <div>
            <p className="section-eyebrow">Wine AI Mastery</p>
            <h1 className="mt-3 text-4xl sm:text-5xl text-ink leading-tight">
              Crea contenuti vino che fanno crescere audience e vendite.{" "}
              <span className="text-burgundy">Con l&apos;AI.</span>
            </h1>
            <p className="mt-5 max-w-2xl leading-8 text-ink/75">
              Non hai bisogno di scrivere meglio.
              Hai bisogno di un sistema che trasforma idee in contenuti che funzionano.
            </p>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row">
              <Link
                href="/quiz"
                className="rounded-full bg-burgundy px-7 py-3.5 text-center text-sm font-semibold text-cream transition hover:bg-burgundy/90"
              >
                Costruisci il tuo sistema contenuti
              </Link>
              <Link
                href="/academy"
                className="rounded-full border border-burgundy/15 px-7 py-3.5 text-center text-sm font-semibold text-burgundy transition hover:bg-white/60"
              >
                Sei un buyer? Vedi Academy
              </Link>
            </div>
          </div>

          <div className="rounded-[28px] bg-burgundy shadow-soft p-8 text-cream">
            <p className="text-xs uppercase tracking-[0.28em] text-gold/90">Per chi è</p>
            <ul className="mt-5 space-y-3 text-cream/85">
              {[
                "Creator e influencer nel mondo vino",
                "Chi vuole usare il vino come leva di contenuto",
                "Chi pubblica ma non cresce",
                "Chi perde troppo tempo a scrivere da zero",
              ].map((item) => (
                <li key={item} className="flex items-start gap-2">
                  <span className="mt-0.5 text-gold text-sm">✓</span>
                  {item}
                </li>
              ))}
            </ul>
            <p className="mt-8 text-4xl font-bold text-gold">€249</p>
            <p className="mt-1 text-sm text-cream/50">accesso completo · una tantum</p>
          </div>
        </div>
      </section>

      {/* Problem */}
      <section className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="mx-auto max-w-3xl">
            <p className="section-eyebrow mb-4">Il problema reale</p>
            <h2 className="text-3xl text-ink">
              Il problema non è <em>cosa</em> dire. È <em>come</em> dirlo — e come farlo scalare.
            </h2>
            <p className="mt-4 leading-8 text-ink/70">
              Nel vino ci sono troppi contenuti tecnici, troppo autoreferenziali,
              troppo poco orientati a chi legge. Risultato: contenuti che parlano... ma non convertono.
            </p>
            <div className="mt-8 grid gap-3 sm:grid-cols-2">
              {problems.map((p) => (
                <div key={p} className="flex items-start gap-3 rounded-xl border border-burgundy/10 bg-burgundy/4 p-4">
                  <span className="mt-0.5 text-burgundy text-sm">→</span>
                  <p className="text-sm leading-6 text-ink/75">{p}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </section>

      {/* What you get */}
      <section className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="mb-10">
            <p className="section-eyebrow">Cosa ottieni</p>
            <h2 className="mt-3 text-3xl text-ink">Un sistema, non una raccolta di materiali.</h2>
          </div>
          <div className="grid gap-5 md:grid-cols-2">
            {whatYouGet.map((item) => (
              <article key={item.title} className="card-surface p-6 sm:p-8">
                <span className="text-gold text-xl">✓</span>
                <h3 className="mt-3 text-xl text-ink">{item.title}</h3>
                <p className="mt-3 leading-7 text-ink/70">{item.desc}</p>
              </article>
            ))}
          </div>
        </div>
      </section>

      {/* Transformation */}
      <section className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="rounded-[28px] bg-bottle shadow-soft p-8 text-cream sm:p-10">
            <p className="text-xs uppercase tracking-[0.28em] text-gold/90">Risultato</p>
            <div className="mt-6 grid gap-8 sm:grid-cols-2">
              <div>
                <p className="text-sm text-cream/50 uppercase tracking-wider mb-3">Prima</p>
                <ul className="space-y-2 text-cream/70">
                  <li>→ &quot;Non so cosa pubblicare&quot;</li>
                  <li>→ Ore perse a scrivere da zero</li>
                  <li>→ Contenuti che non convertono</li>
                  <li>→ Audience che non cresce</li>
                </ul>
              </div>
              <div>
                <p className="text-sm text-gold/70 uppercase tracking-wider mb-3">Dopo</p>
                <ul className="space-y-2 text-cream/90">
                  <li className="flex items-start gap-2"><span className="text-gold">✓</span> Sistema editoriale pronto</li>
                  <li className="flex items-start gap-2"><span className="text-gold">✓</span> Contenuti in minuti, non ore</li>
                  <li className="flex items-start gap-2"><span className="text-gold">✓</span> Ogni post collegato a un obiettivo</li>
                  <li className="flex items-start gap-2"><span className="text-gold">✓</span> Crescita misurabile</li>
                </ul>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Why now */}
      <section className="border-t border-burgundy/10 py-16">
        <div className="container-shell">
          <div className="card-surface p-8 sm:p-10">
            <p className="section-eyebrow">Perché adesso</p>
            <h2 className="mt-3 text-3xl text-ink">
              Il mercato non premia più solo la conoscenza: premia sistemi chiari e ripetibili.
            </h2>
            <p className="mt-4 max-w-3xl leading-8 text-ink/75">
              Chi pubblica contenuti wine in modo sistematico — con AI, template e metodo —
              cresce più veloce di chi scrive bene ma senza struttura.
              Wine AI Mastery ti mette dalla parte giusta.
            </p>
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-16">
        <div className="container-shell">
          <div className="rounded-[28px] bg-burgundy shadow-soft p-8 text-cream sm:p-10">
            <p className="text-xs font-semibold uppercase tracking-[0.28em] text-gold/90">Pronto a iniziare?</p>
            <h2 className="mt-3 max-w-2xl text-3xl text-cream">
              Fai il quiz — scopri se Wine AI Mastery è il passo giusto per te.
            </h2>
            <div className="mt-8 flex flex-col gap-3 sm:flex-row sm:items-center">
              <Link
                href="/quiz"
                className="rounded-full bg-cream px-7 py-3.5 text-center text-sm font-semibold text-burgundy transition hover:bg-gold"
              >
                Costruisci il tuo sistema contenuti
              </Link>
              <SommelierCTA
                source="wine_ai_mastery"
                className="rounded-full border border-cream/25 px-7 py-3.5 text-center text-sm font-semibold text-cream transition hover:border-cream/60"
                label="💬 Chiedi al Sommelier AI"
              />
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}
