const CLEAN_TAIL_REGEX = /\b(kerak|borish|ketish|ketadi|ketaman|boradi|boraman|yo'lovchi|yolovchi|yulovchi|taksi|taxi|mashina|moshina|такси|машина|мошина|йўловчи|йуловчи|керак|кетиш|бориш|кетади|кетаман)\b/giu;
const NON_PLACE_WORD_REGEX = /\b(ertaga|ertalab|bugun|kecha|indin|soat|larda|larida|taxminan|сегодня|завтра|утром|кеча|эртага)\b/giu;

const ROUTE_INTENT_REGEX = /\b(taxi|taksi|mashina|moshina|yo'lovchi|yolovchi|yulovchi|ketaman|ketamiz|ketadi|ketish|ketadigan|boraman|boramiz|boradi|borish|olib ket|ob ket|joy bormi|nechida|такси|машина|мошина|йўловчи|йуловчи|кетаман|кетамиз|кетади|кетиш|бориш|керак)\b/iu;

function tidyPlace(raw: string): string {
  return raw
    .replace(CLEAN_TAIL_REGEX, "")
    .replace(NON_PLACE_WORD_REGEX, "")
    .replace(/\s+/g, " ")
    .replace(/(^[\s\-,.]+|[\s\-,.]+$)/g, "")
    .trim();
}

export function detectRoute(originalText: string): string | null {
  const text = originalText.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();

  const directPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`»ј’-]{1,40}?)\s*(dan|den|дан)\s+(?<to>[\p{L}\d][\p{L}\d\s'`»ј’-]{1,40}?)\s*(ga|gacha|га|ка)\b/iu;
  const directMatch = text.match(directPattern);

  if (directMatch?.groups?.from && directMatch.groups.to) {
    const from = tidyPlace(directMatch.groups.from);
    const to = tidyPlace(directMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  const arrowPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`»ј’-]{1,40}?)\s*(?:->|=>|—|-)\s*(?<to>[\p{L}\d][\p{L}\d\s'`»ј’-]{1,40})/iu;
  const arrowMatch = text.match(arrowPattern);

  if (arrowMatch?.groups?.from && arrowMatch.groups.to) {
    const from = tidyPlace(arrowMatch.groups.from);
    const to = tidyPlace(arrowMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  if (!ROUTE_INTENT_REGEX.test(text)) {
    return null;
  }

  const toPattern = /(?<to>[\p{L}][\p{L}'`»-]{1,29}(?:\s+[\p{L}][\p{L}'`»-]{1,29}){0,2})\s*(ga|gacha|га|ка)\s*(ketaman|boraman|ketamiz|boramiz|ketadi|boradi|ketish kerak|borish kerak|ketish|borish|kerak)\b/iu;
  const toMatch = text.match(toPattern);

  if (toMatch?.groups?.to) {
    const to = tidyPlace(toMatch.groups.to);

    if (to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  return null;
}
