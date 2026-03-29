import Anthropic from "@anthropic-ai/sdk";

import { getTemplate } from "./templates";
import { safetyCheck } from "./safety";
import type { AgentReply, ReplyContext } from "./types";

const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `Sei l'agente email di Divino AI, firmi come Luca – Divino Market.

Obiettivo: aiutare l'utente a scegliere meglio tra vino, contenuti e prodotti formativi.
Tono: umano, competente, non invadente. Mai da chatbot.

Prodotti disponibili:
1. Ebook Lead Magnet (gratuito): /#ebook-lead-magnet
2. Corso Introduttivo 5 Lezioni (€79): /corso
3. Wine AI Mastery (€249): /wine-ai-mastery
4. Wine Buyer Academy (€1490): /academy

Segmenti utente:
- Beginner Explorer → Corso 5 Lezioni
- Enthusiast & Collector → Wine AI Mastery
- AI Wine Creator → Wine AI Mastery
- Wine Business Professional → Wine Buyer Academy

Regole OBBLIGATORIE:
- Rispondi SEMPRE in italiano
- Massimo 220 parole
- Una sola CTA per email (formato: → Testo: /percorso)
- Non inventare prezzi, disponibilità o dettagli non forniti
- Non usare "clicca qui", "sconto", "solo oggi", "garantito"
- Se mancano informazioni, fai massimo 2 domande chiare
- Firma sempre: A presto,\nLuca\nDivino Market – L'Outlet del Vino

Struttura risposta:
1. Apertura breve e umana (1 riga)
2. Risposta utile e concreta
3. Eventuale consiglio vino o prodotto
4. CTA finale semplice`.trim();

export async function generateReply(ctx: ReplyContext): Promise<AgentReply> {
  const { inboundMessage, intent, lead } = ctx;
  const template = getTemplate(intent.intent, lead.segment);
  const bodyText = inboundMessage.extracted_text ?? inboundMessage.text;

  const userPrompt = `
Contesto lead:
- Nome: ${lead.name ?? "non noto"}
- Segmento quiz: ${lead.segment ?? "non classificato"}
- Prodotto suggerito: ${lead.productName ?? "non noto"}
- Email ricevute finora: ${lead.emailsSent ?? "non noto"}

Email ricevuta:
Oggetto: ${inboundMessage.subject}
Testo: ${bodyText}

Intent classificato: ${intent.intent} (${intent.confidence})
Parole chiave trovate: ${intent.matchedKeywords.join(", ") || "nessuna"}

Istruzioni per questa risposta:
${template}

Scrivi la risposta email. Solo il corpo del testo, senza righe "Da:", "A:", "Oggetto:".
`.trim();

  const message = await anthropic.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 600,
    messages: [{ role: "user", content: userPrompt }],
    system: SYSTEM_PROMPT,
  });

  const rawText =
    message.content[0].type === "text" ? message.content[0].text : "";

  const safety = safetyCheck(rawText);

  const replySubject = inboundMessage.subject.startsWith("Re:")
    ? inboundMessage.subject
    : `Re: ${inboundMessage.subject}`;

  return {
    subject: replySubject,
    text: rawText,
    approved: safety.approved,
    intent: intent.intent,
    safetyCheck: safety,
  };
}
