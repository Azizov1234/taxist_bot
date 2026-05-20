import { LeadStatus, LogLevel } from "@prisma/client";
import type { Context } from "grammy";
import { env } from "../config/env.js";
import { prisma } from "../prisma/client.js";
import { classifyMessage } from "./leadClassifier.service.js";
import { extractPhone } from "../utils/phone.js";
import { detectRoute } from "../utils/route.js";
import { stripExtraPunctuation } from "../utils/text.js";
import { sendLogToChannel, writeError, writeInfo, writeWarn } from "./logger.service.js";

export interface ProcessMessageResult {
  processed: boolean;
  reason?: string;
}

function isForwardedMessage(msg: NonNullable<Context["msg"]>): boolean {
  return (
    ("forward_origin" in msg && Boolean(msg.forward_origin)) ||
    ("forward_from" in msg && Boolean(msg.forward_from)) ||
    ("forward_from_chat" in msg && Boolean(msg.forward_from_chat)) ||
    ("forward_sender_name" in msg && Boolean(msg.forward_sender_name)) ||
    ("forward_date" in msg && typeof msg.forward_date === "number")
  );
}

function isSenderChatMessage(msg: NonNullable<Context["msg"]>): boolean {
  return "sender_chat" in msg && Boolean(msg.sender_chat);
}

function getMessageText(msg: Context["msg"]): string | null {
  if (!msg) {
    return null;
  }

  if ("text" in msg && typeof msg.text === "string") {
    return msg.text;
  }

  if ("caption" in msg && typeof msg.caption === "string") {
    return msg.caption;
  }

  return null;
}

function formatFullName(firstName: string, lastName?: string): string {
  const combined = `${firstName} ${lastName ?? ""}`.replace(/\s+/g, " ").trim();
  return combined.length > 0 ? combined : "Noma'lum";
}

