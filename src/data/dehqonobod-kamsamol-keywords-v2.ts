import { KeywordCategory, KeywordLanguage, KeywordMatchType } from "@prisma/client";
import { detectKeywordLanguage, normalizePhrase } from "../utils/keywordNormalize.js";

export const DK_V2_SOURCE = "generated:dehqonobod_kamsamol_v2";

export type DkV2DecisionCategory = "PASSENGER_LEAD" | "DRIVER_AD" | "CARGO" | "SPAM" | "AMBIGUOUS";

export interface DkV2KeywordRecord {
  phrase: string;
  normalized: string;
  category: KeywordCategory;
  weight: number;
  language: KeywordLanguage;
  matchType: KeywordMatchType;
  source: string;
  frequency: number;
  examples: string[];
}

export interface DkV2ClassificationResult {
  category: DkV2DecisionCategory;
  passengerScore: number;
  driverScore: number;
  cargoScore: number;
  spamScore: number;
  matchedKeywords: string[];
}

export const DK_V2_TEST_CASES: Array<{ text: string; expected: DkV2DecisionCategory }> = [
  { text: "Kamsamoldan Dehqonobodga 1 kishi bor", expected: "PASSENGER_LEAD" },
  { text: "Dehqonobodga joy bormi", expected: "PASSENGER_LEAD" },
  { text: "Kamsamolga kim ketadi", expected: "PASSENGER_LEAD" },
  { text: "Qarshiga 2 kishi bor", expected: "PASSENGER_LEAD" },
  { text: "Dehqonoboddan Qarshiga taksi kerak", expected: "PASSENGER_LEAD" },
  { text: "Dehqonobod Kamsamol bo'sh joy bor", expected: "DRIVER_AD" },
  { text: "Har kuni Kamsamol Dehqonobod qatnaymiz", expected: "DRIVER_AD" },
  { text: "2 ta joy bor murojaat uchun", expected: "DRIVER_AD" },
  { text: "Kamsamoldan Qarshiga reys bor", expected: "DRIVER_AD" },
  { text: "Pochta bor Kamsamoldan Dehqonobodga", expected: "CARGO" },
  { text: "Kanalga obuna bo'ling", expected: "SPAM" }
];

const LOCATIONS_LATIN = [
  "Kamsamol",
  "Komsomol",
  "Qamsamol",
  "Dehqonobod",
  "Dehqonobod markaz",
  "Qarshi",
  "Qarshi shahar",
  "G'uzor",
  "Guzor",
  "Guzar",
  "Koson",
  "Nishon",
  "Yakkabog'",
  "Yakkabog",
  "Shahrisabz",
  "Kitob",
  "Chiroqchi",
  "Muborak",
  "Mirishkor",
  "Kasbi",
  "Tallimarjon",
  "Toshkent",
  "Samarqand",
  "Buxoro",
  "Termiz",
  "Guliston",
  "Bekobod",
  "Shirin",
  "Yangiyer",
  "Sirdaryo",
  "Aeroport",
  "Vokzal",
  "Bozor",
  "Shifoxona",
  "Poliklinika",
  "Universitet",
  "Institut",
  "Avtovokzal",
  "Markaz",
  "Mahalla",
  "Bekat"
] as const;

const LOCATIONS_CYRILLIC = [
  "Камсамол",
  "Комсомол",
  "Қамсамол",
  "Деҳқонобод",
  "Дехконобод",
  "Деҳқонобод марказ",
  "Қарши",
  "Карши",
  "Ғузор",
  "Гузор",
  "Косон",
  "Нишон",
  "Яккабоғ",
  "Яккабог",
  "Шаҳрисабз",
  "Шахрисабз",
  "Китоб",
  "Чироқчи",
  "Чирокчи",
  "Муборак",
  "Миришкор",
  "Касби",
  "Таллимаржон",
  "Тошкент",
  "Самарқанд",
  "Самарканд",
  "Бухоро",
  "Термиз",
  "Гулистон",
  "Бекобод",
  "Ширин",
  "Янгийер",
  "Сирдарё",
  "Аэропорт",
  "Вокзал",
  "Бозор",
  "Шифохона",
  "Поликлиника",
  "Университет",
  "Институт",
  "Автовокзал",
  "Марказ",
  "Маҳалла",
  "Махалла",
  "Бекат"
] as const;

