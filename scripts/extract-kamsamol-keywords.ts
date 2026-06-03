import dotenv from "dotenv";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { TelegramClient } from "telegram";
import { getPeerId } from "telegram/Utils.js";
import { StringSession } from "telegram/sessions/index.js";
import { detectKeywordLanguage, normalizePhrase } from "../src/utils/keywordNormalize.js";

dotenv.config({ override: true });

export type KamsamolKeywordCategory = "PASSENGER" | "DRIVER" | "CARGO" | "SPAM" | "AMBIGUOUS";
export type KamsamolKeywordLanguage = "LATIN" | "CYRILLIC" | "RUSSIAN" | "MIXED";
export type KamsamolKeywordMatchType = "EXACT" | "PHRASE" | "REGEX";
export type KamsamolKeywordSource = "history:kamsamol" | "generated:kamsamol" | "manual:kamsamol";

export interface KamsamolKeywordRecord {
  phrase: string;
  normalized: string;
  category: KamsamolKeywordCategory;
  weight: number;
  language: KamsamolKeywordLanguage;
  matchType: KamsamolKeywordMatchType;
  source: KamsamolKeywordSource;
  frequency: number;
  examples: string[];
}

interface ExtractConfig {
  sourceUsernames: string[];
  extractLimit: number;
  batchSize: number;
  minFrequency: number;
  saveExamples: boolean;
  generateOnly: boolean;
}

interface SourceStats {
  username: string;
  title: string | null;
  resolved: boolean;
  skippedReason: string | null;
  messagesRead: number;
  textMessages: number;
  skippedMessages: number;
}

interface BuildStats {
  historyCandidates: number;
  templateAdded: number;
  manualAdded: number;
}

interface KamsamolKeywordReport {
  createdAt: string;
  config: ExtractConfig;
  messagesRead: number;
  textMessages: number;
  skippedMessages: number;
  sources: SourceStats[];
  keywordCount: number;
  byCategory: Record<KamsamolKeywordCategory, number>;
  bySource: Record<KamsamolKeywordSource, number>;
  buildStats: BuildStats;
}

interface KamsamolKeywordFile {
  version: 1;
  createdAt: string;
  source: "kamsamol";
  config: ExtractConfig;
  keywords: KamsamolKeywordRecord[];
}

interface ClassificationResult {
  category: KamsamolKeywordCategory;
  scores: Record<KamsamolKeywordCategory, number>;
  matched: string[];
}

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(CURRENT_DIR, "..");
const GENERATED_DIR = resolve(ROOT_DIR, "generated");
const KEYWORDS_PATH = resolve(GENERATED_DIR, "kamsamol-keywords.json");
const REPORT_PATH = resolve(GENERATED_DIR, "kamsamol-keyword-report.json");

const DEFAULT_SOURCE_USERNAMES = ["KamsamoltaksiN1", "Dehqonobod_taksi24"];
const CATEGORY_TARGETS: Record<KamsamolKeywordCategory, number> = {
  PASSENGER: 500,
  DRIVER: 350,
  CARGO: 100,
  SPAM: 35,
  AMBIGUOUS: 15
};

const SOURCE_KEYS: KamsamolKeywordSource[] = ["history:kamsamol", "generated:kamsamol", "manual:kamsamol"];
const CATEGORY_KEYS: KamsamolKeywordCategory[] = ["PASSENGER", "DRIVER", "CARGO", "SPAM", "AMBIGUOUS"];
const PERSONAL_TOKEN_WORDS = new Set(["phone", "username", "link"]);

const STOPWORDS = new Set([
  "va",
  "ham",
  "bilan",
  "uchun",
  "shu",
  "bu",
  "u",
  "men",
  "sen",
  "biz",
  "siz",
  "ular",
  "da",
  "ga",
  "dan",
  "ni",
  "ning",
  "bor",
  "yoq",
  "ha",
  "xa",
  "ok",
  "hop",
  "rahmat",
  "salom",
  "assalom",
  "alaykum",
  "admin",
  "iltimos",
  "kerakmi",
  "bormi",
  "telefon",
  "nomer",
  "raqam"
]);

const LOCATIONS_LATIN = [
  "Kamsamol",
  "Dehqonobod",
  "Guzor",
  "G'uzor",
  "Guzar",
  "Qarshi",
  "Koson",
  "Nishon",
  "Yakkabog'",
  "Shahrisabz",
  "Kitob",
  "Chiroqchi",
  "Muborak",
  "Toshkent",
  "Guliston",
  "Bekobod",
  "Shirin",
  "Yangiyer",
  "Sirdaryo",
  "Samarqand",
  "Buxoro",
  "Termiz"
];

const LOCATIONS_CYRILLIC = [
  "Камсамол",
  "Деҳқонобод",
  "Дехконобод",
  "Ғузор",
  "Гузор",
  "Қарши",
  "Карши",
  "Косон",
  "Нишон",
  "Яккабоғ",
  "Шаҳрисабз",
  "Китоб",
  "Чироқчи",
  "Муборак",
  "Тошкент",
  "Гулистон",
  "Бекобод",
  "Ширин",
  "Янгийер",
  "Сирдарё",
  "Самарқанд",
  "Бухоро",
  "Термиз"
];

