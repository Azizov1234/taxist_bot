import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions/index.js";
import { env } from "../config/env.js";
import { writeInfo, writeWarn } from "../services/logger.service.js";
import { askUser } from "./session.js";
import { hostname } from "node:os";

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

async function sendBotApiAlert(chatId: number, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const endpoint = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`;
  const response = await fetch(endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      chat_id: String(chatId),
      text
    })
  });

  if (!response.ok) {
    const body = await response.text().catch(() => "");
    throw new Error(`Telegram Bot API sendMessage failed (${response.status}): ${body.slice(0, 300)}`);
  }
}

async function notifySessionDuplicateAlert(payload: { attempt: number; error: string }): Promise<void> {
  const host = hostname();
  const alertText = [
    "Taxi bot ogohlantirish:",
    "AUTH_KEY_DUPLICATED aniqlandi.",
    `Host: ${host}`,
    `PID: ${process.pid}`,
    `Attempt: ${payload.attempt}`,
    "Ehtimol bir xil TELEGRAM_STRING_SESSION boshqa joyda ham ishlayapti.",
    "Yechim: boshqa instance'larni to'xtating va yangi TELEGRAM_STRING_SESSION oling."
  ].join("\n");

  await writeWarn("Duplicate Telegram session detected", {
    host,
    pid: process.pid,
    attempt: payload.attempt,
    error: payload.error
  });

  console.error(alertText);

  if (!env.TELEGRAM_BOT_TOKEN) {
    return;
  }

  const targetChatIds = new Set<number>();
  if (env.ADMIN_TELEGRAM_ID) {
    targetChatIds.add(env.ADMIN_TELEGRAM_ID);
  }
  if (env.LOG_CHANNEL_ID) {
    targetChatIds.add(env.LOG_CHANNEL_ID);
  }

  for (const chatId of targetChatIds) {
    try {
      await sendBotApiAlert(chatId, alertText);
    } catch (error) {
      await writeWarn("Failed to send duplicate-session alert via Bot API", {
        chatId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}

function normalizePhoneNumber(raw: string): string | null {
  const trimmed = raw.trim();
  let digitsOnly = trimmed.replace(/\D/g, "");

  if (digitsOnly.length === 0) {
    return null;
  }

  if (digitsOnly.startsWith("00")) {
    digitsOnly = digitsOnly.slice(2);
  }

  if (digitsOnly.length === 9) {
    digitsOnly = `998${digitsOnly}`;
  }

  if (!digitsOnly.startsWith("998")) {
    return null;
  }

  if (digitsOnly.length !== 12) {
    return null;
  }

  return `+${digitsOnly}`;
}

function isValidPhoneNumber(value: string): boolean {
  return /^\+998\d{9}$/.test(value);
}

function parseFloodWaitSeconds(message: string): number | null {
  const upperMessage = message.toUpperCase();
  const floodWaitMatch = upperMessage.match(/FLOOD_WAIT_(\d+)/);
  if (floodWaitMatch) {
    const seconds = Number(floodWaitMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const genericWaitMatch = upperMessage.match(/A WAIT OF (\d+) SECONDS IS REQUIRED/);
  if (genericWaitMatch) {
    const seconds = Number(genericWaitMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  return null;
}

function formatFloodWait(seconds: number): string {
  if (seconds < 60) {
    return `${seconds} seconds`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (remainingSeconds === 0) {
    return `${minutes} minute(s)`;
  }

  return `${minutes} minute(s) ${remainingSeconds} second(s)`;
}

function toBase64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createRestartAuthWithQrError(): Error {
  const error = new Error("Switching auth flow to QR mode");
  (error as Error & { errorMessage?: string }).errorMessage = "RESTART_AUTH_WITH_QR";
  return error;
}

function buildQrLoginUrl(token: Buffer): string {
  return `tg://login?token=${toBase64Url(token)}`;
}

function buildInteractiveLoginErrorMessage(message: string): string | null {
  const upperMessage = message.toUpperCase();
  const floodWaitSeconds = parseFloodWaitSeconds(message);
  if (floodWaitSeconds !== null) {
    return `Telegram temporary flood limit triggered. Retry after ${formatFloodWait(floodWaitSeconds)}.`;
  }

  if (upperMessage.includes("PHONE_NUMBER_FLOOD")) {
    return "Too many login attempts for this phone number. Wait a bit and try again.";
  }

  if (upperMessage.includes("PHONE_PASSWORD_FLOOD")) {
    return "Too many 2FA password attempts. Wait before trying again.";
  }

  if (upperMessage.includes("PHONE_CODE_INVALID")) {
    return "The login code is invalid. Please enter the latest code from Telegram app or SMS.";
  }

  if (upperMessage.includes("PHONE_CODE_EXPIRED")) {
    return "The login code expired. Restart login and request a fresh code.";
  }

  if (upperMessage.includes("PHONE_NUMBER_INVALID")) {
    return "Phone number is invalid. Use Uzbekistan format: +998XXXXXXXXX or 9 local digits.";
  }

  if (upperMessage.includes("SEND_CODE_UNAVAILABLE")) {
    return env.TELEGRAM_FORCE_SMS
      ? "SMS code is unavailable for this account/region. Set TELEGRAM_LOGIN_MODE=auto (or TELEGRAM_FORCE_SMS=false) and retry."
      : "Telegram cannot send a new code right now. Wait a bit and retry.";
  }

  return null;
}

