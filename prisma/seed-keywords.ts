import { KeywordCategory, KeywordLanguage, KeywordMatchType, PrismaClient } from "@prisma/client";
import { detectKeywordLanguage, normalizePhrase as baseNormalizePhrase } from "../src/utils/keywordNormalize.js";

type CategoryKey = "passenger" | "driver" | "cargo" | "spam" | "ambiguous";

interface CandidateKeyword {
  phrase: string;
  normalized: string;
  category: KeywordCategory;
  weight: number;
  language: KeywordLanguage;
  matchType: KeywordMatchType;
  source: string;
}

const defaultPrisma = new PrismaClient();
const keywordMap = new Map<string, CandidateKeyword>();

const LOCATIONS_LATIN = [
  "Guliston",
  "Bekobod",
  "Shirin",
  "Yangiyer",
  "Sirdaryo",
  "Toshkent",
  "Chinoz",
  "Olmaliq",
  "Piskent",
  "Bo'ka",
  "Boka",
  "Ohangaron",
  "Angren",
  "Nurafshon",
  "Sergeli",
  "Chilonzor",
  "Yunusobod",
  "Qo'yliq",
  "Quyliq",
  "Aeroport",
  "Vokzal",
  "Samarqand",
  "Jizzax",
  "Farg'ona",
  "Fargona",
  "Andijon",
  "Namangan",
  "Qo'qon",
  "Qoqon",
  "Marg'ilon",
  "Margilon",
  "Buxoro",
  "Qarshi",
  "Termiz",
  "Navoiy"
];

const LOCATIONS_CYRILLIC = [
  "Гулистон",
  "Бекобод",
  "Ширин",
  "Янгийер",
  "Сирдарё",
  "Тошкент",
  "Чиноз",
  "Олмалиқ",
  "Пискент",
  "Бўка",
  "Бока",
  "Оҳангарон",
  "Ангрен",
  "Нурафшон",
  "Сергели",
  "Чилонзор",
  "Юнусобод",
  "Қўйлиқ",
  "Куйлик",
  "Аэропорт",
  "Вокзал",
  "Самарқанд",
  "Жиззах",
  "Фарғона",
  "Андижон",
  "Наманган",
  "Қўқон",
  "Марғилон",
  "Бухоро",
  "Қарши",
  "Термиз",
  "Навоий"
];

const PASSENGER_SUBJECTS_LATIN = [
  "men",
  "menga",
  "biz",
  "bizga",
  "1 kishi",
  "2 kishi",
  "3 kishi",
  "4 kishi",
  "5 kishi",
  "1 odam",
  "2 odam",
  "3 odam",
  "4 odam",
  "bir kishi",
  "ikki kishi",
  "uch kishi",
  "tort kishi",
  "to'rt kishi",
  "ayol kishi",
  "erkak kishi",
  "bola",
  "ona bola",
  "oilaviy",
  "yo'lovchi",
  "yolovchi",
  "yulovchi",
  "passajir",
  "pasajir"
];

const PASSENGER_NEEDS_LATIN = [
  "taxi kerak",
  "taksi kerak",
  "taxi kere",
  "taksi kere",
  "tax kerak",
  "tak kerak",
  "takis kerak",
  "mashina kerak",
  "moshina kerak",
  "mashna kerak",
  "mashina kere",
  "moshina kere",
  "avto kerak",
  "transport kerak",
  "ulov kerak",
  "haydovchi kerak",
  "taksist kerak",
  "voditel kerak"
];

const PASSENGER_ACTIONS_LATIN = [
  "ketish kerak",
  "ketish kere",
  "ketishim kerak",
  "ketishim kere",
  "borish kerak",
  "borish kere",
  "borishim kerak",
  "borishim kere",
  "chiqish kerak",
  "chiqish kere",
  "yetib olish kerak",
  "yetib borish kerak",
  "manzilga borish kerak",
  "uyga ketish kerak",
  "ishxonaga borish kerak",
  "aeroportga borish kerak",
  "vokzalga borish kerak",
  "bozorga borish kerak",
  "shifoxonaga borish kerak"
];

const PASSENGER_QUESTIONS_LATIN = [
  "kim ketadi",
  "kim boradi",
  "kim yuradi",
  "kim chiqadi",
  "kim olib ketadi",
  "kim ob ketadi",
  "kim olib boradi",
  "kim yetkazadi",
  "boradigan bormi",
  "ketadigan bormi",
  "yuradigan bormi",
  "chiqadigan bormi",
  "olib ketadigan bormi",
  "ob ketadigan bormi",
  "op ketadigan bormi",
  "olib boradigan bormi",
  "joy bormi",
  "bitta joy bormi",
  "ikkita joy bormi",
  "kimda joy bor",
  "kimda joy bormi",
  "nechida ketadi",
  "qachon ketadi",
  "necha pul",
  "narxi qancha",
  "kira qancha",
  "yo'l kira qancha",
  "telefon tashang",
  "nomer tashang",
  "raqam tashang"
];

const PASSENGER_TIMES_LATIN = [
  "hozir",
  "hoziroq",
  "bugun",
  "ertaga",
  "ertalab",
  "tushda",
  "tushdan keyin",
  "kechqurun",
  "kechasi",
  "tunda",
  "saharda",
  "namozdan keyin",
  "tezda",
  "tezroq",
  "shoshilinch",
  "kechgacha",
  "soat 5 da",
  "soat 6 da",
  "soat 7 da",
  "soat 8 da",
  "soat 9 da",
  "soat 10 da",
  "soat 11 da",
  "soat 12 da"
];

const PASSENGER_SUBJECTS_CYRILLIC = [
  "мен",
  "менга",
  "биз",
  "бизга",
  "1 киши",
  "2 киши",
  "3 киши",
  "4 киши",
  "5 киши",
  "1 одам",
  "2 одам",
  "3 одам",
  "бир киши",
  "икки киши",
  "уч киши",
  "аёл киши",
  "эркак киши",
  "она бола",
  "оилавий",
  "йўловчи",
  "йуловчи",
  "пассажир",
  "пасажир"
];

