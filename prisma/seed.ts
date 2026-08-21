import dotenv from "dotenv";
import { KeywordType, PrismaClient } from "@prisma/client";
import { DEFAULT_KEYWORDS } from "../src/config/defaultKeywords.js";
import { normalizeUzbekText } from "../src/utils/text.js";
import { seedKeywordDictionaryWithClient } from "./seed-keywords.js";

dotenv.config({ override: true });

const prisma = new PrismaClient();

async function upsertMany(words: readonly string[], type: KeywordType): Promise<void> {
  for (const rawWord of words) {
    const word = normalizeUzbekText(rawWord);

    await prisma.keyword.upsert({
      where: { word },
      create: { word, type, isActive: true },
      update: { type, isActive: true }
    });
  }
}

async function seedRuntimeConfigs(): Promise<void> {
  const e = process.env;

  // Barcha kerakli runtime config keylar va ularning .env qiymatlari
  const configs: Record<string, string> = {
    // === PASSENGER CHAT IDs (region bo'yicha) ===
    PASSENGER_CHAT_IDS: e.PASSENGER_CHAT_IDS || e.SOURCE_CHAT_IDS || "",
    SOURCE_CHAT_IDS: e.SOURCE_CHAT_IDS || e.PASSENGER_CHAT_IDS || "",
    PASSENGER_CHAT_IDS_TASHKENT: e.PASSENGER_CHAT_IDS_TASHKENT || "",
    PASSENGER_CHAT_IDS_GULISTON: e.PASSENGER_CHAT_IDS_GULISTON || "",
    PASSENGER_CHAT_IDS_KOMSOMOL: e.PASSENGER_CHAT_IDS_KOMSOMOL || "",
    PASSENGER_CHAT_IDS_ANDIJON: e.PASSENGER_CHAT_IDS_ANDIJON || "",

    // === PASSENGER CHAT USERNAMES (region bo'yicha) ===
    PASSENGER_CHAT_USERNAMES: e.PASSENGER_CHAT_USERNAMES || "",
    PASSENGER_CHAT_USERNAMES_TASHKENT:
      e.PASSENGER_CHAT_USERNAMES_TASHKENT ||
      "guliston_bekabod_xovos_yangiyer,SHIRIN_N1_TOSHKENT,bekobod_chirchiqdagibekobodlilar,ToshkentBekobod_Shirin,navoiy777galaba",
    PASSENGER_CHAT_USERNAMES_GULISTON:
      e.PASSENGER_CHAT_USERNAMES_GULISTON ||
      "Bekobod_Shirin_Guliston_taxi,ShirinTaksi,Guliston_Bekobod_taksi,guliston_bekabod_xovos",
    PASSENGER_CHAT_USERNAMES_KOMSOMOL: e.PASSENGER_CHAT_USERNAMES_KOMSOMOL || "",
    PASSENGER_CHAT_USERNAMES_ANDIJON: e.PASSENGER_CHAT_USERNAMES_ANDIJON || "",

    // === DRIVER CHAT IDs (region bo'yicha) ===
    DRIVER_CHAT_ID: e.DRIVER_CHAT_ID || "-1004453401746",
    DRIVER_CHAT_ID_TASHKENT: e.DRIVER_CHAT_ID_TASHKENT || "-1004447414662",
    DRIVER_CHAT_ID_GULISTON: e.DRIVER_CHAT_ID_GULISTON || "-1004453401746",
    DRIVER_CHAT_ID_KOMSOMOL: e.DRIVER_CHAT_ID_KOMSOMOL || "-1003872057304",
    DRIVER_CHAT_ID_ANDIJON: e.DRIVER_CHAT_ID_ANDIJON || "-1003740829119",

    // === PASSENGER_GROUP_AUTO_REPLIES (global + region) ===
    PASSENGER_GROUP_AUTO_REPLIES: e.PASSENGER_GROUP_AUTO_REPLIES || "false",
    PASSENGER_GROUP_AUTO_REPLIES_TASHKENT: e.PASSENGER_GROUP_AUTO_REPLIES_TASHKENT || "",
    PASSENGER_GROUP_AUTO_REPLIES_GULISTON: e.PASSENGER_GROUP_AUTO_REPLIES_GULISTON || "",
    PASSENGER_GROUP_AUTO_REPLIES_KOMSOMOL: e.PASSENGER_GROUP_AUTO_REPLIES_KOMSOMOL || "",
    PASSENGER_GROUP_AUTO_REPLIES_ANDIJON: e.PASSENGER_GROUP_AUTO_REPLIES_ANDIJON || "",

    // === SEND_PRIVATE_ACK_TO_PASSENGER (global + region) ===
    SEND_PRIVATE_ACK_TO_PASSENGER: e.SEND_PRIVATE_ACK_TO_PASSENGER || "false",
    SEND_PRIVATE_ACK_TO_PASSENGER_TASHKENT: e.SEND_PRIVATE_ACK_TO_PASSENGER_TASHKENT || "",
    SEND_PRIVATE_ACK_TO_PASSENGER_GULISTON: e.SEND_PRIVATE_ACK_TO_PASSENGER_GULISTON || "",
    SEND_PRIVATE_ACK_TO_PASSENGER_KOMSOMOL: e.SEND_PRIVATE_ACK_TO_PASSENGER_KOMSOMOL || "",
    SEND_PRIVATE_ACK_TO_PASSENGER_ANDIJON: e.SEND_PRIVATE_ACK_TO_PASSENGER_ANDIJON || "",

    // === DELETE_SOURCE_MESSAGE_IF_ADMIN (global + region) ===
    DELETE_SOURCE_MESSAGE_IF_ADMIN: e.DELETE_SOURCE_MESSAGE_IF_ADMIN || "false",
    DELETE_SOURCE_MESSAGE_IF_ADMIN_TASHKENT: e.DELETE_SOURCE_MESSAGE_IF_ADMIN_TASHKENT || "",
    DELETE_SOURCE_MESSAGE_IF_ADMIN_GULISTON: e.DELETE_SOURCE_MESSAGE_IF_ADMIN_GULISTON || "",
    DELETE_SOURCE_MESSAGE_IF_ADMIN_KOMSOMOL: e.DELETE_SOURCE_MESSAGE_IF_ADMIN_KOMSOMOL || "",
    DELETE_SOURCE_MESSAGE_IF_ADMIN_ANDIJON: e.DELETE_SOURCE_MESSAGE_IF_ADMIN_ANDIJON || "",

    // === DELETE_IGNORED_MESSAGE_IF_ADMIN (global + region) ===
    DELETE_IGNORED_MESSAGE_IF_ADMIN: e.DELETE_IGNORED_MESSAGE_IF_ADMIN || "false",
    DELETE_IGNORED_MESSAGE_IF_ADMIN_TASHKENT: e.DELETE_IGNORED_MESSAGE_IF_ADMIN_TASHKENT || "",
    DELETE_IGNORED_MESSAGE_IF_ADMIN_GULISTON: e.DELETE_IGNORED_MESSAGE_IF_ADMIN_GULISTON || "",
    DELETE_IGNORED_MESSAGE_IF_ADMIN_KOMSOMOL: e.DELETE_IGNORED_MESSAGE_IF_ADMIN_KOMSOMOL || "",
    DELETE_IGNORED_MESSAGE_IF_ADMIN_ANDIJON: e.DELETE_IGNORED_MESSAGE_IF_ADMIN_ANDIJON || "",

    // === Boshqa sozlamalar ===
    SEND_DRIVER_AD_WARNINGS: e.SEND_DRIVER_AD_WARNINGS || "false",
    USERBOT_READ_ONLY: e.USERBOT_READ_ONLY || "true"
  };

  for (const [key, value] of Object.entries(configs)) {
    // Bo'sh string bo'lsa ham upsert qil (bo'shatish uchun kerak bo'lishi mumkin)
    await prisma.runtimeConfig.upsert({
      where: { key },
      create: { key, value },
      update: { value }
    });
  }

  console.log(`RuntimeConfig: ${Object.keys(configs).length} ta kalit seeder orqali yangilandi.`);
}

async function main(): Promise<void> {
  await upsertMany(DEFAULT_KEYWORDS.latin, KeywordType.LATIN);
  await upsertMany(DEFAULT_KEYWORDS.cyrillic, KeywordType.CYRILLIC);
  await upsertMany(DEFAULT_KEYWORDS.route, KeywordType.ROUTE);
  await upsertMany(DEFAULT_KEYWORDS.extra, KeywordType.EXTRA);
  const dictionarySeed = await seedKeywordDictionaryWithClient(prisma);
  await seedRuntimeConfigs();

  console.log("Seed completed successfully");
  console.log(`passenger keywords count: ${dictionarySeed.counts.passenger}`);
  console.log(`driver keywords count: ${dictionarySeed.counts.driver}`);
  console.log(`cargo keywords count: ${dictionarySeed.counts.cargo}`);
  console.log(`spam keywords count: ${dictionarySeed.counts.spam}`);
  console.log(`ambiguous keywords count: ${dictionarySeed.counts.ambiguous}`);
  console.log(`total inserted/upserted: ${dictionarySeed.total} (inserted=${dictionarySeed.inserted}, updated=${dictionarySeed.updated})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
