import type {
  HermesInput,
  SegmentAgentOutput
} from "@/lib/hermes/types";

export function runSegmentAgent(input: HermesInput): SegmentAgentOutput {
  const { answers, recommendation, context } = input;

  if (
    context?.flow === "buyer" ||
    context?.professionalIntent === "buyer" ||
    answers.goal === "acquisto-professionale" ||
    recommendation.segment === "buyer-professionale"
  ) {
    return {
      userSegment: "buyer",
      rationale: [
        "L'intento espresso e professionale o buyer-oriented.",
        "Il profilo richiede metodo di acquisto e proposta premium.",
        "Il percorso corretto porta verso Academy e follow-up dedicato."
      ]
    };
  }

  if (
    context?.flow === "business" ||
    Boolean(context?.businessQuizAnswers) ||
    answers.goal === "business-ai" ||
    answers.goal === "business-crescita" ||
    recommendation.segment === "builder-digitale"
  ) {
    return {
      userSegment: "business",
      rationale: [
        "L'utente mostra un intento di crescita, contenuto o conversione.",
        "Il percorso richiede un sistema e non solo contenuto educativo.",
        "Gli agenti business possono poi specializzare il follow-up."
      ]
    };
  }

  return {
    userSegment: "appassionato",
    rationale: [
      "Il profilo parte dal gusto e dal percorso personale nel vino.",
      "La priorita e orientare, educare e suggerire scelte coerenti.",
      "Serve un agente sommelieriale piu che commerciale."
    ]
  };
}
