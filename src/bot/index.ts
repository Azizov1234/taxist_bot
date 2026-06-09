import { Bot, type Context } from "grammy";
import { env } from "../config/env.js";
import { registerAdminCommands } from "./admin.commands.js";
import { registerMessageHandler } from "./message.handler.js";
import { sendLogToChannel, writeError } from "../services/logger.service.js";
import { shouldBlockPassengerGroupWrite } from "../utils/passengerGroupWrite.js";
import { LogLevel } from "@prisma/client";

export function createBot(): Bot<Context> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    throw new Error("TELEGRAM_BOT_TOKEN is required for legacy mode");
  }

  const bot = new Bot<Context>(env.TELEGRAM_BOT_TOKEN);

  bot.use(async (ctx, next) => {
    const originalReply = ctx.reply.bind(ctx);
    ctx.reply = ((...args: Parameters<Context["reply"]>) => {
      const chatId = ctx.chat?.id;
      if (chatId !== undefined && shouldBlockPassengerGroupWrite(chatId)) {
        return Promise.resolve({ message_id: 0 } as Awaited<ReturnType<Context["reply"]>>);
      }

      return originalReply(...args);
    }) as Context["reply"];

    await next();
  });

  registerAdminCommands(bot);
  registerMessageHandler(bot);

  bot.catch(async (error) => {
    await writeError("Global bot.catch error", error.error, {
      updateId: error.ctx.update.update_id
    });

    await sendLogToChannel(bot.api, LogLevel.ERROR, "Global bot.catch error", {
      updateId: error.ctx.update.update_id,
      error: error.error instanceof Error ? error.error.message : String(error.error)
    });
  });

  return bot;
}

