import personas from "@/data/personas.json";
import products from "@/data/products.json";
import wines from "@/data/wines.json";
import type {
  Persona,
  PostQuizCta,
  Product,
  QuizAnswers,
  RecommendationResponse,
  ScoreMap,
  SegmentId,
  UpsellRecommendation,
  Wine
} from "@/lib/types";

const fallbackWineCount = 2;
const personaList = personas as Persona[];
const productList = products as Product[];
const wineList = wines as Wine[];
const segments: SegmentId[] = [
  "novizio-curioso",
  "appassionato-pratico",
  "builder-digitale",
  "buyer-professionale"
];

type WeightMap<T extends string> = Record<T, Partial<Record<SegmentId, number>>>;

const levelWeights: WeightMap<QuizAnswers["level"]> = {
  principiante: {
    "novizio-curioso": 5,
    "appassionato-pratico": 2
  },
  intermedio: {
    "appassionato-pratico": 4,
    "builder-digitale": 1
  },
  professionista: {
    "buyer-professionale": 5,
    "builder-digitale": 2,
    "appassionato-pratico": 1
  },
  esperto: {
    "appassionato-pratico": 4,
    "buyer-professionale": 3,
    "builder-digitale": 1
  }
};

const goalWeights: WeightMap<QuizAnswers["goal"]> = {
  imparare: {
    "novizio-curioso": 4,
    "appassionato-pratico": 1
  },
  "scegliere-meglio": {
    "appassionato-pratico": 5,
    "novizio-curioso": 1
  },
  "business-ai": {
    "builder-digitale": 6,
    "appassionato-pratico": 1
  },
  "business-crescita": {
    "builder-digitale": 4,
    "buyer-professionale": 3,
    "appassionato-pratico": 1
  },
  "acquisto-professionale": {
    "buyer-professionale": 6,
    "appassionato-pratico": 1
  }
};

const tasteWeights: WeightMap<QuizAnswers["taste"]> = {
  morbido: {
    "novizio-curioso": 2,
    "appassionato-pratico": 1
  },
  fresco: {
    "appassionato-pratico": 2,
    "novizio-curioso": 1
  },
  strutturato: {
    "buyer-professionale": 2,
    "builder-digitale": 1
  },
  elegante: {
    "buyer-professionale": 2,
    "appassionato-pratico": 2
  },
  esploratore: {
    "appassionato-pratico": 2,
    "builder-digitale": 1
  }
};

const budgetWeights: WeightMap<QuizAnswers["budget"]> = {
  basso: {
    "novizio-curioso": 2
  },
  medio: {
    "appassionato-pratico": 2,
    "builder-digitale": 1
  },
  alto: {
    "buyer-professionale": 2,
    "appassionato-pratico": 1
  },
  "molto-alto": {
    "buyer-professionale": 3,
    "appassionato-pratico": 1
  }
};

const journeyWeights: WeightMap<QuizAnswers["journey"]> = {
  "semplice-pratico": {
    "novizio-curioso": 3,
    "appassionato-pratico": 1
  },
  "creativo-moderno": {
    "builder-digitale": 4,
    "appassionato-pratico": 1
  },
  "professionale-tecnico": {
    "buyer-professionale": 4,
    "builder-digitale": 1
  },
  "esclusivo-approfondito": {
    "appassionato-pratico": 3,
    "buyer-professionale": 2
  }
};

const tieBreakers: Record<QuizAnswers["goal"], SegmentId[]> = {
  imparare: [
    "novizio-curioso",
    "appassionato-pratico",
    "builder-digitale",
    "buyer-professionale"
  ],
  "scegliere-meglio": [
    "appassionato-pratico",
    "novizio-curioso",
    "buyer-professionale",
    "builder-digitale"
  ],
  "business-ai": [
    "builder-digitale",
    "appassionato-pratico",
    "buyer-professionale",
    "novizio-curioso"
  ],
  "business-crescita": [
    "builder-digitale",
    "buyer-professionale",
    "appassionato-pratico",
    "novizio-curioso"
  ],
  "acquisto-professionale": [
    "buyer-professionale",
    "builder-digitale",
    "appassionato-pratico",
    "novizio-curioso"
  ]
};

// Integration note:
// this file intentionally keeps scoring explicit and local.
// In the future, an agent layer can enrich these outputs, but this ruleset remains
// the deterministic baseline and fallback for classification and CTA selection.

function findProduct(productId: string): Product {
  const product = productList.find((item) => item.id === productId);

  if (!product) {
    throw new Error(`Prodotto non trovato: ${productId}`);
  }

  return product;
}

function findPersona(personaId: string): Persona {
  const persona = personaList.find((item) => item.id === personaId);

  if (!persona) {
    throw new Error(`Persona non trovata: ${personaId}`);
  }

  return persona;
}

function createEmptyScores(): ScoreMap {
  return {
    "novizio-curioso": 0,
    "appassionato-pratico": 0,
    "builder-digitale": 0,
    "buyer-professionale": 0
  };
}