const PASSENGER_NEEDS_CYRILLIC = [
  "такси керак",
  "такси кере",
  "такс керак",
  "такис керак",
  "машина керак",
  "мошина керак",
  "машна керак",
  "авто керак",
  "транспорт керак",
  "улов керак",
  "ҳайдовчи керак",
  "хайдовчи керак",
  "таксист керак",
  "водитель керак"
];

const PASSENGER_ACTIONS_CYRILLIC = [
  "кетиш керак",
  "кетиш кере",
  "кетишим керак",
  "бориш керак",
  "бориш кере",
  "боришим керак",
  "чиқиш керак",
  "манзилга бориш керак",
  "уйга кетиш керак",
  "аэропортга бориш керак",
  "вокзалга бориш керак",
  "бозорга бориш керак",
  "шифохонага бориш керак"
];

const PASSENGER_QUESTIONS_CYRILLIC = [
  "ким кетади",
  "ким боради",
  "ким юради",
  "ким чиқади",
  "ким олиб кетади",
  "ким об кетади",
  "ким олиб боради",
  "ким етказади",
  "борадиган борми",
  "кетадиган борми",
  "юрадиган борми",
  "чиқадиган борми",
  "олиб кетадиган борми",
  "об кетадиган борми",
  "жой борми",
  "битта жой борми",
  "иккита жой борми",
  "кимда жой бор",
  "нечада кетади",
  "қачон кетади",
  "неча пул",
  "нархи қанча",
  "кира қанча",
  "йўл кира қанча",
  "телефон ташанг",
  "номер ташанг",
  "рақам ташанг"
];

const DRIVER_SUBJECTS_LATIN = [
  "taxi",
  "taksi",
  "mashina",
  "mashin",
  "moshina",
  "moshin",
  "avto",
  "ulov",
  "haydovchi",
  "taksist",
  "voditel",
  "lacetti",
  "cobalt",
  "gentra",
  "nexia",
  "damas",
  "spark",
  "malibu",
  "onix",
  "captiva",
  "matiz",
  "miniven",
  "sedan",
  "yengil mashina"
];

const DRIVER_SERVICE_WORDS_LATIN = [
  "taxi xizmati",
  "taksi xizmati",
  "taxi hizmati",
  "taksi hizmati",
  "xizmat bor",
  "xizmat ko'rsatamiz",
  "xizmat korsatamiz",
  "xizmat qilamiz",
  "taksi bor",
  "taxi bor",
  "mashina bor",
  "mashin bor",
  "moshina bor",
  "moshin bor",
  "avto bor",
  "ulov bor",
  "bo'sh joy bor",
  "bosh joy bor",
  "joy bor",
  "joylar bor",
  "1 ta joy bor",
  "2 ta joy bor",
  "3 ta joy bor",
  "4 ta joy bor",
  "5 ta joy bor"
];

const DRIVER_ACTION_WORDS_LATIN = [
  "qatnaymiz",
  "qatnayman",
  "yuraman",
  "yuramiz",
  "boraman",
  "boramiz",
  "ketaman",
  "ketamiz",
  "chiqaman",
  "chiqamiz",
  "yo'lga chiqamiz",
  "yolga chiqamiz",
  "yo'ldamiz",
  "yoldamiz",
  "trassadamiz",
  "hozir chiqamiz",
  "bugun chiqamiz",
  "har kuni qatnaymiz",
  "har kuni yuramiz",
  "doimiy qatnaymiz",
  "doimiy reys",
  "reys bor",
  "zakaz olamiz",
  "buyurtma olamiz",
  "bron qiling",
  "olib boraman",
  "olib boramiz",
  "olib ketaman",
  "olib ketamiz",
  "yetkazib beramiz",
  "yetkazib qo'yamiz",
  "manzilga yetkazamiz",
  "uydan olib ketamiz",
  "uygacha olib boramiz",
  "eshikdan eshikkacha olib boramiz"
];

const DRIVER_CONTACT_WORDS_LATIN = [
  "murojaat uchun",
  "bog'lanish uchun",
  "boglanish uchun",
  "aloqa uchun",
  "tel",
  "telefon",
  "nomer",
  "raqam",
  "admin",
  "lichka",
  "lichkaga yozing",
  "dm",
  "inbox",
  "kerak bo'lsa yozing",
  "kerak bolsa yozing",
  "operator",
  "dispetcher"
];

const DRIVER_PROMO_WORDS_LATIN = [
  "24/7",
  "24 soat",
  "arzon narx",
  "kelishilgan narx",
  "qulay narx",
  "narx kelishiladi",
  "tez va qulay",
  "komfort",
  "konditsioner",
  "toza salon",
  "tajribali haydovchi",
  "ishonchli haydovchi",
  "litsenziyali",
  "yandex",
  "mytaxi",
  "taksometr",
  "park",
  "taksopark",
  "bonus",
  "foiz"
];

