import { NextResponse } from "next/server";
import { AgentMailClient } from "agentmail";

import { classifyIntent } from "@/lib/emailAgent/classifier";
import { getHermesReply } from "@/lib/hermesClient";
import type { AgentMailWebhookPayload, LeadContext } from "@/lib/emailAgent/types";
import { supabase } from "@/lib/supabase";

const agentmail = new AgentMailClient({
  apiKey: process.env.AGENTMAIL_API_KEY ?? "",
});

const FALLBACK_REPLY =
  "Grazie per il messaggio. Ti rispondo a breve con un consiglio mirato.\n\nA presto,\nLuca\nAffari Divini";

const HANDOFF_REPLY =
  "Certo, capisco che tu voglia parlare direttamente.\nRispondimi con due righe sul tuo caso e ti contatto nel modo più utile.\n\nA presto,\nLuca\nAffari Divini";

function limitWords(text: string, max = 220): string {
  const words = text.trim().split(/\s+/);
  return words.length <= max ? text.trim() : words.slice(0, max).join(" ") + "…";
}

export async function POST(request: Request) {
  let payload: AgentMailWebhookPayload;

  try {
    payload = (await request.json()) as AgentMailWebhookPayload;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (payload.event_type !== "message.received") {
    return NextResponse.json({ skipped: true });
  }

  const msg = payload.message;

  // 1. Resolve sender email
  const senderEmail = msg.from.includes("<")
    ? msg.from.match(/<(.+?)>/)?.[1] ?? msg.from
    : msg.from;

  // 2. Look up lead context
  const { data: leadRow } = await supabase
    .from("leads")
    .select("id, name, segment, product_name, emails_sent")
    .eq("email", senderEmail)
    .maybeSingle();

  const lead: LeadContext = {
    leadId: leadRow?.id,
    name: leadRow?.name,
    segment: leadRow?.segment,
    productName: leadRow?.product_name,
    emailsSent: leadRow?.emails_sent ?? 0,
  };

  // 3. Classify intent
  const bodyText = msg.extracted_text ?? msg.text ?? "";
  const intent = classifyIntent(bodyText);

  // 4. Log inbound
  await supabase.from("email_messages").insert({
    thread_id: msg.thread_id,
    message_id: msg.message_id,
    direction: "inbound",
    from_address: senderEmail,
    subject: msg.subject,
    body: bodyText,
    intent: intent.intent,
    intent_confidence: intent.confidence,
    lead_id: lead.leadId ?? null,
  });

  const inboxId = process.env.AGENTMAIL_INBOX_ID ?? "";

  // 5. Human handoff — no AI, short reply + flag
  if (intent.intent === "human_help") {
    await supabase.from("agent_actions").insert({
      thread_id: msg.thread_id,
      action_type: "handoff",
      action_payload: { reason: "human_help", sender: senderEmail, subject: msg.subject },
    });

    await agentmail.inboxes.messages.reply(inboxId, msg.message_id, {
      text: HANDOFF_REPLY,
    });

    return NextResponse.json({ handled: "handoff", intent: intent.intent });
  }

  // 6. Generate reply via Hermes (Marco — Sommelier AI)
  let replyText: string;

  try {
    replyText = await getHermesReply({
      message: bodyText,
      segment: lead.segment ?? undefined,
      userName: lead.name ?? senderEmail.split("@")[0],
      subject: msg.subject,
    });
    replyText = limitWords(replyText);
  } catch (err) {
    console.error("Hermes reply failed:", err);
    replyText = FALLBACK_REPLY;

    await supabase.from("agent_actions").insert({
      thread_id: msg.thread_id,
      action_type: "hermes_fallback",
      action_payload: { error: String(err) },
    });
  }

  // 7. Send reply
  await agentmail.inboxes.messages.reply(inboxId, msg.message_id, {
    text: replyText,
  });

  // 8. Log outbound
  await supabase.from("agent_actions").insert({
    thread_id: msg.thread_id,
    action_type: "reply",
    action_payload: {
      intent: intent.intent,
      via: "hermes",
      word_count: replyText.split(/\s+/).length,
    },
  });

  return NextResponse.json({ handled: "replied", intent: intent.intent, via: "hermes" });
}
