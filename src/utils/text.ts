import { DEFAULT_SPAM_KEYWORDS } from "../config/defaultKeywords.js";

const APOSTROPHE_VARIANTS_REGEX = /[`?’????']/g;

export function normalizeUzbekText(input: string): string {
  return input
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS_REGEX, "'")
    .replace(/o\s*'/g, "o")
    .replace(/g\s*'/g, "g")
    .replace(/[\u2018\u2019\u02bb\u02bc\uFF07]/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

export function stripExtraPunctuation(input: string): string {
  return input.replace(/[\t\n\r]+/g, " ").replace(/\s+/g, " ").trim();
}

export function hasSpamSignals(text: string): boolean {
  const normalizedText = normalizeUzbekText(text);
  const linksCount = (normalizedText.match(/https?:\/\//g) ?? []).length + (normalizedText.match(/t\.me\//g) ?? []).length;
  const spamKeywordHit = DEFAULT_SPAM_KEYWORDS.some((word) => normalizedText.includes(normalizeUzbekText(word)));

  return linksCount > 0 || spamKeywordHit;
}