const DRIVER_WORDS_CYRILLIC = [
  "такси хизмати",
  "такси ҳизмати",
  "хизмат бор",
  "хизмат кўрсатамиз",
  "такси бор",
  "машина бор",
  "мошина бор",
  "бўш жой бор",
  "буш жой бор",
  "жой бор",
  "1 та жой бор",
  "2 та жой бор",
  "3 та жой бор",
  "4 та жой бор",
  "ҳар куни қатнаймиз",
  "хар куни катнаймиз",
  "қатнаймиз",
  "қатнайман",
  "юраман",
  "юрамиз",
  "бораман",
  "борамиз",
  "кетаман",
  "кетамиз",
  "чиқамиз",
  "йўлга чиқамиз",
  "йулга чикамиз",
  "йўлдамиз",
  "йулдамиз",
  "ҳозир чиқамиз",
  "бугун қатнаймиз",
  "доимий рейс",
  "рейс бор",
  "заказ оламиз",
  "буюртма оламиз",
  "брон қилинг",
  "олиб борамиз",
  "олиб кетамиз",
  "етказиб берамиз",
  "уйдан олиб кетамиз",
  "уйгача олиб борамиз",
  "мурожаат учун",
  "боғланиш учун",
  "алоқа учун",
  "тел",
  "телефон",
  "номер",
  "рақам",
  "админ",
  "личка",
  "керак бўлса ёзинг",
  "оператор",
  "диспетчер",
  "арзон нарх",
  "келишилган нарх",
  "қулай нарх",
  "комфорт",
  "кондиционер",
  "тажрибали ҳайдовчи",
  "ишончли ҳайдовчи",
  "ҳайдовчи",
  "хайдовчи",
  "водитель",
  "таксист",
  "таксопарк",
  "лацетти",
  "кобальт",
  "жентра",
  "нексия",
  "дамас",
  "спарк",
  "малибу",
  "оникс",
  "седан",
  "минивен"
];

const CARGO_WORDS = [
  "pochta",
  "posilka",
  "yuk",
  "dostavka",
  "yetkazma",
  "jo'natma",
  "jonatma",
  "paket",
  "hujjat",
  "sumka",
  "narsa",
  "pochta bor",
  "posilka bor",
  "yuk bor",
  "pochta ketadi",
  "posilka ketadi",
  "yuk ketadi",
  "pochta olib ketamiz",
  "posilka olib ketamiz",
  "yuk olib ketamiz",
  "pochta olib boramiz",
  "yuk tashish",
  "qayerdan",
  "qayerga",
  "yuboruvchi",
  "qabul qiluvchi",
  "kategoriya pochta",
  "kategoriya: pochta",
  "почта",
  "посилка",
  "груз",
  "почта бор",
  "посилка бор"
];

const SPAM_WORDS = [
  "kanalga obuna",
  "kanalga qoshb beraman",
  "kanalga qo'shib beraman",
  "obuna bo'ling",
  "obuna boling",
  "reklama",
  "reklama uchun",
  "elon berish",
  "e'lon berish",
  "admin bilan bog'laning",
  "ish bor",
  "vakansiya",
  "xodim kerak",
  "sotiladi",
  "arenda",
  "ijara",
  "uy sotiladi",
  "hovli sotiladi",
  "aksiya",
  "skidka",
  "promo",
  "instagram",
  "youtube",
  "tiktok",
  "botga start bosing",
  "pul ishlash",
  "karta",
  "plastik",
  "click",
  "payme",
  "uzum",
  "havola",
  "link",
  "http",
  "https",
  "t.me/",
  "@admin",
  "manba",
  "bizni kuzatib boring",
  "yangiliklar",
  "diqqat",
  "rasmiy kanal",
  "do'kon",
  "dokoni",
  "savdo",
  "chegirma",
  "muzika",
  "musiqa"
];

const AMBIGUOUS_WORDS = [
  "taxi",
  "taksi",
  "такси",
  "mashina",
  "moshina",
  "машина",
  "мошина",
  "joy",
  "жой",
  "ketadi",
  "кетади",
  "boradi",
  "боради",
  "guliston",
  "гулистон",
  "bekobod",
  "бекобод",
  "shirin",
  "ширин",
  "yangiyer",
  "янгийер",
  "toshkent",
  "тошкент",
  "sirdaryo",
  "сирдарё",
  "aloqa",
  "алоқа",
  "telefon",
  "телефон",
  "nomer",
  "номер",
  "narx",
  "нарх",
  "odam",
  "одам",
  "kishi",
  "киши",
  "reys",
  "рейс"
];

const PASSENGER_HIGH_WEIGHTS = new Map<string, number>([
  [n("joy bormi"), 8],
  [n("ketish kerak"), 8],
  [n("borish kerak"), 8],
  [n("1 kishi bor"), 8],
  [n("2 odam bor"), 8],
  [n("kim ketadi"), 7],
  [n("kategoriya yo'lovchi"), 10]
]);

const DRIVER_HIGH_WEIGHTS = new Map<string, number>([
  [n("taxi xizmati"), 10],
  [n("bo'sh joy bor"), 9],
  [n("har kuni qatnaymiz"), 10],
  [n("qatnaymiz"), 8],
  [n("murojaat uchun"), 6],
  [n("2 ta joy bor"), 8],
  [n("mashin bor"), 9],
  [n("moshin bor"), 9],
  [n("kerak bo'lsa yozing"), 7],
  [n("kategoriya yengil mashinalar"), 8]
]);

const CARGO_HIGH_WEIGHTS = new Map<string, number>([
  [n("pochta bor"), 8],
  [n("posilka bor"), 8],
  [n("yuk tashish"), 8],
  [n("kategoriya pochta"), 10]
]);

const SPAM_HIGH_WEIGHTS = new Map<string, number>([
  [n("obuna bo'ling"), 9],
  [n("reklama"), 8],
  [n("kanalga qoshb beraman"), 8],
  [n("kanalga qo'shib beraman"), 8],
  [n("muzika"), 7],
  [n("musiqa"), 7],
  [n("http"), 6],
  [n("t.me/"), 6],
  [n("sotiladi"), 5],
  [n("ish bor"), 5]
]);

