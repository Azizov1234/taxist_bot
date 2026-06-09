import { env } from "../config/env.js";
import { shouldBlockPassengerGroupWrite, toNumericChatId } from "../utils/passengerGroupWrite.js";
import { writeInfo } from "./logger.service.js";

export interface SendTelegramBotMessageOptions {
  replyToMessageId?: number;
  replyMarkup?: Record<string, unknown>;
}

export interface SentTelegramBotMessage {
  messageId: number;
}

export async function sendTelegramBotMessage(
  chatId: number | string,
  text: string,
  options: SendTelegramBotMessageOptions = {}
): Promise<SentTelegramBotMessage | null> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return null;
  }

  const numericChatId = toNumericChatId(chatId);
  if (numericChatId !== null && shouldBlockPassengerGroupWrite(numericChatId)) {
    await writeInfo("Bot API write skipped: passenger group auto-replies disabled", {
      chatId: numericChatId
    });
    return null;
  }

  const body: Record<string, unknown> = {
    chat_id: String(chatId),
    text,
    disable_web_page_preview: true
  };

  if (options.replyToMessageId !== undefined) {
    body.reply_parameters = {
      message_id: options.replyToMessageId,
      allow_sending_without_reply: true
    };
  }

  if (options.replyMarkup !== undefined) {
    body.reply_markup = options.replyMarkup;
  }

  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify(body)
  });

  const responseBody = await response.text().catch(() => "");

  if (!response.ok) {
    throw new Error(`Telegram Bot API sendMessage failed (${response.status}): ${responseBody.slice(0, 300)}`);
  }

  let parsed: any;
  try {
    parsed = JSON.parse(responseBody);
  } catch {
    throw new Error("Telegram Bot API sendMessage returned invalid JSON");
  }

  const messageId = Number(parsed?.result?.message_id);
  if (!Number.isInteger(messageId) || messageId <= 0) {
    throw new Error("Telegram Bot API sendMessage response did not include message_id");
  }

  return { messageId };
}
