const CLEAN_TAIL_REGEX = /\b(kerak|kere|edi|borish|ketish|ketadi|ketaman|boradi|boraman|yo'lovchi|yolovchi|yulovchi|taksi|taxi|taxsi|mashina|moshina)\b/giu;
const NON_PLACE_WORD_REGEX =
  /\b(ertaga|ertalab|bugun|kecha|indin|soat|larda|larida|taxminan|assalomu|alaykum|aleykum|asalomu|salom|ассалому|ассаломалекум|ассаломуалекум|алейкум|салом)\b/giu;

const ROUTE_INTENT_REGEX =
  /(?:^|[^\p{L}\p{N}])(?:taxi|taksi|taxsi|mashina|moshina|yo'lovchi|yolovchi|yulovchi|kishi|odam|ketaman|ketamiz|ketadi|ketish|ketadigan|boraman|boramiz|boradi|borish|bormi|bori?mi|yo'?qmi|yuqmi|olib ket|ob ket|joy bormi|nechida|\u0442\u0430\u043a\u0441\u0438|\u043c\u0430\u0448\u0438\u043d\u0430|\u043c\u043e\u0448\u0438\u043d\u0430|\u0439\u045e\u043b\u043e\u0432\u0447\u0438|\u0439\u0443\u043b\u043e\u0432\u0447\u0438|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u043a\u0435\u0442\u0430\u043c\u0430\u043d|\u043a\u0435\u0442\u0430\u043c\u0438\u0437|\u043a\u0435\u0442\u0430\u0434\u0438|\u043a\u0435\u0442\u0438\u0448|\u0431\u043e\u0440\u0438\u0448|\u0431\u043e\u0440\u043c\u0438|\u043a\u0435\u0440\u0430\u043a)(?=$|[^\p{L}\p{N}])/iu;
const FROM_ONLY_PASSENGER_SIGNAL_REGEX =
  /(?:(?:^|[^\p{L}\p{N}])(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:(?:ta)|(?:\u0442\u0430))?\s*(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}]))|(?:\+?\d[\d\s()\-]{6,})/iu;
