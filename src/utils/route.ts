const CLEAN_TAIL_REGEX = /\b(kerak|borish|ketish|ketadi|yo'lovchi|yolovchi|yulovchi|taksi|taxi|mashina|moshina|taksi|керак|кетиш|бориш|йуловчи|йўловчи|такси|машина|мошина)\b/giu;

function tidyPlace(raw: string): string {
  return raw
    .replace(CLEAN_TAIL_REGEX, "")
    .replace(/\s+/g, " ")
    .replace(/(^[\s\-,.]+|[\s\-,.]+$)/g, "")
    .trim();
}

export function detectRoute(originalText: string): string | null {
  const text = originalText.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();

  const directPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`ʻʼ’\-]{1,40}?)\s*(dan|ден|дан)\s+(?<to>[\p{L}\d][\p{L}\d\s'`ʻʼ’\-]{1,40}?)\s*(ga|gacha|га|ка)\b/iu;
  const directMatch = text.match(directPattern);

  if (directMatch?.groups?.from && directMatch.groups.to) {
    const from = tidyPlace(directMatch.groups.from);
    const to = tidyPlace(directMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  const arrowPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`ʻʼ’\-]{1,40}?)\s*(?:->|=>|—|-)\s*(?<to>[\p{L}\d][\p{L}\d\s'`ʻʼ’\-]{1,40})/iu;
  const arrowMatch = text.match(arrowPattern);

  if (arrowMatch?.groups?.from && arrowMatch.groups.to) {
    const from = tidyPlace(arrowMatch.groups.from);
    const to = tidyPlace(arrowMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  const toPattern = /(?<to>[\p{L}\d][\p{L}\d\s'`ʻʼ’\-]{1,40}?)\s*(ga|gacha|га|ка)\s*(ketish kerak|borish kerak|кетиш керак|бориш керак)?/iu;
  const toMatch = text.match(toPattern);

  if (toMatch?.groups?.to) {
    const to = tidyPlace(toMatch.groups.to);

    if (to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  return null;
}
