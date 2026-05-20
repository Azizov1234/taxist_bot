import { Bot, type Context } from "grammy";
import { env } from "../config/env.js";
import { processIncomingMessage } from "../services/lead.service.js";
import { writeError, writeInfo } from "../services/logger.service.js";

export function registerMessageHandler(bot: Bot<Context>): void {
  bot.on("message", async (ctx) => {
    try {
      const messageText = "text" in ctx.msg && typeof ctx.msg.text === "string" ? ctx.msg.text : "";

      if (messageText.startsWith("/")) {
        return;
      }

      if (ctx.chat?.id !== env.PASSENGERS_CHAT_ID) {
        return;
      }

      const result = await processIncomingMessage(ctx);

      if (result.processed) {
        await writeInfo("Passenger message processed and forwarded", {
          chatId: ctx.chat.id,
          messageId: ctx.msg.message_id
        });
      }
    } catch (error) {
      await writeError("Unhandled error in message handler", error, {
        chatId: ctx.chat?.id,
        messageId: ctx.msg?.message_id
      });
    }
  });
}

