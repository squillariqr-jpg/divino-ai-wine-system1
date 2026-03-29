import { NextResponse } from "next/server";

import { submitLeadToPlaceholderBackend } from "@/lib/placeholder-backend";
import type { LeadCapturePayload } from "@/lib/types";

export async function POST(request: Request) {
  // Future-ready note:
  // this route is the boundary where we can later swap the placeholder backend
  // with a Supabase repository and an n8n workflow trigger without changing the UI contract.
  const body = (await request.json()) as Partial<LeadCapturePayload>;

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { success: false, message: "Email valida obbligatoria." },
      { status: 400 }
    );
  }

  const record = await submitLeadToPlaceholderBackend({
    name: body.name,
    email: body.email,
    source: body.source ?? "sito",
    segment: body.segment,
    interest: body.interest,
    notes: body.notes
  });

  return NextResponse.json({
    success: true,
    message: "Lead ricevuto e inviato al backend placeholder.",
    leadId: record.leadId,
    destination: record.destination,
    nextStep: record.nextStep
  });
}