const PASSENGER_RULES = [
  "taxi kerak",
  "taksi kerak",
  "taxi kere",
  "taksi kere",
  "moshina kerak",
  "mashina kerak",
  "mashna kerak",
  "transport kerak",
  "ulov kerak",
  "ketish kerak",
  "ketish kere",
  "borish kerak",
  "borish kere",
  "kim ketadi",
  "kim boradi",
  "kim yuradi",
  "kim olib ketadi",
  "kim ob ketadi",
  "joy bormi",
  "bitta joy bormi",
  "ikkita joy bormi",
  "kishi bor",
  "odam bor",
  "yolovchi bor",
  "yulovchi bor",
  "passajir bor",
  "pasajir bor",
  "poputchik bormi",
  "nechida ketadi",
  "qachon ketadi",
  "narxi qancha",
  "necha pul",
  "telefon tashang",
  "nomer tashang",
  "raqam tashang",
  "такси керак",
  "машина керак",
  "мошина керак",
  "кетиш керак",
  "бориш керак",
  "ким кетади",
  "ким боради",
  "жой борми",
  "киши бор",
  "одам бор",
  "йуловчи бор",
  "йўловчи бор"
];

const DRIVER_RULES = [
  "taxi xizmati",
  "taksi xizmati",
  "xizmat bor",
  "mashina bor",
  "moshina bor",
  "bosh joy bor",
  "joylar bor",
  "joy bor",
  "ta joy bor",
  "har kuni qatnaymiz",
  "qatnaymiz",
  "qatnayman",
  "yuraman",
  "yuramiz",
  "boraman",
  "boramiz",
  "ketaman",
  "ketamiz",
  "reys bor",
  "bron qiling",
  "zakaz olamiz",
  "buyurtma olamiz",
  "murojaat uchun",
  "aloqa uchun",
  "kerak bolsa yozing",
  "lichkaga yozing",
  "olib boramiz",
  "olib ketamiz",
  "yetkazib beramiz",
  "такси хизмати",
  "хизмат бор",
  "машина бор",
  "мошина бор",
  "буш жой бор",
  "бош жой бор",
  "жой бор",
  "та жой бор",
  "хар куни катнаймиз",
  "ҳар куни қатнаймиз",
  "катнаймиз",
  "қатнаймиз",
  "рейс бор",
  "мурожаат учун",
  "олиб борамиз",
  "олиб кетамиз"
];

const CARGO_RULES = [
  "pochta",
  "posilka",
  "yuk",
  "dostavka",
  "jonatma",
  "qayerdan",
  "qayerga",
  "yuboruvchi",
  "qabul qiluvchi",
  "pochta bor",
  "posilka bor",
  "yuk bor",
  "pochta ketadi",
  "posilka ketadi",
  "yuk ketadi",
  "почта",
  "посилка",
  "юк",
  "почта бор",
  "посилка бор",
  "юк бор"
];

const SPAM_RULES = [
  "reklama",
  "obuna boling",
  "kanalga qoshing",
  "kanalga qoshiling",
  "sotiladi",
  "ijara",
  "ish bor",
  "vakansiya",
  "http",
  "https",
  "t me",
  "admin bilan boglaning",
  "elon berish",
  "e lon berish",
  "реклама",
  "обуна болинг",
  "каналга кушилинг",
  "сотилади",
  "ижара",
  "иш бор"
];

const PASSENGER_TEMPLATES_LATIN = [
  "{from}dan {to}ga 1 kishi bor",
  "{from}dan {to}ga 2 kishi bor",
  "{from}dan {to}ga 3 kishi bor",
  "{from}dan {to}ga odam bor",
  "{from}dan {to}ga yo'lovchi bor",
  "{from}dan {to}ga taxi kerak",
  "{from}dan {to}ga taksi kerak",
  "{from}dan {to}ga moshina kerak",
  "{from}dan {to}ga mashina kerak",
  "{from}dan {to}ga ketish kerak",
  "{from}dan {to}ga borish kerak",
  "{from}dan {to}ga kim ketadi",
  "{from}dan {to}ga kim boradi",
  "{from}dan {to}ga joy bormi",
  "{from}dan {to}ga nechida ketadi",
  "{from}dan {to}ga narxi qancha",
  "{to}ga 1 kishi bor",
  "{to}ga 2 odam bor",
  "{to}ga odam bor",
  "{to}ga yo'lovchi bor",
  "{to}ga ketish kerak",
  "{to}ga borish kerak",
  "{to}ga taxi kerak",
  "{to}ga taksi kerak",
  "{to}ga moshina kerak",
  "{to}ga mashina kerak",
  "{to}ga joy bormi",
  "{to}ga kim ketadi",
  "{to}ga kim boradi",
  "{to}ga nechida ketadi",
  "{to}ga narxi qancha",
  "{from}dan chiqadigan bormi",
  "{from}dan ketadigan bormi",
  "{from}dan yuradigan bormi",
  "{from}dan {to}ga olib ketadigan bormi",
  "{from}dan {to}ga ob ketadigan bormi",
  "{from}dan {to}ga poputchik bormi",
  "{from}dan {to}ga bitta joy bormi"
];

