const APOSTROPHE_VARIANTS_REGEX = /[`´‘’ʻʼʿˈ՚＇]/g;

export function normalizePhrase(input: string): string {
  return input
    .toLowerCase()
    .replace(APOSTROPHE_VARIANTS_REGEX, "'")
    .replace(/ё/g, "е")
    .replace(/o\s*['’`ʻʼ]/g, "o")
    .replace(/g\s*['’`ʻʼ]/g, "g")
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/(.)\1{2,}/gu, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

export function detectKeywordLanguage(phrase: string): "LATIN" | "CYRILLIC" | "RUSSIAN" | "MIXED" {
  const hasLatin = /[a-z]/i.test(phrase);
  const hasCyrillic = /\p{Script=Cyrillic}/u.test(phrase);

  if (hasLatin && hasCyrillic) {
    return "MIXED";
  }

  if (hasCyrillic) {
    if (/[эыёъ]/i.test(phrase)) {
      return "RUSSIAN";
    }

    return "CYRILLIC";
  }

  if (hasLatin) {
    return "LATIN";
  }

  return "MIXED";
}
