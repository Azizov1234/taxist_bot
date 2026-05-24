const CLEAN_TAIL_REGEX = /\b(kerak|kere|edi|borish|ketish|ketadi|ketaman|boradi|boraman|yo'lovchi|yolovchi|yulovchi|taksi|taxi|mashina|moshina)\b/giu;
const NON_PLACE_WORD_REGEX =
  /\b(ertaga|ertalab|bugun|kecha|indin|soat|larda|larida|taxminan|assalomu|alaykum|aleykum|asalomu|salom|ассалому|ассаломалекум|ассаломуалекум|алейкум|салом)\b/giu;

const ROUTE_INTENT_REGEX =
  /(?:^|[^\p{L}\p{N}])(?:taxi|taksi|mashina|moshina|yo'lovchi|yolovchi|yulovchi|kishi|odam|ketaman|ketamiz|ketadi|ketish|ketadigan|boraman|boramiz|boradi|borish|bormi|bori?mi|olib ket|ob ket|joy bormi|nechida|\u0442\u0430\u043a\u0441\u0438|\u043c\u0430\u0448\u0438\u043d\u0430|\u043c\u043e\u0448\u0438\u043d\u0430|\u0439\u045e\u043b\u043e\u0432\u0447\u0438|\u0439\u0443\u043b\u043e\u0432\u0447\u0438|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u043a\u0435\u0442\u0430\u043c\u0430\u043d|\u043a\u0435\u0442\u0430\u043c\u0438\u0437|\u043a\u0435\u0442\u0430\u0434\u0438|\u043a\u0435\u0442\u0438\u0448|\u0431\u043e\u0440\u0438\u0448|\u0431\u043e\u0440\u043c\u0438|\u043a\u0435\u0440\u0430\u043a)(?=$|[^\p{L}\p{N}])/iu;
const FROM_ONLY_PASSENGER_SIGNAL_REGEX =
  /(?:(?:^|[^\p{L}\p{N}])(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:ta)?\s*(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}]))|(?:\+?\d[\d\s()\-]{6,})/iu;
const DESTINATION_STOPWORDS = new Set([
  "men",
  "man",
  "sen",
  "siz",
  "biz",
  "u",
  "ular",
  "manga",
  "menga",
  "senga",
  "unga",
  "bizga",
  "sizga",
  "ularga",
  "ga",
  "gacha",
  "\u0433\u0430",
  "\u043a\u0430",
  "kerak",
  "kere",
  "kerede"
]);

function normalizeCandidate(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2019`']/g, "'")
    .replace(/\s+/g, " ")
    .trim();
}

function tidyPlace(raw: string): string {
  return raw
    .replace(CLEAN_TAIL_REGEX, "")
    .replace(NON_PLACE_WORD_REGEX, "")
    .replace(/\s+/g, " ")
    .replace(/(^[\s\-,.]+|[\s\-,.]+$)/g, "")
    .trim();
}

function trimGreetingPrefix(value: string): string {
  return value
    .replace(
      /^(?:(?:assalomu|asalomu|ассаломалекум|ассаломуалекум|ассалому)\s*(?:alaykum|aleykum|алейкум)?|salom|салом)\s+/iu,
      ""
    )
    .trim();
}

function cleanDestinationCandidate(value: string): string | null {
  const words = normalizeCandidate(tidyPlace(value))
    .split(" ")
    .filter((word) => word.length > 0);

  while (words.length > 0 && DESTINATION_STOPWORDS.has(words[0] ?? "")) {
    words.shift();
  }

  if (words.length === 0) {
    return null;
  }

  const candidate = words.join(" ").trim();
  return DESTINATION_STOPWORDS.has(candidate) ? null : candidate;
}

export function detectRoute(originalText: string): string | null {
  const text = originalText.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();

  const directPattern =
    /(?<from>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(dan|den|\u0434\u0430\u043d)\s+(?<to>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(ga|gacha|\u0433\u0430|\u043a\u0430)(?=$|[^\p{L}\p{N}])/iu;
  const directMatch = text.match(directPattern);

  if (directMatch?.groups?.from && directMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(directMatch.groups.from));
    const to = tidyPlace(directMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  const arrowPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(?:->|=>|-)\s*(?<to>[\p{L}\d][\p{L}\d\s'`-]{1,40})/iu;
  const arrowMatch = text.match(arrowPattern);

  if (arrowMatch?.groups?.from && arrowMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(arrowMatch.groups.from));
    const to = tidyPlace(arrowMatch.groups.to);

    if (from.length > 1 && to.length > 1) {
      return `${from} -> ${to}`;
    }
  }

  if (!ROUTE_INTENT_REGEX.test(text)) {
    return null;
  }

  const toPattern = /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(ketaman|boraman|ketamiz|boramiz|ketadi|boradi|ketish kerak|borish kerak|ketish|borish|kerak)\b/iu;
  const toMatch = text.match(toPattern);

  if (toMatch?.groups?.to) {
    const to = cleanDestinationCandidate(toMatch.groups.to);

    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  const destinationPassengerPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:ta\s*)?)?(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}])/iu;
  const destinationPassengerMatch = text.match(destinationPassengerPattern);

  if (destinationPassengerMatch?.groups?.to) {
    const to = cleanDestinationCandidate(destinationPassengerMatch.groups.to);
    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  const destinationTaxiQueryPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:bormi|bori?mi|\u0431\u043e\u0440\u043c\u0438)?\s*(?:taxi|taksi|mashina|moshina|\u0442\u0430\u043a\u0441\u0438|\u043c\u0430\u0448\u0438\u043d\u0430|\u043c\u043e\u0448\u0438\u043d\u0430)(?=$|[^\p{L}\p{N}])/iu;
  const destinationTaxiQueryMatch = text.match(destinationTaxiQueryPattern);

  if (destinationTaxiQueryMatch?.groups?.to) {
    const to = cleanDestinationCandidate(destinationTaxiQueryMatch.groups.to);
    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  const fromOnlyPattern =
    /(?<from>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(dan|den|\u0434\u0430\u043d)(?=$|[^\p{L}\p{N}])/iu;
  const fromOnlyMatch = text.match(fromOnlyPattern);

  if (fromOnlyMatch?.groups?.from && FROM_ONLY_PASSENGER_SIGNAL_REGEX.test(text)) {
    const from = trimGreetingPrefix(tidyPlace(fromOnlyMatch.groups.from));
    if (from.length > 1) {
      return `${from} -> Aniq emas`;
    }
  }

  const destinationTailPattern = /(?<to>[\p{L}][\p{L}'`-]{2,29}(?:\s+[\p{L}][\p{L}'`-]{2,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*$/iu;
  const destinationTailMatch = text.match(destinationTailPattern);

  if (destinationTailMatch?.groups?.to) {
    const to = cleanDestinationCandidate(destinationTailMatch.groups.to);

    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  return null;
}