function classifySessionAuthError(message: string): "AUTH_KEY_DUPLICATED" | "AUTH_KEY_INVALID" | "SESSION_REVOKED" | null {
  const normalized = message.toUpperCase();

  if (normalized.includes("AUTH_KEY_DUPLICATED")) {
    return "AUTH_KEY_DUPLICATED";
  }

  if (normalized.includes("AUTH_KEY_INVALID") || normalized.includes("AUTH_KEY_UNREGISTERED")) {
    return "AUTH_KEY_INVALID";
  }

  if (normalized.includes("SESSION_REVOKED") || normalized.includes("SESSION_EXPIRED")) {
    return "SESSION_REVOKED";
  }

  return null;
}

function buildSessionRecoveryHint(errorType: "AUTH_KEY_DUPLICATED" | "AUTH_KEY_INVALID" | "SESSION_REVOKED"): string {
  if (errorType === "AUTH_KEY_DUPLICATED") {
    return "AUTH_KEY_DUPLICATED: this TELEGRAM_STRING_SESSION was used in multiple places and got invalidated by Telegram. Generate a new TELEGRAM_STRING_SESSION and keep only one running instance.";
  }

  if (errorType === "AUTH_KEY_INVALID") {
    return "AUTH_KEY_INVALID: stored TELEGRAM_STRING_SESSION is no longer valid. Generate a new TELEGRAM_STRING_SESSION and update .env.";
  }

  return "SESSION_REVOKED: Telegram revoked the stored session. Generate a new TELEGRAM_STRING_SESSION and update .env.";
}

async function startInteractive(client: TelegramClient): Promise<void> {
  const isSmsMode = env.TELEGRAM_LOGIN_MODE === "sms";
  const isQrMode = env.TELEGRAM_LOGIN_MODE === "qr";

  console.log(
    isQrMode
      ? "Telegram login mode: QR (scan/link confirmation required)."
      : isSmsMode
      ? "Telegram login mode: SMS forced (TELEGRAM_LOGIN_MODE=sms)."
      : "Telegram login mode: auto (code is usually sent to Telegram app)."
  );

  await client.start({
    phoneNumber: async () => {
      if (isQrMode) {
        throw createRestartAuthWithQrError();
      }

      while (true) {
        const input = await askUser("Telegram phone number (+998... or 9 digits): ");
        const normalized = normalizePhoneNumber(input);

        if (!normalized || !isValidPhoneNumber(normalized)) {
          console.log("Invalid phone format. Use +998901234567 or only 9 local digits (e.g. 901234567).");
          continue;
        }

        if (input.trim() !== normalized) {
          console.log(`Phone normalized to ${normalized}`);
        }

        return normalized;
      }
    },
    phoneCode: async (isCodeViaApp?: boolean) => {
      if (isQrMode) {
        return "";
      }

      console.log(`isCodeViaApp: ${String(isCodeViaApp)}`);

      if (isCodeViaApp === true) {
        console.log("Login code was sent to your Telegram app (look in chats from Telegram service).");
      } else if (isCodeViaApp === false) {
        console.log("Login code was sent via SMS.");
      } else {
        console.log("Login code delivery channel is unknown (Telegram did not specify app/SMS).");
      }

      return askUser("Telegram code: ");
    },
    password: async () => askUser("2FA password (agar bo'lmasa Enter): "),
    forceSMS: isSmsMode,
    qrCode: async ({ token, expires }) => {
      if (!isQrMode) {
        return;
      }

      const qrLoginUrl = buildQrLoginUrl(token);
      const expiresAt = new Date(expires * 1000).toISOString();
      const qrImageUrl = `https://api.qrserver.com/v1/create-qr-code/?size=300x300&data=${encodeURIComponent(qrLoginUrl)}`;

      console.log("\nOpen Telegram on your phone -> Settings -> Devices -> Link Desktop Device.");
      console.log("Then scan this QR image URL or open the tg:// login URL directly on your phone.");
      console.log(`QR expires at (UTC): ${expiresAt}`);
      console.log(`QR image URL: ${qrImageUrl}`);
      console.log(`QR login URL: ${qrLoginUrl}\n`);
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : String(error);
      const normalized = message.toUpperCase();
      const friendlyMessage = buildInteractiveLoginErrorMessage(message);

      if (normalized.includes("SEND_CODE_UNAVAILABLE") && isSmsMode) {
        throw new Error(
          "SEND_CODE_UNAVAILABLE with forced SMS. Set TELEGRAM_LOGIN_MODE=auto (or TELEGRAM_FORCE_SMS=false) and retry. Telegram may only allow app-based code delivery for this account/region."
        );
      }

      if (friendlyMessage) {
        console.error(`Telegram login error: ${friendlyMessage}`);
        return;
      }

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
        const authErrorType = classifySessionAuthError(message);
        const shouldStop = maxAttempts > 0 && attempt >= maxAttempts;

        if (authErrorType) {
          const recoveryHint = buildSessionRecoveryHint(authErrorType);
          await writeWarn("Stored TELEGRAM_STRING_SESSION is unrecoverable; stopping startup retries", {
            attempt,
            useWSS: env.TELEGRAM_USE_WSS,
            errorType: authErrorType,
            error: message,
            recoveryHint
          });

          if (authErrorType === "AUTH_KEY_DUPLICATED") {
            await notifySessionDuplicateAlert({
              attempt,
              error: message
            });
          }

          throw new Error(recoveryHint);
        }

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
