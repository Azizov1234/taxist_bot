import { LeadStatus, LogLevel } from "@prisma/client";
import type { Context } from "grammy";
import { env } from "../config/env.js";
import { prisma } from "../prisma/client.js";
import { classifyLead } from "./leadClassifier.service.js";
import { extractPhone } from "../utils/phone.js";
import { formatMessageDate } from "../utils/time.js";
import { stripExtraPunctuation } from "../utils/text.js";
import { sendLogToChannel, writeError, writeInfo, writeWarn } from "./logger.service.js";

export interface ProcessMessageResult {
  processed: boolean;
  reason?: string;
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

function shorten(text: string, max = 2500): string {
  if (text.length <= max) {
    return text;
  }

  return `${text.slice(0, max)}...`;
}

function buildDriverLeadMessage(params: {
  fullName: string;
  username: string | undefined;
  phone: string | null;
  route: string | null;
  messageTime: string;
  originalMessage: string;
  sourceMessageId: number;
}): string {
  const usernameLine = params.username ? `@${params.username}` : "yo'q";
  const phoneLine = params.phone ?? "xabarda topilmadi";
  const routeLine = params.route ?? "aniqlanmadi";

  return [
    "🚕 Yangi yo‘lovchi so‘rovi",
    "",
    `👤 Foydalanuvchi: ${params.fullName}`,
    `🔗 Username: ${usernameLine}`,
    `📞 Telefon: ${phoneLine}`,
    `📍 Yo‘nalish: ${routeLine}`,
    `🕒 Vaqt: ${params.messageTime}`,
    "",
    "💬 Xabar:",
    shorten(params.originalMessage, 2500),
    "",
    "🔎 Manba: Yo‘lovchilar guruhi",
    `🆔 Message ID: ${params.sourceMessageId}`
  ].join("\n");
}

async function sendLeadToDriver(ctx: Context, sourceMessageId: number, payload: string): Promise<number | null> {
  const summaryMsg = await ctx.api.sendMessage(env.DRIVER_GROUP_OR_CHANNEL_ID, payload);

  try {
    const forwarded = await ctx.api.forwardMessage(
      env.DRIVER_GROUP_OR_CHANNEL_ID,
      env.PASSENGER_GROUP_ID,
      sourceMessageId
    );

    return forwarded.message_id;
  } catch (forwardError) {
    await writeWarn("forwardMessage failed, trying copyMessage", {
      sourceMessageId,
      driverChatId: env.DRIVER_GROUP_OR_CHANNEL_ID,
      passengerChatId: env.PASSENGER_GROUP_ID
    });

    try {
      const copied = await ctx.api.copyMessage(env.DRIVER_GROUP_OR_CHANNEL_ID, env.PASSENGER_GROUP_ID, sourceMessageId);
      return copied.message_id;
    } catch (copyError) {
      await writeWarn("copyMessage failed, keeping summary message only", {
        sourceMessageId,
        forwardError: String(forwardError),
        copyError: String(copyError)
      });

      await sendLogToChannel(ctx.api, LogLevel.WARN, "Forward va copy ishlamadi, faqat summary yuborildi", {
        sourceMessageId
      });

      return summaryMsg.message_id;
    }
  }
}

async function deleteLeadSourceMessage(ctx: Context, sourceMessageId: number, leadId: number): Promise<void> {
  try {
    await ctx.api.deleteMessage(env.PASSENGER_GROUP_ID, sourceMessageId);
    await writeInfo("Lead source message deleted from passenger group", {
      leadId,
      sourceMessageId
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const deletePermissionHint = message.includes("message can't be deleted")
      ? "Bot passenger guruhida admin emas yoki Delete messages huquqi yo'q"
      : undefined;

    await writeWarn("Failed to delete lead source message", {
      leadId,
      sourceMessageId,
      error: String(error),
      hint: deletePermissionHint
    });
  }
}

export async function processIncomingMessage(ctx: Context): Promise<ProcessMessageResult> {
  const msg = ctx.msg;

  if (!msg || !ctx.chat || !ctx.from) {
    return { processed: false, reason: "Message context missing" };
  }

  if (ctx.chat.id !== env.PASSENGER_GROUP_ID) {
    return { processed: false, reason: "Message from disallowed chat" };
  }

  const sourceMessageId = msg.message_id;
  const sourceChatId = String(ctx.chat.id);
  const userId = String(ctx.from.id);
  const text = getMessageText(msg);

  if (!text || text.trim().length === 0) {
    return { processed: false, reason: "No text/caption in message" };
  }

  const originalText = stripExtraPunctuation(text);
  const classification = await classifyLead(originalText);

  const existingByMessage = await prisma.lead.findUnique({
    where: {
      sourceChatId_sourceMessageId: {
        sourceChatId,
        sourceMessageId
      }
    }
  });

  if (existingByMessage) {
    return { processed: false, reason: "Duplicate source message" };
  }

  const fullName = formatFullName(ctx.from.first_name, ctx.from.last_name);
  const username = ctx.from.username ?? null;
  const phone = extractPhone(originalText);
  const detectedRoute = classification.route;

  if (!classification.isLead) {
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

    return { processed: false, reason: classification.isSpam ? "Spam or ad" : "Not a lead" };
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

  const messageTime = formatMessageDate(new Date(msg.date * 1000));
  const payload = buildDriverLeadMessage({
    fullName,
    username: username ?? undefined,
    phone,
    route: detectedRoute,
    messageTime,
    originalMessage: originalText,
    sourceMessageId
  });

  try {
    const forwardedMessageId = await sendLeadToDriver(ctx, sourceMessageId, payload);

    await prisma.lead.update({
      where: { id: createdLead.id },
      data: {
        status: LeadStatus.FORWARDED,
        forwardedMessageId: forwardedMessageId ?? null
      }
    });

    await writeInfo("Lead forwarded to driver chat", {
      leadId: createdLead.id,
      sourceMessageId,
      forwardedMessageId
    });

    await deleteLeadSourceMessage(ctx, sourceMessageId, createdLead.id);

    return { processed: true };
  } catch (error) {
    await writeError("Failed to forward lead", error, {
      leadId: createdLead.id,
      sourceMessageId
    });

    await sendLogToChannel(ctx.api, LogLevel.ERROR, "Lead forwarding xatosi", {
      leadId: createdLead.id,
      sourceMessageId,
      error: String(error)
    });

    return { processed: false, reason: "Forward failed" };
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
