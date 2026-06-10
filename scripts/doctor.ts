import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { env, ENV_FILE_LOADED, ENV_FILE_PATH } from "../src/config/env.js";
import { prisma } from "../src/prisma/client.js";

const LOCK_PATH = join(tmpdir(), "taxi-lead-bot.userbot.lock");

function parseLockPid(raw: string): number | null {
  try {
    const parsed = JSON.parse(raw) as { pid?: unknown };
    const pid = Number(parsed.pid);
    return Number.isInteger(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

function isProcessRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

async function checkLock(errors: string[], warnings: string[]): Promise<void> {
  try {
    const raw = await readFile(LOCK_PATH, "utf8");
    const pid = parseLockPid(raw);
    if (!pid) {
      warnings.push(`Lock file exists but PID could not be parsed: ${LOCK_PATH}`);
      return;
    }

    if (isProcessRunning(pid)) {
      errors.push(`Another process is running with lock PID=${pid}. Stop it first or remove stale lock if needed.`);
      return;
    }

    warnings.push(`Stale lock file found (PID ${pid} is not alive): ${LOCK_PATH}`);
  } catch {
    // No lock file is fine.
  }
}

async function checkDatabase(errors: string[]): Promise<void> {
  try {
    await prisma.$connect();
    await prisma.$queryRaw`SELECT 1`;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`Database connection failed: ${message}`);
  } finally {
    await prisma.$disconnect().catch(() => undefined);
  }
}

async function main(): Promise<void> {
  const errors: string[] = [];
  const warnings: string[] = [];

  console.log("=== Taxi Bot Doctor ===");
  console.log(`Node version: ${process.version}`);
  console.log(`Mode: ${env.TELEGRAM_MODE}`);
  console.log(`ENV file path: ${ENV_FILE_PATH}`);
  console.log(`ENV file loaded: ${ENV_FILE_LOADED ? "yes" : "no"}`);
  console.log(`Passenger chat IDs: ${env.PASSENGER_CHAT_IDS.length}`);
  console.log(`Passenger usernames: ${env.PASSENGER_CHAT_USERNAMES.length}`);
  console.log(`Driver chat configured: ${env.DRIVER_CHAT_ID !== 0 ? "yes" : "no"}`);
  console.log(`Driver delivery mode: ${env.DRIVER_DELIVERY_MODE} (requested: ${env.DRIVER_DELIVERY_REQUESTED_MODE})`);
  console.log(`Passenger group auto-replies: ${env.PASSENGER_GROUP_AUTO_REPLIES ? "ON (bot writes to passenger groups)" : "OFF (no writes to passenger groups)"}`);
  console.log(`Driver channels (leads always go here): ${env.DRIVER_CHAT_IDS.join(", ")}`);
  console.log(`Admin configured: ${Boolean(env.ADMIN_TELEGRAM_ID) ? "yes" : "no"}`);
  console.log(`String session configured: ${env.TELEGRAM_STRING_SESSION.trim().length > 0 ? "yes" : "no"}`);
  console.log(`AI enabled: ${env.AI_ENABLED ? "yes" : "no"}`);
  console.log(
    `AI configured providers: ${
      env.AI_CONFIGURED_PROVIDERS.length > 0 ? env.AI_CONFIGURED_PROVIDERS.join(", ") : "none"
    }`
  );

  if (env.AI_ENABLED && env.AI_CONFIGURED_PROVIDERS.length === 0) {
    warnings.push("AI is enabled but no provider credentials are configured. Bot will use keyword fallback only.");
  }

  try {
    const dbUrl = new URL(env.DATABASE_URL);
    if (env.NODE_ENV === "production" && ["localhost", "127.0.0.1"].includes(dbUrl.hostname)) {
      warnings.push("DATABASE_URL uses localhost in production. Ensure PostgreSQL is running on the same server.");
    }
  } catch {
    warnings.push("DATABASE_URL could not be parsed as URL.");
  }

  if (env.TELEGRAM_MODE === "userbot" && env.TELEGRAM_STRING_SESSION.trim().length === 0) {
    errors.push("TELEGRAM_STRING_SESSION is empty for userbot mode.");
  }

  if (env.TELEGRAM_MODE === "userbot" && env.DRIVER_DELIVERY_MODE === "userbot") {
    warnings.push("Driver delivery is using the userbot transport. Set TELEGRAM_BOT_TOKEN and DRIVER_DELIVERY_MODE=bot to post as the ordinary bot.");
  }

  await checkLock(errors, warnings);
  await checkDatabase(errors);

  console.log("");
  if (warnings.length > 0) {
    console.log("Warnings:");
    for (const item of warnings) {
      console.log(`- ${item}`);
    }
  }

  if (errors.length > 0) {
    console.log("Errors:");
    for (const item of errors) {
      console.log(`- ${item}`);
    }
    process.exitCode = 1;
    return;
  }

  console.log("No blocking errors found.");
}

void main();
