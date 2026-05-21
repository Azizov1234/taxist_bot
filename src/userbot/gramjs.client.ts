import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { env } from "../config/env.js";
import { writeInfo, writeWarn } from "../services/logger.service.js";
import { askUser } from "./session.js";

function buildClient(stringSession: string): TelegramClient {
  return new TelegramClient(new StringSession(stringSession), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    connectionRetries: 5
  });
}

async function startInteractive(client: TelegramClient): Promise<void> {
  await client.start({
    phoneNumber: async () => askUser("Telegram phone number (+998...): "),
    phoneCode: async () => askUser("Telegram code: "),
    password: async () => askUser("2FA password (agar bo'lmasa Enter): "),
    onError: (error) => {
      console.error("Telegram login error:", error);
    }
  });

  const sessionString = (client.session as StringSession).save();
  if (sessionString.trim().length > 0) {
    console.log("\nTELEGRAM_STRING_SESSION:");
    console.log(sessionString);
    console.log("\nTELEGRAM_STRING_SESSION ni .env ga qo'ying va qayta run qiling\n");
  }
}

export async function createAndConnectUserbotClient(): Promise<TelegramClient> {
  const hasStoredSession = env.TELEGRAM_STRING_SESSION.trim().length > 0;

  let client = buildClient(env.TELEGRAM_STRING_SESSION);

  if (hasStoredSession) {
    try {
      await client.connect();
      await client.getMe();

      await writeInfo("Userbot connected with TELEGRAM_STRING_SESSION");
      return client;
    } catch (error) {
      await writeWarn("Stored TELEGRAM_STRING_SESSION failed, switching to interactive login", {
        error: error instanceof Error ? error.message : String(error)
      });

      try {
        await client.disconnect();
      } catch {
        // ignore
      }

      client = buildClient("");
    }
  }

  await startInteractive(client);
  await writeInfo("Userbot connected with fresh interactive login");

  return client;
}
