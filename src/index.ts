import { createBot } from "./bot/index.js";
import { env } from "./config/env.js";
import { prisma } from "./prisma/client.js";
import { seedDefaultKeywords } from "./services/keyword.service.js";
import { sendLogToChannel, writeError, writeInfo, writeWarn } from "./services/logger.service.js";
import { LogLevel } from "@prisma/client";
import { checkConfiguredChats } from "./services/telegramHealth.service.js";

function isPollingConflictError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes("terminated by other getUpdates request") || message.includes("409");
}

async function main(): Promise<void> {
  await prisma.$connect();
  await seedDefaultKeywords();

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

  await writeInfo("Bot is starting", {
    passengerGroupId: env.PASSENGER_GROUP_ID,
    driverGroupOrChannelId: env.DRIVER_GROUP_OR_CHANNEL_ID
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
        passengerChatId: env.PASSENGER_GROUP_ID,
        currentStatus: passengerStatus
      });
    }
  }

  await bot.start({
    onStart: async (me) => {
      await writeInfo("Bot started", { username: me.username, id: me.id });
      await sendLogToChannel(bot.api, LogLevel.INFO, "Taxi lead bot ishga tushdi", {
        username: me.username,
        id: me.id
      });
    }
  });
}

main().catch(async (error) => {
  if (isPollingConflictError(error)) {
    await writeWarn("Polling conflict detected: another bot instance is using the same token", {
      hint: "Stop all other instances or rotate BOT_TOKEN via BotFather /revoke"
    });
  }

  await writeError("Fatal startup error", error);
  // LOG channel attempt best effort
  try {
    const bot = createBot();
    await sendLogToChannel(bot.api, LogLevel.ERROR, "Bot start xatosi", {
      error: error instanceof Error ? error.message : String(error)
    });
  } catch {
    // ignore
  }

  await prisma.$disconnect();
  process.exit(1);
});
