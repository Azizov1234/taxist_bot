import { LogLevel } from "@prisma/client";
import { createBot } from "./bot/index.js";
import { ENV_FILE_LOADED, ENV_FILE_PATH, assertRuntimeRoutingConfigured, env } from "./config/env.js";
import { prisma } from "./prisma/client.js";
import { seedDefaultAdminsFromEnv } from "./services/admin.service.js";
import { seedDefaultKeywords } from "./services/keyword.service.js";
import { getKeywordCacheStats, loadKeywordDictionaryCache } from "./services/keywordDictionary.service.js";
import { loadRuntimeConfigFromDatabase } from "./services/runtimeConfig.service.js";
import { sendLogToChannel, writeError, writeInfo, writeWarn } from "./services/logger.service.js";
import { checkConfiguredChats } from "./services/telegramHealth.service.js";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import type { Bot, Context } from "grammy";

function isPollingConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("terminated by other getUpdates request") || message.includes("409");
}

export async function startLegacyBot(): Promise<void> {
  await prisma.$connect();
  await loadRuntimeConfigFromDatabase();
  await seedDefaultAdminsFromEnv();
  assertRuntimeRoutingConfigured();
  await seedDefaultKeywords();
  await loadKeywordDictionaryCache();
  await writeInfo("Keyword dictionary cache loaded", getKeywordCacheStats());

  const bot = createBot();

  process.once("SIGINT", async () => {
    bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  });

  process.once("SIGTERM", async () => {
    bot.stop();
    await prisma.$disconnect();
    process.exit(0);
  });

  await writeInfo("Legacy bot is starting", {
    envFilePath: ENV_FILE_PATH,
    envFileLoaded: ENV_FILE_LOADED,
    passengerGroupIds: env.PASSENGER_CHAT_IDS,
    driverGroupOrChannelId: env.DRIVER_CHAT_ID
  });

  const chatCheck = await checkConfiguredChats(bot.api);
  const chatCheckMeta = {
    passenger: JSON.parse(JSON.stringify(chatCheck.passenger)),
    driver: JSON.parse(JSON.stringify(chatCheck.driver))
  };

  if (!chatCheck.passenger.ok || !chatCheck.driver.ok) {
    await writeWarn("Chat configuration check failed", {
      passenger: chatCheckMeta.passenger,
      driver: chatCheckMeta.driver
    });
  } else {
    await writeInfo("Chat configuration check passed", {
      passenger: chatCheckMeta.passenger,
      driver: chatCheckMeta.driver
    });

    const passengerStatus = chatCheck.passenger.membershipStatus;
    if (passengerStatus !== "administrator" && passengerStatus !== "creator") {
      await writeWarn("Passenger chat delete permission risk", {
        hint: "Botni passenger guruhida admin qiling va Delete messages huquqini bering",
        passengerChatId: chatCheck.passenger.chatId,
        currentStatus: passengerStatus
      });
    }
  }

  await bot.start({
    drop_pending_updates: true,
    onStart: async (me) => {
      await writeInfo("Legacy bot started", { username: me.username, id: me.id });
      await sendLogToChannel(bot.api, LogLevel.INFO, "Taxi lead legacy bot ishga tushdi", {
        username: me.username,
        id: me.id
      });
    }
  });
}

export async function startTokenBotLayer(): Promise<Bot<Context> | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    await writeWarn("Token bot layer skipped: TELEGRAM_BOT_TOKEN is not configured");
    return null;
  }

  const bot = createBot();
  let started = false;

  const startedPromise = new Promise<void>((resolveStarted, rejectStarted) => {
    const pollingPromise = bot.start({
      drop_pending_updates: true,
      onStart: async (me) => {
        started = true;
        await writeInfo("Token bot layer started", {
          username: me.username,
          id: me.id,
          sourceChatIds: env.PASSENGER_CHAT_IDS,
          driverChatIds: env.DRIVER_CHAT_IDS
        });
        await sendLogToChannel(bot.api, LogLevel.INFO, "Taxi lead token bot ishga tushdi", {
          username: me.username,
          id: me.id
        });
        resolveStarted(); 
      }
    });

    void pollingPromise.catch(async (error) => {
      if (isPollingConflictError(error)) {
        await writeWarn("Polling conflict detected: another bot instance is using the same token", {
          hint: "Stop all other bot instances or rotate TELEGRAM_BOT_TOKEN via BotFather /revoke"
        });
      }

      await writeError("Token bot layer stopped with error", error);

      if (!started) {
        rejectStarted(error);
      }
    });
  });

  await startedPromise;
  return bot;
}

export async function runLegacyBotWithCatch(): Promise<void> {
  try {
    await startLegacyBot();
  } catch (error) {
    if (isPollingConflictError(error)) {
      await writeWarn("Polling conflict detected: another bot instance is using the same token", {
        hint: "Stop all other instances or rotate TELEGRAM_BOT_TOKEN via BotFather /revoke"
      });
    }

    await writeError("Fatal legacy startup error", error);

    try {
      const bot = createBot();
      await sendLogToChannel(bot.api, LogLevel.ERROR, "Legacy bot start xatosi", {
        error: error instanceof Error ? error.message : String(error)
      });
    } catch {
      // ignore
    }

    await prisma.$disconnect();
    process.exit(1);
  }
}

function isDirectRun(): boolean {
  if (!process.argv[1]) {
    return false;
  }

  return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

if (isDirectRun()) {
  void runLegacyBotWithCatch();
}
