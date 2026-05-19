import { Bot, type Context } from "grammy";
import { env } from "../config/env.js";
import { registerAdminCommands } from "./admin.commands.js";
import { registerMessageHandler } from "./message.handler.js";
import { sendLogToChannel, writeError } from "../services/logger.service.js";
import { LogLevel } from "@prisma/client";

export function createBot(): Bot<Context> {
  const bot = new Bot<Context>(env.BOT_TOKEN);

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