const PASSENGER_MANUAL_EXPANSION: Array<{ phrase: string; weight: number }> = [
  { phrase: "taxi kk", weight: 9 },
  { phrase: "taksi kk", weight: 9 },
  { phrase: "taxii kk", weight: 9 },
  { phrase: "taksi krk", weight: 9 },
  { phrase: "menga taxi kerak", weight: 9 },
  { phrase: "menga taksi kerak", weight: 9 },
  { phrase: "bizga taxi kerak", weight: 9 },
  { phrase: "bizga taksi kerak", weight: 9 },
  { phrase: "taxi topish kerak", weight: 9 },
  { phrase: "taksi topish kerak", weight: 9 },
  { phrase: "mashina topish kerak", weight: 9 },
  { phrase: "hozir ketish kerak", weight: 9 },
  { phrase: "tezda ketish kerak", weight: 9 },
  { phrase: "tezroq ketish kerak", weight: 9 },
  { phrase: "shoshilinch ketish kerak", weight: 9 },
  { phrase: "shoshilinch taksi kerak", weight: 9 },
  { phrase: "olib ketadigan bormi", weight: 8 },
  { phrase: "ob ketadigan bormi", weight: 8 },
  { phrase: "op ketadigan bormi", weight: 8 },
  { phrase: "olib boradigan bormi", weight: 8 },
  { phrase: "kim olib ketadi", weight: 8 },
  { phrase: "kim ob ketadi", weight: 8 },
  { phrase: "kim olib boradi", weight: 8 },
  { phrase: "kim boradi", weight: 8 },
  { phrase: "kim ketadi", weight: 8 },
  { phrase: "joy bormi", weight: 10 },
  { phrase: "joy bormi?", weight: 10 },
  { phrase: "bo'sh joy bormi", weight: 8 },
  { phrase: "bosh joy bormi", weight: 8 },
  { phrase: "bitta joy bormi", weight: 8 },
  { phrase: "ikkita joy bormi", weight: 8 },
  { phrase: "kimda joy bor", weight: 8 },
  { phrase: "kimda joy bormi", weight: 8 },
  { phrase: "1 kishi bor", weight: 10 },
  { phrase: "2 kishi bor", weight: 10 },
  { phrase: "1 odam bor", weight: 10 },
  { phrase: "2 odam bor", weight: 10 },
  { phrase: "yo'lovchi bor", weight: 8 },
  { phrase: "yolovchi bor", weight: 8 },
  { phrase: "yulovchi bor", weight: 8 },
  { phrase: "passajir bor", weight: 8 },
  { phrase: "pasajir bor", weight: 8 },
  { phrase: "poputchik bormi", weight: 7 },
  { phrase: "poputka bormi", weight: 7 },
  { phrase: "nechida ketadi", weight: 7 },
  { phrase: "qachon ketadi", weight: 7 },
  { phrase: "narxi qancha", weight: 6 },
  { phrase: "necha pul", weight: 6 },
  { phrase: "yo'l kira qancha", weight: 6 },
  { phrase: "kira qancha", weight: 6 },
  { phrase: "telefon tashang", weight: 7 },
  { phrase: "nomer tashang", weight: 7 },
  { phrase: "raqam tashang", weight: 7 }
];

const DRIVER_MANUAL_EXPANSION: Array<{ phrase: string; weight: number }> = [
  { phrase: "taxi xizmati", weight: 10 },
  { phrase: "taksi xizmati", weight: 10 },
  { phrase: "taxi hizmati", weight: 10 },
  { phrase: "taksi hizmati", weight: 10 },
  { phrase: "xizmat bor", weight: 8 },
  { phrase: "xizmat ko'rsatamiz", weight: 8 },
  { phrase: "xizmat korsatamiz", weight: 8 },
  { phrase: "xizmat qilamiz", weight: 8 },
  { phrase: "bo'sh joy bor", weight: 10 },
  { phrase: "bosh joy bor", weight: 10 },
  { phrase: "mashin bor", weight: 10 },
  { phrase: "moshin bor", weight: 10 },
  { phrase: "2 ta joy bor", weight: 10 },
  { phrase: "har kuni qatnaymiz", weight: 10 },
  { phrase: "har kuni yuramiz", weight: 9 },
  { phrase: "doimiy qatnaymiz", weight: 9 },
  { phrase: "qatnaymiz", weight: 9 },
  { phrase: "yuramiz", weight: 8 },
  { phrase: "boramiz", weight: 8 },
  { phrase: "ketamiz", weight: 8 },
  { phrase: "yo'lga chiqamiz", weight: 8 },
  { phrase: "yolga chiqamiz", weight: 8 },
  { phrase: "yo'ldamiz", weight: 8 },
  { phrase: "yoldamiz", weight: 8 },
  { phrase: "trassadamiz", weight: 8 },
  { phrase: "reys bor", weight: 8 },
  { phrase: "zakaz olamiz", weight: 8 },
  { phrase: "buyurtma olamiz", weight: 8 },
  { phrase: "buyurtma qabul qilamiz", weight: 8 },
  { phrase: "olib ketamiz", weight: 8 },
  { phrase: "olib boramiz", weight: 8 },
  { phrase: "yetkazib beramiz", weight: 8 },
  { phrase: "murojaat uchun", weight: 9 },
  { phrase: "bog'lanish uchun", weight: 8 },
  { phrase: "aloqa uchun", weight: 8 },
  { phrase: "kerak bo'lsa yozing", weight: 8 },
  { phrase: "kerak bolsa yozing", weight: 8 },
  { phrase: "operator", weight: 7 },
  { phrase: "dispetcher", weight: 7 },
  { phrase: "24/7", weight: 7 },
  { phrase: "24 soat", weight: 7 },
  { phrase: "arzon narx", weight: 7 },
  { phrase: "kelishilgan narx", weight: 7 },
  { phrase: "qulay narx", weight: 7 },
  { phrase: "narx kelishiladi", weight: 7 },
  { phrase: "tez va qulay", weight: 7 },
  { phrase: "komfort", weight: 6 },
  { phrase: "konditsioner", weight: 6 },
  { phrase: "toza salon", weight: 6 },
  { phrase: "tajribali haydovchi", weight: 7 },
  { phrase: "ishonchli haydovchi", weight: 7 },
  { phrase: "taxist", weight: 7 },
  { phrase: "taksopark", weight: 6 },
  { phrase: "lacetti", weight: 6 },
  { phrase: "lasetti", weight: 6 },
  { phrase: "cobalt", weight: 6 },
  { phrase: "koblt", weight: 6 },
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
  { phrase: "yengil mashina", weight: 6 }
];