const PASSENGER_MANUAL: Array<{ phrase: string; weight: number }> = [
  { phrase: "joy bormi", weight: 10 },
  { phrase: "joy bormi?", weight: 10 },
  { phrase: "bitta joy bormi", weight: 10 },
  { phrase: "ikkita joy bormi", weight: 10 },
  { phrase: "2 ta joy bormi", weight: 9 },
  { phrase: "bo'sh joy bormi", weight: 9 },
  { phrase: "bosh joy bormi", weight: 9 },
  { phrase: "1 kishi bor", weight: 10 },
  { phrase: "2 kishi bor", weight: 10 },
  { phrase: "3 kishi bor", weight: 10 },
  { phrase: "4 kishi bor", weight: 10 },
  { phrase: "1 odam bor", weight: 10 },
  { phrase: "2 odam bor", weight: 10 },
  { phrase: "yo'lovchi bor", weight: 9 },
  { phrase: "yolovchi bor", weight: 9 },
  { phrase: "yulovchi bor", weight: 9 },
  { phrase: "passajir bor", weight: 9 },
  { phrase: "pasajir bor", weight: 9 },
  { phrase: "taxi kerak", weight: 10 },
  { phrase: "taksi kerak", weight: 10 },
  { phrase: "takisi kerak", weight: 9 },
  { phrase: "taxi kere", weight: 9 },
  { phrase: "taksi kere", weight: 9 },
  { phrase: "tax kerak", weight: 9 },
  { phrase: "tak kerak", weight: 9 },
  { phrase: "takis kerak", weight: 9 },
  { phrase: "taks kerak", weight: 9 },
  { phrase: "mashina kerak", weight: 9 },
  { phrase: "moshina kerak", weight: 9 },
  { phrase: "mashna kerak", weight: 8 },
  { phrase: "avto kerak", weight: 8 },
  { phrase: "ulov kerak", weight: 8 },
  { phrase: "transport kerak", weight: 8 },
  { phrase: "haydovchi kerak", weight: 8 },
  { phrase: "taksist kerak", weight: 8 },
  { phrase: "voditel kerak", weight: 8 },
  { phrase: "menga taxi kerak", weight: 10 },
  { phrase: "menga taksi kerak", weight: 10 },
  { phrase: "bizga taxi kerak", weight: 10 },
  { phrase: "bizga taksi kerak", weight: 10 },
  { phrase: "ketish kerak", weight: 10 },
  { phrase: "ketish kere", weight: 9 },
  { phrase: "ketishim kerak", weight: 10 },
  { phrase: "ketishimiz kerak", weight: 10 },
  { phrase: "borish kerak", weight: 10 },
  { phrase: "borish kere", weight: 9 },
  { phrase: "borishim kerak", weight: 10 },
  { phrase: "borishimiz kerak", weight: 10 },
  { phrase: "chiqish kerak", weight: 9 },
  { phrase: "yo'lga chiqish kerak", weight: 9 },
  { phrase: "yolga chiqish kerak", weight: 9 },
  { phrase: "olib ketadigan bormi", weight: 9 },
  { phrase: "ob ketadigan bormi", weight: 9 },
  { phrase: "op ketadigan bormi", weight: 9 },
  { phrase: "olib boradigan bormi", weight: 9 },
  { phrase: "kim olib ketadi", weight: 9 },
  { phrase: "kim ob ketadi", weight: 9 },
  { phrase: "kim op ketadi", weight: 9 },
  { phrase: "kim olib boradi", weight: 9 },
  { phrase: "kim yetkazadi", weight: 9 },
  { phrase: "kim ketadi", weight: 9 },
  { phrase: "kim boradi", weight: 9 },
  { phrase: "kim yuradi", weight: 8 },
  { phrase: "kim chiqadi", weight: 8 },
  { phrase: "boradigan bormi", weight: 9 },
  { phrase: "ketadigan bormi", weight: 9 },
  { phrase: "yuradigan bormi", weight: 8 },
  { phrase: "chiqadigan bormi", weight: 8 },
  { phrase: "yo'l bormi", weight: 8 },
  { phrase: "yol bormi", weight: 8 },
  { phrase: "reys bormi", weight: 8 },
  { phrase: "taxi bormi", weight: 8 },
  { phrase: "taksi bormi", weight: 8 },
  { phrase: "mashina bormi", weight: 8 },
  { phrase: "moshina bormi", weight: 8 },
  { phrase: "poputchik bormi", weight: 7 },
  { phrase: "poputka bormi", weight: 7 },
  { phrase: "nechida ketadi", weight: 8 },
  { phrase: "nechada ketadi", weight: 8 },
  { phrase: "qachon ketadi", weight: 8 },
  { phrase: "soat nechida ketadi", weight: 8 },
  { phrase: "narxi qancha", weight: 7 },
  { phrase: "narh qancha", weight: 7 },
  { phrase: "necha pul", weight: 7 },
  { phrase: "kira qancha", weight: 7 },
  { phrase: "yo'l kira qancha", weight: 7 },
  { phrase: "telefon tashang", weight: 7 },
  { phrase: "nomer tashang", weight: 7 },
  { phrase: "raqam tashang", weight: 7 },
  { phrase: "taxi topib bering", weight: 9 },
  { phrase: "taksi topib bering", weight: 9 },
  { phrase: "tezroq kerak", weight: 7 },
  { phrase: "shoshilinch kerak", weight: 8 },
  { phrase: "hozir kerak", weight: 7 },
  { phrase: "bugun kerak", weight: 7 }
];

