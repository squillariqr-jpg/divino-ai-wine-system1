import { NextResponse } from "next/server";

import { routeAgentDecision } from "@/lib/agents/router";
import type {
  RecommendApiResponse,
  RecommendRequestPayload
} from "@/lib/agents/types";
import { buildRecommendation } from "@/lib/recommendation";
import type { QuizAnswers } from "@/lib/types";

export async function POST(request: Request) {
  // Future-ready note:
  // keep the local rule-based engine as a deterministic fallback.
  // An agent layer such as OpenClaw can later be injected here or behind an adapter.
  const body = (await request.json()) as Partial<RecommendRequestPayload>;

  if (!body.level || !body.goal || !body.taste || !body.budget || !body.journey) {
    return NextResponse.json(
      { message: "Dati del quiz incompleti." },
      { status: 400 }
    );
  }

  const answers = {
    level: body.level,
    goal: body.goal,
    taste: body.taste,
    budget: body.budget,
    journey: body.journey
  } as QuizAnswers;

  const result = buildRecommendation(answers);
  const agentDecision = routeAgentDecision({
    answers,
    recommendation: result,
    context: body.context,
    source: body.context?.source
  });

  const response: RecommendApiResponse = {
    ...result,
    agentDecision
  };

  return NextResponse.json(response);
}