const CARGO_MANUAL_EXPANSION: Array<{ phrase: string; weight: number }> = [
  { phrase: "pochta", weight: 7 },
  { phrase: "pochta bor", weight: 10 },
  { phrase: "pochta ketadi", weight: 8 },
  { phrase: "pochta olib ketamiz", weight: 9 },
  { phrase: "pochta olib boramiz", weight: 9 },
  { phrase: "posilka", weight: 7 },
  { phrase: "posilka bor", weight: 10 },
  { phrase: "posilka ketadi", weight: 8 },
  { phrase: "yuk", weight: 7 },
  { phrase: "yuk bor", weight: 9 },
  { phrase: "yuk ketadi", weight: 8 },
  { phrase: "yuk tashish", weight: 10 },
  { phrase: "dostavka", weight: 8 },
  { phrase: "yetkazma", weight: 8 },
  { phrase: "jo'natma", weight: 8 },
  { phrase: "jonatma", weight: 8 },
  { phrase: "yuboruvchi", weight: 8 },
  { phrase: "qabul qiluvchi", weight: 8 },
  { phrase: "kategoriya pochta", weight: 10 },
  { phrase: "kategoriya: pochta", weight: 10 }
];

const SPAM_MANUAL_EXPANSION: Array<{ phrase: string; weight: number }> = [
  { phrase: "kanalga obuna", weight: 8 },
  { phrase: "kanalga qoshb beraman", weight: 8 },
  { phrase: "kanalga qo'shib beraman", weight: 8 },
  { phrase: "obuna bo'ling", weight: 10 },
  { phrase: "obuna boling", weight: 10 },
  { phrase: "reklama", weight: 9 },
  { phrase: "reklama uchun", weight: 8 },
  { phrase: "elon berish", weight: 8 },
  { phrase: "e'lon berish", weight: 8 },
  { phrase: "admin bilan bog'laning", weight: 8 },
  { phrase: "ish bor", weight: 6 },
  { phrase: "vakansiya", weight: 6 },
  { phrase: "xodim kerak", weight: 6 },
  { phrase: "sotiladi", weight: 7 },
  { phrase: "arenda", weight: 6 },
  { phrase: "ijara", weight: 6 },
  { phrase: "uy sotiladi", weight: 7 },
  { phrase: "hovli sotiladi", weight: 7 },
  { phrase: "aksiya", weight: 7 },
  { phrase: "skidka", weight: 7 },
  { phrase: "promo", weight: 7 },
  { phrase: "instagram", weight: 7 },
  { phrase: "youtube", weight: 7 },
  { phrase: "tiktok", weight: 7 },
  { phrase: "muzika", weight: 8 },
  { phrase: "musiqa", weight: 8 },
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
  { phrase: "bizni kuzatib boring", weight: 8 },
  { phrase: "yangiliklar", weight: 6 },
  { phrase: "diqqat", weight: 6 },
  { phrase: "rasmiy kanal", weight: 8 },
  { phrase: "do'kon", weight: 6 },
  { phrase: "dokoni", weight: 6 },
  { phrase: "savdo", weight: 6 },
  { phrase: "chegirma", weight: 7 }
];

function n(value: string): string {
  return baseNormalizePhrase(value);
}

export function normalizePhrase(phrase: string): string {
  return n(phrase);
}

function highWeightFor(category: KeywordCategory, normalized: string, fallback: number): number {
  if (category === KeywordCategory.PASSENGER) {
    return PASSENGER_HIGH_WEIGHTS.get(normalized) ?? fallback;
  }

  if (category === KeywordCategory.DRIVER) {
    return DRIVER_HIGH_WEIGHTS.get(normalized) ?? fallback;
  }

  if (category === KeywordCategory.CARGO) {
    return CARGO_HIGH_WEIGHTS.get(normalized) ?? fallback;
  }

  if (category === KeywordCategory.SPAM) {
    return SPAM_HIGH_WEIGHTS.get(normalized) ?? fallback;
  }

  return fallback;
}

