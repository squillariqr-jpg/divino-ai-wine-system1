import { NextResponse } from "next/server";

import { submitLeadToPlaceholderBackend } from "@/lib/placeholder-backend";
import { getSupabase } from "@/lib/supabase";
import type { LeadCapturePayload } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<LeadCapturePayload>;

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { success: false, message: "Email valida obbligatoria." },
      { status: 400 }
    );
  }

  const normalizedPayload: LeadCapturePayload = {
    name: body.name ?? undefined,
    email: body.email,
    source: body.source ?? "sito",
    segment: body.segment,
    interest: body.interest,
    businessType: body.businessType,
    quizResult: body.quizResult,
    message: body.message,
    notes: body.notes,
    agentName: body.agentName ?? body.agentDecision?.agentName,
    nextAction: body.nextAction ?? body.agentDecision?.nextAction,
    agentDecision: body.agentDecision
  };

  const placeholderLead = await submitLeadToPlaceholderBackend(normalizedPayload);

  // Future integration note:
  // Supabase remains a best-effort sink. The deterministic placeholder backend
  // is the source of truth for local/demo flows until the real data model lands.
  if (
    process.env.SUPABASE_URL &&
    process.env.SUPABASE_SERVICE_ROLE_KEY
  ) {
    try {
      const supabase = getSupabase();
      const { error } = await supabase.from("leads").upsert(
        {
          email: normalizedPayload.email,
          name: normalizedPayload.name ?? null,
          segment: normalizedPayload.segment ?? null,
          product_name: normalizedPayload.interest ?? null,
          source: normalizedPayload.source,
          interest: normalizedPayload.interest ?? null,
          updated_at: new Date().toISOString()
        },
        { onConflict: "email" }
      );

      if (error) {
        console.error("Supabase lead upsert error:", error.message);
      }
    } catch (error) {
      console.error("Supabase lead sync skipped:", error);
    }
  }

  return NextResponse.json({
    success: true,
    message: "Perfetto — ti invio subito il percorso.",
    leadId: placeholderLead.leadId,
    destination: placeholderLead.destination,
    nextStep: placeholderLead.nextStep,
    agentName: placeholderLead.agentName
  });
}