const DRIVER_TEMPLATES_LATIN = [
  "{from}dan {to}ga bo'sh joy bor",
  "{from}dan {to}ga bosh joy bor",
  "{from}dan {to}ga 1 ta joy bor",
  "{from}dan {to}ga 2 ta joy bor",
  "{from}dan {to}ga 3 ta joy bor",
  "{from}dan {to}ga 4 ta joy bor",
  "{from}dan {to}ga taxi xizmati",
  "{from}dan {to}ga taksi xizmati",
  "{from}dan {to}ga qatnaymiz",
  "{from}dan {to}ga har kuni qatnaymiz",
  "{from}dan {to}ga reys bor",
  "{from}dan {to}ga bron qiling",
  "{from}dan {to}ga kerak bo'lsa yozing",
  "{from}dan {to}ga murojaat uchun",
  "{from}dan {to}ga olib boramiz",
  "{from}dan {to}ga yetkazib beramiz",
  "{to}ga bo'sh joy bor",
  "{to}ga 2 ta joy bor",
  "{to}ga reys bor",
  "{to}ga qatnaymiz",
  "{to}ga taxi bor",
  "{to}ga taksi bor",
  "{from} {to} qatnaymiz",
  "{from} {to} har kuni qatnaymiz",
  "{from} {to} reys bor"
];

const PASSENGER_TEMPLATES_CYRILLIC = [
  "{from}дан {to}га 1 киши бор",
  "{from}дан {to}га 2 киши бор",
  "{from}дан {to}га одам бор",
  "{from}дан {to}га йўловчи бор",
  "{from}дан {to}га такси керак",
  "{from}дан {to}га машина керак",
  "{from}дан {to}га кетиш керак",
  "{from}дан {to}га бориш керак",
  "{from}дан {to}га ким кетади",
  "{from}дан {to}га ким боради",
  "{from}дан {to}га жой борми",
  "{to}га 1 киши бор",
  "{to}га 2 одам бор",
  "{to}га кетиш керак",
  "{to}га бориш керак",
  "{to}га такси керак",
  "{to}га машина керак",
  "{to}га жой борми"
];

const DRIVER_TEMPLATES_CYRILLIC = [
  "{from}дан {to}га бўш жой бор",
  "{from}дан {to}га буш жой бор",
  "{from}дан {to}га 1 та жой бор",
  "{from}дан {to}га 2 та жой бор",
  "{from}дан {to}га 3 та жой бор",
  "{from}дан {to}га 4 та жой бор",
  "{from}дан {to}га такси хизмати",
  "{from}дан {to}га қатнаймиз",
  "{from}дан {to}га хар куни катнаймиз",
  "{from}дан {to}га рейс бор",
  "{from}дан {to}га брон қилинг",
  "{from}дан {to}га мурожаат учун",
  "{from}дан {to}га олиб борамиз",
  "{to}га бўш жой бор",
  "{to}га 2 та жой бор",
  "{to}га рейс бор",
  "{to}га қатнаймиз"
];

const CARGO_TEMPLATES_LATIN = [
  "{from}dan {to}ga pochta bor",
  "{from}dan {to}ga posilka bor",
  "{from}dan {to}ga yuk bor",
  "{from}dan {to}ga pochta ketadi",
  "{from}dan {to}ga jonatma bor",
  "{from} {to} pochta"
];

const CARGO_TEMPLATES_CYRILLIC = [
  "{from}дан {to}га почта бор",
  "{from}дан {to}га посилка бор",
  "{from}дан {to}га юк бор"
];

const SPAM_TEMPLATES = [
  "kanalga obuna boling",
  "reklama uchun yozing",
  "admin bilan boglaning",
  "elon berish",
  "ish bor vakansiya",
  "uy sotiladi",
  "ijara bor",
  "https reklama",
  "t me kanal",
  "aksiya chegirma"
];

const AMBIGUOUS_TEMPLATES = [
  "taxi",
  "taksi",
  "mashina",
  "moshina",
  "joy",
  "ketadi",
  "boradi",
  "narx",
  "aloqa",
  "telefon",
  "Kamsamol narx",
  "Dehqonobod telefon",
  "Qarshi aloqa"
];