function shorten(text: string, max = 300): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}...`;
}

async function sendLeadToDriver(ctx: Context, sourceMessageId: number): Promise<number> {
  try {
    const forwarded = await ctx.api.forwardMessage(env.DRIVERS_CHAT_ID, env.PASSENGERS_CHAT_ID, sourceMessageId);
    return forwarded.message_id;
  } catch (forwardError) {
    await writeWarn("forwardMessage failed, trying copyMessage", {
      sourceMessageId,
      driverChatId: env.DRIVERS_CHAT_ID,
      passengerChatId: env.PASSENGERS_CHAT_ID,
      forwardError: String(forwardError)
    });

    const copied = await ctx.api.copyMessage(env.DRIVERS_CHAT_ID, env.PASSENGERS_CHAT_ID, sourceMessageId);
    return copied.message_id;
  }
}

export async function processIncomingMessage(ctx: Context): Promise<ProcessMessageResult> {
  const msg = ctx.msg;
  const isChannelSource = ctx.chat?.type === "channel";

  if (!msg || !ctx.chat) {
    return { processed: false, reason: "Message context missing" };
  }

  if (ctx.chat.id !== env.PASSENGERS_CHAT_ID) {
    return { processed: false, reason: "Message from disallowed chat" };
  }

  if (ctx.from?.is_bot) {
    return { processed: false, reason: "Message from bot user" };
  }

  if (isForwardedMessage(msg)) {
    return { processed: false, reason: "Forwarded message ignored" };
  }

  if (!isChannelSource && isSenderChatMessage(msg)) {
    return { processed: false, reason: "Sender chat/anonymous message ignored" };
  }

  const sourceMessageId = msg.message_id;
  const sourceChatId = String(ctx.chat.id);
  const userId =
    ctx.from?.id !== undefined
      ? String(ctx.from.id)
      : "sender_chat" in msg && msg.sender_chat
        ? `chat:${msg.sender_chat.id}`
        : `chat:${ctx.chat.id}`;
  const text = getMessageText(msg);

  if (!text || text.trim().length === 0) {
    return { processed: false, reason: "No text/caption in message" };
  }

  const existingByMessage = await prisma.lead.findUnique({
    where: {
      sourceChatId_sourceMessageId: {
        sourceChatId,
        sourceMessageId
      }
    }
  });

  if (existingByMessage) {
    await writeInfo("Duplicate message skipped", {
      sourceChatId,
      sourceMessageId
    });

    return { processed: false, reason: "Duplicate source message" };
  }

  const originalText = stripExtraPunctuation(text);
  const classification = await classifyMessage(originalText);
  const shouldSend = classification.is_passenger_request && classification.confidence >= env.MIN_CONFIDENCE;

  await writeInfo("Message classification", {
    sourceMessageId,
    text: shorten(originalText, 350),
    provider: classification.provider,
    confidence: classification.confidence,
    reason: classification.reason,
    action: shouldSend ? "sent" : "skipped",
    minConfidence: env.MIN_CONFIDENCE,
    providerStatuses: classification.providerStatuses.map((status) => ({ ...status }))
  });

  const fullName =
    ctx.from?.first_name !== undefined
      ? formatFullName(ctx.from.first_name, ctx.from.last_name)
      : "sender_chat" in msg && msg.sender_chat?.title
        ? msg.sender_chat.title
        : ctx.chat.title ?? "Noma'lum";
  const username = ctx.from?.username ?? null;
  const phone = extractPhone(originalText);
  const detectedRoute = detectRoute(originalText);

  if (!shouldSend) {
    await prisma.lead.create({
      data: {
        sourceChatId,
        sourceMessageId,
        userId,
        fullName,
        username,
        phone,
        originalText,
        normalizedText: classification.normalizedText,
        detectedRoute,
        status: LeadStatus.IGNORED
      }
    });

    return {
      processed: false,
      reason: `Skipped by classifier (${classification.provider})`
    };
  }

  const createdLead = await prisma.lead.create({
    data: {
      sourceChatId,
      sourceMessageId,
      userId,
      fullName,
      username,
      phone,
      originalText,
      normalizedText: classification.normalizedText,
      detectedRoute,
      status: LeadStatus.NEW
    }
  });

  try {
    const forwardedMessageId = await sendLeadToDriver(ctx, sourceMessageId);

    await prisma.lead.update({
      where: { id: createdLead.id },
      data: {
        status: LeadStatus.FORWARDED,
        forwardedMessageId
      }
    });

    await writeInfo("Lead sent to drivers chat", {
      leadId: createdLead.id,
      sourceMessageId,
      forwardedMessageId,
      provider: classification.provider,
      confidence: classification.confidence,
      reason: classification.reason
    });

    return { processed: true };
  } catch (error) {
    await writeError("Failed to send lead to drivers chat", error, {
      leadId: createdLead.id,
      sourceMessageId,
      provider: classification.provider
    });

    await sendLogToChannel(ctx.api, LogLevel.ERROR, "Lead forwarding xatosi", {
      leadId: createdLead.id,
      sourceMessageId,
      provider: classification.provider,
      error: String(error)
    });

    return { processed: false, reason: "Forward/copy failed" };
  }
}

export async function getStatusSnapshot(): Promise<{ total: number; forwarded: number; ignored: number; duplicate: number }> {
  const grouped = await prisma.lead.groupBy({
    by: ["status"],
    _count: { status: true }
  });

  const counts = {
    total: 0,
    forwarded: 0,
    ignored: 0,
    duplicate: 0
  };

  for (const row of grouped) {
    counts.total += row._count.status;

    if (row.status === LeadStatus.FORWARDED) {
      counts.forwarded = row._count.status;
    }

    if (row.status === LeadStatus.IGNORED) {
      counts.ignored = row._count.status;
    }

    if (row.status === LeadStatus.DUPLICATE) {
      counts.duplicate = row._count.status;
    }
  }

  return counts;
}

export async function getStatsSnapshot(): Promise<{
  today: { leads: number; forwarded: number; duplicates: number };
  week: { leads: number; forwarded: number; duplicates: number };
}> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const [todayLeads, todayForwarded, todayDuplicates, weekLeads, weekForwarded, weekDuplicates] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: { in: [LeadStatus.NEW, LeadStatus.FORWARDED] } } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.FORWARDED } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.DUPLICATE } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: { in: [LeadStatus.NEW, LeadStatus.FORWARDED] } } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.FORWARDED } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.DUPLICATE } })
  ]);

  return {
    today: {
      leads: todayLeads,
      forwarded: todayForwarded,
      duplicates: todayDuplicates
    },
    week: {
      leads: weekLeads,
      forwarded: weekForwarded,
      duplicates: weekDuplicates
    }
  };
}

