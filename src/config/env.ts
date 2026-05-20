import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

function emptyToUndefined(value: unknown): unknown {
  if (value === undefined || value === null) {
    return undefined;
  }

  const raw = String(value).trim();
  return raw.length === 0 ? undefined : raw;
}

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

const rawEnvSchema = z
  .object({
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    TELEGRAM_BOT_TOKEN: optionalStringSchema,
    BOT_TOKEN: optionalStringSchema,
    PASSENGERS_CHAT_ID: optionalChatIdSchema,
    PASSENGER_GROUP_ID: optionalChatIdSchema,
    DRIVERS_CHAT_ID: optionalChatIdSchema,
    DRIVER_GROUP_OR_CHANNEL_ID: optionalChatIdSchema,
    ADMIN_TELEGRAM_ID: optionalChatIdSchema,
    LOG_CHANNEL_ID: optionalChatIdSchema,
    DATABASE_URL: optionalStringSchema,
    GROQ_API_KEY: optionalStringSchema,
    GEMINI_API_KEY: optionalStringSchema,
    OPENROUTER_API_KEY: optionalStringSchema,
    MIN_CONFIDENCE: optionalNumberSchema,
    AI_COOLDOWN_MINUTES: optionalNumberSchema,
    AI_TIMEOUT_MS: optionalNumberSchema,
    GROQ_MODEL: optionalStringSchema,
    GEMINI_MODEL: optionalStringSchema,
    OPENROUTER_MODEL: optionalStringSchema
  })
  .superRefine((data, ctx) => {
    if (!data.TELEGRAM_BOT_TOKEN && !data.BOT_TOKEN) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "TELEGRAM_BOT_TOKEN is required (or BOT_TOKEN for backward compatibility)",
        path: ["TELEGRAM_BOT_TOKEN"]
      });
    }

    if (data.PASSENGERS_CHAT_ID === undefined && data.PASSENGER_GROUP_ID === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "PASSENGERS_CHAT_ID is required (or PASSENGER_GROUP_ID for backward compatibility)",
        path: ["PASSENGERS_CHAT_ID"]
      });
    }

    if (data.DRIVERS_CHAT_ID === undefined && data.DRIVER_GROUP_OR_CHANNEL_ID === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DRIVERS_CHAT_ID is required (or DRIVER_GROUP_OR_CHANNEL_ID for backward compatibility)",
        path: ["DRIVERS_CHAT_ID"]
      });
    }

    if (!data.DATABASE_URL) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: "DATABASE_URL is required",
        path: ["DATABASE_URL"]
      });
    }
  });

const parsed = rawEnvSchema.safeParse(process.env);

if (!parsed.success) {
  const flattened = parsed.error.flatten().fieldErrors;
  const details = Object.entries(flattened)
    .map(([key, errors]) => `${key}: ${errors?.join(", ")}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

const token = parsed.data.TELEGRAM_BOT_TOKEN ?? parsed.data.BOT_TOKEN;
const passengersChatId = parsed.data.PASSENGERS_CHAT_ID ?? parsed.data.PASSENGER_GROUP_ID;
const driversChatId = parsed.data.DRIVERS_CHAT_ID ?? parsed.data.DRIVER_GROUP_OR_CHANNEL_ID;

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

if (!token || passengersChatId === undefined || driversChatId === undefined || !parsed.data.DATABASE_URL) {
  throw new Error("Invalid environment variables: missing required Telegram or database configuration");
}

export const env = {
  NODE_ENV: parsed.data.NODE_ENV,
  TELEGRAM_BOT_TOKEN: token,
  PASSENGERS_CHAT_ID: passengersChatId,
  DRIVERS_CHAT_ID: driversChatId,
  ADMIN_TELEGRAM_ID: parsed.data.ADMIN_TELEGRAM_ID,
  LOG_CHANNEL_ID: parsed.data.LOG_CHANNEL_ID,
  DATABASE_URL: parsed.data.DATABASE_URL,
  GROQ_API_KEY: parsed.data.GROQ_API_KEY,
  GEMINI_API_KEY: parsed.data.GEMINI_API_KEY,
  OPENROUTER_API_KEY: parsed.data.OPENROUTER_API_KEY,
  MIN_CONFIDENCE: minConfidence,
  AI_COOLDOWN_MINUTES: aiCooldownMinutes,
  AI_TIMEOUT_MS: Math.round(aiTimeoutMs),
  GROQ_MODEL: parsed.data.GROQ_MODEL ?? "llama-3.1-8b-instant",
  GEMINI_MODEL: parsed.data.GEMINI_MODEL ?? "gemini-1.5-flash",
  OPENROUTER_MODEL: parsed.data.OPENROUTER_MODEL ?? "openai/gpt-4o-mini",

  // Backward-compatible aliases
  BOT_TOKEN: token,
  PASSENGER_GROUP_ID: passengersChatId,
  DRIVER_GROUP_OR_CHANNEL_ID: driversChatId
};

export type AppEnv = typeof env;
