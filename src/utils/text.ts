import { DEFAULT_SPAM_KEYWORDS } from "../config/defaultKeywords.js";

const APOSTROPHE_VARIANTS_REGEX = /[`'\u00b4\u2018\u2019\u02bb\u02bc\u02ca\u02cb\u02f4\uff07]/gu;
const EMOJI_REGEX = /[\p{Extended_Pictographic}\u200d\ufe0f]/gu;
const LINK_REGEX = /\b(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)\S+/giu;
const USERNAME_REGEX = /@[a-zA-Z][a-zA-Z0-9_]{4,31}\b/gu;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{7,}\d)/gu;

function collapseOverstretchedLatin(value: string): string {
  return value
    .replace(/\btaxii+\b/gu, "taxi")
    .replace(/\btaxs+i+\b/gu, "taxi")
    .replace(/\btaxs+\b/gu, "taxi")
    .replace(/\btaksii+\b/gu, "taksi")
    .replace(/([a-z])\1{2,}/gu, "$1");
}

export function normalizeUzbekText(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(LINK_REGEX, " link ")
    .replace(USERNAME_REGEX, " username ")
    .replace(PHONE_REGEX, " phone ")
    .replace(EMOJI_REGEX, " ")
    .replace(APOSTROPHE_VARIANTS_REGEX, "'")
    .replace(/\u0451/gu, "\u0435")
    .replace(/\u045e/gu, "\u0443")
    .replace(/\u0493/gu, "\u0433")
    .replace(/\u049b/gu, "\u043a")
    .replace(/o\s*'/g, "o")
    .replace(/g\s*'/g, "g")
    .replace(/\s+/g, " ")
    .trim();

  return collapseOverstretchedLatin(normalized);
}

export function stripExtraPunctuation(input: string): string {
  return input.replace(/[\t\n\r]+/g, " ").replace(/\s+/g, " ").trim();
}

export function hasSpamSignals(text: string): boolean {
  const normalizedText = normalizeUzbekText(text);
  const linksCount = (normalizedText.match(/\blink\b/g) ?? []).length;
  const spamKeywordHit = DEFAULT_SPAM_KEYWORDS.some((word) => normalizedText.includes(normalizeUzbekText(word)));

  return linksCount > 0 || spamKeywordHit;
}
