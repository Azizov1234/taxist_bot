import { getActiveKeywordBucket, type KeywordBucket } from "./keyword.service.js";
import { detectRoute } from "../utils/route.js";
import { hasSpamSignals, normalizeUzbekText } from "../utils/text.js";

const ROUTE_HINT_PATTERNS: RegExp[] = [
  /\b[\p{L}\d\-\s]{2,30}\s*(dan|den|дан)\s+[\p{L}\d\-\s]{2,30}\s*(ga|gacha|га|ка)\b/iu,
  /\b[\p{L}\d\-\s]{2,30}\s*(ga|gacha|га|ка)\s*(ketish kerak|borish kerak|керак|кетиш)/iu,
  /\b(joy bormi|жой борми|nechida ketadi|нечада кетади|ketish kerak|ketadigan)\b/iu
];

export interface LeadClassification {
  isLead: boolean;
  isSpam: boolean;
  score: number;
  normalizedText: string;
  matchedKeywords: string[];
  matchedPatterns: string[];
  route: string | null;
}

function detectPatternMatches(text: string): string[] {
  const matches: string[] = [];

  ROUTE_HINT_PATTERNS.forEach((pattern, index) => {
    if (pattern.test(text)) {
      matches.push(`pattern_${index + 1}`);
    }
  });

  return matches;
}

function detectKeywordMatches(normalizedText: string, bucket: KeywordBucket): string[] {
  const all = [...bucket.latin, ...bucket.cyrillic, ...bucket.route, ...bucket.extra];
  const hits: string[] = [];

  for (const keyword of all) {
    if (keyword.length < 2) {
      continue;
    }

    if (normalizedText.includes(keyword)) {
      hits.push(keyword);
    }
  }

  return hits;
}

export async function classifyLead(rawText: string): Promise<LeadClassification> {
  const normalizedText = normalizeUzbekText(rawText);

  if (normalizedText.length < 4) {
    return {
      isLead: false,
      isSpam: false,
      score: 0,
      normalizedText,
      matchedKeywords: [],
      matchedPatterns: [],
      route: null
    };
  }

  const bucket = await getActiveKeywordBucket();
  const matchedKeywords = detectKeywordMatches(normalizedText, bucket);
  const matchedPatterns = detectPatternMatches(rawText);
  const route = detectRoute(rawText);

  const score = matchedKeywords.length * 2 + matchedPatterns.length * 2 + (route ? 2 : 0);
  const isLead = matchedKeywords.length > 0 || matchedPatterns.length > 0 || route !== null;
  const isSpam = hasSpamSignals(normalizedText) && matchedKeywords.length === 0 && matchedPatterns.length === 0;

  return {
    isLead: isLead && !isSpam,
    isSpam,
    score,
    normalizedText,
    matchedKeywords,
    matchedPatterns,
    route
  };
}
