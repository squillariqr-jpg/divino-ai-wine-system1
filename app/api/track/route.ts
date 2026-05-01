import { NextResponse } from "next/server";
import { supabase } from "@/lib/supabase";

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const event = typeof body?.event === "string" ? body.event.slice(0, 100) : null;
    if (!event) return NextResponse.json({ ok: false }, { status: 400 });

    await supabase.from("events").insert({
      event_name: event,
      properties: body.properties ?? {},
    });

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ ok: false });
  }
}