const PASSENGER_CYRILLIC: Array<{ phrase: string; weight: number }> = [
  { phrase: "такси керак", weight: 10 },
  { phrase: "такси кере", weight: 9 },
  { phrase: "машина керак", weight: 9 },
  { phrase: "мошина керак", weight: 9 },
  { phrase: "авто керак", weight: 8 },
  { phrase: "кетиш керак", weight: 10 },
  { phrase: "бориш керак", weight: 10 },
  { phrase: "чиқиш керак", weight: 9 },
  { phrase: "ким кетади", weight: 9 },
  { phrase: "ким боради", weight: 9 },
  { phrase: "жой борми", weight: 10 },
  { phrase: "битта жой борми", weight: 10 },
  { phrase: "иккита жой борми", weight: 10 },
  { phrase: "1 киши бор", weight: 10 },
  { phrase: "2 киши бор", weight: 10 },
  { phrase: "1 одам бор", weight: 10 },
  { phrase: "2 одам бор", weight: 10 },
  { phrase: "йўловчи бор", weight: 9 },
  { phrase: "йуловчи бор", weight: 9 },
  { phrase: "пассажир бор", weight: 9 },
  { phrase: "нечада кетади", weight: 8 },
  { phrase: "қачон кетади", weight: 8 },
  { phrase: "нархи қанча", weight: 7 },
  { phrase: "неча пул", weight: 7 }
];

