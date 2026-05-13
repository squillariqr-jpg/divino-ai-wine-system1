import type { EmailIntent } from "./types";
import type { SegmentId } from "@/lib/types";

type TemplateKey = `${EmailIntent}:${SegmentId}` | `${EmailIntent}:default`;

// Each template is a structured prompt fragment.
// The reply engine injects sender name, segment context, and personalises via LLM.
const templates: Record<TemplateKey | string, string> = {

  // ── WINE ADVICE ──────────────────────────────────────────────────────────────

  "wine_advice:novizio-curioso": `
Rispondi in modo semplice e rassicurante.
Consiglia 2 vini concreti adatti a chi inizia: uno bianco e uno rosso.
Spiega in 1 frase cosa li rende speciali — senza tecnicismi.
Chiudi con una CTA morbida verso il Corso Introduttivo in 5 Lezioni (€79): /corso
`.trim(),

  "wine_advice:appassionato-pratico": `
Rispondi con tono raffinato e selettivo.
Consiglia 2 vini interessanti con un profilo più definito: regione, vitigno, carattere.
Sottolinea cosa li distingue da una scelta ordinaria.
Chiudi con una CTA verso Wine AI Mastery (€249): /wine-ai-mastery
`.trim(),

  "wine_advice:builder-digitale": `
Rispondi con tono strategico.
Consiglia 2 vini con forte potenziale narrativo per contenuti: insoliti, con storia, visivi.
Spiega perché funzionano bene nei contenuti social/email.
Chiudi con una CTA verso Wine AI Mastery (€249): /wine-ai-mastery
`.trim(),

  "wine_advice:buyer-professionale": `
Rispondi con tono business e concreto.
Consiglia 2 vini con potenziale commerciale: denominazioni interessanti, margini, domanda.
Chiudi con una CTA verso Wine Buyer Academy o una call gratuita: /academy
`.trim(),

  "wine_advice:default": `
Rispondi in modo utile e umano.
Consiglia 2 vini concreti basandoti sul messaggio ricevuto.
Spiega brevemente perché li consigli.
Chiudi con una CTA verso il prodotto più coerente con il profilo.
`.trim(),

  // ── FIT CHECK ─────────────────────────────────────────────────────────────────

  "fit_check:novizio-curioso": `
Rispondi in modo rassicurante.
Non vendere subito — aiuta a capire se il Corso in 5 Lezioni (€79) è adatto.
Fai massimo 2 domande precise per capire il punto di partenza dell'utente.
Chiudi dicendo che puoi rispondere appena ha chiarito.
`.trim(),

  "fit_check:appassionato-pratico": `
Rispondi con tono diretto e rispettoso.
Spiega in 2-3 righe per chi è stato costruito Wine AI Mastery e per chi non è adatto.
Fai 1 domanda per capire se c'è fit reale.
Chiudi con CTA verso /wine-ai-mastery solo se il fit sembra buono.
`.trim(),

  "fit_check:builder-digitale": `
Rispondi con tono strategico e orientato ai risultati.
Chiedi al massimo 2 domande precise: il progetto, l'obiettivo, il pubblico.
Se il fit è plausibile, proponi Wine AI Mastery (€249) con una ragione concreta.
`.trim(),

  "fit_check:buyer-professionale": `
Rispondi con tono professionale e diretto.
Fai 2 domande sul volume d'acquisto e sulle decisioni correnti.
Se il profilo regge, proponi una call gratuita di 20 minuti: /academy
Spiega brevemente che è il modo migliore per capire se fa al caso suo.
`.trim(),

  "fit_check:default": `
Rispondi in modo utile, senza spingere.
Fai al massimo 2 domande per capire il contesto.
Chiudi offrendo una risposta più precisa una volta chiarito.
`.trim(),

  // ── PRICE OBJECTION ───────────────────────────────────────────────────────────

  "price_objection:novizio-curioso": `
Non difenderti sul prezzo.
Riformula il valore: €79 non è il prezzo di un corso, è il prezzo di non sprecare bottiglie.
Proponi l'alternativa gratuita (ebook lead magnet) come primo passo: /#ebook-lead-magnet
Chiudi con CTA verso il corso per chi vuole il sistema completo.
`.trim(),

  "price_objection:appassionato-pratico": `
Non difenderti sul prezzo.
Riformula il valore di Wine AI Mastery (€249) in termini di tempo risparmiato e scelte migliori.
Proponi l'alternativa: Corso in 5 Lezioni (€79) se vuole iniziare con meno.
Chiudi con una CTA chiara.
`.trim(),

  "price_objection:builder-digitale": `
Non difenderti sul prezzo.
Riformula il valore di Wine AI Mastery (€249) in termini di ritorno: sistema, template, metodo.
Chiedi se preferisce una call per capire meglio prima di decidere.
`.trim(),

  "price_objection:buyer-professionale": `
Non difenderti sul prezzo.
Riformula il valore della Wine Buyer Academy (€1490) in termini di ritorno sul primo acquisto.
Proponi la call gratuita come passo zero prima di qualsiasi decisione: /academy
`.trim(),

  "price_objection:default": `
Non difenderti sul prezzo.
Riformula il valore in termini concreti per l'utente.
Proponi l'alternativa inferiore se esiste.
Chiudi con una CTA semplice.
`.trim(),

  // ── HUMAN HELP ────────────────────────────────────────────────────────────────

  "human_help:default": `
Rispondi in modo caldo e diretto.
Dì che hai ricevuto il messaggio e che Luca risponde personalmente entro 24 ore.
Se è urgente, invitalo a rispondere con i dettagli.
Non proporre prodotti in questa email — è una email di supporto umano.
`.trim(),
};

export function getTemplate(intent: EmailIntent, segment?: SegmentId): string {
  const specific = segment
    ? templates[`${intent}:${segment}`]
    : undefined;
  return specific ?? templates[`${intent}:default`] ?? templates["human_help:default"];
}
