import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { classifyKamsamolText, normalizeKamsamolPhrase, type KamsamolKeywordCategory, type KamsamolKeywordRecord } from "./extract-kamsamol-keywords.js";

interface KeywordFile {
  keywords?: KamsamolKeywordRecord[];
}

interface ReportFile {
  messagesRead?: number;
  textMessages?: number;
  keywordCount?: number;
  byCategory?: Record<string, number>;
  bySource?: Record<string, number>;
}

interface TestCase {
  text: string;
  expected: KamsamolKeywordCategory;
}

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
const ROOT_DIR = resolve(CURRENT_DIR, "..");
const KEYWORDS_PATH = resolve(ROOT_DIR, "generated/kamsamol-keywords.json");
const REPORT_PATH = resolve(ROOT_DIR, "generated/kamsamol-keyword-report.json");

const TEST_CASES: TestCase[] = [
  { text: "Kamsamoldan Dehqonobodga 1 kishi bor", expected: "PASSENGER" },
  { text: "Dehqonobodga joy bormi", expected: "PASSENGER" },
  { text: "Kamsamolga kim ketadi", expected: "PASSENGER" },
  { text: "Dehqonoboddan Qarshiga taksi kerak", expected: "PASSENGER" },
  { text: "Qarshiga 2 kishi bor", expected: "PASSENGER" },
  { text: "Dehqonobod Kamsamol bo'sh joy bor", expected: "DRIVER" },
  { text: "Har kuni Kamsamol Dehqonobod qatnaymiz", expected: "DRIVER" },
  { text: "2 ta joy bor murojaat uchun", expected: "DRIVER" },
  { text: "Kamsamoldan Qarshiga reys bor", expected: "DRIVER" },
  { text: "Pochta bor Kamsamoldan Dehqonobodga", expected: "CARGO" },
  { text: "Kanalga obuna bo'ling", expected: "SPAM" }
];

async function readJsonFile<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(path, "utf8")) as T;
}

function countByCategory(records: KamsamolKeywordRecord[]): Record<KamsamolKeywordCategory, number> {
  const counts: Record<KamsamolKeywordCategory, number> = {
    PASSENGER: 0,
    DRIVER: 0,
    CARGO: 0,
    SPAM: 0,
    AMBIGUOUS: 0
  };

  for (const record of records) {
    counts[record.category] += 1;
  }

  return counts;
}

function countBySource(records: KamsamolKeywordRecord[]): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const record of records) {
    counts[record.source] = (counts[record.source] ?? 0) + 1;
  }
  return counts;
}

function runClassificationChecks(): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  console.log("classification checks:");
  for (const testCase of TEST_CASES) {
    const result = classifyKamsamolText(testCase.text);
    const ok = result.category === testCase.expected;
    if (ok) {
      passed += 1;
    } else {
      failed += 1;
    }

    const status = ok ? "PASS" : "FAIL";
    console.log(`${status} ${JSON.stringify(testCase.text)} => ${result.category} (expected ${testCase.expected})`);
  }

  return { passed, failed };
}

async function main(): Promise<void> {
  const keywordFile = await readJsonFile<KeywordFile | KamsamolKeywordRecord[]>(KEYWORDS_PATH);
  const records = Array.isArray(keywordFile) ? keywordFile : keywordFile.keywords ?? [];
  const report = await readJsonFile<ReportFile>(REPORT_PATH).catch(() => null);

  console.log(`keywords: ${records.length}`);
  console.log(`by category: ${JSON.stringify(countByCategory(records))}`);
  console.log(`by source: ${JSON.stringify(countBySource(records))}`);
  console.log(`first normalized: ${records[0] ? normalizeKamsamolPhrase(records[0].phrase) : "-"}`);

  if (report) {
    console.log(`report messages read: ${report.messagesRead ?? 0}`);
    console.log(`report text messages: ${report.textMessages ?? 0}`);
    console.log(`report keyword count: ${report.keywordCount ?? records.length}`);
  }

  if (process.argv.includes("--check")) {
    const result = runClassificationChecks();
    console.log(`checks passed: ${result.passed}`);
    console.log(`checks failed: ${result.failed}`);
    if (result.failed > 0) {
      process.exitCode = 1;
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
