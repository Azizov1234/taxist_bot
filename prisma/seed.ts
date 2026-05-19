import dotenv from "dotenv";
import { KeywordType, PrismaClient } from "@prisma/client";
import { DEFAULT_KEYWORDS } from "../src/config/defaultKeywords.js";
import { normalizeUzbekText } from "../src/utils/text.js";

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

async function main(): Promise<void> {
  await upsertMany(DEFAULT_KEYWORDS.latin, KeywordType.LATIN);
  await upsertMany(DEFAULT_KEYWORDS.cyrillic, KeywordType.CYRILLIC);
  await upsertMany(DEFAULT_KEYWORDS.route, KeywordType.ROUTE);
  await upsertMany(DEFAULT_KEYWORDS.extra, KeywordType.EXTRA);

  console.log("Seed completed successfully");
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
