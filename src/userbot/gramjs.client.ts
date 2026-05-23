import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { env } from "../config/env.js";
import { writeInfo, writeWarn } from "../services/logger.service.js";
import { askUser } from "./session.js";

function buildClient(stringSession: string): TelegramClient {
  return new TelegramClient(new StringSession(stringSession), env.TELEGRAM_API_ID, env.TELEGRAM_API_HASH, {
    useWSS: env.TELEGRAM_USE_WSS,
    autoReconnect: true,
    connectionRetries: env.TELEGRAM_CONNECTION_RETRIES,
    reconnectRetries: env.TELEGRAM_RECONNECT_RETRIES,
    retryDelay: env.TELEGRAM_RETRY_DELAY_MS
  });
}

function alignSessionPortWithTransport(client: TelegramClient): { changed: boolean; fromPort: number | null; toPort: number } {
  const session = client.session as any;
  if (!session || typeof session.setDC !== "function") {
    return { changed: false, fromPort: null, toPort: env.TELEGRAM_USE_WSS ? 443 : 80 };
  }

  const desiredPort = env.TELEGRAM_USE_WSS ? 443 : 80;
  const currentPort = Number(session.port);
  const dcId = Number.isInteger(Number(session.dcId)) && Number(session.dcId) > 0 ? Number(session.dcId) : 4;
  const serverAddress =
    typeof session.serverAddress === "string" && session.serverAddress.trim().length > 0
      ? session.serverAddress.trim()
      : "149.154.167.91";

  if (currentPort === desiredPort) {
    return {
      changed: false,
      fromPort: Number.isFinite(currentPort) ? currentPort : null,
      toPort: desiredPort
    };
  }

  session.setDC(dcId, serverAddress, desiredPort);
  return {
    changed: true,
    fromPort: Number.isFinite(currentPort) ? currentPort : null,
    toPort: desiredPort
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
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
  const initialTransportAlign = alignSessionPortWithTransport(client);

  if (initialTransportAlign.changed) {
    await writeInfo("Userbot session transport port aligned with TELEGRAM_USE_WSS", {
      fromPort: initialTransportAlign.fromPort,
      toPort: initialTransportAlign.toPort,
      useWSS: env.TELEGRAM_USE_WSS
    });
  }

  if (hasStoredSession) {
    const maxAttempts = Math.max(0, env.TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS);
    let attempt = 0;

    while (true) {
      attempt += 1;

      try {
        await client.connect();
        await client.getMe();

        await writeInfo("Userbot connected with TELEGRAM_STRING_SESSION", {
          attempt,
          useWSS: env.TELEGRAM_USE_WSS,
          connectionRetries: env.TELEGRAM_CONNECTION_RETRIES,
          reconnectRetries: env.TELEGRAM_RECONNECT_RETRIES
        });
        return client;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        const shouldStop = maxAttempts > 0 && attempt >= maxAttempts;

        await writeWarn("Stored TELEGRAM_STRING_SESSION connection failed; retrying", {
          attempt,
          maxAttempts: maxAttempts === 0 ? "infinite" : maxAttempts,
          retryAfterMs: env.TELEGRAM_STARTUP_CONNECT_RETRY_MS,
          useWSS: env.TELEGRAM_USE_WSS,
          error: message
        });

        try {
          await client.disconnect();
        } catch {
          // ignore
        }

        if (shouldStop) {
          throw new Error(`Userbot startup connection failed after ${attempt} attempts: ${message}`);
        }

        await sleep(env.TELEGRAM_STARTUP_CONNECT_RETRY_MS);
        client = buildClient(env.TELEGRAM_STRING_SESSION);
        alignSessionPortWithTransport(client);
      }
    }
  }

  await startInteractive(client);
  await writeInfo("Userbot connected with fresh interactive login");

  return client;
}
