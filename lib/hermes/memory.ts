import type {
  AgentDecision,
  LeadProfile,
  MemorySnapshot
} from "@/lib/hermes/types";

function pushIfValue(items: string[], label: string, value?: string) {
  if (value) {
    items.push(`${label}: ${value}`);
  }
}

export function buildMemorySnapshot(input: {
  leadProfile: LeadProfile;
  agentDecision: AgentDecision;
}): MemorySnapshot {
  const { leadProfile, agentDecision } = input;
  const preferences: string[] = [];
  const history: string[] = [];
  const nextActions = [
    agentDecision.nextAction,
    agentDecision.nextActionLabel
  ];

  pushIfValue(preferences, "Livello", leadProfile.level);
  pushIfValue(preferences, "Obiettivo", leadProfile.goal);
  pushIfValue(preferences, "Gusto", leadProfile.taste);
  pushIfValue(preferences, "Budget", leadProfile.budget);
  pushIfValue(preferences, "Tipo business", leadProfile.businessType);
  pushIfValue(preferences, "Problema business", leadProfile.businessProblem);
  pushIfValue(preferences, "Goal business", leadProfile.businessGoal);

  history.push(`Source: ${leadProfile.source}`);
  history.push(`Flow: ${leadProfile.quizFlow}`);
  history.push(`Segmento Hermes: ${agentDecision.userSegment}`);
  if (leadProfile.segment) {
    history.push(`Segmento recommendation: ${leadProfile.segment}`);
  }
  history.push(`Agente primario: ${agentDecision.agentName}`);
  history.push(`Profilo: ${agentDecision.profileLabel}`);

  return {
    profileTag: agentDecision.profileLabel,
    preferences,
    history,
    nextActions,
    lastUpdatedAt: new Date().toISOString()
  };
}
