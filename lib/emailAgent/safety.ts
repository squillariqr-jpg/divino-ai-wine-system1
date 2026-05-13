import type { SafetyCheckResult } from "./types";

const MAX_WORDS = 220;
const CTA_PATTERNS = [
  /→\s.+?:\s?\//g,
  /\[.+?\]\(.+?\)/g,         // markdown links
  /https?:\/\/\S+/g,         // bare URLs
];

function countWords(text: string): number {
  return text.trim().split(/\s+/).filter(Boolean).length;
}

function countCTAs(text: string): number {
  let count = 0;
  for (const pattern of CTA_PATTERNS) {
    const matches = text.match(pattern);
    if (matches) count += matches.length;
  }
  return count;
}

const BLOCKED_PHRASES = [
  "noreply",
  "non rispondere",
  "automated",
  "system@",
  "sconto del",
  "offerta limitata",
  "solo oggi",
  "garantito",
  "clicca qui",
];

function hasBlockedPhrases(text: string): string[] {
  const lower = text.toLowerCase();
  return BLOCKED_PHRASES.filter((phrase) => lower.includes(phrase));
}

export function safetyCheck(text: string): SafetyCheckResult {
  const wordCount = countWords(text);
  const ctaCount = countCTAs(text);
  const blocked = hasBlockedPhrases(text);
  const reasons: string[] = [];

  if (wordCount > MAX_WORDS) {
    reasons.push(`Troppo lungo: ${wordCount} parole (max ${MAX_WORDS})`);
  }
  if (ctaCount > 1) {
    reasons.push(`CTA multiple: trovate ${ctaCount} (max 1)`);
  }
  if (blocked.length > 0) {
    reasons.push(`Frasi bloccate: ${blocked.join(", ")}`);
  }

  return {
    approved: reasons.length === 0,
    wordCount,
    ctaCount,
    reasons,
  };
}
