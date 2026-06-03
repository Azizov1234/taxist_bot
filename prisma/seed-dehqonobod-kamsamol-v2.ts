import { Prisma, PrismaClient, type KeywordCategory } from "@prisma/client";
import {
  buildDehqonobodKamsamolV2Keywords,
  DK_V2_SOURCE,
  type DkV2KeywordRecord
} from "../src/data/dehqonobod-kamsamol-keywords-v2.js";

type CountKey = "passenger" | "driver" | "cargo" | "spam" | "ambiguous";

interface SeedResult {
  counts: Record<CountKey, number>;
  inserted: number;
  updated: number;
  total: number;
}

const prisma = new PrismaClient();

function emptyCounts(): Record<CountKey, number> {
  return {
    passenger: 0,
    driver: 0,
    cargo: 0,
    spam: 0,
    ambiguous: 0
  };
}

function countKey(category: KeywordCategory): CountKey {
  if (category === "PASSENGER") {
    return "passenger";
  }

  if (category === "DRIVER") {
    return "driver";
  }

  if (category === "CARGO") {
    return "cargo";
  }

  if (category === "SPAM") {
    return "spam";
  }

  return "ambiguous";
}

function examplesValue(record: DkV2KeywordRecord): Prisma.InputJsonValue | typeof Prisma.DbNull {
  return record.examples.length > 0 ? record.examples : Prisma.DbNull;
}

export async function seedDehqonobodKamsamolV2WithClient(prismaClient: PrismaClient): Promise<SeedResult> {
  const records = buildDehqonobodKamsamolV2Keywords();
  const counts = emptyCounts();
  const existingRows = await prismaClient.keywordDictionary.findMany({
    select: {
      normalized: true,
      category: true
    }
  });
  const existing = new Set(existingRows.map((row) => `${row.category}::${row.normalized}`));

  await prismaClient.keywordDictionary.updateMany({
    where: {
      source: DK_V2_SOURCE
    },
    data: {
      isActive: false
    }
  });

  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const key = `${record.category}::${record.normalized}`;
    if (existing.has(key)) {
      updated += 1;
    } else {
      inserted += 1;
      existing.add(key);
    }

    counts[countKey(record.category)] += 1;

    await prismaClient.keywordDictionary.upsert({
      where: {
        normalized_category: {
          normalized: record.normalized,
          category: record.category
        }
      },
      create: {
        phrase: record.phrase,
        normalized: record.normalized,
        category: record.category,
        weight: record.weight,
        language: record.language,
        matchType: record.matchType,
        source: record.source,
        frequency: record.frequency,
        examples: examplesValue(record),
        isActive: true
      },
      update: {
        phrase: record.phrase,
        weight: record.weight,
        language: record.language,
        matchType: record.matchType,
        source: record.source,
        frequency: record.frequency,
        examples: examplesValue(record),
        isActive: true
      }
    });
  }

  return {
    counts,
    inserted,
    updated,
    total: inserted + updated
  };
}

async function main(): Promise<void> {
  const result = await seedDehqonobodKamsamolV2WithClient(prisma);

  console.log(`PASSENGER keywords: ${result.counts.passenger}`);
  console.log(`DRIVER keywords: ${result.counts.driver}`);
  console.log(`CARGO keywords: ${result.counts.cargo}`);
  console.log(`SPAM keywords: ${result.counts.spam}`);
  console.log(`AMBIGUOUS keywords: ${result.counts.ambiguous}`);
  console.log(`total upserted: ${result.total} (inserted=${result.inserted}, updated=${result.updated})`);
}

const entryFile = process.argv[1];
if (entryFile && entryFile.endsWith("seed-dehqonobod-kamsamol-v2.ts")) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