const DRIVER_MANUAL: Array<{ phrase: string; weight: number }> = [
  { phrase: "bo'sh joy bor", weight: 11 },
  { phrase: "bosh joy bor", weight: 11 },
  { phrase: "bo'sh joylar bor", weight: 11 },
  { phrase: "bosh joylar bor", weight: 11 },
  { phrase: "joy bor", weight: 8 },
  { phrase: "joylar bor", weight: 8 },
  { phrase: "1 ta joy bor", weight: 10 },
  { phrase: "2 ta joy bor", weight: 10 },
  { phrase: "3 ta joy bor", weight: 10 },
  { phrase: "4 ta joy bor", weight: 10 },
  { phrase: "taxi xizmati", weight: 11 },
  { phrase: "taksi xizmati", weight: 11 },
  { phrase: "taxi hizmati", weight: 10 },
  { phrase: "taksi hizmati", weight: 10 },
  { phrase: "xizmat bor", weight: 9 },
  { phrase: "taxi bor", weight: 9 },
  { phrase: "taksi bor", weight: 9 },
  { phrase: "taxsi bor", weight: 9 },
  { phrase: "mashina bor", weight: 9 },
  { phrase: "moshina bor", weight: 9 },
  { phrase: "avto bor", weight: 8 },
  { phrase: "haydovchi bor", weight: 8 },
  { phrase: "har kuni qatnaymiz", weight: 11 },
  { phrase: "har kuni yuramiz", weight: 10 },
  { phrase: "har kuni boramiz", weight: 10 },
  { phrase: "doimiy qatnaymiz", weight: 10 },
  { phrase: "doimiy reys", weight: 9 },
  { phrase: "qatnaymiz", weight: 9 },
  { phrase: "qatnayman", weight: 9 },
  { phrase: "yuraman", weight: 8 },
  { phrase: "yuramiz", weight: 8 },
  { phrase: "boraman", weight: 8 },
  { phrase: "boramiz", weight: 8 },
  { phrase: "ketaman", weight: 8 },
  { phrase: "ketamiz", weight: 8 },
  { phrase: "chiqaman", weight: 8 },
  { phrase: "chiqamiz", weight: 8 },
  { phrase: "yo'lga chiqamiz", weight: 8 },
  { phrase: "yolga chiqamiz", weight: 8 },
  { phrase: "yo'ldamiz", weight: 8 },
  { phrase: "yoldamiz", weight: 8 },
  { phrase: "trassadamiz", weight: 8 },
  { phrase: "hozir chiqamiz", weight: 8 },
  { phrase: "hozir ketamiz", weight: 8 },
  { phrase: "reys bor", weight: 9 },
  { phrase: "reis bor", weight: 9 },
  { phrase: "reysga yoziling", weight: 9 },
  { phrase: "bron qiling", weight: 8 },
  { phrase: "zakaz olamiz", weight: 8 },
  { phrase: "buyurtma olamiz", weight: 8 },
  { phrase: "buyurtma qabul qilamiz", weight: 8 },
  { phrase: "olib boraman", weight: 8 },
  { phrase: "olib boramiz", weight: 8 },
  { phrase: "olib ketaman", weight: 8 },
  { phrase: "olib ketamiz", weight: 8 },
  { phrase: "yetkazib beramiz", weight: 8 },
  { phrase: "manzilga yetkazamiz", weight: 8 },
  { phrase: "murojaat uchun", weight: 8 },
  { phrase: "bog'lanish uchun", weight: 8 },
  { phrase: "boglanish uchun", weight: 8 },
  { phrase: "aloqa uchun", weight: 8 },
  { phrase: "telefon", weight: 4 },
  { phrase: "nomer", weight: 4 },
  { phrase: "raqam", weight: 4 },
  { phrase: "kerak bo'lsa yozing", weight: 8 },
  { phrase: "kerak bolsa yozing", weight: 8 },
  { phrase: "operator", weight: 7 },
  { phrase: "dispetcher", weight: 7 },
  { phrase: "24/7", weight: 7 },
  { phrase: "24 soat", weight: 7 },
  { phrase: "arzon narx", weight: 7 },
  { phrase: "kelishilgan narx", weight: 7 },
  { phrase: "qulay narx", weight: 7 },
  { phrase: "komfort", weight: 6 },
  { phrase: "konditsioner", weight: 6 },
  { phrase: "haydovchi", weight: 6 },
  { phrase: "voditel", weight: 6 },
  { phrase: "taksist", weight: 6 },
  { phrase: "taxist", weight: 6 },
  { phrase: "lacetti", weight: 6 },
  { phrase: "lasetti", weight: 6 },
  { phrase: "cobalt", weight: 6 },
  { phrase: "cobult", weight: 6 },
  { phrase: "gentra", weight: 6 },
  { phrase: "nexia", weight: 6 },
  { phrase: "damas", weight: 6 },
  { phrase: "spark", weight: 6 },
  { phrase: "malibu", weight: 6 },
  { phrase: "onix", weight: 6 },
  { phrase: "captiva", weight: 6 },
  { phrase: "matiz", weight: 6 },
  { phrase: "miniven", weight: 6 },
  { phrase: "sedan", weight: 6 },
  { phrase: "yengil mashina", weight: 6 },
  { phrase: "pochta olamiz", weight: 8 },
  { phrase: "odam olamiz", weight: 8 },
  { phrase: "joyga yoziling", weight: 8 },
  { phrase: "srochniy reys", weight: 8 },
  { phrase: "tezkor reys", weight: 8 }
];

const DRIVER_CYRILLIC: Array<{ phrase: string; weight: number }> = [
  { phrase: "такси хизмати", weight: 11 },
  { phrase: "хизмат бор", weight: 9 },
  { phrase: "такси бор", weight: 9 },
  { phrase: "машина бор", weight: 9 },
  { phrase: "мошина бор", weight: 9 },
  { phrase: "бўш жой бор", weight: 11 },
  { phrase: "буш жой бор", weight: 11 },
  { phrase: "жой бор", weight: 8 },
  { phrase: "1 та жой бор", weight: 10 },
  { phrase: "2 та жой бор", weight: 10 },
  { phrase: "ҳар куни қатнаймиз", weight: 11 },
  { phrase: "хар куни катнаймиз", weight: 11 },
  { phrase: "қатнаймиз", weight: 9 },
  { phrase: "катнаймиз", weight: 9 },
  { phrase: "юрамиз", weight: 8 },
  { phrase: "борамиз", weight: 8 },
  { phrase: "кетамиз", weight: 8 },
  { phrase: "чиқамиз", weight: 8 },
  { phrase: "рейс бор", weight: 9 },
  { phrase: "мурожаат учун", weight: 8 },
  { phrase: "алоқа учун", weight: 8 },
  { phrase: "телефон", weight: 4 },
  { phrase: "номер", weight: 4 },
  { phrase: "рақам", weight: 4 }
];

