import type { Api, RawApi } from "grammy";
import pino from "pino";
import { LogLevel, Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../prisma/client.js";

export const logger = pino({
  name: "taxi-lead-bot",
  level: env.NODE_ENV === "production" ? "info" : "debug"
});

type MetaValue = string | number | boolean | null | undefined | MetaRecord | MetaValue[];
interface MetaRecord {
  [key: string]: MetaValue;
}

function sanitizeMeta(meta?: MetaRecord): MetaRecord | undefined {
  if (!meta) {
    return undefined;
  }

  return JSON.parse(JSON.stringify(meta)) as MetaRecord;
}

export async function saveBotLog(level: LogLevel, message: string, meta?: MetaRecord): Promise<void> {
  const safeMeta = sanitizeMeta(meta);

  try {
    const data: Prisma.BotLogCreateInput = {
      level,
      message
    };

    if (safeMeta !== undefined) {
      data.meta = safeMeta as Prisma.InputJsonValue;
    }

    await prisma.botLog.create({
      data
    });
  } catch (error) {
    logger.error({ error, message, meta: safeMeta }, "Failed to persist bot log");
  }
}

export async function writeInfo(message: string, meta?: MetaRecord): Promise<void> {
  logger.info({ meta }, message);
  await saveBotLog(LogLevel.INFO, message, meta);
}

export async function writeWarn(message: string, meta?: MetaRecord): Promise<void> {
  logger.warn({ meta }, message);
  await saveBotLog(LogLevel.WARN, message, meta);
}

export async function writeError(message: string, error?: unknown, meta?: MetaRecord): Promise<void> {
  logger.error({ error, meta }, message);

  await saveBotLog(LogLevel.ERROR, message, {
    ...meta,
    error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack } : String(error)
  });
}

export async function sendLogToChannel(
  api: Api<RawApi>,
  level: LogLevel,
  message: string,
  meta?: MetaRecord
): Promise<void> {
  if (!env.LOG_CHANNEL_ID) {
    return;
  }

  const header = level === LogLevel.ERROR ? "ERROR" : level === LogLevel.WARN ? "WARN" : "INFO";
  const payload = meta ? `\n\nMeta: ${JSON.stringify(meta).slice(0, 2500)}` : "";

  try {
    await api.sendMessage(env.LOG_CHANNEL_ID, `[${header}] ${message}${payload}`);
  } catch (error) {
    logger.error({ error }, "Failed to send log to LOG_CHANNEL_ID");
  }
}
