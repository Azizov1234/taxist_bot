import { prisma } from "./prisma/client.js";
import { env } from "./config/env.js";
import { seedDefaultKeywords } from "./services/keyword.service.js";
import { writeError, writeInfo, writeWarn } from "./services/logger.service.js";
import { runLegacyBotWithCatch } from "./index.js";
import { createAndConnectUserbotClient } from "./userbot/gramjs.client.js";
import { startUserbotListener } from "./userbot/userbot.listener.js";
import type { TelegramClient } from "telegram";
import { getPeerId } from "telegram/Utils.js";
import { open, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";

const INSTANCE_LOCK_PATH = join(tmpdir(), "taxi-lead-bot.userbot.lock");

function getEntityTitle(entity: any): string {
  if (!entity) {
    return "unknown";
  }

  if (typeof entity.title === "string" && entity.title.trim().length > 0) {
    return entity.title.trim();
  }

  const firstName = typeof entity.firstName === "string" ? entity.firstName : typeof entity.first_name === "string" ? entity.first_name : "";
  const lastName = typeof entity.lastName === "string" ? entity.lastName : typeof entity.last_name === "string" ? entity.last_name : "";
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  if (fullName.length > 0) {
    return fullName;
  }

  if (typeof entity.username === "string" && entity.username.trim().length > 0) {
    return `@${entity.username.trim()}`;
  }

  return "unknown";
}

async function validateSourceChats(client: TelegramClient): Promise<void> {
  const validIds: number[] = [];
  const resolvedTitles: Array<{ id: number; title: string }> = [];
  const dialogsByChatId = new Map<number, any>();

  try {
    const dialogs = await client.getDialogs({ limit: 500 });
    for (const dialog of dialogs) {
      const entity = (dialog as any)?.entity;
      if (!entity) {
        continue;
      }

      const markedPeerId = getPeerId(entity, true);
      const numericPeerId = Number(markedPeerId);
      if (!Number.isFinite(numericPeerId)) {
        continue;
      }

      dialogsByChatId.set(numericPeerId, entity);
    }
  } catch (error) {
    await writeWarn("Could not preload dialogs before source chat validation", {
      error: error instanceof Error ? error.message : String(error)
    });
  }

  for (const chatId of env.PASSENGER_CHAT_IDS) {
    try {
      const entity = dialogsByChatId.get(chatId) ?? (await client.getEntity(chatId));
      validIds.push(chatId);
      resolvedTitles.push({ id: chatId, title: getEntityTitle(entity) });
    } catch (error) {
      await writeWarn("Skipping invalid/unavailable passenger source chat", {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }

  if (validIds.length === 0) {
    throw new Error("No valid PASSENGER_CHAT_IDS available for this account. Join the source group(s) and run get:ids again.");
  }

  env.PASSENGER_CHAT_IDS.length = 0;
  env.PASSENGER_CHAT_IDS.push(...validIds);

  await writeInfo("Passenger source chats validated", {
    sourceChats: resolvedTitles
  });
}

function parsePidFromLock(raw: string): number | null {
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

async function readExistingLockPid(): Promise<number | null> {
  try {
    const lockRaw = await readFile(INSTANCE_LOCK_PATH, "utf8");
    return parsePidFromLock(lockRaw);
  } catch {
    return null;
  }
}

async function acquireInstanceLock(): Promise<() => Promise<void>> {
  let staleLockRemoved = false;

  while (true) {
    try {
      const handle = await open(INSTANCE_LOCK_PATH, "wx");
      await handle.writeFile(
        JSON.stringify({
          pid: process.pid,
          createdAt: new Date().toISOString()
        })
      );

      return async () => {
        try {
          await handle.close();
        } finally {
          await rm(INSTANCE_LOCK_PATH, { force: true });
        }
      };
    } catch (error: any) {
      if (error?.code !== "EEXIST") {
        throw error;
      }

      const existingPid = await readExistingLockPid();
      if (existingPid && isProcessRunning(existingPid)) {
        throw new Error(`Another bot instance is already running (PID: ${existingPid}). Stop it before starting a new one.`);
      }

      if (staleLockRemoved) {
        throw new Error("Could not acquire instance lock after removing stale lock file.");
      }

      await rm(INSTANCE_LOCK_PATH, { force: true });
      staleLockRemoved = true;
    }
  }
}

async function startUserbotMode(): Promise<void> {
  const releaseLock = await acquireInstanceLock();
  let lockReleased = false;
  const safeReleaseLock = async (): Promise<void> => {
    if (lockReleased) {
      return;
    }

    lockReleased = true;
    await releaseLock();
  };

  try {
    await prisma.$connect();
    await seedDefaultKeywords();

    if (env.AI_ENABLED && !env.AI_HAS_CONFIGURED_PROVIDER) {
      await writeWarn("AI enabled but no provider credentials configured. Falling back to rule-based analyzer only.", {
        providerOrder: env.AI_PROVIDER_ORDER
      });
    }

    const client = await createAndConnectUserbotClient();
    await validateSourceChats(client);
    const me = await client.getMe();

    await writeInfo("Userbot mode started", {
      meId: me.id?.toString(),
      username: (me as any).username ?? null,
      sourceChatIds: env.PASSENGER_CHAT_IDS,
      driverChatId: env.DRIVER_CHAT_ID
    });

    const shutdown = async (signal: string): Promise<void> => {
      await writeInfo("Shutdown signal received", { signal });

      try {
        await client.disconnect();
      } catch {
        // ignore
      }

      await prisma.$disconnect();
      await safeReleaseLock();
      process.exit(0);
    };

    process.once("SIGINT", () => {
      void shutdown("SIGINT");
    });

    process.once("SIGTERM", () => {
      void shutdown("SIGTERM");
    });

    await startUserbotListener(client);

    await new Promise<void>(() => {
      // keep process alive for update handlers
    });
  } catch (error) {
    await safeReleaseLock();
    throw error;
  }
}

async function main(): Promise<void> {
  if (env.TELEGRAM_MODE === "legacy") {
    await runLegacyBotWithCatch();
    return;
  }

  await startUserbotMode();
}

main().catch(async (error) => {
  await writeError("Fatal startup error", error);

  try {
    await prisma.$disconnect();
  } catch {
    // ignore
  }

  process.exit(1);
});
