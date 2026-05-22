const APOSTROPHE_VARIANTS_REGEX = /[`´‘’ʻʼʹʽʾʿ＇]/gu;

function collapseOverstretchedLatin(word: string): string {
  return word
    .replace(/([a-z])\1{1,}/gu, "$1")
    .replace(/\btaxii+\b/gu, "taxi")
    .replace(/\btaksii+\b/gu, "taksi");
}

export function normalizePhrase(input: string): string {
  const normalized = input
    .normalize("NFKC")
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS_REGEX, "'")
    .replace(/ё/gu, "е")
    .replace(/ў/gu, "у")
    .replace(/қ/gu, "к")
    .replace(/ғ/gu, "г")
    .replace(/ҳ/gu, "х")
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
    if (/[эыёъ]/iu.test(normalized)) {
      return "RUSSIAN";
    }

    return "CYRILLIC";
  }

  if (hasLatin) {
    return "LATIN";
  }

  return "MIXED";
}