const CARGO_MANUAL: Array<{ phrase: string; weight: number }> = [
  { phrase: "pochta", weight: 7 },
  { phrase: "pochta bor", weight: 9 },
  { phrase: "pochta ketadi", weight: 8 },
  { phrase: "pochta olib ketamiz", weight: 9 },
  { phrase: "pochta olib boramiz", weight: 9 },
  { phrase: "pochta xizmati", weight: 8 },
  { phrase: "posilka", weight: 7 },
  { phrase: "posilka bor", weight: 9 },
  { phrase: "posilka ketadi", weight: 8 },
  { phrase: "yuk", weight: 7 },
  { phrase: "yuk bor", weight: 8 },
  { phrase: "yuk ketadi", weight: 8 },
  { phrase: "yuk tashish", weight: 9 },
  { phrase: "dostavka", weight: 8 },
  { phrase: "yetkazma", weight: 8 },
  { phrase: "jo'natma", weight: 8 },
  { phrase: "jonatma", weight: 8 },
  { phrase: "qayerdan", weight: 4 },
  { phrase: "qayerga", weight: 4 },
  { phrase: "yuboruvchi", weight: 8 },
  { phrase: "qabul qiluvchi", weight: 8 },
  { phrase: "kategoriya pochta", weight: 10 },
  { phrase: "почта", weight: 7 },
  { phrase: "почта бор", weight: 9 },
  { phrase: "посилка", weight: 7 },
  { phrase: "посилка бор", weight: 9 },
  { phrase: "юк бор", weight: 8 },
  { phrase: "юк ташиш", weight: 9 }
];

const SPAM_MANUAL: Array<{ phrase: string; weight: number }> = [
  { phrase: "kanalga obuna", weight: 9 },
  { phrase: "obuna bo'ling", weight: 10 },
  { phrase: "obuna boling", weight: 10 },
  { phrase: "reklama", weight: 9 },
  { phrase: "reklama uchun", weight: 9 },
  { phrase: "elon berish", weight: 8 },
  { phrase: "e'lon berish", weight: 8 },
  { phrase: "admin bilan bog'laning", weight: 8 },
  { phrase: "ish bor", weight: 7 },
  { phrase: "vakansiya", weight: 7 },
  { phrase: "xodim kerak", weight: 7 },
  { phrase: "sotiladi", weight: 7 },
  { phrase: "arenda", weight: 7 },
  { phrase: "ijara", weight: 7 },
  { phrase: "uy sotiladi", weight: 8 },
  { phrase: "hovli sotiladi", weight: 8 },
  { phrase: "aksiya", weight: 8 },
  { phrase: "skidka", weight: 8 },
  { phrase: "promo", weight: 8 },
  { phrase: "instagram", weight: 7 },
  { phrase: "youtube", weight: 7 },
  { phrase: "tiktok", weight: 7 },
  { phrase: "botga start bosing", weight: 8 },
  { phrase: "pul ishlash", weight: 8 },
  { phrase: "karta", weight: 6 },
  { phrase: "plastik", weight: 6 },
  { phrase: "click", weight: 6 },
  { phrase: "payme", weight: 6 },
  { phrase: "uzum", weight: 6 },
  { phrase: "havola", weight: 7 },
  { phrase: "link", weight: 7 },
  { phrase: "http", weight: 7 },
  { phrase: "https", weight: 7 },
  { phrase: "t.me/", weight: 8 },
  { phrase: "@admin", weight: 6 },
  { phrase: "manba", weight: 6 },
  { phrase: "yangiliklar", weight: 6 },
  { phrase: "diqqat", weight: 6 },
  { phrase: "rasmiy kanal", weight: 8 },
  { phrase: "do'kon", weight: 6 },
  { phrase: "dokoni", weight: 6 },
  { phrase: "savdo", weight: 6 },
  { phrase: "chegirma", weight: 7 },
  { phrase: "каналга обуна", weight: 9 },
  { phrase: "обуна бўлинг", weight: 10 },
  { phrase: "реклама", weight: 9 },
  { phrase: "сотилади", weight: 7 },
  { phrase: "ижара", weight: 7 }
];

const PASSENGER_ROUTE_TEMPLATES = [
  "{from}dan {to}ga 1 kishi bor",
  "{from}dan {to}ga 2 kishi bor",
  "{from}dan {to}ga taxi kerak",
  "{from}dan {to}ga taksi kerak",
  "{from}dan {to}ga ketish kerak",
  "{from}dan {to}ga borish kerak",
  "{from}dan {to}ga kim ketadi",
  "{from}dan {to}ga joy bormi"
] as const;

