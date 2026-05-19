import { getActiveKeywordBucket, type KeywordBucket } from "./keyword.service.js";
import { detectRoute } from "../utils/route.js";
import { hasSpamSignals, normalizeUzbekText } from "../utils/text.js";

const WEAK_ROUTE_KEYWORDS = new Set(["ga", "dan"]);

const ROUTE_HINT_PATTERNS: RegExp[] = [
  /\b[\p{L}\d\-\s]{2,30}\s*(dan|den|га|дан)\s+[\p{L}\d\-\s]{2,30}\s*(ga|gacha|га|ка)\b/iu,
  /\b[\p{L}\d\-\s]{2,30}\s*(ga|gacha|га|ка)\s*(ketish kerak|borish kerak|ketaman|boraman|ketamiz|boramiz|ketadi|boradi|kerak|ketish)\b/iu,
  /\b(joy bormi|нечада кетади|nechida ketadi|ketish kerak|ketadigan)\b/iu
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

function detectKeywordMatches(
  normalizedText: string,
  bucket: KeywordBucket
): { core: string[]; route: string[]; all: string[] } {
  const coreKeywords = [...bucket.latin, ...bucket.cyrillic, ...bucket.extra];
  const routeKeywords = bucket.route.filter((keyword) => !WEAK_ROUTE_KEYWORDS.has(keyword));
  const all = [...coreKeywords, ...routeKeywords];
  const hits: string[] = [];

  for (const keyword of all) {
    if (keyword.length < 3) {
      continue;
    }

    if (normalizedText.includes(keyword)) {
      hits.push(keyword);
    }
  }

  const routeSet = new Set(routeKeywords);
  const route = hits.filter((keyword) => routeSet.has(keyword));
  const core = hits.filter((keyword) => !routeSet.has(keyword));

  return { core, route, all: hits };
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
  const keywordMatches = detectKeywordMatches(normalizedText, bucket);
  const matchedPatterns = detectPatternMatches(rawText);
  const route = detectRoute(rawText);

  const score = keywordMatches.core.length * 2 + keywordMatches.route.length + matchedPatterns.length * 2 + (route ? 2 : 0);
  const isLeadSignal = keywordMatches.core.length > 0 || matchedPatterns.length > 0;
  const isSpam = hasSpamSignals(normalizedText) && keywordMatches.core.length === 0 && matchedPatterns.length === 0;

  return {
    isLead: isLeadSignal && !isSpam,
    isSpam,
    score,
    normalizedText,
    matchedKeywords: keywordMatches.all,
    matchedPatterns,
    route
  };
}