function addKeyword(
  category: KeywordCategory,
  phrase: string,
  weight = 1,
  language?: KeywordLanguage,
  matchType: KeywordMatchType = KeywordMatchType.PHRASE,
  source = "generated"
): void {
  const raw = phrase.trim();
  if (!raw) {
    return;
  }

  const normalized = normalizePhrase(raw);
  if (!normalized) {
    return;
  }

  const finalWeight = highWeightFor(category, normalized, Math.max(1, Math.round(weight)));
  const finalLanguage = language ?? (detectKeywordLanguage(raw) as KeywordLanguage);
  const key = `${category}::${normalized}`;
  const existing = keywordMap.get(key);

  if (!existing) {
    keywordMap.set(key, {
      phrase: raw,
      normalized,
      category,
      weight: finalWeight,
      language: finalLanguage,
      matchType,
      source
    });
    return;
  }

  if (finalWeight > existing.weight) {
    existing.weight = finalWeight;
  }

  if (raw.length < existing.phrase.length) {
    existing.phrase = raw;
  }

  existing.language = finalLanguage;
  existing.matchType = matchType;
  existing.source = source;
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

export function generateRoutePhrases(): void {
  for (const pair of routePairs(LOCATIONS_LATIN)) {
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}dan ${pair.to}ga`, 6);
    addKeyword(KeywordCategory.DRIVER, `${pair.from}dan ${pair.to}ga bo'sh joy bor`, 8);
    addKeyword(KeywordCategory.CARGO, `${pair.from}dan ${pair.to}ga yuk`, 7);
  }

  for (const pair of routePairs(LOCATIONS_CYRILLIC)) {
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}дан ${pair.to}га`, 6, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.DRIVER, `${pair.from}дан ${pair.to}га бўш жой бор`, 8, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.CARGO, `${pair.from}дан ${pair.to}га юк`, 7, KeywordLanguage.CYRILLIC);
  }
}

function generatePassengerPhrases(): void {
  for (const subject of PASSENGER_SUBJECTS_LATIN) {
    for (const need of PASSENGER_NEEDS_LATIN) {
      addKeyword(KeywordCategory.PASSENGER, `${subject} ${need}`, 5);
    }
    for (const action of PASSENGER_ACTIONS_LATIN) {
      addKeyword(KeywordCategory.PASSENGER, `${subject} ${action}`, 5);
    }
  }

  for (const question of PASSENGER_QUESTIONS_LATIN) {
    addKeyword(KeywordCategory.PASSENGER, question, 6);
  }

  for (const timeWord of PASSENGER_TIMES_LATIN) {
    for (const action of PASSENGER_ACTIONS_LATIN) {
      addKeyword(KeywordCategory.PASSENGER, `${timeWord} ${action}`, 4);
    }
    for (const need of PASSENGER_NEEDS_LATIN) {
      addKeyword(KeywordCategory.PASSENGER, `${timeWord} ${need}`, 4);
    }
  }

  for (const pair of routePairs(LOCATIONS_LATIN)) {
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}dan ${pair.to}ga taxi kerak`, 6);
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}dan ${pair.to}ga borish kerak`, 8);
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}dan ${pair.to}ga kim ketadi`, 7);
  }

  for (const subject of PASSENGER_SUBJECTS_CYRILLIC) {
    for (const need of PASSENGER_NEEDS_CYRILLIC) {
      addKeyword(KeywordCategory.PASSENGER, `${subject} ${need}`, 5, KeywordLanguage.CYRILLIC);
    }
    for (const action of PASSENGER_ACTIONS_CYRILLIC) {
      addKeyword(KeywordCategory.PASSENGER, `${subject} ${action}`, 5, KeywordLanguage.CYRILLIC);
    }
  }

  for (const question of PASSENGER_QUESTIONS_CYRILLIC) {
    addKeyword(KeywordCategory.PASSENGER, question, 6, KeywordLanguage.CYRILLIC);
  }

  for (const pair of routePairs(LOCATIONS_CYRILLIC)) {
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}дан ${pair.to}га такси керак`, 6, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.PASSENGER, `${pair.from}дан ${pair.to}га бориш керак`, 8, KeywordLanguage.CYRILLIC);
  }
}

function generateDriverPhrases(): void {
  for (const subject of DRIVER_SUBJECTS_LATIN) {
    for (const service of DRIVER_SERVICE_WORDS_LATIN) {
      addKeyword(KeywordCategory.DRIVER, `${subject} ${service}`, 6);
    }
    for (const action of DRIVER_ACTION_WORDS_LATIN) {
      addKeyword(KeywordCategory.DRIVER, `${subject} ${action}`, 6);
    }
  }

  for (const action of DRIVER_ACTION_WORDS_LATIN) {
    for (const contact of DRIVER_CONTACT_WORDS_LATIN) {
      addKeyword(KeywordCategory.DRIVER, `${action} ${contact}`, 6);
    }
  }

  for (const promo of DRIVER_PROMO_WORDS_LATIN) {
    for (const service of DRIVER_SERVICE_WORDS_LATIN) {
      addKeyword(KeywordCategory.DRIVER, `${promo} ${service}`, 5);
    }
  }

  for (const pair of routePairs(LOCATIONS_LATIN)) {
    addKeyword(KeywordCategory.DRIVER, `${pair.from}dan ${pair.to}ga bo'sh joy bor`, 9);
    addKeyword(KeywordCategory.DRIVER, `${pair.from}dan ${pair.to}ga 2 ta joy bor`, 8);
    addKeyword(KeywordCategory.DRIVER, `${pair.from}dan ${pair.to}ga qatnaymiz`, 8);
  }

  for (const phrase of DRIVER_WORDS_CYRILLIC) {
    addKeyword(KeywordCategory.DRIVER, phrase, 6, KeywordLanguage.CYRILLIC);
  }

  for (const pair of routePairs(LOCATIONS_CYRILLIC)) {
    addKeyword(KeywordCategory.DRIVER, `${pair.from}дан ${pair.to}га бўш жой бор`, 9, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.DRIVER, `${pair.from}дан ${pair.to}га 2 та жой бор`, 8, KeywordLanguage.CYRILLIC);
  }
}

function generateCargoPhrases(): void {
  for (const pair of routePairs(LOCATIONS_LATIN)) {
    addKeyword(KeywordCategory.CARGO, `${pair.from}dan ${pair.to}ga pochta bor`, 8);
    addKeyword(KeywordCategory.CARGO, `${pair.from}dan ${pair.to}ga posilka bor`, 8);
    addKeyword(KeywordCategory.CARGO, `${pair.from}dan ${pair.to}ga yuk bor`, 8);
    addKeyword(KeywordCategory.CARGO, `${pair.from}dan ${pair.to}ga pochta ketadi`, 7);
    addKeyword(KeywordCategory.CARGO, `${pair.from} ${pair.to} pochta`, 6);
  }

  for (const pair of routePairs(LOCATIONS_CYRILLIC)) {
    addKeyword(KeywordCategory.CARGO, `${pair.from}дан ${pair.to}га почта бор`, 8, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.CARGO, `${pair.from}дан ${pair.to}га посилка бор`, 8, KeywordLanguage.CYRILLIC);
    addKeyword(KeywordCategory.CARGO, `${pair.from}дан ${pair.to}га юк бор`, 8, KeywordLanguage.CYRILLIC);
  }

  for (const phrase of CARGO_WORDS) {
    addKeyword(KeywordCategory.CARGO, phrase, 6);
  }
}