const PASSENGER_TO_TEMPLATES = [
  "{to}ga 1 kishi bor",
  "{to}ga 2 odam bor",
  "{to}ga ketish kerak",
  "{to}ga borish kerak",
  "{to}ga taxi kerak",
  "{to}ga taksi kerak",
  "{to}ga joy bormi",
  "{to}ga kim ketadi",
  "{to}ga kim boradi"
] as const;

const DRIVER_ROUTE_TEMPLATES = [
  "{from}dan {to}ga bo'sh joy bor",
  "{from}dan {to}ga bosh joy bor",
  "{from}dan {to}ga 2 ta joy bor",
  "{from}dan {to}ga taxi xizmati",
  "{from}dan {to}ga qatnaymiz",
  "{from}dan {to}ga har kuni qatnaymiz",
  "{from}dan {to}ga reys bor",
  "{from}dan {to}ga murojaat uchun"
] as const;

const CYRILLIC_ROUTE_TEMPLATES: Array<{ category: KeywordCategory; template: string; weight: number }> = [
  { category: KeywordCategory.PASSENGER, template: "{from}дан {to}га 1 киши бор", weight: 9 },
  { category: KeywordCategory.PASSENGER, template: "{from}дан {to}га 2 киши бор", weight: 9 },
  { category: KeywordCategory.PASSENGER, template: "{from}дан {to}га такси керак", weight: 9 },
  { category: KeywordCategory.PASSENGER, template: "{from}дан {to}га кетиш керак", weight: 9 },
  { category: KeywordCategory.PASSENGER, template: "{from}дан {to}га жой борми", weight: 9 },
  { category: KeywordCategory.DRIVER, template: "{from}дан {to}га бўш жой бор", weight: 10 },
  { category: KeywordCategory.DRIVER, template: "{from}дан {to}га 2 та жой бор", weight: 9 },
  { category: KeywordCategory.DRIVER, template: "{from}дан {to}га такси хизмати", weight: 10 },
  { category: KeywordCategory.DRIVER, template: "{from}дан {to}га қатнаймиз", weight: 9 },
  { category: KeywordCategory.DRIVER, template: "{from}дан {to}га мурожаат учун", weight: 8 }
];

const REGEX_KEYWORDS: Array<{ category: KeywordCategory; pattern: string; weight: number }> = [
  { category: KeywordCategory.PASSENGER, pattern: "\\b\\d+\\s*(kishi|odam|та киши|та одам)\\s*(bor|бор)\\b", weight: 9 },
  {
    category: KeywordCategory.PASSENGER,
    pattern: "\\b(bir|ikki|uch|tort|to'rt|бир|икки|уч|тўрт)\\s*(kishi|odam|киши|одам)\\s*(bor|бор)\\b",
    weight: 9
  },
  { category: KeywordCategory.PASSENGER, pattern: "\\b\\w+\\s*dan\\s+\\w+\\s*ga\\b", weight: 4 },
  { category: KeywordCategory.PASSENGER, pattern: "\\b\\w+\\s*дан\\s+\\w+\\s*га\\b", weight: 4 },
  { category: KeywordCategory.PASSENGER, pattern: "\\b(ketish|borish|chiqish)\\s*(kerak|kere)\\b", weight: 10 },
  { category: KeywordCategory.PASSENGER, pattern: "\\b(кетиш|бориш|чиқиш)\\s*(керак|кере)\\b", weight: 10 },
  { category: KeywordCategory.PASSENGER, pattern: "\\bjoy\\s*bormi\\??\\b", weight: 10 },
  { category: KeywordCategory.PASSENGER, pattern: "\\bжой\\s*борми\\??\\b", weight: 10 },
  { category: KeywordCategory.PASSENGER, pattern: "\\b(kim|ким)\\s*(ketadi|boradi|olib ketadi|кетади|боради|олиб кетади)\\b", weight: 9 },
  { category: KeywordCategory.DRIVER, pattern: "\\b(bo'?sh|bosh|бўш|буш)\\s*(joy|жой)\\s*(bor|бор)\\b", weight: 11 },
  { category: KeywordCategory.DRIVER, pattern: "\\b\\d+\\s*ta\\s*(joy|жой)\\s*(bor|бор)\\b", weight: 10 },
  { category: KeywordCategory.DRIVER, pattern: "\\b\\d+\\s*та\\s*жой\\s*бор\\b", weight: 10 },
  {
    category: KeywordCategory.DRIVER,
    pattern: "\\b(har kuni|хар куни|ҳар куни)\\s*(qatnaymiz|yuramiz|юрамиз|қатнаймиз|катнаймиз)\\b",
    weight: 11
  },
  { category: KeywordCategory.DRIVER, pattern: "\\b(murojaat|мурожаат)\\s*(uchun|учун)\\b", weight: 8 },
  { category: KeywordCategory.DRIVER, pattern: "\\b(tel|тел|telefon|телефон|nomer|номер)\\s*[:\\-]?\\s*\\+?\\d\\b", weight: 6 },
  { category: KeywordCategory.DRIVER, pattern: "\\b(kerak bo'?lsa|керак бўлса|керак булса)\\s*(yozing|ёзинг)\\b", weight: 8 },
  { category: KeywordCategory.DRIVER, pattern: "\\b(reys|reis|рейс)\\s*(bor|бор)\\b", weight: 9 },
  { category: KeywordCategory.CARGO, pattern: "\\b(qayerdan|қаердан)\\b.*\\b(qayerga|қаерга)\\b", weight: 7 },
  { category: KeywordCategory.CARGO, pattern: "\\b(yuboruvchi|юборувчи)\\b.*\\b(qabul qiluvchi|қабул қилувчи)\\b", weight: 8 },
  { category: KeywordCategory.CARGO, pattern: "\\b(kategoriya|категория)\\s*[:\\-]?\\s*(pochta|почта)\\b", weight: 10 }
];

