import { readdir, rm } from "node:fs/promises";

function isCleanupTarget(fileName: string): boolean {
  if (fileName === "run.log" || fileName === "run.err") {
    return true;
  }

  if (/^taxi-bot-dev-\d+(?:\.err)?\.log$/u.test(fileName)) {
    return true;
  }

  return fileName.startsWith("_") && fileName.endsWith(".log");
}

async function main(): Promise<void> {
  const entries = await readdir(process.cwd(), { withFileTypes: true });
  const targets = entries.filter((entry) => entry.isFile() && isCleanupTarget(entry.name)).map((entry) => entry.name);

  if (targets.length === 0) {
    console.log("No log files to clean.");
    return;
  }

  await Promise.all(targets.map((fileName) => rm(fileName, { force: true })));
  console.log(`Deleted ${targets.length} log file(s).`);
}

main().catch((error) => {
  console.error("Failed to clean logs:", error);
  process.exit(1);
});