function generateSpamPhrases(): void {
  const spamTemplates = [
    "{word}",
    "{word} uchun yozing",
    "{word} link",
    "{word} kanal",
    "{word} bugun",
    "{word} hozir",
    "{word} promo",
    "{word} chegirma",
    "{word} admin",
    "{word} havola",
    "{word} narxi",
    "{word} sotuv",
    "{word} obuna"
  ];

  for (const word of SPAM_WORDS) {
    addKeyword(KeywordCategory.SPAM, word, 6);
    for (const template of spamTemplates) {
      addKeyword(KeywordCategory.SPAM, template.replace("{word}", word), 5);
    }
  }

  const spamByLocation = ["obuna bo'ling", "reklama", "aksiya", "sotiladi", "vakansiya", "ish bor"];
  for (const location of LOCATIONS_LATIN) {
    for (const spamWord of spamByLocation) {
      addKeyword(KeywordCategory.SPAM, `${location} ${spamWord}`, 5);
      addKeyword(KeywordCategory.SPAM, `${spamWord} ${location}`, 5);
    }
  }
}

function generateAmbiguousPhrases(): void {
  for (const word of AMBIGUOUS_WORDS) {
    addKeyword(KeywordCategory.AMBIGUOUS, word, 3);
  }

  for (const location of [...LOCATIONS_LATIN, ...LOCATIONS_CYRILLIC]) {
    addKeyword(KeywordCategory.AMBIGUOUS, `${location} narx`, 3);
    addKeyword(KeywordCategory.AMBIGUOUS, `${location} telefon`, 3);
    addKeyword(KeywordCategory.AMBIGUOUS, `${location} aloqa`, 3);
  }
}

function addManualExpansionKeywords(): void {
  for (const item of PASSENGER_MANUAL_EXPANSION) {
    addKeyword(KeywordCategory.PASSENGER, item.phrase, item.weight, undefined, KeywordMatchType.PHRASE, "generated-manual");
  }

  for (const item of DRIVER_MANUAL_EXPANSION) {
    addKeyword(KeywordCategory.DRIVER, item.phrase, item.weight, undefined, KeywordMatchType.PHRASE, "generated-manual");
  }

  for (const item of CARGO_MANUAL_EXPANSION) {
    addKeyword(KeywordCategory.CARGO, item.phrase, item.weight, undefined, KeywordMatchType.PHRASE, "generated-manual");
  }

  for (const item of SPAM_MANUAL_EXPANSION) {
    addKeyword(KeywordCategory.SPAM, item.phrase, item.weight, undefined, KeywordMatchType.PHRASE, "generated-manual");
  }
}

function generateRegexKeywords(): void {
  const patterns: Array<{ category: KeywordCategory; pattern: string; weight: number }> = [
    { category: KeywordCategory.PASSENGER, pattern: "\\b\\d+\\s*(kishi|odam|та киши|та одам)\\s*(bor|бор)\\b", weight: 8 },
    {
      category: KeywordCategory.PASSENGER,
      pattern: "\\b(bir|ikki|uch|tort|to'rt|бир|икки|уч|тўрт)\\s*(kishi|odam|киши|одам)\\s*(bor|бор)\\b",
      weight: 8
    },
    { category: KeywordCategory.PASSENGER, pattern: "\\b\\w+\\s*dan\\s+\\w+\\s*ga\\b", weight: 6 },
    { category: KeywordCategory.PASSENGER, pattern: "\\b\\w+\\s*дан\\s+\\w+\\s*га\\b", weight: 6 },
    { category: KeywordCategory.PASSENGER, pattern: "\\b(ketish|borish|chiqish)\\s*(kerak|kere)\\b", weight: 8 },
    { category: KeywordCategory.PASSENGER, pattern: "\\b(кетиш|бориш|чиқиш)\\s*(керак|кере)\\b", weight: 8 },
    { category: KeywordCategory.PASSENGER, pattern: "\\bjoy\\s*bormi\\??\\b", weight: 8 },
    { category: KeywordCategory.PASSENGER, pattern: "\\bжой\\s*борми\\??\\b", weight: 8 },
    { category: KeywordCategory.PASSENGER, pattern: "\\b(kim|ким)\\s*(ketadi|boradi|olib ketadi|кетади|боради|олиб кетади)\\b", weight: 7 },
    { category: KeywordCategory.DRIVER, pattern: "\\b(bo'?sh|bosh|бўш|буш)\\s*(joy|жой)\\s*(bor|бор)\\b", weight: 9 },
    { category: KeywordCategory.DRIVER, pattern: "\\b\\d+\\s*ta\\s*(joy|жой)\\s*(bor|бор)\\b", weight: 8 },
    { category: KeywordCategory.DRIVER, pattern: "\\b\\d+\\s*та\\s*жой\\s*бор\\b", weight: 8 },
    { category: KeywordCategory.DRIVER, pattern: "\\b(har kuni|хар куни|ҳар куни)\\s*(qatnaymiz|yuramiz|юрамиз|қатнаймиз|катнаймиз)\\b", weight: 10 },
    { category: KeywordCategory.DRIVER, pattern: "\\b(murojaat|мурожаат)\\s*(uchun|учун)\\b", weight: 6 },
    { category: KeywordCategory.DRIVER, pattern: "\\b(tel|тел|telefon|телефон|nomer|номер)\\s*[:\\-]?\\s*\\+?\\d\\b", weight: 6 },
    { category: KeywordCategory.DRIVER, pattern: "\\b(kerak bo'?lsa|керак бўлса|керак булса)\\s*(yozing|ёзинг)\\b", weight: 7 },
    {
      category: KeywordCategory.DRIVER,
      pattern: "\\b(?:odam|yo'?lovchi|yolovchi|yulovchi|pochta|yuk)\\b.{0,25}\\bbo'?lsa\\b.{0,25}\\b(?:olaman|olamiz|olamz)\\b",
      weight: 9
    },
    {
      category: KeywordCategory.DRIVER,
      pattern: "\\b(?:yuraman|yuramiz|ketaman|ketamiz|chiqaman|chiqamiz)\\b.{0,35}\\b(?:odam|yo'?lovchi|yolovchi|yulovchi|pochta|yuk)\\b.{0,25}\\b(?:olaman|olamiz|olamz)\\b",
      weight: 9
    },
    {
      category: KeywordCategory.DRIVER,
      pattern: "\\b(?:taxi|taksi)\\b.{0,30}\\bbor\\b.{0,30}\\b(?:kishi|odam)\\b(?:.{0,20}\\bbo'?lsa\\b)?(?:.{0,30}\\b(?:olib|ob)\\s*ket(?:aman|amiz|amz)\\b)",
      weight: 10
    },
    { category: KeywordCategory.PASSENGER, pattern: "\\b(?:taxi|taksi|taxii|taksii|takis)\\s*(?:kk|krk|kerak|kere)\\b", weight: 9 },
    { category: KeywordCategory.CARGO, pattern: "\\b(qayerdan|қаердан)\\b.*\\b(qayerga|қаерга)\\b", weight: 7 },
    { category: KeywordCategory.CARGO, pattern: "\\b(yuboruvchi|юборувчи)\\b.*\\b(qabul qiluvchi|қабул қилувчи)\\b", weight: 7 },
    { category: KeywordCategory.CARGO, pattern: "\\b(kategoriya|категория)\\s*[:\\-]?\\s*(pochta|почта)\\b", weight: 10 }
  ];

  for (const item of patterns) {
    addKeyword(item.category, item.pattern, item.weight, KeywordLanguage.MIXED, KeywordMatchType.REGEX, "generated-regex");
  }
}

