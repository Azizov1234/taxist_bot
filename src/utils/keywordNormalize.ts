const APOSTROPHE_VARIANTS_REGEX = /[`'\u00b4\u2018\u2019\u02bb\u02bc\u02ca\u02cb\u02f4\uff07]/gu;
const EMOJI_REGEX = /[\p{Extended_Pictographic}\u200d\ufe0f]/gu;
const LINK_REGEX = /\b(?:https?:\/\/|www\.|t\.me\/|telegram\.me\/)\S+/giu;
const USERNAME_REGEX = /@[a-zA-Z][a-zA-Z0-9_]{4,31}\b/gu;
const PHONE_REGEX = /(?:\+?\d[\d\s().-]{7,}\d)/gu;

function collapseOverstretchedLatin(value: string): string {
  return value
    .replace(/\bsrowna\b/gu, "srochna")
    .replace(/\bsrowno\b/gu, "srochno")
    .replace(/\bwahar(?=\b|ga|dan|da|gacha)/gu, "shahar")
    .replace(/\btaxii+\b/gu, "taxi")
    .replace(/\btaxs+i+\b/gu, "taxi")
    .replace(/\btaxs+\b/gu, "taxi")
    .replace(/\btaksii+\b/gu, "taksi")
    .replace(/([a-z])\1{2,}/gu, "$1");
}

export function normalizePhrase(input: string): string {
  const normalized = input
    .normalize("NFKC")
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
    .replace(/\u04b3/gu, "\u0445")
    .replace(/o\s*'/gu, "o")
    .replace(/g\s*'/gu, "g")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/gu, " ")
    .trim();

  return collapseOverstretchedLatin(normalized);
}

export function detectKeywordLanguage(phrase: string): "LATIN" | "CYRILLIC" | "RUSSIAN" | "MIXED" {
  const normalized = phrase.normalize("NFKC");
  const hasLatin = /[a-z]/iu.test(normalized);
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(normalized);

  if (hasLatin && hasCyrillic) {
    return "MIXED";
  }

  if (hasCyrillic) {
    if (/[\u044d\u044b\u0451\u044a]/iu.test(normalized)) {
      return "RUSSIAN";
    }

    return "CYRILLIC";
  }

  if (hasLatin) {
    return "LATIN";
  }

  return "MIXED";
}
