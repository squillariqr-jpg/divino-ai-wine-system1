import { runBusinessAgent } from "@/lib/hermes/agents/business-agent";
import { runBuyerAgent } from "@/lib/hermes/agents/buyer-agent";
import { runContentAgent } from "@/lib/hermes/agents/content-agent";
import { runSalesAgent } from "@/lib/hermes/agents/sales-agent";
import { runSegmentAgent } from "@/lib/hermes/agents/segment-agent";
import { runSommelierAgent } from "@/lib/hermes/agents/sommelier-agent";
import { buildMemorySnapshot } from "@/lib/hermes/memory";
import type {
  AgentDecision,
  AgentName,
  HermesInput,
  LeadProfile
} from "@/lib/hermes/types";

function buildLeadProfile(input: HermesInput): LeadProfile {
  const { answers, recommendation, context, source } = input;

  return {
    source: source ?? context?.source ?? "recommendation-api",
    quizFlow: context?.flow ?? "unknown",
    segment: recommendation.segment,
    level: answers.level,
    goal: answers.goal,
    taste: answers.taste,
    budget: answers.budget,
    businessType: context?.businessQuizAnswers?.businessType,
    businessProblem: context?.businessQuizAnswers?.mainProblem,
    systemLevel: context?.businessQuizAnswers?.systemLevel,
    toolsUsed: context?.businessQuizAnswers?.toolsUsed,
    businessGoal: context?.businessQuizAnswers?.mainGoal
  };
}

function dedupeAgents(agents: AgentName[]) {
  return [...new Set(agents)];
}

export function routeHermesDecision(input: HermesInput): AgentDecision {
  const leadProfile = buildLeadProfile(input);
  const { answers, recommendation, context } = input;
  const segmentDecision = runSegmentAgent(input);

  let decision: AgentDecision;
  const helperAgents: AgentName[] = ["segment_agent", "memory_agent"];

  // TODO: the Hermes Orchestrator is deterministic by choice in v1.
  // OpenClaw, OpenAI, Anthropic or LangChain can later enrich routing here
  // without changing the public AgentDecision contract.
  if (segmentDecision.userSegment === "buyer") {
    decision = runBuyerAgent({
      answers,
      recommendation,
      leadProfile,
      segmentRationale: segmentDecision.rationale
    });
  } else if (segmentDecision.userSegment === "business") {
    if (context?.flow === "business" && context.businessQuizAnswers) {
      decision = runBusinessAgent({
        answers: context.businessQuizAnswers,
        recommendation,
        leadProfile,
        segmentRationale: segmentDecision.rationale
      });

      if (
        context.businessQuizAnswers.mainGoal === "piu-contenuti" ||
        context.businessQuizAnswers.mainProblem === "contenuti-incostanti"
      ) {
        helperAgents.push("content_agent");
      }

      if (
        context.businessQuizAnswers.mainGoal === "piu-lead" ||
        context.businessQuizAnswers.mainProblem === "acquisizione-instabile" ||
        context.businessQuizAnswers.mainProblem === "clienti-non-ritornano"
      ) {
        helperAgents.push("sales_agent");
      }
    } else if (answers.goal === "business-ai") {
      decision = runContentAgent({
        recommendation,
        leadProfile,
        segmentRationale: segmentDecision.rationale
      });
    } else {
      decision = runSalesAgent({
        recommendation,
        leadProfile,
        segmentRationale: segmentDecision.rationale
      });
    }
  } else {
    decision = runSommelierAgent({
      answers,
      recommendation,
      leadProfile,
      segmentRationale: segmentDecision.rationale
    });
  }

  const memory = buildMemorySnapshot({
    leadProfile,
    agentDecision: decision
  });

  return {
    ...decision,
    supportingAgents: dedupeAgents([...decision.supportingAgents, ...helperAgents]),
    memory
  };
}
