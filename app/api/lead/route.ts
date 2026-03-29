import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";
import type { LeadCapturePayload } from "@/lib/types";

export async function POST(request: Request) {
  const body = (await request.json()) as Partial<LeadCapturePayload>;

  if (!body.email || !body.email.includes("@")) {
    return NextResponse.json(
      { success: false, message: "Email valida obbligatoria." },
      { status: 400 }
    );
  }

  const { data, error } = await supabase
    .from("leads")
    .upsert(
      {
        email: body.email,
        name: body.name ?? null,
        segment: body.segment ?? null,
        product_name: body.interest ?? null,
        source: body.source ?? "sito",
        interest: body.interest ?? null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: "email" }
    )
    .select("id")
    .single();

  if (error) {
    console.error("Supabase lead upsert error:", error.message);
    return NextResponse.json(
      { success: false, message: "Errore nel salvataggio del lead." },
      { status: 500 }
    );
  }

  return NextResponse.json({
    success: true,
    message: "Perfetto — ti invio subito il percorso.",
    leadId: data.id,
  });
}