const MANUAL_KEYWORDS: Array<{ category: KamsamolKeywordCategory; phrase: string; weight: number }> = [
  { category: "PASSENGER", phrase: "Kamsamoldan Dehqonobodga 1 kishi bor", weight: 10 },
  { category: "PASSENGER", phrase: "Dehqonobodga joy bormi", weight: 10 },
  { category: "PASSENGER", phrase: "Kamsamolga kim ketadi", weight: 9 },
  { category: "PASSENGER", phrase: "Dehqonoboddan Qarshiga taksi kerak", weight: 9 },
  { category: "PASSENGER", phrase: "Qarshiga 2 kishi bor", weight: 9 },
  { category: "DRIVER", phrase: "Dehqonobod Kamsamol bo'sh joy bor", weight: 10 },
  { category: "DRIVER", phrase: "Har kuni Kamsamol Dehqonobod qatnaymiz", weight: 10 },
  { category: "DRIVER", phrase: "2 ta joy bor murojaat uchun", weight: 10 },
  { category: "DRIVER", phrase: "Kamsamoldan Qarshiga reys bor", weight: 9 },
  { category: "CARGO", phrase: "Pochta bor Kamsamoldan Dehqonobodga", weight: 10 },
  { category: "SPAM", phrase: "Kanalga obuna bo'ling", weight: 10 },
  { category: "PASSENGER", phrase: "joy bormi", weight: 10 },
  { category: "DRIVER", phrase: "bo'sh joy bor", weight: 10 },
  { category: "PASSENGER", phrase: "1 kishi bor", weight: 10 },
  { category: "PASSENGER", phrase: "2 odam bor", weight: 10 },
  { category: "DRIVER", phrase: "2 ta joy bor", weight: 10 },
  { category: "PASSENGER", phrase: "ketish kerak", weight: 9 },
  { category: "PASSENGER", phrase: "borish kerak", weight: 9 },
  { category: "DRIVER", phrase: "murojaat uchun", weight: 8 },
  { category: "DRIVER", phrase: "reys bor", weight: 8 },
  { category: "CARGO", phrase: "pochta bor", weight: 9 },
  { category: "SPAM", phrase: "obuna boling", weight: 9 }
];

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  return ["1", "true", "yes", "on"].includes(value.trim().toLowerCase());
}

function parsePositiveInteger(value: string | undefined, fallback: number): number {
  if (value === undefined || value.trim().length === 0) {
    return fallback;
  }

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.max(0, Math.round(parsed));
}

function parseSourceUsernames(value: string | undefined): string[] {
  const raw = value ?? DEFAULT_SOURCE_USERNAMES.join(",");
  const values = raw
    .split(",")
    .map((item) => item.trim().replace(/^@/, ""))
    .filter(Boolean);

  return [...new Set(values)];
}

function parseConfig(): ExtractConfig {
  const limitOverride = process.argv.find((arg) => arg.startsWith("--limit="));
  const cliLimit = limitOverride ? limitOverride.slice("--limit=".length) : undefined;

  return {
    sourceUsernames: parseSourceUsernames(process.env.KEYWORD_SOURCE_CHAT_USERNAMES),
    extractLimit: parsePositiveInteger(cliLimit ?? process.env.KEYWORD_EXTRACT_LIMIT, 10_000),
    batchSize: Math.max(1, parsePositiveInteger(process.env.KEYWORD_EXTRACT_BATCH_SIZE, 100)),
    minFrequency: Math.max(1, parsePositiveInteger(process.env.KEYWORD_MIN_FREQUENCY, 2)),
    saveExamples: parseBoolean(process.env.KEYWORD_SAVE_EXAMPLES, true),
    generateOnly: process.argv.includes("--generate-only")
  };
}

export function maskSensitiveText(text: string): string {
  return text
    .replace(/https?:\/\/\S+|(?:t|telegram)\.me\/\S+/giu, "<LINK>")
    .replace(/(^|[^\p{L}\p{N}_])@[a-z0-9_]{3,32}\b/giu, "$1<USERNAME>")
    .replace(/\+?\d[\d\s().-]{7,}\d/gu, "<PHONE>")
    .replace(/\b\d{9,}\b/gu, "<PHONE>");
}

export function normalizeKamsamolPhrase(text: string): string {
  return normalizePhrase(maskSensitiveText(text));
}

function scoreRuleSet(normalizedText: string, rules: string[], weight: number): { score: number; matched: string[] } {
  let score = 0;
  const matched: string[] = [];

  for (const rule of rules) {
    const normalizedRule = normalizePhrase(rule);
    if (!normalizedRule || !normalizedText.includes(normalizedRule)) {
      continue;
    }

    score += weight;
    matched.push(rule);
  }

  return { score, matched };
}

export function classifyKamsamolText(text: string): ClassificationResult {
  const normalizedText = normalizeKamsamolPhrase(text);
  const passenger = scoreRuleSet(normalizedText, PASSENGER_RULES, 5);
  const driver = scoreRuleSet(normalizedText, DRIVER_RULES, 5);
  const cargo = scoreRuleSet(normalizedText, CARGO_RULES, 5);
  const spam = scoreRuleSet(normalizedText, SPAM_RULES, 5);

  if (/\b\d+\s*(?:kishi|odam)\s+bor\b/iu.test(normalizedText)) {
    passenger.score += 7;
    passenger.matched.push("passenger count bor");
  }

  if (/\b\d+\s*ta\s+joy\s+bor\b/iu.test(normalizedText)) {
    driver.score += 8;
    driver.matched.push("seat count joy bor");
  }

  if (/\bjoy\s+bormi\b/iu.test(normalizedText)) {
    passenger.score += 8;
    passenger.matched.push("joy bormi");
  }

  if (/\bbosh\s+joy\s+bor\b/iu.test(normalizedText)) {
    driver.score += 8;
    driver.matched.push("bosh joy bor");
  }

  if (/\bhar\s+kuni\b.*\b(?:qatnaymiz|katnaymiz)\b/iu.test(normalizedText)) {
    driver.score += 8;
    driver.matched.push("har kuni qatnaymiz");
  }

  const scores: Record<KamsamolKeywordCategory, number> = {
    PASSENGER: passenger.score,
    DRIVER: driver.score,
    CARGO: cargo.score,
    SPAM: spam.score,
    AMBIGUOUS: 0
  };

  let category: KamsamolKeywordCategory = "AMBIGUOUS";
  if (scores.SPAM >= 5 && scores.SPAM >= scores.PASSENGER + 2 && scores.SPAM >= scores.DRIVER && scores.SPAM >= scores.CARGO) {
    category = "SPAM";
  } else if (scores.CARGO >= 5 && scores.CARGO >= scores.PASSENGER + 1 && scores.CARGO >= scores.DRIVER && scores.CARGO >= scores.SPAM) {
    category = "CARGO";
  } else if (scores.DRIVER >= 5 && scores.DRIVER >= scores.PASSENGER + 1 && scores.DRIVER >= scores.CARGO && scores.DRIVER >= scores.SPAM) {
    category = "DRIVER";
  } else if (scores.PASSENGER >= 5 && scores.PASSENGER >= scores.DRIVER && scores.PASSENGER >= scores.CARGO && scores.PASSENGER >= scores.SPAM) {
    category = "PASSENGER";
  }

  return {
    category,
    scores,
    matched: [...new Set([...passenger.matched, ...driver.matched, ...cargo.matched, ...spam.matched])].slice(0, 20)
  };
}

