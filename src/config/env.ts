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

const chatIdSchema = z.preprocess((value) => {
  const sanitized = emptyToUndefined(value);
  if (sanitized === undefined) {
    return undefined;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : sanitized;
}, z.number().int().refine((value) => Math.abs(value) >= 1, "Telegram ID must be a non-zero integer"));

const optionalChatIdSchema = z.preprocess((value) => {
  const sanitized = emptyToUndefined(value);
  if (sanitized === undefined) {
    return undefined;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : sanitized;
}, z.number().int().refine((value) => Math.abs(value) >= 1, "Telegram ID must be a non-zero integer").optional());

const optionalNumberSchema = z.preprocess((value) => {
  const sanitized = emptyToUndefined(value);
  if (sanitized === undefined) {
    return undefined;
  }

  const parsed = Number(sanitized);
  return Number.isFinite(parsed) ? parsed : sanitized;
}, z.number().optional());

const optionalStringSchema = z.preprocess((value) => emptyToUndefined(value), z.string().optional());

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  TELEGRAM_BOT_TOKEN: z.preprocess((value) => emptyToUndefined(value), z.string().min(1, "TELEGRAM_BOT_TOKEN is required")),
  PASSENGERS_CHAT_ID: chatIdSchema,
  DRIVERS_CHAT_ID: chatIdSchema,
  ADMIN_TELEGRAM_ID: optionalChatIdSchema,
  LOG_CHANNEL_ID: optionalChatIdSchema,
  DATABASE_URL: z.preprocess((value) => emptyToUndefined(value), z.string().min(1, "DATABASE_URL is required")),
  GROQ_API_KEY: optionalStringSchema,
  GEMINI_API_KEY: optionalStringSchema,
  MIN_CONFIDENCE: optionalNumberSchema,
  AI_COOLDOWN_MINUTES: optionalNumberSchema,
  AI_TIMEOUT_MS: optionalNumberSchema,
  GROQ_MODEL: optionalStringSchema,
  GEMINI_MODEL: optionalStringSchema
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const flattened = parsed.error.flatten().fieldErrors;
  const details = Object.entries(flattened)
    .map(([key, errors]) => `${key}: ${errors?.join(", ")}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

const minConfidence = parsed.data.MIN_CONFIDENCE ?? 0.7;
const aiCooldownMinutes = parsed.data.AI_COOLDOWN_MINUTES ?? 10;
const aiTimeoutMs = parsed.data.AI_TIMEOUT_MS ?? 15_000;

if (minConfidence < 0 || minConfidence > 1) {
  throw new Error("Invalid environment variables: MIN_CONFIDENCE must be between 0 and 1");
}

if (aiCooldownMinutes <= 0) {
  throw new Error("Invalid environment variables: AI_COOLDOWN_MINUTES must be greater than 0");
}

if (aiTimeoutMs <= 0) {
  throw new Error("Invalid environment variables: AI_TIMEOUT_MS must be greater than 0");
}

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  TELEGRAM_BOT_TOKEN: parsed.data.TELEGRAM_BOT_TOKEN,
  PASSENGERS_CHAT_ID: parsed.data.PASSENGERS_CHAT_ID,
  DRIVERS_CHAT_ID: parsed.data.DRIVERS_CHAT_ID,
  ADMIN_TELEGRAM_ID: parsed.data.ADMIN_TELEGRAM_ID,
  LOG_CHANNEL_ID: parsed.data.LOG_CHANNEL_ID,
  DATABASE_URL: parsed.data.DATABASE_URL,
  GROQ_API_KEY: parsed.data.GROQ_API_KEY,
  GEMINI_API_KEY: parsed.data.GEMINI_API_KEY,
  MIN_CONFIDENCE: minConfidence,
  AI_COOLDOWN_MINUTES: aiCooldownMinutes,
  AI_TIMEOUT_MS: Math.round(aiTimeoutMs),
  GROQ_MODEL: parsed.data.GROQ_MODEL ?? "llama-3.1-8b-instant",
  GEMINI_MODEL: parsed.data.GEMINI_MODEL ?? "gemini-2.5-flash"
};

export type AppEnv = typeof env;