function countByCategory(records: CandidateKeyword[]): Record<CategoryKey, number> {
  const counts: Record<CategoryKey, number> = {
    passenger: 0,
    driver: 0,
    cargo: 0,
    spam: 0,
    ambiguous: 0
  };

  for (const record of records) {
    if (record.category === KeywordCategory.PASSENGER) {
      counts.passenger += 1;
    } else if (record.category === KeywordCategory.DRIVER) {
      counts.driver += 1;
    } else if (record.category === KeywordCategory.CARGO) {
      counts.cargo += 1;
    } else if (record.category === KeywordCategory.SPAM) {
      counts.spam += 1;
    } else {
      counts.ambiguous += 1;
    }
  }

  return counts;
}

function chunk<T>(items: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    result.push(items.slice(i, i + size));
  }

  return result;
}

async function upsertAll(prismaClient: PrismaClient, records: CandidateKeyword[]): Promise<{ inserted: number; updated: number }> {
  const existingRows = await prismaClient.keywordDictionary.findMany({
    select: {
      normalized: true,
      category: true
    }
  });

  const existing = new Set(existingRows.map((row) => `${row.category}::${row.normalized}`));
  let inserted = 0;
  let updated = 0;

  for (const part of chunk(records, 200)) {
    for (const item of part) {
      const key = `${item.category}::${item.normalized}`;
      if (existing.has(key)) {
        updated += 1;
      } else {
        inserted += 1;
        existing.add(key);
      }

      await prismaClient.keywordDictionary.upsert({
        where: {
          normalized_category: {
            normalized: item.normalized,
            category: item.category
          }
        },
        create: {
          phrase: item.phrase,
          normalized: item.normalized,
          category: item.category,
          weight: item.weight,
          language: item.language,
          matchType: item.matchType,
          source: item.source,
          isActive: true
        },
        update: {
          phrase: item.phrase,
          weight: item.weight,
          language: item.language,
          matchType: item.matchType,
          source: item.source,
          isActive: true
        }
      });
    }
  }

  return { inserted, updated };
}

function buildCandidates(): CandidateKeyword[] {
  keywordMap.clear();
  generateRoutePhrases();
  generatePassengerPhrases();
  generateDriverPhrases();
  generateCargoPhrases();
  generateSpamPhrases();
  generateAmbiguousPhrases();
  addManualExpansionKeywords();
  generateRegexKeywords();
  return [...keywordMap.values()];
}

export async function seedKeywordDictionary(): Promise<{
  counts: Record<CategoryKey, number>;
  inserted: number;
  updated: number;
  total: number;
}> {
  return seedKeywordDictionaryWithClient(defaultPrisma);
}

export async function seedKeywordDictionaryWithClient(prismaClient: PrismaClient): Promise<{
  counts: Record<CategoryKey, number>;
  inserted: number;
  updated: number;
  total: number;
}> {
  const generated = buildCandidates();
  const counts = countByCategory(generated);
  await prismaClient.keywordDictionary.updateMany({
    where: {
      source: { in: ["generated", "generated-regex", "generated-manual"] }
    },
    data: { isActive: false }
  });
  const { inserted, updated } = await upsertAll(prismaClient, generated);

  return {
    counts,
    inserted,
    updated,
    total: inserted + updated
  };
}

async function main(): Promise<void> {
  const result = await seedKeywordDictionaryWithClient(defaultPrisma);
  console.log(`passenger keywords count: ${result.counts.passenger}`);
  console.log(`driver keywords count: ${result.counts.driver}`);
  console.log(`cargo keywords count: ${result.counts.cargo}`);
  console.log(`spam keywords count: ${result.counts.spam}`);
  console.log(`ambiguous keywords count: ${result.counts.ambiguous}`);
  console.log(`total inserted/upserted: ${result.total} (inserted=${result.inserted}, updated=${result.updated})`);
}

const entryFile = process.argv[1];
if (entryFile && entryFile.endsWith("seed-keywords.ts")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await defaultPrisma.$disconnect();
    });
}
