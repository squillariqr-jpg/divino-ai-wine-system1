import { NextResponse } from "next/server";

import { supabase } from "@/lib/supabase";

// Called daily by Vercel Cron to prevent Supabase free tier from pausing.
export async function GET(request: Request) {
  const authHeader = request.headers.get("authorization");
  if (authHeader !== `Bearer ${process.env.CRON_SECRET}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { error } = await supabase
    .from("leads")
    .select("id")
    .limit(1);

  if (error) {
    console.error("Keepalive ping failed:", error.message);
    return NextResponse.json({ ok: false, error: error.message }, { status: 500 });
  }

  return NextResponse.json({ ok: true, ts: new Date().toISOString() });
}
