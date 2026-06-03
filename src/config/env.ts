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
const runtimeModeSchema = z.enum(["userbot", "legacy"]);
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
  DRIVER_CHAT_ID: optionalChatIdSchema,
  DRIVER_CHAT_ID_TASHKENT: optionalChatIdSchema,
  DRIVER_CHAT_ID_GULISTON: optionalChatIdSchema,
  DRIVER_CHAT_ID_KOMSOMOL: optionalChatIdSchema,
  PASSENGER_HELP_GROUP_LINK: optionalStringSchema,
  DRIVER_PREMIUM_GROUP_LINK: optionalStringSchema,
  ADMIN_TELEGRAM_ID: optionalChatIdSchema,
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
  LISTENER_BACKFILL_SECONDS: optionalNumberSchema,
  LISTENER_STARTUP_BACKFILL_LIMIT: optionalNumberSchema,
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

if (SOURCE_REGIONS.every((region) => passengerChatIdsByRegion[region].length === 0) && legacyPassengerChatIds.length > 0) {
  passengerChatIdsByRegion.TASHKENT = legacyPassengerChatIds;
}

const passengerChatRegionById = new Map<number, SourceRegion>();
for (const region of SOURCE_REGIONS) {
  for (const chatId of passengerChatIdsByRegion[region]) {
    const existingRegion = passengerChatRegionById.get(chatId);
    if (existingRegion && existingRegion !== region) {
      throw new Error(`Invalid environment variables: passenger chat ${chatId} assigned to multiple regions (${existingRegion}, ${region})`);
    }
    passengerChatRegionById.set(chatId, region);
  }
}

const passengerChatIds = [...new Set(SOURCE_REGIONS.flatMap((region) => passengerChatIdsByRegion[region]))];

if (passengerChatIds.length === 0 && !isGetIdsMode) {
  throw new Error(
    "Invalid environment variables: at least one passenger source chat is required (PASSENGER_CHAT_IDS or regional PASSENGER_CHAT_IDS_*)"
  );
}

const legacyDriverChatId = parsed.data.DRIVER_CHAT_ID;
const driverChatIdByRegion: Record<SourceRegion, number | null> = {
  TASHKENT: parsed.data.DRIVER_CHAT_ID_TASHKENT ?? legacyDriverChatId ?? null,
  GULISTON: parsed.data.DRIVER_CHAT_ID_GULISTON ?? legacyDriverChatId ?? null,
  KOMSOMOL: parsed.data.DRIVER_CHAT_ID_KOMSOMOL ?? legacyDriverChatId ?? null
};

for (const region of SOURCE_REGIONS) {
  if (passengerChatIdsByRegion[region].length > 0 && driverChatIdByRegion[region] === null && !isGetIdsMode) {
    throw new Error(`Invalid environment variables: DRIVER_CHAT_ID_${region} (or fallback DRIVER_CHAT_ID) is required`);
  }
}

const driverChatIds = [...new Set(Object.values(driverChatIdByRegion).filter((chatId): chatId is number => chatId !== null))];
const driverChatId = SOURCE_REGIONS.map((region) => driverChatIdByRegion[region]).find((chatId): chatId is number => chatId !== null) ?? (isGetIdsMode ? 0 : undefined);

if (driverChatId === undefined) {
  throw new Error("Invalid environment variables: DRIVER_CHAT_ID is required");
}

if (parsed.data.ADMIN_TELEGRAM_ID === undefined && !isGetIdsMode) {
  throw new Error("Invalid environment variables: ADMIN_TELEGRAM_ID is required");
}

const runtimeMode = parsed.data.TELEGRAM_MODE ?? "userbot";
if (runtimeMode === "userbot" && (parsed.data.TELEGRAM_API_ID === undefined || !parsed.data.TELEGRAM_API_HASH)) {
  throw new Error("Invalid environment variables: TELEGRAM_API_ID and TELEGRAM_API_HASH are required for userbot mode");
}

if (runtimeMode === "legacy" && !parsed.data.TELEGRAM_BOT_TOKEN) {
  throw new Error("Invalid environment variables: TELEGRAM_BOT_TOKEN is required for legacy mode");
}

