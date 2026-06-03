import { KeywordCategory } from "@prisma/client";
import {
  buildDehqonobodKamsamolV2Keywords,
  classifyDehqonobodKamsamolV2Text,
  DK_V2_SOURCE,
  DK_V2_TEST_CASES,
  type DkV2KeywordRecord
} from "../src/data/dehqonobod-kamsamol-keywords-v2.js";

function countByCategory(records: DkV2KeywordRecord[]): Record<KeywordCategory, number> {
  const counts: Record<KeywordCategory, number> = {
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

function runChecks(records: DkV2KeywordRecord[]): { passed: number; failed: number } {
  let passed = 0;
  let failed = 0;

  console.log("classification checks:");
  for (const testCase of DK_V2_TEST_CASES) {
    const result = classifyDehqonobodKamsamolV2Text(testCase.text, records);
    const ok = result.category === testCase.expected;
    if (ok) {
      passed += 1;
    } else {
      failed += 1;
    }

    const status = ok ? "PASS" : "FAIL";
    console.log(
      `${status} ${JSON.stringify(testCase.text)} => ${result.category} (expected ${testCase.expected}) ` +
        `scores p=${result.passengerScore}, d=${result.driverScore}, c=${result.cargoScore}, s=${result.spamScore}`
    );
  }

  return { passed, failed };
}

function main(): void {
  const records = buildDehqonobodKamsamolV2Keywords();
  const counts = countByCategory(records);

  console.log(`source: ${DK_V2_SOURCE}`);
  console.log(`PASSENGER keywords: ${counts.PASSENGER}`);
  console.log(`DRIVER keywords: ${counts.DRIVER}`);
  console.log(`CARGO keywords: ${counts.CARGO}`);
  console.log(`SPAM keywords: ${counts.SPAM}`);
  console.log(`AMBIGUOUS keywords: ${counts.AMBIGUOUS}`);
  console.log(`total keywords: ${records.length}`);

  const checks = runChecks(records);
  console.log(`checks passed: ${checks.passed}`);
  console.log(`checks failed: ${checks.failed}`);

  if (checks.failed > 0) {
    process.exitCode = 1;
  }
}

main();