function applyWeights(scores: ScoreMap, weights: Partial<Record<SegmentId, number>>) {
  for (const segment of segments) {
    scores[segment] += weights[segment] ?? 0;
  }
}

function classifyProfile(answers: QuizAnswers) {
  const scores = createEmptyScores();

  applyWeights(scores, levelWeights[answers.level]);
  applyWeights(scores, goalWeights[answers.goal]);
  applyWeights(scores, tasteWeights[answers.taste]);
  applyWeights(scores, budgetWeights[answers.budget]);
  applyWeights(scores, journeyWeights[answers.journey]);

  const maxScore = Math.max(...Object.values(scores));
  const segment =
    tieBreakers[answers.goal].find((entry) => scores[entry] === maxScore) ??
    "appassionato-pratico";

  return { segment, scores };
}

function pickWines(taste: QuizAnswers["taste"], budget: QuizAnswers["budget"]): Wine[] {
  // normalize: esploratore picks from all styles; molto-alto maps to alto
  const normalizedBudget = budget === "molto-alto" ? "alto" : budget;
  const exact = taste === "esploratore"
    ? wineList.filter((wine) => wine.priceTier === normalizedBudget)
    : wineList.filter((wine) => wine.style === taste && wine.priceTier === normalizedBudget);

  if (exact.length >= fallbackWineCount) {
    return exact.slice(0, fallbackWineCount);
  }

  // fallback 1: same budget, any style (budget coherence > style)
  const sameBudget = wineList.filter((wine) => wine.priceTier === normalizedBudget);
  // fallback 2: same style, any budget
  const sameStyle = taste === "esploratore"
    ? wineList
    : wineList.filter((wine) => wine.style === taste);

  const merged = [...exact];

  for (const wine of sameBudget) {
    if (merged.length >= fallbackWineCount) break;
    if (!merged.some((item) => item.id === wine.id)) merged.push(wine);
  }

  for (const wine of sameStyle) {
    if (merged.length >= fallbackWineCount) break;
    if (!merged.some((item) => item.id === wine.id)) merged.push(wine);
  }

  for (const wine of wineList) {
    if (merged.length >= fallbackWineCount) break;
    if (!merged.some((item) => item.id === wine.id)) merged.push(wine);
  }

  return merged.slice(0, fallbackWineCount);
}

function buildLeadMagnet(segment: SegmentId) {
  if (segment === "builder-digitale") {
    return {
      title: "Ebook Lead Magnet: AI e contenuti wine",
      description:
        "Un asset rapido per capire come trasformare contenuti e automazioni in un funnel wine credibile.",
      ctaLabel: "Ricevi l'ebook AI",
      ctaHref: "/#ebook-lead-magnet"
    };
  }

  if (segment === "buyer-professionale") {
    return {
      title: "Cantina Minima: versione buyer",
      description:
        "Una selezione essenziale di criteri e bottiglie per avviare un ragionamento più professionale sull'acquisto.",
      ctaLabel: "Esplora Cantina Minima",
      ctaHref: "/#cantina-minima"
    };
  }

  if (segment === "appassionato-pratico") {
    return {
      title: "Cantina Minima",
      description:
        "Il miglior punto di ingresso per chi vuole scegliere con più sicurezza senza perdersi in teoria inutile.",
      ctaLabel: "Vai a Cantina Minima",
      ctaHref: "/#cantina-minima"
    };
  }

  return {
    title: "Ebook Lead Magnet",
    description:
      "Una guida elegante e accessibile per iniziare a capire il vino e fare prime scelte più ordinate.",
    ctaLabel: "Ricevi l'ebook",
    ctaHref: "/#ebook-lead-magnet"
  };
}

function buildContentRecommendation(segment: SegmentId) {
  if (segment === "buyer-professionale") {
    return {
      title: "Buyer Brief: criteri, margine e carta vini",
      description:
        "Contenuto di onboarding pensato per chi ragiona in termini di selezione, rotazione e posizionamento."
    };
  }

  if (segment === "builder-digitale") {
    return {
      title: "Sequenza AI Funnel Starter",
      description:
        "Una mini-architettura di contenuto per unire educazione, lead capture e vendita nel settore wine."
    };
  }

  if (segment === "appassionato-pratico") {
    return {
      title: "Corso Introduttivo in 5 Lezioni",
      description:
        "Il contenuto più ordinato per consolidare il gusto, acquistare con criterio e capire gli stili principali."
    };
  }

  return {
    title: "Cantina Minima + guida ai primi acquisti",
    description:
      "Un passaggio morbido ma strutturato per creare basi solide prima di entrare nel corso guidato."
  };
}