const aiEnabled = parsed.data.AI_ENABLED ?? true;
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
const providerOrder = parseProviderOrder(parsed.data.AI_PROVIDER_ORDER);
const aiConfiguredProviders = providerOrder.filter((provider) => hasProviderCredentials(provider));
const aiHasConfiguredProvider = aiConfiguredProviders.length > 0;

if (minConfidence < 0 || minConfidence > 1) {
  throw new Error("Invalid environment variables: AI_MIN_CONFIDENCE (or MIN_CONFIDENCE) must be between 0 and 1");
}

if (aiCooldownMinutes <= 0) {
  throw new Error("Invalid environment variables: AI_COOLDOWN_MINUTES must be greater than 0");
}

if (aiTimeoutMs <= 0) {
  throw new Error("Invalid environment variables: AI_TIMEOUT_MS must be greater than 0");
}

if (duplicateWindowMinutes <= 0) {
  throw new Error("Invalid environment variables: DUPLICATE_WINDOW_MINUTES must be greater than 0");
}

if (telegramRetryDelayMs <= 0) {
  throw new Error("Invalid environment variables: TELEGRAM_RETRY_DELAY_MS must be greater than 0");
}

if (telegramStartupConnectMaxAttempts < 0) {
  throw new Error("Invalid environment variables: TELEGRAM_STARTUP_CONNECT_MAX_ATTEMPTS must be 0 or greater");
}

if (telegramStartupConnectRetryMs <= 0) {
  throw new Error("Invalid environment variables: TELEGRAM_STARTUP_CONNECT_RETRY_MS must be greater than 0");
}

if (listenerBackfillSeconds < 0) {
  throw new Error("Invalid environment variables: LISTENER_BACKFILL_SECONDS must be 0 or greater");
}

if (listenerStartupBackfillLimit < 0) {
  throw new Error("Invalid environment variables: LISTENER_STARTUP_BACKFILL_LIMIT must be 0 or greater");
}

if (providerOrder.length === 0) {
  throw new Error("Invalid environment variables: AI_PROVIDER_ORDER must include at least one valid provider");
}

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  LOG_LEVEL: parsed.data.LOG_LEVEL ?? "info",
  TELEGRAM_MODE: runtimeMode,
  TELEGRAM_API_ID: parsed.data.TELEGRAM_API_ID ?? 0,
  TELEGRAM_API_HASH: parsed.data.TELEGRAM_API_HASH ?? "",
  TELEGRAM_STRING_SESSION: parsed.data.TELEGRAM_STRING_SESSION,
  TELEGRAM_BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN,
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
  DRIVER_CHAT_ID: driverChatId,
  DRIVER_CHAT_ID_TASHKENT: driverChatIdByRegion.TASHKENT,
  DRIVER_CHAT_ID_GULISTON: driverChatIdByRegion.GULISTON,
  DRIVER_CHAT_ID_KOMSOMOL: driverChatIdByRegion.KOMSOMOL,
  DRIVER_CHAT_IDS: driverChatIds,
  DRIVER_CHAT_ID_BY_REGION: driverChatIdByRegion,
  PASSENGER_HELP_GROUP_LINK: parsed.data.PASSENGER_HELP_GROUP_LINK ?? null,
  DRIVER_PREMIUM_GROUP_LINK: parsed.data.DRIVER_PREMIUM_GROUP_LINK ?? null,
  ADMIN_TELEGRAM_ID: parsed.data.ADMIN_TELEGRAM_ID,
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
  LISTENER_BACKFILL_SECONDS: Math.round(listenerBackfillSeconds),
  LISTENER_STARTUP_BACKFILL_LIMIT: Math.round(listenerStartupBackfillLimit),
  STARTUP_BACKFILL_DELETE_SOURCE: parsed.data.STARTUP_BACKFILL_DELETE_SOURCE ?? false,
  SEND_FORMATTED_MESSAGE: parsed.data.SEND_FORMATTED_MESSAGE ?? true,
  DUPLICATE_WINDOW_MINUTES: Math.round(duplicateWindowMinutes)
};

export function getSourceRegionByPassengerChatId(chatId: number): SourceRegion | null {
  return passengerChatRegionById.get(chatId) ?? null;
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