function isBadNgram(tokens: string[]): boolean {
  if (tokens.length < 2) {
    return true;
  }

  if (tokens.some((token) => PERSONAL_TOKEN_WORDS.has(token))) {
    return true;
  }

  const meaningful = tokens.filter((token) => token.length > 1 && !STOPWORDS.has(token));
  return meaningful.length === 0;
}

function extractNgrams(normalizedText: string): string[] {
  const tokens = normalizedText
    .split(/\s+/)
    .map((token) => token.trim())
    .filter(Boolean);
  const phrases: string[] = [];

  for (let size = 2; size <= 5; size += 1) {
    for (let start = 0; start <= tokens.length - size; start += 1) {
      const part = tokens.slice(start, start + size);
      if (isBadNgram(part)) {
        continue;
      }

      phrases.push(part.join(" "));
    }
  }

  return phrases;
}

function makeEmptyCounts<T extends string>(keys: readonly T[]): Record<T, number> {
  return Object.fromEntries(keys.map((key) => [key, 0])) as Record<T, number>;
}

function routePairs(locations: readonly string[]): Array<{ from: string; to: string }> {
  const pairs: Array<{ from: string; to: string }> = [];
  for (const from of locations) {
    for (const to of locations) {
      if (from !== to) {
        pairs.push({ from, to });
      }
    }
  }

  return pairs;
}

function renderTemplate(template: string, from: string, to: string): string {
  return template.replaceAll("{from}", from).replaceAll("{to}", to);
}

function recordKey(category: KamsamolKeywordCategory, normalized: string): string {
  return `${category}::${normalized}`;
}

function weightFor(category: KamsamolKeywordCategory, frequency: number, source: KamsamolKeywordSource, phrase: string): number {
  const normalized = normalizePhrase(phrase);
  if (source === "manual:kamsamol") {
    return 10;
  }

  const base =
    category === "PASSENGER"
      ? 6
      : category === "DRIVER"
        ? 7
        : category === "CARGO"
          ? 8
          : category === "SPAM"
            ? 7
            : 3;
  const frequencyBonus = Math.min(5, Math.floor(Math.max(0, frequency) / 3));
  const importantBonus =
    /joy bormi|kishi bor|odam bor|ketish kerak|borish kerak|bo'?sh joy bor|bosh joy bor|qatnaymiz|murojaat uchun|pochta bor|obuna boling/iu.test(
      normalized
    )
      ? 2
      : 0;

  return Math.max(1, Math.min(12, base + frequencyBonus + importantBonus));
}

function addKeywordRecord(
  records: Map<string, KamsamolKeywordRecord>,
  input: {
    phrase: string;
    category: KamsamolKeywordCategory;
    source: KamsamolKeywordSource;
    frequency?: number;
    examples?: string[];
    weight?: number;
  }
): boolean {
  const phrase = input.phrase.trim().replace(/\s+/g, " ");
  const normalized = normalizeKamsamolPhrase(phrase);

  if (!phrase || !normalized || PERSONAL_TOKEN_WORDS.has(normalized)) {
    return false;
  }

  const key = recordKey(input.category, normalized);
  const existing = records.get(key);
  const frequency = Math.max(0, Math.round(input.frequency ?? 0));
  const examples = [...new Set((input.examples ?? []).map((example) => maskSensitiveText(example).trim()).filter(Boolean))].slice(0, 3);
  const weight = input.weight ?? weightFor(input.category, frequency, input.source, phrase);

  if (!existing) {
    records.set(key, {
      phrase,
      normalized,
      category: input.category,
      weight,
      language: detectKeywordLanguage(phrase) as KamsamolKeywordLanguage,
      matchType: "PHRASE",
      source: input.source,
      frequency,
      examples
    });
    return true;
  }

  existing.frequency += frequency;
  existing.weight = Math.max(existing.weight, weight);
  if (existing.source !== "history:kamsamol" && input.source === "history:kamsamol") {
    existing.source = "history:kamsamol";
  }
  if (phrase.length < existing.phrase.length || existing.source !== "history:kamsamol") {
    existing.phrase = phrase;
    existing.language = detectKeywordLanguage(phrase) as KamsamolKeywordLanguage;
  }
  existing.examples = [...new Set([...existing.examples, ...examples])].slice(0, 3);
  return false;
}