function buildPostQuizCta(segment: SegmentId): PostQuizCta {
  if (segment === "buyer-professionale") {
    return {
      title: "Il tuo prossimo passo: acquistare con metodo",
      description:
        "Hai il profilo di chi gestisce vino come business. La Wine Buyer Academy ti dà criteri, marginalità, selezione fornitori e un framework decisionale replicabile da subito.",
      primaryLabel: "Migliora le tue decisioni di acquisto",
      primaryHref: "/academy",
      secondaryLabel: "Esplora Wine AI Mastery",
      secondaryHref: "/wine-ai-mastery"
    };
  }

  if (segment === "builder-digitale") {
    return {
      title: "Il tuo prossimo passo: costruire il sistema contenuti",
      description:
        "Hai il profilo di chi vuole trasformare il vino in contenuti, audience e vendite. Wine AI Mastery è il sistema per farlo — template, prompt e metodo già pronti.",
      primaryLabel: "Costruisci il tuo sistema contenuti",
      primaryHref: "/wine-ai-mastery",
      secondaryLabel: "Prima il lead magnet gratuito",
      secondaryHref: "/#ebook-lead-magnet"
    };
  }

  if (segment === "appassionato-pratico") {
    return {
      title: "Procedi con Cantina Minima e poi con il corso",
      description:
        "La tua traiettoria ideale parte da scelte più nitide e prosegue con formazione guidata.",
      primaryLabel: "Scopri Cantina Minima",
      primaryHref: "/#cantina-minima",
      secondaryLabel: "Vedi il corso in 5 lezioni",
      secondaryHref: "/#corso-5-lezioni"
    };
  }

  return {
    title: "Parti dal lead magnet e sali di un livello",
    description:
      "Il funnel ti accompagna bene se cominci da un asset gratuito e passi poi al corso introduttivo.",
    primaryLabel: "Ricevi l'ebook",
    primaryHref: "/#ebook-lead-magnet",
    secondaryLabel: "Scopri il corso in 5 lezioni",
    secondaryHref: "/#corso-5-lezioni"
  };
}

function buildUpsell(
  segment: SegmentId,
  scores: ScoreMap,
  answers: QuizAnswers
): UpsellRecommendation | null {
  if (
    (segment === "novizio-curioso" || segment === "appassionato-pratico") &&
    (scores["builder-digitale"] >= 6 || answers.goal === "business-ai")
  ) {
    return {
      title: "Upsell morbido verso Wine AI Mastery",
      description:
        "Quando emerge un interesse reale per contenuti, automazioni e business, il funnel può aprire il prodotto digitale.",
      target: "Wine AI Mastery",
      href: "/wine-ai-mastery"
    };
  }

  if (
    segment === "builder-digitale" &&
    (scores["buyer-professionale"] >= 7 ||
      answers.goal === "acquisto-professionale")
  ) {
    return {
      title: "Upsell premium verso Wine Buyer Academy",
      description:
        "Se il progetto richiede anche capacità di selezione o acquisto professionale, il passo successivo è la Academy.",
      target: "Wine Buyer Academy",
      href: "/academy"
    };
  }

  if (segment === "buyer-professionale" && scores["builder-digitale"] >= 5) {
    return {
      title: "Cross-sell verso Wine AI Mastery",
      description:
        "Per buyer e team che vogliono anche migliorare contenuti, lead generation e posizionamento digitale.",
      target: "Wine AI Mastery",
      href: "/wine-ai-mastery"
    };
  }

  return null;
}

function buildRationale(answers: QuizAnswers, segment: SegmentId) {
  const rationale = [
    `Il livello dichiarato (${answers.level}) orienta il profilo verso ${findPersona(segment).label}.`,
    `L'obiettivo scelto (${answers.goal}) è il segnale più forte per definire il segmento del funnel.`,
    `Gusto ${answers.taste} e budget ${answers.budget} rifiniscono sia i vini suggeriti sia il tono della proposta.`
  ];

  if (segment === "builder-digitale") {
    rationale.push(
      "Il funnel privilegia asset e CTA orientati a contenuti, automazioni e crescita commerciale."
    );
  }

  if (segment === "buyer-professionale") {
    rationale.push(
      "La raccomandazione si sposta su offerte premium perché il profilo richiede metodo decisionale e applicazione business."
    );
  }

  return rationale;
}

function buildPrimaryProduct(segment: SegmentId) {
  if (segment === "buyer-professionale") {
    return findProduct("wine-buyer-academy");
  }

  if (segment === "builder-digitale") {
    return findProduct("wine-ai-mastery");
  }

  return findProduct("corso-5-lezioni");
}

function buildScoreSummary(scores: ScoreMap) {
  return segments
    .map((segment) => ({
      segment,
      label: findPersona(segment).label,
      score: scores[segment]
    }))
    .sort((left, right) => right.score - left.score);
}

export function buildRecommendation(answers: QuizAnswers): RecommendationResponse {
  const { segment, scores } = classifyProfile(answers);

  return {
    segment,
    persona: findPersona(segment),
    scores,
    scoreSummary: buildScoreSummary(scores),
    rationale: buildRationale(answers, segment),
    leadMagnet: buildLeadMagnet(segment),
    contentRecommendation: buildContentRecommendation(segment),
    productRecommendation: buildPrimaryProduct(segment),
    upsellRecommendation: buildUpsell(segment, scores, answers),
    postQuizCta: buildPostQuizCta(segment),
    wines: pickWines(answers.taste, answers.budget)
  };
}
