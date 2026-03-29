import { NextResponse } from "next/server";

import { buildRecommendation } from "@/lib/recommendation";
import type { QuizAnswers } from "@/lib/types";

export async function POST(request: Request) {
  // Future-ready note:
  // keep the local rule-based engine as a deterministic fallback.
  // An agent layer such as OpenClaw can later be injected here or behind an adapter.
  const body = (await request.json()) as Partial<QuizAnswers>;

  if (!body.level || !body.goal || !body.taste || !body.budget) {
    return NextResponse.json(
      { message: "Dati del quiz incompleti." },
      { status: 400 }
    );
  }

  const result = buildRecommendation(body as QuizAnswers);

  return NextResponse.json(result);
}