function template(value: string, from: string, to: string): string {
  return value.replaceAll("{from}", from).replaceAll("{to}", to);
}

function regexNormalized(pattern: string): string {
  return `regex:${normalizePhrase(pattern)}`;
}

function addKeyword(
  map: Map<string, DkV2KeywordRecord>,
  category: KeywordCategory,
  phrase: string,
  weight: number,
  matchType: KeywordMatchType = KeywordMatchType.PHRASE,
  frequency = 1,
  examples: string[] = []
): void {
  const raw = phrase.trim().replace(/\s+/g, " ");
  if (!raw) {
    return;
  }

  const normalized = matchType === KeywordMatchType.REGEX ? regexNormalized(raw) : normalizePhrase(raw);
  if (!normalized) {
    return;
  }

  const key = `${category}::${normalized}`;
  const existing = map.get(key);
  const record: DkV2KeywordRecord = {
    phrase: raw,
    normalized,
    category,
    weight: Math.max(1, Math.min(20, Math.round(weight))),
    language: (matchType === KeywordMatchType.REGEX ? KeywordLanguage.MIXED : detectKeywordLanguage(raw)) as KeywordLanguage,
    matchType,
    source: DK_V2_SOURCE,
    frequency: Math.max(1, Math.round(frequency)),
    examples: examples.slice(0, 3)
  };

  if (!existing) {
    map.set(key, record);
    return;
  }

  if (record.weight > existing.weight) {
    existing.weight = record.weight;
  }
  existing.frequency += record.frequency;
  existing.examples = [...new Set([...existing.examples, ...record.examples])].slice(0, 3);
}

