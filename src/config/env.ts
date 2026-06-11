import dotenv from "dotenv";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));
export const ENV_FILE_PATH = resolve(CURRENT_DIR, "../../.env");

const dotenvResult = dotenv.config({
  path: ENV_FILE_PATH,
  override: true
});

export const ENV_FILE_LOADED = Boolean(dotenvResult.parsed);

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = String(value).trim();
  return raw.length === 0 ? undefined : raw;
}

function parseBoolean(value: unknown): unknown {
  const sanitized = emptyToUndefined(value);
  if (sanitized === undefined) {
    return undefined;
  }

  if (typeof sanitized === "boolean") {
    return sanitized;
  }

  const lowered = String(sanitized).trim().toLowerCase();
  if (["1", "true", "yes", "on"].includes(lowered)) {
    return true;
  }

  if (["0", "false", "no", "off"].includes(lowered)) {
    return false;
  }

  return sanitized;
}

function parseNumber(value: unknown): unknown {
  const sanitized = emptyToUndefined(value);
  if (sanitized === undefined) {
    return undefined;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : sanitized;
}

const optionalNumberSchema = z.preprocess((value) => parseNumber(value), z.number().optional());
const optionalStringSchema = z.preprocess((value) => emptyToUndefined(value), z.string().optional());
const optionalBooleanSchema = z.preprocess((value) => parseBoolean(value), z.boolean().optional());

const optionalChatIdSchema = z.preprocess(
  (value) => parseNumber(value),
  z
    .number()
    .int()
    .refine((chatId) => Math.abs(chatId) >= 1, "Telegram ID must be a non-zero integer")
    .optional()
);

const logLevelSchema = z.enum(["fatal", "error", "warn", "info", "debug", "trace", "silent"]);
const runtimeModeSchema = z.enum(["userbot", "bot", "both", "legacy"]);
const adminCommandReplyModeSchema = z.enum(["bot", "userbot", "off"]);
const driverDeliveryModeSchema = z.enum(["auto", "bot", "userbot"]);
const telegramLoginModeSchema = z.enum(["auto", "sms", "qr"]);
const aiProviderNameSchema = z.enum(["gemini", "groq", "cerebras", "openrouter", "cloudflare"]);
const sourceRegionSchema = z.enum(["TASHKENT", "GULISTON", "KOMSOMOL"]);

export type SourceRegion = z.infer<typeof sourceRegionSchema>;
const SOURCE_REGIONS: SourceRegion[] = [...sourceRegionSchema.options];

export type AIProviderName = z.infer<typeof aiProviderNameSchema>;

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  LOG_LEVEL: z.preprocess((value) => emptyToUndefined(value), logLevelSchema.optional()),
  TELEGRAM_MODE: z.preprocess((value) => emptyToUndefined(value), runtimeModeSchema.optional()),
  TELEGRAM_API_ID: optionalNumberSchema,
  TELEGRAM_API_HASH: optionalStringSchema,
  TELEGRAM_STRING_SESSION: z.preprocess((value) => (value === undefined ? "" : String(value).trim()), z.string()),
  TELEGRAM_BOT_TOKEN: optionalStringSchema,
  ADMIN_COMMAND_REPLY_MODE: z.preprocess(
    (value) => {
      const sanitized = emptyToUndefined(value);
      return sanitized === undefined ? undefined : String(sanitized).trim().toLowerCase();
    },
    adminCommandReplyModeSchema.optional()
  ),
  DRIVER_DELIVERY_MODE: z.preprocess(
    (value) => {
      const sanitized = emptyToUndefined(value);
      return sanitized === undefined ? undefined : String(sanitized).trim().toLowerCase();
    },
    driverDeliveryModeSchema.optional()
  ),
  TELEGRAM_USE_WSS: optionalBooleanSchema,
  TELEGRAM_FORCE_SMS: optionalBooleanSchema,
  TELEGRAM_LOGIN_MODE: z.preprocess(
    (value) => {
      const sanitized = emptyToUndefined(value);
      return sanitized === undefined ? undefined : String(sanitized).trim().toLowerCase();
    },
    telegramLoginModeSchema.optional()
  ),
  TELEGRAM_CONNECTION_RETRIES: optionalNumberSchema,
  TELEGRAM_RECONNECT_RETRIES: optionalNumberSchema,
  TELEGRAM_RETRY_DELAY_MS: optionalNumberSchema,
  TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS: optionalNumberSchema,
  TELEGRAM_STARTUP_CONNECT_RETRY_MS: optionalNumberSchema,
  PASSENGER_CHAT_IDS: optionalStringSchema,
  PASSENGER_CHAT_IDS_TASHKENT: optionalStringSchema,
  PASSENGER_CHAT_IDS_GULISTON: optionalStringSchema,
  PASSENGER_CHAT_IDS_KOMSOMOL: optionalStringSchema,
  PASSENGER_CHAT_USERNAMES: optionalStringSchema,
  PASSENGER_CHAT_USERNAMES_TASHKENT: optionalStringSchema,
  PASSENGER_CHAT_USERNAMES_GULISTON: optionalStringSchema,
  PASSENGER_CHAT_USERNAMES_KOMSOMOL: optionalStringSchema,
  DRIVER_CHAT_ID: optionalChatIdSchema,
  DRIVER_CHAT_ID_TASHKENT: optionalChatIdSchema,
  DRIVER_CHAT_ID_GULISTON: optionalChatIdSchema,
  DRIVER_CHAT_ID_KOMSOMOL: optionalChatIdSchema,
  PASSENGER_HELP_GROUP_LINK: optionalStringSchema,
  DRIVER_PREMIUM_GROUP_LINK: optionalStringSchema,
  ADMIN_TELEGRAM_ID: optionalChatIdSchema,
  ADMIN_TELEGRAM_IDS: optionalStringSchema,
  ADMIN_TELEGRAM_USERNAMES: optionalStringSchema,
  LOG_CHANNEL_ID: optionalChatIdSchema,
  DATABASE_URL: z.preprocess((value) => emptyToUndefined(value), z.string().min(1, "DATABASE_URL is required")),
  AI_ENABLED: optionalBooleanSchema,
  AI_PROVIDER_ORDER: optionalStringSchema,
  AI_MIN_CONFIDENCE: optionalNumberSchema,
  MIN_CONFIDENCE: optionalNumberSchema,
  AI_COOLDOWN_MINUTES: optionalNumberSchema,
  AI_TIMEOUT_MS: optionalNumberSchema,
  AI_MAX_RETRIES: optionalNumberSchema,
  GEMINI_API_KEY: optionalStringSchema,
  GEMINI_MODEL: optionalStringSchema,
  GROQ_API_KEY: optionalStringSchema,
  GROQ_MODEL: optionalStringSchema,
  CEREBRAS_API_KEY: optionalStringSchema,
  CEREBRAS_MODEL: optionalStringSchema,
  OPENROUTER_API_KEY: optionalStringSchema,
  OPENROUTER_MODEL: optionalStringSchema,
  OPENROUTER_SITE_URL: optionalStringSchema,
  OPENROUTER_APP_NAME: optionalStringSchema,
  CLOUDFLARE_API_TOKEN: optionalStringSchema,
  CLOUDFLARE_ACCOUNT_ID: optionalStringSchema,
  CLOUDFLARE_MODEL: optionalStringSchema,
  DELETE_SOURCE_MESSAGE_IF_ADMIN: optionalBooleanSchema,
  DELETE_IGNORED_MESSAGE_IF_ADMIN: optionalBooleanSchema,
  SEND_PRIVATE_ACK_TO_PASSENGER: optionalBooleanSchema,
  PASSENGER_GROUP_AUTO_REPLIES: optionalBooleanSchema,
  USERBOT_READ_ONLY: optionalBooleanSchema,
  SEND_DRIVER_AD_WARNINGS: optionalBooleanSchema,
  LISTENER_BACKFILL_SECONDS: optionalNumberSchema,
  LISTENER_STARTUP_BACKFILL_LIMIT: optionalNumberSchema,
  LISTENER_PERIODIC_CATCH_UP_ENABLED: optionalBooleanSchema,
  LISTENER_PERIODIC_CATCH_UP_INTERVAL_MS: optionalNumberSchema,
  LISTENER_PERIODIC_CATCH_UP_LIMIT: optionalNumberSchema,
  LISTENER_PROCESS_OUTGOING_MESSAGES: optionalBooleanSchema,
  OUTBOUND_MIN_DELAY_MS: optionalNumberSchema,
  OUTBOUND_JITTER_MS: optionalNumberSchema,
  STARTUP_BACKFILL_DELETE_SOURCE: optionalBooleanSchema,
  SEND_FORMATTED_MESSAGE: optionalBooleanSchema,
  DUPLICATE_WINDOW_MINUTES: optionalNumberSchema
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const flattened = parsed.error.flatten().fieldErrors;
  const details = Object.entries(flattened)
    .map(([key, errors]) => `${key}: ${errors?.join(", ")}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

const envData = parsed.data;
const isGetIdsMode = process.argv.some((arg) => arg.includes("get-ids"));

function failConfig(message: string): never {
  throw new Error(`Invalid environment variables: ${message}`);
}

function requireConfig(condition: boolean, message: string): void {
  if (!condition) {
    failConfig(message);
  }
}

function requireRuntimeConfig(condition: boolean, message: string): void {
  if (isGetIdsMode) {
    return;
  }

  requireConfig(condition, message);
}

function parseChatIdList(rawValue: string | undefined): number[] {
  if (!rawValue) {
    return [];
  }

  const parsed = rawValue
    .split(",")
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value) && Number.isInteger(value) && Math.abs(value) >= 1);

  return [...new Set(parsed)];
}

export function normalizeTelegramChatUsername(rawValue: string | undefined | null): string | null {
  if (!rawValue) {
    return null;
  }

  let value = rawValue.trim();
  if (value.length === 0) {
    return null;
  }

  const usernameCandidate = value
    .replace(/^https?:\/\/t\.me\//i, "")
    .replace(/^https?:\/\/telegram\.me\//i, "")
    .replace(/^@/, "")
    .split(/[/?#]/u)[0];
  value = usernameCandidate?.trim() ?? "";

  if (!/^[a-z][a-z0-9_]{4,31}$/iu.test(value)) {
    return null;
  }

  return value.toLowerCase();
}

function parseChatUsernameList(rawValue: string | undefined): string[] {
  if (!rawValue) {
    return [];
  }

  const parsed = rawValue
    .split(/[\s,]+/u)
    .map((value) => normalizeTelegramChatUsername(value))
    .filter((value): value is string => value !== null);

  return [...new Set(parsed)];
}

function parseProviderOrder(rawValue: string | undefined): AIProviderName[] {
  const values = (rawValue ?? "gemini,groq,cerebras,openrouter,cloudflare")
    .split(",")
    .map((value) => value.trim().toLowerCase())
    .filter((value) => value.length > 0);

  const parsedValues = values
    .map((value) => aiProviderNameSchema.safeParse(value))
    .filter((result): result is { success: true; data: AIProviderName } => result.success)
    .map((result) => result.data);

  return [...new Set(parsedValues)];
}

function hasProviderCredentials(provider: AIProviderName): boolean {
  if (provider === "gemini") {
    return Boolean(envData.GEMINI_API_KEY);
  }

  if (provider === "groq") {
    return Boolean(envData.GROQ_API_KEY);
  }

  if (provider === "cerebras") {
    return Boolean(envData.CEREBRAS_API_KEY);
  }

  if (provider === "openrouter") {
    return Boolean(envData.OPENROUTER_API_KEY);
  }

  return Boolean(envData.CLOUDFLARE_API_TOKEN && envData.CLOUDFLARE_ACCOUNT_ID);
}

const legacyPassengerChatIds = parseChatIdList(parsed.data.PASSENGER_CHAT_IDS);
const passengerChatIdsByRegion: Record<SourceRegion, number[]> = {
  TASHKENT: parseChatIdList(parsed.data.PASSENGER_CHAT_IDS_TASHKENT),
  GULISTON: parseChatIdList(parsed.data.PASSENGER_CHAT_IDS_GULISTON),
  KOMSOMOL: parseChatIdList(parsed.data.PASSENGER_CHAT_IDS_KOMSOMOL)
};
const legacyPassengerChatUsernames = parseChatUsernameList(parsed.data.PASSENGER_CHAT_USERNAMES);
const passengerChatUsernamesByRegion: Record<SourceRegion, string[]> = {
  TASHKENT: parseChatUsernameList(parsed.data.PASSENGER_CHAT_USERNAMES_TASHKENT),
  GULISTON: parseChatUsernameList(parsed.data.PASSENGER_CHAT_USERNAMES_GULISTON),
  KOMSOMOL: parseChatUsernameList(parsed.data.PASSENGER_CHAT_USERNAMES_KOMSOMOL)
};

if (SOURCE_REGIONS.every((region) => passengerChatIdsByRegion[region].length === 0) && legacyPassengerChatIds.length > 0) {
  passengerChatIdsByRegion.TASHKENT = legacyPassengerChatIds;
}

if (SOURCE_REGIONS.every((region) => passengerChatUsernamesByRegion[region].length === 0) && legacyPassengerChatUsernames.length > 0) {
  passengerChatUsernamesByRegion.TASHKENT = legacyPassengerChatUsernames;
}

const passengerChatRegionById = new Map<number, SourceRegion>();
for (const region of SOURCE_REGIONS) {
  for (const chatId of passengerChatIdsByRegion[region]) {
    const existingRegion = passengerChatRegionById.get(chatId);
    if (existingRegion && existingRegion !== region) {
      failConfig(`passenger chat ${chatId} assigned to multiple regions (${existingRegion}, ${region})`);
    }
    passengerChatRegionById.set(chatId, region);
  }
}

const passengerChatRegionByUsername = new Map<string, SourceRegion>();
for (const region of SOURCE_REGIONS) {
  for (const username of passengerChatUsernamesByRegion[region]) {
    const existingRegion = passengerChatRegionByUsername.get(username);
    if (existingRegion && existingRegion !== region) {
      failConfig(`passenger username ${username} assigned to multiple regions (${existingRegion}, ${region})`);
    }
    passengerChatRegionByUsername.set(username, region);
  }
}

const passengerChatIds = [...new Set(SOURCE_REGIONS.flatMap((region) => passengerChatIdsByRegion[region]))];
const passengerChatUsernames = [...new Set(SOURCE_REGIONS.flatMap((region) => passengerChatUsernamesByRegion[region]))];

requireRuntimeConfig(
  passengerChatIds.length > 0 || passengerChatUsernames.length > 0,
  "at least one passenger source chat is required (PASSENGER_CHAT_IDS/PASSENGER_CHAT_USERNAMES or regional variants)"
);

const legacyDriverChatId = parsed.data.DRIVER_CHAT_ID;
const driverChatIdByRegion: Record<SourceRegion, number | null> = {
  TASHKENT: parsed.data.DRIVER_CHAT_ID_TASHKENT ?? legacyDriverChatId ?? null,
  GULISTON: parsed.data.DRIVER_CHAT_ID_GULISTON ?? legacyDriverChatId ?? null,
  KOMSOMOL: parsed.data.DRIVER_CHAT_ID_KOMSOMOL ?? legacyDriverChatId ?? null
};

for (const region of SOURCE_REGIONS) {
  const hasPassengerSources = passengerChatIdsByRegion[region].length > 0 || passengerChatUsernamesByRegion[region].length > 0;
  requireRuntimeConfig(!hasPassengerSources || driverChatIdByRegion[region] !== null, `DRIVER_CHAT_ID_${region} (or fallback DRIVER_CHAT_ID) is required`);
}

const driverChatIds = [...new Set(Object.values(driverChatIdByRegion).filter((chatId): chatId is number => chatId !== null))];
const driverChatId = SOURCE_REGIONS.map((region) => driverChatIdByRegion[region]).find((chatId): chatId is number => chatId !== null) ?? (isGetIdsMode ? 0 : undefined);

if (driverChatId === undefined) {
  failConfig("DRIVER_CHAT_ID is required");
}

const adminTelegramIds = [
  ...new Set([
    ...(parsed.data.ADMIN_TELEGRAM_ID !== undefined ? [parsed.data.ADMIN_TELEGRAM_ID] : []),
    ...parseChatIdList(parsed.data.ADMIN_TELEGRAM_IDS)
  ])
];
const adminTelegramUsernames = parseChatUsernameList(parsed.data.ADMIN_TELEGRAM_USERNAMES);

requireRuntimeConfig(adminTelegramIds.length > 0 || adminTelegramUsernames.length > 0, "ADMIN_TELEGRAM_ID or ADMIN_TELEGRAM_USERNAMES is required");

const primaryAdminTelegramId = adminTelegramIds[0];

const runtimeMode = parsed.data.TELEGRAM_MODE ?? "userbot";
const userbotEnabled = runtimeMode === "userbot" || runtimeMode === "both";
const tokenBotRequired = runtimeMode === "bot" || runtimeMode === "legacy";
requireConfig(
  !userbotEnabled || (parsed.data.TELEGRAM_API_ID !== undefined && Boolean(parsed.data.TELEGRAM_API_HASH)),
  "TELEGRAM_API_ID and TELEGRAM_API_HASH are required for userbot mode"
);

requireConfig(!tokenBotRequired || Boolean(parsed.data.TELEGRAM_BOT_TOKEN), "TELEGRAM_BOT_TOKEN is required for bot mode");

const requestedDriverDeliveryMode = parsed.data.DRIVER_DELIVERY_MODE ?? "auto";
const driverDeliveryMode =
  requestedDriverDeliveryMode === "auto" ? (runtimeMode === "bot" || runtimeMode === "legacy" ? "bot" : "userbot") : requestedDriverDeliveryMode;

requireRuntimeConfig(driverDeliveryMode !== "bot" || Boolean(parsed.data.TELEGRAM_BOT_TOKEN), "TELEGRAM_BOT_TOKEN is required when DRIVER_DELIVERY_MODE=bot");

const aiEnabled = parsed.data.AI_ENABLED ?? false;
const minConfidence = parsed.data.AI_MIN_CONFIDENCE ?? parsed.data.MIN_CONFIDENCE ?? 0.65;
const aiCooldownMinutes = parsed.data.AI_COOLDOWN_MINUTES ?? 10;
const aiTimeoutMs = parsed.data.AI_TIMEOUT_MS ?? 15_000;
const aiMaxRetries = Math.max(0, Math.round(parsed.data.AI_MAX_RETRIES ?? 1));
const telegramUseWss = parsed.data.TELEGRAM_USE_WSS ?? true;
const telegramLoginMode = parsed.data.TELEGRAM_LOGIN_MODE ?? ((parsed.data.TELEGRAM_FORCE_SMS ?? false) ? "sms" : "auto");
const telegramForceSms = telegramLoginMode === "sms";
const normalizeRetryCount = (value: number | undefined, fallback: number): number => {
  if (value === undefined) {
    return fallback;
  }

  if (value < 0) {
    return Number.POSITIVE_INFINITY;
  }

  return Math.round(value);
};

const telegramConnectionRetries = normalizeRetryCount(parsed.data.TELEGRAM_CONNECTION_RETRIES, Number.POSITIVE_INFINITY);
const telegramReconnectRetries = normalizeRetryCount(parsed.data.TELEGRAM_RECONNECT_RETRIES, Number.POSITIVE_INFINITY);
const telegramRetryDelayMs = parsed.data.TELEGRAM_RETRY_DELAY_MS ?? 2_000;
const telegramStartupConnectMaxAttempts = parsed.data.TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS ?? 0;
const telegramStartupConnectRetryMs = parsed.data.TELEGRAM_STARTUP_CONNECT_RETRY_MS ?? 5_000;
const duplicateWindowMinutes = parsed.data.DUPLICATE_WINDOW_MINUTES ?? 5;
const listenerBackfillSeconds = parsed.data.LISTENER_BACKFILL_SECONDS ?? 180;
const listenerStartupBackfillLimit = parsed.data.LISTENER_STARTUP_BACKFILL_LIMIT ?? 20;
const listenerPeriodicCatchUpIntervalMs = parsed.data.LISTENER_PERIODIC_CATCH_UP_INTERVAL_MS ?? 30_000;
const listenerPeriodicCatchUpEnabled = parsed.data.LISTENER_PERIODIC_CATCH_UP_ENABLED ?? false;
const listenerPeriodicCatchUpLimit = listenerPeriodicCatchUpEnabled
  ? (parsed.data.LISTENER_PERIODIC_CATCH_UP_LIMIT ?? Math.max(50, listenerStartupBackfillLimit * 4))
  : 0;
const listenerProcessOutgoingMessages = parsed.data.LISTENER_PROCESS_OUTGOING_MESSAGES ?? false;
const outboundMinDelayMs = Math.max(0, parsed.data.OUTBOUND_MIN_DELAY_MS ?? 0);
const outboundJitterMs = Math.max(0, parsed.data.OUTBOUND_JITTER_MS ?? 0);
const passengerGroupAutoReplies = parsed.data.PASSENGER_GROUP_AUTO_REPLIES ?? false;
const sendDriverAdWarnings = parsed.data.SEND_DRIVER_AD_WARNINGS ?? false;
const providerOrder = parseProviderOrder(parsed.data.AI_PROVIDER_ORDER);
const aiConfiguredProviders = providerOrder.filter((provider) => hasProviderCredentials(provider));
const aiHasConfiguredProvider = aiConfiguredProviders.length > 0;

requireConfig(minConfidence >= 0 && minConfidence <= 1, "AI_MIN_CONFIDENCE (or MIN_CONFIDENCE) must be between 0 and 1");
requireConfig(aiCooldownMinutes > 0, "AI_COOLDOWN_MINUTES must be greater than 0");
requireConfig(aiTimeoutMs > 0, "AI_TIMEOUT_MS must be greater than 0");
requireConfig(duplicateWindowMinutes > 0, "DUPLICATE_WINDOW_MINUTES must be greater than 0");
requireConfig(telegramRetryDelayMs > 0, "TELEGRAM_RETRY_DELAY_MS must be greater than 0");
requireConfig(telegramStartupConnectMaxAttempts >= 0, "TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS must be 0 or greater");
requireConfig(telegramStartupConnectRetryMs > 0, "TELEGRAM_STARTUP_CONNECT_RETRY_MS must be greater than 0");
requireConfig(listenerBackfillSeconds >= 0, "LISTENER_BACKFILL_SECONDS must be 0 or greater");
requireConfig(listenerStartupBackfillLimit >= 0, "LISTENER_STARTUP_BACKFILL_LIMIT must be 0 or greater");
requireConfig(
  listenerPeriodicCatchUpIntervalMs > 0,
  "LISTENER_PERIODIC_CATCH_UP_INTERVAL_MS must be greater than 0"
);
requireConfig(listenerPeriodicCatchUpLimit >= 0, "LISTENER_PERIODIC_CATCH_UP_LIMIT must be 0 or greater");
requireConfig(outboundMinDelayMs >= 0, "OUTBOUND_MIN_DELAY_MS must be 0 or greater");
requireConfig(outboundJitterMs >= 0, "OUTBOUND_JITTER_MS must be 0 or greater");
requireConfig(providerOrder.length > 0, "AI_PROVIDER_ORDER must include at least one valid provider");

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  LOG_LEVEL: parsed.data.LOG_LEVEL ?? "info",
  TELEGRAM_MODE: runtimeMode,
  TELEGRAM_API_ID: parsed.data.TELEGRAM_API_ID ?? 0,
  TELEGRAM_API_HASH: parsed.data.TELEGRAM_API_HASH ?? "",
  TELEGRAM_STRING_SESSION: parsed.data.TELEGRAM_STRING_SESSION,
  TELEGRAM_BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN,
  ADMIN_COMMAND_REPLY_MODE: parsed.data.ADMIN_COMMAND_REPLY_MODE ?? "bot",
  DRIVER_DELIVERY_MODE: driverDeliveryMode,
  DRIVER_DELIVERY_REQUESTED_MODE: requestedDriverDeliveryMode,
  TELEGRAM_USE_WSS: telegramUseWss,
  TELEGRAM_LOGIN_MODE: telegramLoginMode,
  TELEGRAM_FORCE_SMS: telegramForceSms,
  TELEGRAM_CONNECTION_RETRIES: telegramConnectionRetries,
  TELEGRAM_RECONNECT_RETRIES: telegramReconnectRetries,
  TELEGRAM_RETRY_DELAY_MS: Math.round(telegramRetryDelayMs),
  TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS: Math.round(telegramStartupConnectMaxAttempts),
  TELEGRAM_STARTUP_CONNECT_RETRY_MS: Math.round(telegramStartupConnectRetryMs),
  PASSENGER_CHAT_IDS: passengerChatIds,
  PASSENGER_CHAT_IDS_TASHKENT: passengerChatIdsByRegion.TASHKENT,
  PASSENGER_CHAT_IDS_GULISTON: passengerChatIdsByRegion.GULISTON,
  PASSENGER_CHAT_IDS_KOMSOMOL: passengerChatIdsByRegion.KOMSOMOL,
  PASSENGER_CHAT_IDS_BY_REGION: passengerChatIdsByRegion,
  PASSENGER_CHAT_USERNAMES: passengerChatUsernames,
  PASSENGER_CHAT_USERNAMES_TASHKENT: passengerChatUsernamesByRegion.TASHKENT,
  PASSENGER_CHAT_USERNAMES_GULISTON: passengerChatUsernamesByRegion.GULISTON,
  PASSENGER_CHAT_USERNAMES_KOMSOMOL: passengerChatUsernamesByRegion.KOMSOMOL,
  PASSENGER_CHAT_USERNAMES_BY_REGION: passengerChatUsernamesByRegion,
  DRIVER_CHAT_ID: driverChatId,
  DRIVER_CHAT_ID_TASHKENT: driverChatIdByRegion.TASHKENT,
  DRIVER_CHAT_ID_GULISTON: driverChatIdByRegion.GULISTON,
  DRIVER_CHAT_ID_KOMSOMOL: driverChatIdByRegion.KOMSOMOL,
  DRIVER_CHAT_IDS: driverChatIds,
  DRIVER_CHAT_ID_BY_REGION: driverChatIdByRegion,
  PASSENGER_HELP_GROUP_LINK: parsed.data.PASSENGER_HELP_GROUP_LINK ?? null,
  DRIVER_PREMIUM_GROUP_LINK: parsed.data.DRIVER_PREMIUM_GROUP_LINK ?? null,
  ADMIN_TELEGRAM_ID: primaryAdminTelegramId,
  ADMIN_TELEGRAM_IDS: adminTelegramIds,
  ADMIN_TELEGRAM_USERNAMES: adminTelegramUsernames,
  LOG_CHANNEL_ID: parsed.data.LOG_CHANNEL_ID,
  DATABASE_URL: parsed.data.DATABASE_URL,
  AI_ENABLED: aiEnabled,
  AI_PROVIDER_ORDER: providerOrder,
  AI_CONFIGURED_PROVIDERS: aiConfiguredProviders,
  AI_HAS_CONFIGURED_PROVIDER: aiHasConfiguredProvider,
  AI_MIN_CONFIDENCE: minConfidence,
  MIN_CONFIDENCE: minConfidence,
  AI_COOLDOWN_MINUTES: aiCooldownMinutes,
  AI_TIMEOUT_MS: Math.round(aiTimeoutMs),
  AI_MAX_RETRIES: aiMaxRetries,
  GEMINI_API_KEY: parsed.data.GEMINI_API_KEY,
  GEMINI_MODEL: parsed.data.GEMINI_MODEL ?? "gemini-2.5-flash",
  GROQ_API_KEY: parsed.data.GROQ_API_KEY,
  GROQ_MODEL: parsed.data.GROQ_MODEL ?? "llama-3.3-70b-versatile",
  CEREBRAS_API_KEY: parsed.data.CEREBRAS_API_KEY,
  CEREBRAS_MODEL: parsed.data.CEREBRAS_MODEL ?? "gpt-oss-120b",
  OPENROUTER_API_KEY: parsed.data.OPENROUTER_API_KEY,
  OPENROUTER_MODEL: parsed.data.OPENROUTER_MODEL ?? "google/gemini-2.5-flash",
  OPENROUTER_SITE_URL: parsed.data.OPENROUTER_SITE_URL,
  OPENROUTER_APP_NAME: parsed.data.OPENROUTER_APP_NAME ?? "taxi-lead-userbot",
  CLOUDFLARE_API_TOKEN: parsed.data.CLOUDFLARE_API_TOKEN,
  CLOUDFLARE_ACCOUNT_ID: parsed.data.CLOUDFLARE_ACCOUNT_ID,
  CLOUDFLARE_MODEL: parsed.data.CLOUDFLARE_MODEL ?? "@cf/meta/llama-3.1-8b-instruct",
  DELETE_SOURCE_MESSAGE_IF_ADMIN: parsed.data.DELETE_SOURCE_MESSAGE_IF_ADMIN ?? true,
  DELETE_IGNORED_MESSAGE_IF_ADMIN: parsed.data.DELETE_IGNORED_MESSAGE_IF_ADMIN ?? true,
  SEND_PRIVATE_ACK_TO_PASSENGER: parsed.data.SEND_PRIVATE_ACK_TO_PASSENGER ?? true,
  PASSENGER_GROUP_AUTO_REPLIES: passengerGroupAutoReplies,
  USERBOT_READ_ONLY: parsed.data.USERBOT_READ_ONLY ?? false,
  SEND_DRIVER_AD_WARNINGS: sendDriverAdWarnings,
  LISTENER_BACKFILL_SECONDS: Math.round(listenerBackfillSeconds),
  LISTENER_STARTUP_BACKFILL_LIMIT: Math.round(listenerStartupBackfillLimit),
  LISTENER_PERIODIC_CATCH_UP_ENABLED: listenerPeriodicCatchUpEnabled,
  LISTENER_PERIODIC_CATCH_UP_INTERVAL_MS: Math.round(listenerPeriodicCatchUpIntervalMs),
  LISTENER_PERIODIC_CATCH_UP_LIMIT: Math.round(listenerPeriodicCatchUpLimit),
  LISTENER_PROCESS_OUTGOING_MESSAGES: listenerProcessOutgoingMessages,
  OUTBOUND_MIN_DELAY_MS: Math.round(outboundMinDelayMs),
  OUTBOUND_JITTER_MS: Math.round(outboundJitterMs),
  STARTUP_BACKFILL_DELETE_SOURCE: parsed.data.STARTUP_BACKFILL_DELETE_SOURCE ?? false,
  SEND_FORMATTED_MESSAGE: parsed.data.SEND_FORMATTED_MESSAGE ?? true,
  DUPLICATE_WINDOW_MINUTES: Math.round(duplicateWindowMinutes)
};

export function getSourceRegionByPassengerChatId(chatId: number): SourceRegion | null {
  return passengerChatRegionById.get(chatId) ?? null;
}

export function getSourceRegionByPassengerChatUsername(username: string | undefined | null): SourceRegion | null {
  const normalizedUsername = normalizeTelegramChatUsername(username);
  if (!normalizedUsername) {
    return null;
  }

  return passengerChatRegionByUsername.get(normalizedUsername) ?? null;
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

export function registerResolvedPassengerChat(chatId: number, region: SourceRegion): void {
  const existingRegion = passengerChatRegionById.get(chatId);
  if (existingRegion && existingRegion !== region) {
    throw new Error(`Passenger source chat ${chatId} resolved to ${region}, but already mapped to ${existingRegion}`);
  }

  passengerChatRegionById.set(chatId, region);
  pushUnique(passengerChatIdsByRegion[region], chatId);
  pushUnique(passengerChatIds, chatId);
}

export function registerResolvedPassengerChatUsername(username: string, region: SourceRegion): string {
  const normalizedUsername = normalizeTelegramChatUsername(username);
  if (!normalizedUsername) {
    throw new Error(`Invalid passenger source username: ${username}`);
  }

  const existingRegion = passengerChatRegionByUsername.get(normalizedUsername);
  if (existingRegion && existingRegion !== region) {
    throw new Error(`Passenger source username ${normalizedUsername} resolved to ${region}, but already mapped to ${existingRegion}`);
  }

  passengerChatRegionByUsername.set(normalizedUsername, region);
  pushUnique(passengerChatUsernamesByRegion[region], normalizedUsername);
  pushUnique(passengerChatUsernames, normalizedUsername);

  return normalizedUsername;
}

export function getDriverChatIdBySourceChatId(chatId: number): number | null {
  const region = getSourceRegionByPassengerChatId(chatId);
  if (!region) {
    return null;
  }

  return env.DRIVER_CHAT_ID_BY_REGION[region];
}

export function isDriverChatId(chatId: number): boolean {
  return env.DRIVER_CHAT_IDS.includes(chatId);
}

export type AppEnv = typeof env;