function addManualKeywords(records: Map<string, KamsamolKeywordRecord>): number {
  let added = 0;
  for (const item of MANUAL_KEYWORDS) {
    const didAdd = addKeywordRecord(records, {
      phrase: item.phrase,
      category: item.category,
      source: "manual:kamsamol",
      frequency: 0,
      weight: item.weight
    });
    if (didAdd) {
      added += 1;
    }
  }

  return added;
}

function addTemplateKeywords(records: Map<string, KamsamolKeywordRecord>): number {
  let added = 0;
  const needsMore = (category: KamsamolKeywordCategory): boolean =>
    [...records.values()].filter((record) => record.category === category).length < CATEGORY_TARGETS[category];

  const addTemplate = (category: KamsamolKeywordCategory, phrase: string): void => {
    if (!needsMore(category)) {
      return;
    }

    const didAdd = addKeywordRecord(records, {
      phrase,
      category,
      source: "generated:kamsamol",
      frequency: 0
    });
    if (didAdd) {
      added += 1;
    }
  };

  for (const { from, to } of routePairs(LOCATIONS_LATIN)) {
    for (const template of PASSENGER_TEMPLATES_LATIN) {
      addTemplate("PASSENGER", renderTemplate(template, from, to));
    }
    for (const template of DRIVER_TEMPLATES_LATIN) {
      addTemplate("DRIVER", renderTemplate(template, from, to));
    }
    for (const template of CARGO_TEMPLATES_LATIN) {
      addTemplate("CARGO", renderTemplate(template, from, to));
    }
  }

  for (const { from, to } of routePairs(LOCATIONS_CYRILLIC)) {
    for (const template of PASSENGER_TEMPLATES_CYRILLIC) {
      addTemplate("PASSENGER", renderTemplate(template, from, to));
    }
    for (const template of DRIVER_TEMPLATES_CYRILLIC) {
      addTemplate("DRIVER", renderTemplate(template, from, to));
    }
    for (const template of CARGO_TEMPLATES_CYRILLIC) {
      addTemplate("CARGO", renderTemplate(template, from, to));
    }
  }

  for (const phrase of SPAM_TEMPLATES) {
    addTemplate("SPAM", phrase);
  }

  for (const location of LOCATIONS_LATIN) {
    for (const phrase of SPAM_TEMPLATES) {
      addTemplate("SPAM", `${location} ${phrase}`);
    }
    for (const phrase of AMBIGUOUS_TEMPLATES) {
      addTemplate("AMBIGUOUS", phrase.includes(" ") ? phrase : `${location} ${phrase}`);
    }
  }

  for (const phrase of AMBIGUOUS_TEMPLATES) {
    addTemplate("AMBIGUOUS", phrase);
  }

  return added;
}

function buildHistoryKeywords(messages: string[], config: ExtractConfig): { records: Map<string, KamsamolKeywordRecord>; stats: BuildStats } {
  const byPhrase = new Map<string, { phrase: string; category: KamsamolKeywordCategory; frequency: number; examples: string[] }>();

  for (const rawMessage of messages) {
    const masked = maskSensitiveText(rawMessage);
    const normalized = normalizePhrase(masked);
    if (!normalized) {
      continue;
    }

    const classification = classifyKamsamolText(masked);
    if (classification.category === "AMBIGUOUS") {
      continue;
    }

    for (const phrase of extractNgrams(normalized)) {
      const key = recordKey(classification.category, phrase);
      const existing = byPhrase.get(key);
      if (!existing) {
        byPhrase.set(key, {
          phrase,
          category: classification.category,
          frequency: 1,
          examples: config.saveExamples ? [masked] : []
        });
        continue;
      }

      existing.frequency += 1;
      if (config.saveExamples && existing.examples.length < 3) {
        existing.examples.push(masked);
      }
    }
  }

  const records = new Map<string, KamsamolKeywordRecord>();
  for (const item of byPhrase.values()) {
    if (item.frequency < config.minFrequency) {
      continue;
    }

    addKeywordRecord(records, {
      phrase: item.phrase,
      category: item.category,
      source: "history:kamsamol",
      frequency: item.frequency,
      examples: item.examples
    });
  }

  const manualAdded = addManualKeywords(records);
  const templateAdded = addTemplateKeywords(records);

  return {
    records,
    stats: {
      historyCandidates: records.size - manualAdded - templateAdded,
      templateAdded,
      manualAdded
    }
  };
}

function sortKeywords(records: KamsamolKeywordRecord[]): KamsamolKeywordRecord[] {
  return records.sort((a, b) => {
    const categoryDiff = CATEGORY_KEYS.indexOf(a.category) - CATEGORY_KEYS.indexOf(b.category);
    if (categoryDiff !== 0) {
      return categoryDiff;
    }

    const sourceDiff = SOURCE_KEYS.indexOf(a.source) - SOURCE_KEYS.indexOf(b.source);
    if (sourceDiff !== 0) {
      return sourceDiff;
    }

    if (b.frequency !== a.frequency) {
      return b.frequency - a.frequency;
    }

    if (b.weight !== a.weight) {
      return b.weight - a.weight;
    }

    return a.normalized.localeCompare(b.normalized);
  });
}

