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
  const configs: Record<string, string> = {
    DRIVER_CHAT_ID_GULISTON: process.env.DRIVER_CHAT_ID_GULISTON || "-1004453401746",
    DRIVER_CHAT_ID: process.env.DRIVER_CHAT_ID || "-1004453401746",
    PASSENGER_CHAT_USERNAMES_GULISTON: process.env.PASSENGER_CHAT_USERNAMES_GULISTON || "Bekobod_Shirin_Guliston_taxi,ShirinTaksi,Guliston_Bekobod_taksi,guliston_bekabod_xovos",
    PASSENGER_CHAT_USERNAMES: process.env.PASSENGER_CHAT_USERNAMES || ""
  };

  for (const [key, value] of Object.entries(configs)) {
    if (value) {
      await prisma.runtimeConfig.upsert({
        where: { key },
        create: { key, value },
        update: { value }
      });
    }
  }
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