export function buildDehqonobodKamsamolV2Keywords(): DkV2KeywordRecord[] {
  const map = new Map<string, DkV2KeywordRecord>();

  for (const item of PASSENGER_MANUAL) {
    addKeyword(map, KeywordCategory.PASSENGER, item.phrase, item.weight, KeywordMatchType.PHRASE, 5);
  }
  for (const item of PASSENGER_CYRILLIC) {
    addKeyword(map, KeywordCategory.PASSENGER, item.phrase, item.weight, KeywordMatchType.PHRASE, 5);
  }
  for (const item of DRIVER_MANUAL) {
    addKeyword(map, KeywordCategory.DRIVER, item.phrase, item.weight, KeywordMatchType.PHRASE, 5);
  }
  for (const item of DRIVER_CYRILLIC) {
    addKeyword(map, KeywordCategory.DRIVER, item.phrase, item.weight, KeywordMatchType.PHRASE, 5);
  }
  for (const item of CARGO_MANUAL) {
    addKeyword(map, KeywordCategory.CARGO, item.phrase, item.weight, KeywordMatchType.PHRASE, 4);
  }
  for (const item of SPAM_MANUAL) {
    addKeyword(map, KeywordCategory.SPAM, item.phrase, item.weight, KeywordMatchType.PHRASE, 4);
  }

  for (const from of LOCATIONS_LATIN) {
    for (const to of LOCATIONS_LATIN) {
      if (from === to) {
        continue;
      }

      for (const routeTemplate of PASSENGER_ROUTE_TEMPLATES) {
        addKeyword(map, KeywordCategory.PASSENGER, template(routeTemplate, from, to), 8, KeywordMatchType.PHRASE, 2);
      }
      for (const routeTemplate of DRIVER_ROUTE_TEMPLATES) {
        addKeyword(map, KeywordCategory.DRIVER, template(routeTemplate, from, to), 8, KeywordMatchType.PHRASE, 2);
      }
      addKeyword(map, KeywordCategory.CARGO, `${from}dan ${to}ga pochta bor`, 8, KeywordMatchType.PHRASE, 2);
      addKeyword(map, KeywordCategory.CARGO, `${from}dan ${to}ga yuk bor`, 8, KeywordMatchType.PHRASE, 2);
    }
  }

  for (const to of LOCATIONS_LATIN) {
    for (const routeTemplate of PASSENGER_TO_TEMPLATES) {
      addKeyword(map, KeywordCategory.PASSENGER, template(routeTemplate, "", to), 8, KeywordMatchType.PHRASE, 2);
    }
  }

  for (const from of LOCATIONS_CYRILLIC) {
    for (const to of LOCATIONS_CYRILLIC) {
      if (from === to) {
        continue;
      }

      for (const routeTemplate of CYRILLIC_ROUTE_TEMPLATES) {
        addKeyword(map, routeTemplate.category, template(routeTemplate.template, from, to), routeTemplate.weight, KeywordMatchType.PHRASE, 2);
      }
    }
  }

  for (const item of REGEX_KEYWORDS) {
    addKeyword(map, item.category, item.pattern, item.weight, KeywordMatchType.REGEX, 10);
  }

  return [...map.values()].sort((a, b) => a.category.localeCompare(b.category) || b.weight - a.weight || a.normalized.localeCompare(b.normalized));
}

function phraseMatches(normalizedText: string, normalizedKeyword: string): boolean {
  return ` ${normalizedText} `.includes(` ${normalizedKeyword} `);
}

function decideCategory(scores: { passenger: number; driver: number; cargo: number; spam: number }): DkV2DecisionCategory {
  if (scores.driver >= scores.passenger + 3 && scores.driver >= 7 && scores.driver >= scores.cargo && scores.driver >= scores.spam) {
    return "DRIVER_AD";
  }

  if (scores.passenger >= scores.driver + 3 && scores.passenger >= 7 && scores.passenger >= scores.cargo && scores.passenger >= scores.spam) {
    return "PASSENGER_LEAD";
  }

  if (scores.cargo >= 7 && scores.cargo >= scores.spam && scores.cargo >= Math.max(scores.passenger, scores.driver) - 2) {
    return "CARGO";
  }

  if (scores.spam >= 7 && scores.spam >= Math.max(scores.passenger, scores.driver, scores.cargo) - 2) {
    return "SPAM";
  }

  return "AMBIGUOUS";
}

export function classifyDehqonobodKamsamolV2Text(
  text: string,
  records = buildDehqonobodKamsamolV2Keywords()
): DkV2ClassificationResult {
  const normalizedText = normalizePhrase(text);
  const scores = {
    passenger: 0,
    driver: 0,
    cargo: 0,
    spam: 0
  };
  const matchedKeywords: string[] = [];

  for (const record of records) {
    let matched = false;
    if (record.matchType === KeywordMatchType.REGEX) {
      try {
        matched = new RegExp(record.phrase, "iu").test(text);
      } catch {
        matched = false;
      }
    } else {
      matched = phraseMatches(normalizedText, record.normalized);
    }

    if (!matched) {
      continue;
    }

    matchedKeywords.push(record.phrase);
    if (record.category === KeywordCategory.PASSENGER) {
      scores.passenger += record.weight;
    } else if (record.category === KeywordCategory.DRIVER) {
      scores.driver += record.weight;
    } else if (record.category === KeywordCategory.CARGO) {
      scores.cargo += record.weight;
    } else if (record.category === KeywordCategory.SPAM) {
      scores.spam += record.weight;
    }
  }

  return {
    category: decideCategory(scores),
    passengerScore: scores.passenger,
    driverScore: scores.driver,
    cargoScore: scores.cargo,
    spamScore: scores.spam,
    matchedKeywords: [...new Set(matchedKeywords)].slice(0, 30)
  };
}
