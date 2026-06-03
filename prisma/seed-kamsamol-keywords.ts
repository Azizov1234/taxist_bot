import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { KeywordCategory, KeywordLanguage, KeywordMatchType, Prisma, PrismaClient } from "@prisma/client";
import { maskSensitiveText, normalizeKamsamolPhrase, type KamsamolKeywordRecord } from "../scripts/extract-kamsamol-keywords.js";
import { detectKeywordLanguage } from "../src/utils/keywordNormalize.js";

type CategoryCountKey = "passenger" | "driver" | "cargo" | "spam" | "ambiguous";

interface KeywordFile {
  keywords?: KamsamolKeywordRecord[];
}

interface SeedStats {
  counts: Record<CategoryCountKey, number>;
  inserted: number;
  updated: number;
  total: number;
}

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const KEYWORDS_PATH = resolve(CURRENT_DIR, "../generated/kamsamol-keywords.json");
const prisma = new PrismaClient();

const CATEGORY_MAP: Record<KamsamolKeywordRecord["category"], KeywordCategory> = {
  PASSENGER: KeywordCategory.PASSENGER,
  DRIVER: KeywordCategory.DRIVER,
  CARGO: KeywordCategory.CARGO,
  SPAM: KeywordCategory.SPAM,
  AMBIGUOUS: KeywordCategory.AMBIGUOUS
};

function emptyCounts(): Record<CategoryCountKey, number> {
  return {
    passenger: 0,
    driver: 0,
    cargo: 0,
    spam: 0,
    ambiguous: 0
  };
}

function countKey(category: KeywordCategory): CategoryCountKey {
  if (category === KeywordCategory.PASSENGER) {
    return "passenger";
  }
  if (category === KeywordCategory.DRIVER) {
    return "driver";
  }
  if (category === KeywordCategory.CARGO) {
    return "cargo";
  }
  if (category === KeywordCategory.SPAM) {
    return "spam";
  }
  return "ambiguous";
}

function safeWeight(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.min(20, Math.round(parsed)));
}

function safeFrequency(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

function safeExamples(record: KamsamolKeywordRecord): string[] {
  if (!Array.isArray(record.examples)) {
    return [];
  }

  return [...new Set(record.examples.map((example) => maskSensitiveText(String(example)).trim()).filter(Boolean))].slice(0, 3);
}

function asKeywordRecord(value: unknown): KamsamolKeywordRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<KamsamolKeywordRecord>;
  if (typeof record.phrase !== "string" || !record.phrase.trim()) {
    return null;
  }

  if (!record.category || !(record.category in CATEGORY_MAP)) {
    return null;
  }

  return record as KamsamolKeywordRecord;
}

async function readKeywordRecords(path = KEYWORDS_PATH): Promise<KamsamolKeywordRecord[]> {
  const raw = await readFile(path, "utf8");
  const parsed = JSON.parse(raw) as KeywordFile | KamsamolKeywordRecord[];
  const values = Array.isArray(parsed) ? parsed : parsed.keywords ?? [];
  return values.map((value) => asKeywordRecord(value)).filter((value): value is KamsamolKeywordRecord => value !== null);
}

async function seedKamsamolKeywordsWithClient(prismaClient: PrismaClient, records: KamsamolKeywordRecord[]): Promise<SeedStats> {
  const counts = emptyCounts();
  const existingRows = await prismaClient.keywordDictionary.findMany({
    select: {
      normalized: true,
      category: true
    }
  });
  const existing = new Set(existingRows.map((row) => `${row.category}::${row.normalized}`));

  let inserted = 0;
  let updated = 0;

  for (const record of records) {
    const phrase = maskSensitiveText(record.phrase).trim().replace(/\s+/g, " ");
    const normalized = normalizeKamsamolPhrase(phrase);
    if (!phrase || !normalized) {
      continue;
    }

    const category = CATEGORY_MAP[record.category];
    const key = `${category}::${normalized}`;
    const examples = safeExamples(record);
    const examplesValue = examples.length > 0 ? examples : Prisma.DbNull;
    const language = (record.language ?? detectKeywordLanguage(phrase)) as KeywordLanguage;
    const matchType = (record.matchType ?? KeywordMatchType.PHRASE) as KeywordMatchType;
    const source = record.source ?? "generated:kamsamol";
    const frequency = safeFrequency(record.frequency);
    const weight = safeWeight(record.weight);

    if (existing.has(key)) {
      updated += 1;
    } else {
      inserted += 1;
      existing.add(key);
    }

    counts[countKey(category)] += 1;

    await prismaClient.keywordDictionary.upsert({
      where: {
        normalized_category: {
          normalized,
          category
        }
      },
      create: {
        phrase,
        normalized,
        category,
        weight,
        language,
        matchType,
        source,
        frequency,
        examples: examplesValue,
        isActive: true
      },
      update: {
        phrase,
        weight,
        language,
        matchType,
        source,
        frequency,
        examples: examplesValue,
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
  const records = await readKeywordRecords();
  const result = await seedKamsamolKeywordsWithClient(prisma, records);

  console.log(`PASSENGER upserted: ${result.counts.passenger}`);
  console.log(`DRIVER upserted: ${result.counts.driver}`);
  console.log(`CARGO upserted: ${result.counts.cargo}`);
  console.log(`SPAM upserted: ${result.counts.spam}`);
  console.log(`AMBIGUOUS upserted: ${result.counts.ambiguous}`);
  console.log(`total upserted: ${result.total} (inserted=${result.inserted}, updated=${result.updated})`);
}

const entryFile = process.argv[1] ? resolve(process.argv[1]) : "";
if (entryFile === fileURLToPath(import.meta.url)) {
  main()
    .catch((error) => {
      console.error(error);
      process.exit(1);
    })
    .finally(async () => {
      await prisma.$disconnect();
    });
}