function countByCategory(records: KamsamolKeywordRecord[]): Record<KamsamolKeywordCategory, number> {
  const counts = makeEmptyCounts(CATEGORY_KEYS);
  for (const record of records) {
    counts[record.category] += 1;
  }
  return counts;
}

function countBySource(records: KamsamolKeywordRecord[]): Record<KamsamolKeywordSource, number> {
  const counts = makeEmptyCounts(SOURCE_KEYS);
  for (const record of records) {
    counts[record.source] += 1;
  }
  return counts;
}

function getTitle(entity: any): string | null {
  if (!entity) {
    return null;
  }

  if (typeof entity.title === "string" && entity.title.trim()) {
    return entity.title.trim();
  }

  if (typeof entity.username === "string" && entity.username.trim()) {
    return `@${entity.username.trim()}`;
  }

  return null;
}

async function createClient(): Promise<TelegramClient> {
  const apiId = Number(process.env.TELEGRAM_API_ID);
  const apiHash = process.env.TELEGRAM_API_HASH?.trim();
  const stringSession = process.env.TELEGRAM_STRING_SESSION?.trim() ?? "";

  if (!Number.isFinite(apiId) || apiId <= 0 || !apiHash || !stringSession) {
    throw new Error("TELEGRAM_API_ID, TELEGRAM_API_HASH and TELEGRAM_STRING_SESSION are required for extraction.");
  }

  const client = new TelegramClient(new StringSession(stringSession), apiId, apiHash, {
    useWSS: parseBoolean(process.env.TELEGRAM_USE_WSS, true),
    autoReconnect: true,
    connectionRetries: parsePositiveInteger(process.env.TELEGRAM_CONNECTION_RETRIES, 5),
    reconnectRetries: parsePositiveInteger(process.env.TELEGRAM_RECONNECT_RETRIES, 5),
    retryDelay: parsePositiveInteger(process.env.TELEGRAM_RETRY_DELAY_MS, 2_000)
  });

  await client.connect();
  await client.getMe();
  return client;
}

async function resolveAllowedSources(client: TelegramClient, usernames: string[]): Promise<Array<{ username: string; entity: any; title: string | null }>> {
  const dialogs = await client.getDialogs({ limit: 500 });
  const allowedById = new Map<string, any>();
  const allowedByUsername = new Map<string, any>();

  for (const dialog of dialogs) {
    const entity = (dialog as any).entity;
    if (!entity) {
      continue;
    }

    allowedById.set(String(getPeerId(entity, true)), entity);
    if (typeof entity.username === "string" && entity.username.trim()) {
      allowedByUsername.set(entity.username.trim().toLowerCase(), entity);
    }
  }

  const resolved: Array<{ username: string; entity: any; title: string | null }> = [];
  for (const username of usernames) {
    const direct = allowedByUsername.get(username.toLowerCase());
    if (direct) {
      resolved.push({ username, entity: direct, title: getTitle(direct) });
      continue;
    }

    const entity = await client.getEntity(username).catch(() => null);
    if (!entity) {
      continue;
    }

    const peerId = String(getPeerId(entity, true));
    const allowed = allowedById.get(peerId);
    if (!allowed) {
      continue;
    }

    resolved.push({ username, entity: allowed, title: getTitle(allowed) });
  }

  return resolved;
}

function isServiceMessage(message: any): boolean {
  return message?.className === "MessageService" || Boolean(message?.action);
}

