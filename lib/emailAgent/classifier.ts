import type { ClassificationResult, EmailIntent } from "./types";

type KeywordRule = {
  intent: EmailIntent;
  keywords: string[];
  weight: number;
};

const rules: KeywordRule[] = [
  {
    intent: "wine_advice",
    weight: 3,
    keywords: [
      "cosa mi consigli",
      "che vino",
      "abbinare",
      "abbinamento",
      "consigliami",
      "bevo di solito",
      "mi piace",
      "rosso",
      "bianco",
      "bollicine",
      "prosecco",
      "barolo",
      "aperitivo",
      "cena",
      "regalo",
      "provare",
      "scoprire",
      "provo",
    ],
  },
  {
    intent: "fit_check",
    weight: 3,
    keywords: [
      "è adatto",
      "fa per me",
      "nel mio caso",
      "sono adatto",
      "ha senso",
      "mi serve",
      "non so se",
      "capire se",
      "dubbio",
      "valutare",
      "mio progetto",
      "mio business",
      "si applica",
      "posso usare",
    ],
  },
  {
    intent: "price_objection",
    weight: 4,
    keywords: [
      "costa troppo",
      "troppo caro",
      "prezzo",
      "sconto",
      "caro",
      "economico",
      "meno",
      "budget",
      "mi aspettavo meno",
      "è tanto",
      "non posso",
    ],
  },
  {
    intent: "human_help",
    weight: 4,
    keywords: [
      "parlare con te",
      "chiamata",
      "call",
      "telefono",
      "contatto",
      "parlami",
      "urgente",
      "problema",
      "non funziona",
      "aiuto",
      "supporto",
    ],
  },
];

export function classifyIntent(text: string): ClassificationResult {
  const normalized = text.toLowerCase();
  const scores: Record<EmailIntent, number> = {
    wine_advice: 0,
    fit_check: 0,
    price_objection: 0,
    human_help: 0,
    unknown: 0,
  };
  const matched: Record<EmailIntent, string[]> = {
    wine_advice: [],
    fit_check: [],
    price_objection: [],
    human_help: [],
    unknown: [],
  };

  for (const rule of rules) {
    for (const kw of rule.keywords) {
      if (normalized.includes(kw)) {
        scores[rule.intent] += rule.weight;
        matched[rule.intent].push(kw);
      }
    }
  }

  const best = (Object.entries(scores) as [EmailIntent, number][]).sort(
    (a, b) => b[1] - a[1]
  )[0];

  if (best[1] === 0) {
    return { intent: "unknown", confidence: "low", matchedKeywords: [] };
  }

  const confidence =
    best[1] >= 6 ? "high" : best[1] >= 3 ? "medium" : "low";

  return {
    intent: best[0],
    confidence,
    matchedKeywords: matched[best[0]],
  };
}
