import dotenv from "dotenv";
import { z } from "zod";

dotenv.config({ override: true });

const chatIdSchema = z
  .preprocess((value) => {
    if (value === undefined || value === null) {
      return value;
    }

    if (typeof value === "number") {
      return value;
    }

    const raw = String(value).trim();

    if (raw.length === 0) {
      return undefined;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : raw;
  }, z.number().int())
  .refine((value) => Math.abs(value) >= 1, "Telegram ID must be a non-zero integer");

const envSchema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  BOT_TOKEN: z.string().min(1, "BOT_TOKEN is required"),
  PASSENGER_GROUP_ID: chatIdSchema,
  DRIVER_GROUP_OR_CHANNEL_ID: chatIdSchema,
  ADMIN_TELEGRAM_ID: chatIdSchema,
  LOG_CHANNEL_ID: z
    .preprocess((value) => {
      if (value === undefined || value === null) {
        return undefined;
      }

      const raw = String(value).trim();
      if (raw.length === 0) {
        return undefined;
      }

      const parsed = Number(raw);
      return Number.isFinite(parsed) ? parsed : raw;
    }, z.number().int().optional())
    .optional(),
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required")
});

const parsed = envSchema.safeParse(process.env);

if (!parsed.success) {
  const flattened = parsed.error.flatten().fieldErrors;
  const details = Object.entries(flattened)
    .map(([key, errors]) => `${key}: ${errors?.join(", ")}`)
    .join("; ");

  throw new Error(`Invalid environment variables: ${details}`);
}

export const env = parsed.data;
export type AppEnv = typeof env;