function getMessageText(message: any): string | null {
  if (!message || isServiceMessage(message)) {
    return null;
  }

  const value =
    typeof message.message === "string"
      ? message.message
      : typeof message.rawText === "string"
        ? message.rawText
        : typeof message.text === "string"
          ? message.text
          : "";

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

async function readMessagesFromSource(client: TelegramClient, source: { username: string; entity: any; title: string | null }, config: ExtractConfig): Promise<{
  messages: string[];
  stats: SourceStats;
}> {
  const messages: string[] = [];
  let messagesRead = 0;
  let textMessages = 0;
  let skippedMessages = 0;
  let offsetId = 0;

  while (messagesRead < config.extractLimit) {
    const limit = Math.min(config.batchSize, config.extractLimit - messagesRead);
    if (limit <= 0) {
      break;
    }

    const batch = (await client.getMessages(source.entity, {
      limit,
      offsetId
    } as any)) as any[];

    if (batch.length === 0) {
      break;
    }

    for (const message of batch) {
      messagesRead += 1;
      if (typeof message?.id === "number" && message.id > 0) {
        offsetId = message.id;
      }

      const text = getMessageText(message);
      if (!text) {
        skippedMessages += 1;
        continue;
      }

      textMessages += 1;
      messages.push(text);
    }

    if (batch.length < limit) {
      break;
    }
  }

  return {
    messages,
    stats: {
      username: source.username,
      title: source.title,
      resolved: true,
      skippedReason: null,
      messagesRead,
      textMessages,
      skippedMessages
    }
  };
}

async function collectHistory(config: ExtractConfig): Promise<{ messages: string[]; sourceStats: SourceStats[] }> {
  const sourceStats: SourceStats[] = [];

  if (config.generateOnly || config.extractLimit === 0) {
    return {
      messages: [],
      sourceStats: config.sourceUsernames.map((username) => ({
        username,
        title: null,
        resolved: false,
        skippedReason: config.generateOnly ? "generate-only mode" : "extract limit is 0",
        messagesRead: 0,
        textMessages: 0,
        skippedMessages: 0
      }))
    };
  }

  const client = await createClient();
  try {
    const sources = await resolveAllowedSources(client, config.sourceUsernames);
    const resolvedNames = new Set(sources.map((source) => source.username.toLowerCase()));

    for (const username of config.sourceUsernames) {
      if (!resolvedNames.has(username.toLowerCase())) {
        sourceStats.push({
          username,
          title: null,
          resolved: false,
          skippedReason: "chat is not in current userbot dialogs or cannot be resolved",
          messagesRead: 0,
          textMessages: 0,
          skippedMessages: 0
        });
      }
    }

    const messages: string[] = [];
    for (const source of sources) {
      const result = await readMessagesFromSource(client, source, config);
      messages.push(...result.messages);
      sourceStats.push(result.stats);
    }

    return { messages, sourceStats };
  } finally {
    await client.disconnect();
  }
}

async function withProcessExitTrap<T>(callback: () => Promise<T>, timeoutMs = 45_000): Promise<T> {
  const originalExit = process.exit;
  const keepAlive = setInterval(() => undefined, 1_000);
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null;
  const timeoutPromise = new Promise<never>((_, reject) => {
    timeoutHandle = setTimeout(() => {
      reject(new Error(`Telegram extraction timed out after ${timeoutMs}ms`));
    }, timeoutMs);
  });

  process.exit = ((code?: number | string | null | undefined) => {
    throw new Error(`process.exit(${code ?? 0}) was called during Telegram extraction`);
  }) as typeof process.exit;

  try {
    return await Promise.race([callback(), timeoutPromise]);
  } finally {
    clearInterval(keepAlive);
    if (timeoutHandle) {
      clearTimeout(timeoutHandle);
    }
    process.exit = originalExit;
  }
}

function buildReport(config: ExtractConfig, records: KamsamolKeywordRecord[], sourceStats: SourceStats[], buildStats: BuildStats): KamsamolKeywordReport {
  const messagesRead = sourceStats.reduce((sum, item) => sum + item.messagesRead, 0);
  const textMessages = sourceStats.reduce((sum, item) => sum + item.textMessages, 0);
  const skippedMessages = sourceStats.reduce((sum, item) => sum + item.skippedMessages, 0);

  return {
    createdAt: new Date().toISOString(),
    config,
    messagesRead,
    textMessages,
    skippedMessages,
    sources: sourceStats.sort((a, b) => a.username.localeCompare(b.username)),
    keywordCount: records.length,
    byCategory: countByCategory(records),
    bySource: countBySource(records),
    buildStats
  };
}

export async function buildKamsamolKeywordArtifacts(config = parseConfig()): Promise<{ keywordFile: KamsamolKeywordFile; report: KamsamolKeywordReport }> {
  let history: { messages: string[]; sourceStats: SourceStats[] };
  try {
    history = await withProcessExitTrap(() => collectHistory(config));
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    history = {
      messages: [],
      sourceStats: config.sourceUsernames.map((username) => ({
        username,
        title: null,
        resolved: false,
        skippedReason: reason,
        messagesRead: 0,
        textMessages: 0,
        skippedMessages: 0
      }))
    };
  }

  const { records, stats } = buildHistoryKeywords(history.messages, config);
  const keywords = sortKeywords([...records.values()]);
  const createdAt = new Date().toISOString();
  const keywordFile: KamsamolKeywordFile = {
    version: 1,
    createdAt,
    source: "kamsamol",
    config,
    keywords
  };
  const report = buildReport(config, keywords, history.sourceStats, stats);

  return { keywordFile, report };
}

async function main(): Promise<void> {
  const config = parseConfig();
  const { keywordFile, report } = await buildKamsamolKeywordArtifacts(config);

  await mkdir(GENERATED_DIR, { recursive: true });
  await writeFile(KEYWORDS_PATH, `${JSON.stringify(keywordFile, null, 2)}\n`, "utf8");
  await writeFile(REPORT_PATH, `${JSON.stringify(report, null, 2)}\n`, "utf8");

  console.log(`messages read: ${report.messagesRead}`);
  console.log(`text messages: ${report.textMessages}`);
  console.log(`keywords generated: ${report.keywordCount}`);
  console.log(`by category: ${JSON.stringify(report.byCategory)}`);
  console.log(`keywords file: ${KEYWORDS_PATH}`);
  console.log(`report file: ${REPORT_PATH}`);
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryFile === fileURLToPath(import.meta.url) || entryFile.endsWith("extract-kamsamol-keywords.ts") || entryFile.endsWith("extract-kamsamol-keywords.js")) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
