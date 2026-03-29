import { NextResponse } from "next/server";
import { AgentMailClient } from "agentmail";

import { classifyIntent } from "@/lib/emailAgent/classifier";
import { generateReply } from "@/lib/emailAgent/replyEngine";
import type { AgentMailWebhookPayload, LeadContext } from "@/lib/emailAgent/types";
import { supabase } from "@/lib/supabase";

const agentmail = new AgentMailClient({
  apiKey: process.env.AGENTMAIL_API_KEY ?? "",
});

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

  // 1. Look up lead context by sender email
  const senderEmail = msg.from.includes("<")
    ? msg.from.match(/<(.+?)>/)?.[1] ?? msg.from
    : msg.from;

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

  // 2. Classify intent
  const bodyText = msg.extracted_text ?? msg.text ?? "";
  const intent = classifyIntent(bodyText);

  // 3. Log inbound message
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

  // 4. Skip if human_help — mark for manual follow-up
  if (intent.intent === "human_help") {
    await supabase.from("agent_actions").insert({
      thread_id: msg.thread_id,
      action_type: "handoff",
      action_payload: {
        reason: "human_help intent",
        sender: senderEmail,
        subject: msg.subject,
      },
    });

    return NextResponse.json({ handled: "handoff", intent: intent.intent });
  }

  // 5. Generate reply
  const reply = await generateReply({
    inboundMessage: msg,
    intent,
    lead,
  });

  // 6. Safety gate — if not approved, mark for review
  if (!reply.approved) {
    await supabase.from("agent_actions").insert({
      thread_id: msg.thread_id,
      action_type: "review_required",
      action_payload: {
        reasons: reply.safetyCheck.reasons,
        draft: reply.text,
      },
    });

    return NextResponse.json({
      handled: "review_required",
      reasons: reply.safetyCheck.reasons,
    });
  }

  // 7. Send reply via AgentMail
  const inboxId = process.env.AGENTMAIL_INBOX_ID ?? "";

  await agentmail.inboxes.messages.reply(inboxId, msg.message_id, {
    text: reply.text,
  });

  // 8. Log outbound action
  await supabase.from("agent_actions").insert({
    thread_id: msg.thread_id,
    action_type: "reply",
    action_payload: {
      subject: reply.subject,
      intent: reply.intent,
      word_count: reply.safetyCheck.wordCount,
    },
  });

  return NextResponse.json({ handled: "replied", intent: reply.intent });
}