const LOCATION_TOKEN_STOPWORDS = new Set([
  "hozir",
  "hozirga",
  "srochno",
  "tezda",
  "tezroq",
  "bugun",
  "ertaga",
  "ertalab",
  "kechga",
  "kechqurun",
  "soat",
  "da",
  "dan",
  "ga",
  "gacha",
  "taksi",
  "taxi",
  "taxsi",
  "mashina",
  "moshina",
  "kishi",
  "odam",
  "bor",
  "\u0431\u043e\u0440",
  "yo'lovchi",
  "yolovchi",
  "yulovchi"
]);
const LOCATION_NOISE_TOKEN_REGEX =
  /(?:^|[^\p{L}\p{N}])(?:\d{1,2}|kishi|odam|yo'?lovchi|yolovchi|yulovchi|taxi|taksi|taxsi|mashina|moshina|hozir|hozirga|bugun|ertaga|ertalab|kechqurun|soat|srochno|kerak|kere|bor|\u0431\u043e\u0440)(?=$|[^\p{L}\p{N}])/iu;
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

function isLikelyLocationToken(value: string): boolean {
  const normalized = normalizeCandidate(value);
  if (!normalized || normalized.length < 3) {
    return false;
  }

  return !LOCATION_TOKEN_STOPWORDS.has(normalized);
}

function isLikelyLocationPhrase(value: string): boolean {
  const normalized = normalizeCandidate(value);
  if (!normalized || normalized.length < 3) {
    return false;
  }

  if (LOCATION_NOISE_TOKEN_REGEX.test(normalized)) {
    return false;
  }

  const tokens = normalized.split(" ").filter((token) => token.length > 0);
  if (tokens.length === 0 || tokens.length > 3) {
    return false;
  }

  return tokens.every((token) => isLikelyLocationToken(token));
}

export function detectRoute(originalText: string): string | null {
  const text = originalText.replace(/[\n\r]+/g, " ").replace(/\s+/g, " ").trim();

  const directPattern =
    /(?<from>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(dan|den|\u0434\u0430\u043d)\s+(?<to>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(ga|gacha|\u0433\u0430|\u043a\u0430)(?=$|[^\p{L}\p{N}])/iu;
  const directMatch = text.match(directPattern);

  if (directMatch?.groups?.from && directMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(directMatch.groups.from));
    const to = tidyPlace(directMatch.groups.to);

    if (from.length > 1 && to.length > 1 && isLikelyLocationPhrase(from) && isLikelyLocationPhrase(to)) {
      return `${from} -> ${to}`;
    }
  }

  const arrowPattern = /(?<from>[\p{L}\d][\p{L}\d\s'`-]{1,40}?)\s*(?:->|=>|-)\s*(?<to>[\p{L}\d][\p{L}\d\s'`-]{1,40})/iu;
  const arrowMatch = text.match(arrowPattern);

  if (arrowMatch?.groups?.from && arrowMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(arrowMatch.groups.from));
    const to = tidyPlace(arrowMatch.groups.to);

    if (from.length > 1 && to.length > 1 && isLikelyLocationPhrase(from) && isLikelyLocationPhrase(to)) {
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

  const destinationThenFromPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:(?:ta)|(?:\u0442\u0430))?\s*)?(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)?(?:\s+|$).*?(?<from>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(dan|den|\u0434\u0430\u043d)(?=$|[^\p{L}\p{N}])/iu;
  const destinationThenFromMatch = text.match(destinationThenFromPattern);
  if (destinationThenFromMatch?.groups?.to && destinationThenFromMatch.groups.from) {
    const from = trimGreetingPrefix(tidyPlace(destinationThenFromMatch.groups.from));
    const to = cleanDestinationCandidate(destinationThenFromMatch.groups.to);

    if (to && from.length > 1 && isLikelyLocationPhrase(from) && isLikelyLocationPhrase(to)) {
      return `${from} -> ${to}`;
    }
  }

  const destinationPassengerPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:(?:ta)|(?:\u0442\u0430))?\s*)?(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}])/iu;
  const destinationPassengerMatch = text.match(destinationPassengerPattern);

  if (destinationPassengerMatch?.groups?.to) {
    const to = cleanDestinationCandidate(destinationPassengerMatch.groups.to);
    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  const destinationBorPassengerPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:bor|\u0431\u043e\u0440)\s*(?:(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:(?:ta)|(?:\u0442\u0430))?\s*)?(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}])/iu;
  const destinationBorPassengerMatch = text.match(destinationBorPassengerPattern);

  if (destinationBorPassengerMatch?.groups?.to) {
    const to = cleanDestinationCandidate(destinationBorPassengerMatch.groups.to);
    if (to && to.length > 1) {
      return `Aniq emas -> ${to}`;
    }
  }

  const destinationTaxiQueryPattern =
    /(?<to>[\p{L}][\p{L}'`-]{1,29}(?:\s+[\p{L}][\p{L}'`-]{1,29}){0,2})\s*(ga|gacha|\u0433\u0430|\u043a\u0430)\s*(?:bormi|bori?mi|yo'?qmi|yuqmi|\u0431\u043e\u0440\u043c\u0438)?\s*(?:taxi|taksi|taxsi|mashina|moshina|\u0442\u0430\u043a\u0441\u0438|\u043c\u0430\u0448\u0438\u043d\u0430|\u043c\u043e\u0448\u0438\u043d\u0430)(?=$|[^\p{L}\p{N}])/iu;
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
    if (from.length > 1 && isLikelyLocationPhrase(from)) {
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

  const twoLocationPassengerPattern =
    /(?<from>[\p{L}][\p{L}'`-]{2,29})\s+(?<to>[\p{L}][\p{L}'`-]{2,29})\s+(?:(?:\d{1,2}|bir|bitta|ikki|uch|to'?rt|tort|besh|olti|yetti|sakkiz|to'?qqiz|toqiz|on|\u0431\u0438\u0440|\u0431\u0438\u0442\u0442\u0430|\u0438\u043a\u043a\u0438|\u0443\u0447|\u0442\u045e\u0440\u0442|\u0442\u04ef\u0440\u0442|\u0431\u0435\u0448|\u043e\u043b\u0442\u0438|\u0435\u0442\u0442\u0438|\u0441\u0430\u043a\u043a\u0438\u0437|\u0442\u045e\u049b\u049b\u0438\u0437|\u043e\u043d)\s*(?:(?:ta)|(?:\u0442\u0430))?\s*)?(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi|\u043a\u0438\u0448\u0438|\u043e\u0434\u0430\u043c|\u0439[\u0443\u045e]\u043b\u043e\u0432\u0447\u0438)(?=$|[^\p{L}\p{N}])/iu;
  const twoLocationPassengerMatch = text.match(twoLocationPassengerPattern);
  if (twoLocationPassengerMatch?.groups?.from && twoLocationPassengerMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(twoLocationPassengerMatch.groups.from));
    const to = tidyPlace(twoLocationPassengerMatch.groups.to);

    if (from.length > 1 && to.length > 1 && isLikelyLocationPhrase(from) && isLikelyLocationPhrase(to)) {
      return `${from} -> ${to}`;
    }
  }

  const twoLocationTaxiQueryPattern =
    /(?<from>[\p{L}][\p{L}'`-]{2,29})\s+(?<to>[\p{L}][\p{L}'`-]{2,29})\s+(?:taxi|taksi|taxsi|mashina|moshina|\u0442\u0430\u043a\u0441\u0438|\u043c\u0430\u0448\u0438\u043d\u0430|\u043c\u043e\u0448\u0438\u043d\u0430)\s*(?:bormi|bori?mi|yo'?qmi|yuqmi)?(?=$|[^\p{L}\p{N}])/iu;
  const twoLocationTaxiQueryMatch = text.match(twoLocationTaxiQueryPattern);
  if (twoLocationTaxiQueryMatch?.groups?.from && twoLocationTaxiQueryMatch.groups.to) {
    const from = trimGreetingPrefix(tidyPlace(twoLocationTaxiQueryMatch.groups.from));
    const to = tidyPlace(twoLocationTaxiQueryMatch.groups.to);

    if (from.length > 1 && to.length > 1 && isLikelyLocationPhrase(from) && isLikelyLocationPhrase(to)) {
      return `${from} -> ${to}`;
    }
  }

  return null;
}
