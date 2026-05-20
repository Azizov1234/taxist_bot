import { LeadStatus, LogLevel } from "@prisma/client";
import type { Context } from "grammy";
import { DRIVER_AD_NEGATIVE_KEYWORDS } from "../config/defaultKeywords.js";
import { env } from "../config/env.js";
import { prisma } from "../prisma/client.js";
import { classifyMessage, keywordClassify, normalizeText } from "./leadClassifier.service.js";
import { extractPhone } from "../utils/phone.js";
import { detectRoute } from "../utils/route.js";
import { formatMessageDate } from "../utils/time.js";
import { stripExtraPunctuation } from "../utils/text.js";
import { sendLogToChannel, writeError, writeInfo, writeWarn } from "./logger.service.js";

export interface ProcessMessageResult {
  processed: boolean;
  reason?: string;
}

const DRIVER_AD_KEYWORDS_NORMALIZED = [...new Set(DRIVER_AD_NEGATIVE_KEYWORDS.map((keyword) => normalizeText(keyword)))];
const DRIVER_AD_REGEX_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "olib_ketaman", pattern: /\b(?:olib|ob)\s*ket(?:aman|amiz)\b/iu },
  { id: "odam_olaman", pattern: /\bodam\s*(?:olaman|olamiz)\b/iu },
  { id: "yolovchi_olaman", pattern: /\byo'?lovchi\s*(?:olaman|olamiz)\b/iu },
  { id: "mijoz_olaman", pattern: /\bmijoz\s*(?:olaman|olamiz)\b/iu },
  { id: "joy_bor", pattern: /\b(?:bo'?sh|bosh)?\s*joy(?:lar)?\s*bor\b/iu },
  { id: "kishi_bor", pattern: /\b\d+\s*(?:ta|kishi)\s*(?:joy\s*)?bor\b/iu },
  { id: "mashina_bor", pattern: /\b(?:mashina|moshina|avto)\s*bor\b/iu },
  { id: "ketadiganlar_bolsa", pattern: /\bketadiganlar?\s*bo'?lsa\b/iu },
  { id: "aloqaga_chiqadi", pattern: /\baloqaga\s*chiqadi\b/iu },
  { id: "biroz_kuting", pattern: /\bbiroz\s*kuting\b/iu },
  { id: "kuting", pattern: /\bkuting\b/iu },
  { id: "ru_passenger_take", pattern: /\b(?:пассажир|мижоз|й[ўу]ловчи)\s*олам(?:ан|из)\b/iu },
  { id: "ru_seat_available", pattern: /\b(?:б[ўу]ш\s*жой|жой)\s*бор\b/iu }
];
const PRICE_QUERY_KEYWORDS_NORMALIZED = [
  "qancha",
  "qanchaga",
  "qancha boladi",
  "qancha buladi",
  "qancha bulayabdi",
  "necha pul",
  "narx",
  "narxi",
  "сколько",
  "цена",
  "стоимость",
  "скок",
  "skolko"
].map((keyword) => normalizeText(keyword));

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function containsKeyword(normalizedText: string, normalizedKeyword: string): boolean {
  if (!normalizedKeyword) {
    return false;
  }

  const boundaryPattern = new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(normalizedKeyword)}(?=$|[^\\p{L}\\p{N}])`, "iu");
  return boundaryPattern.test(normalizedText);
}

function detectDriverAdHits(normalizedText: string): string[] {
  return DRIVER_AD_KEYWORDS_NORMALIZED.filter((keyword) => keyword.length > 0 && containsKeyword(normalizedText, keyword));
}

function detectPriceQueryHits(normalizedText: string): string[] {
  return PRICE_QUERY_KEYWORDS_NORMALIZED.filter((keyword) => keyword.length > 0 && containsKeyword(normalizedText, keyword));
}

function detectDriverAdPatternHits(text: string): string[] {
  return DRIVER_AD_REGEX_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id);
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

function extractRouteParts(route: string | null): { from: string | null; to: string | null } {
  if (!route) {
    return { from: null, to: null };
  }

  const [rawFrom, rawTo] = route.split("->").map((part) => part.trim());
  const from = rawFrom && rawFrom.toLowerCase() !== "aniq emas" ? rawFrom : null;
  const to = rawTo && rawTo.length > 0 ? rawTo : null;

  return { from, to };
}

function buildDriverLeadSummary(params: {
  fullName: string;
  username: string | null;
  phone: string | null;
  route: string | null;
  messageTime: string;
  originalMessage: string;
  sourceMessageId: number;
}): string {
  const usernameValue = params.username ? `@${params.username}` : "yo'q";
  const phoneValue = params.phone ?? "xabarda topilmadi";
  const routeParts = extractRouteParts(params.route);
  const fromValue = routeParts.from ?? "aniqlanmadi";
  const toValue = routeParts.to ?? "aniqlanmadi";

  return [
    "🚕 Yangi yo'lovchi so'rovi",
    "",
    `👤 Foydalanuvchi: ${params.fullName}`,
    `🔗 Username: ${usernameValue}`,
    `📞 Telefon: ${phoneValue}`,
    `📍 Qayerdan: ${fromValue}`,
    `🎯 Qayergacha: ${toValue}`,
    `🕒 Vaqt: ${params.messageTime}`,
    "",
    "💬 Xabar:",
    shorten(params.originalMessage, 2500),
    "",
    "⚪ Manba: Yo'lovchilar guruhi",
    `🆔 Message ID: ${params.sourceMessageId}`
  ].join("\n");
}

async function sendLeadToDriver(ctx: Context, sourceMessageId: number, summaryText: string): Promise<number> {
  const summaryMessage = await ctx.api.sendMessage(env.DRIVERS_CHAT_ID, summaryText);

  try {
    const forwarded = await ctx.api.forwardMessage(env.DRIVERS_CHAT_ID, env.PASSENGERS_CHAT_ID, sourceMessageId);
    return forwarded.message_id || summaryMessage.message_id;
  } catch (forwardError) {
    await writeWarn("forwardMessage failed, trying copyMessage", {
      sourceMessageId,
      driverChatId: env.DRIVERS_CHAT_ID,
      passengerChatId: env.PASSENGERS_CHAT_ID,
      forwardError: String(forwardError)
    });

    try {
      const copied = await ctx.api.copyMessage(env.DRIVERS_CHAT_ID, env.PASSENGERS_CHAT_ID, sourceMessageId);
      return copied.message_id || summaryMessage.message_id;
    } catch (copyError) {
      await writeWarn("copyMessage failed after forwardMessage failure", {
        sourceMessageId,
        copyError: String(copyError)
      });

      return summaryMessage.message_id;
    }
  }
}

async function deletePassengerMessage(ctx: Context, sourceMessageId: number, reason: string): Promise<void> {
  try {
    await ctx.api.deleteMessage(env.PASSENGERS_CHAT_ID, sourceMessageId);
    await writeInfo("Passenger message deleted", {
      sourceMessageId,
      reason
    });
  } catch (error) {
    await writeWarn("Failed to delete passenger message", {
      sourceMessageId,
      reason,
      error: error instanceof Error ? error.message : String(error)
    });
  }
}

export async function processIncomingMessage(ctx: Context): Promise<ProcessMessageResult> {
  const msg = ctx.msg;

  if (!msg || !ctx.chat) {
    return { processed: false, reason: "Message context missing" };
  }

  if (ctx.chat.id !== env.PASSENGERS_CHAT_ID) {
    return { processed: false, reason: "Message from disallowed chat" };
  }

  if (ctx.from?.is_bot) {
    return { processed: false, reason: "Message from bot user" };
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
  const normalizedText = normalizeText(originalText);
  const forwarded = isForwardedMessage(msg);
  const earlyDriverAdHits = detectDriverAdHits(normalizedText);
  const earlyDriverAdPatternHits = detectDriverAdPatternHits(originalText);
  const isDriverAdByHeuristic = earlyDriverAdHits.length > 0 || earlyDriverAdPatternHits.length > 0;

  if (forwarded) {
    if (isDriverAdByHeuristic) {
      await writeInfo("Forwarded driver advertisement blocked", {
        sourceMessageId,
        text: shorten(originalText, 350),
        driverAdHits: earlyDriverAdHits,
        driverAdPatternHits: earlyDriverAdPatternHits
      });

      await deletePassengerMessage(ctx, sourceMessageId, "forwarded_driver_ad_message");

      return {
        processed: false,
        reason: "Forwarded driver advertisement deleted"
      };
    }

    return { processed: false, reason: "Forwarded message ignored" };
  }

  if (isDriverAdByHeuristic) {
    const phone = extractPhone(originalText);
    const detectedRoute = detectRoute(originalText);
    const fullName =
      ctx.from?.first_name !== undefined
        ? formatFullName(ctx.from.first_name, ctx.from.last_name)
        : "sender_chat" in msg && msg.sender_chat?.title
          ? msg.sender_chat.title
          : ctx.chat.title ?? "Noma'lum";
    const username = ctx.from?.username ?? null;

    await writeInfo("Driver advertisement blocked before AI", {
      sourceMessageId,
      text: shorten(originalText, 350),
      driverAdHits: earlyDriverAdHits,
      driverAdPatternHits: earlyDriverAdPatternHits
    });

    await prisma.lead.create({
      data: {
        sourceChatId,
        sourceMessageId,
        userId,
        fullName,
        username,
        phone,
        originalText,
        normalizedText,
        detectedRoute,
        status: LeadStatus.IGNORED
      }
    });

    await deletePassengerMessage(ctx, sourceMessageId, "driver_ad_precheck");

    return {
      processed: false,
      reason: "Driver advertisement blocked before AI"
    };
  }

  const classification = await classifyMessage(originalText);
  const keywordResult = keywordClassify(originalText);
  const driverAdHits = detectDriverAdHits(classification.normalizedText);
  const driverAdPatternHits = detectDriverAdPatternHits(originalText);
  const priceQueryHits = detectPriceQueryHits(classification.normalizedText);
  const isDriverAdMessage = driverAdHits.length > 0 || driverAdPatternHits.length > 0;
  const phone = extractPhone(originalText);
  const detectedRoute = detectRoute(originalText);
  const isRouteFareInquiry = Boolean(detectedRoute) && priceQueryHits.length > 0;
  const hasHardPassengerSignal = keywordResult.score >= 3 || Boolean(phone) || Boolean(detectedRoute);

  const shouldSendByAI = classification.is_passenger_request && classification.confidence >= env.MIN_CONFIDENCE;
  const shouldSendByKeywordRescue = !shouldSendByAI && keywordResult.is_passenger_request && keywordResult.score >= 3;
  const shouldSendByRouteFareInquiry = !shouldSendByAI && !shouldSendByKeywordRescue && isRouteFareInquiry;
  const shouldSend = (shouldSendByAI || shouldSendByKeywordRescue || shouldSendByRouteFareInquiry) && !isDriverAdMessage && hasHardPassengerSignal;
  const decisionSource = isDriverAdMessage
    ? "blocked_driver_ad"
    : !hasHardPassengerSignal
      ? "blocked_no_passenger_signal"
    : shouldSendByAI
      ? classification.provider
    : shouldSendByKeywordRescue
        ? "keyword_rescue"
      : shouldSendByRouteFareInquiry
        ? "route_fare_inquiry_rescue"
        : "skip";

  await writeInfo("Message classification", {
    sourceMessageId,
    text: shorten(originalText, 350),
    provider: classification.provider,
    confidence: classification.confidence,
    reason: classification.reason,
    keywordScore: keywordResult.score,
    keywordReason: keywordResult.reason,
    driverAdHits,
    driverAdPatternHits,
    priceQueryHits,
    hasHardPassengerSignal,
    decisionSource,
    action: shouldSend ? "sent" : "skipped",
    minConfidence: env.MIN_CONFIDENCE,
    providerStatuses: classification.providerStatuses.map((status) => ({ ...status }))
  });

  if (classification.provider === "keyword") {
    await writeWarn("AI providers unavailable, keyword fallback used", {
      sourceMessageId,
      keywordScore: keywordResult.score,
      decisionSource
    });

    await sendLogToChannel(ctx.api, LogLevel.WARN, "AI limit yoki xato: keyword fallback ishladi", {
      sourceMessageId,
      keywordScore: keywordResult.score,
      decisionSource,
      providerStatuses: classification.providerStatuses.map((status) => ({ ...status }))
    });
  }

  const fullName =
    ctx.from?.first_name !== undefined
      ? formatFullName(ctx.from.first_name, ctx.from.last_name)
      : "sender_chat" in msg && msg.sender_chat?.title
        ? msg.sender_chat.title
        : ctx.chat.title ?? "Noma'lum";
  const username = ctx.from?.username ?? null;
  const messageTime = formatMessageDate(new Date(msg.date * 1000));

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

    if (isDriverAdMessage) {
      await deletePassengerMessage(ctx, sourceMessageId, "driver_ad_message");
    }

    return {
      processed: false,
      reason: `Skipped by classifier (${classification.provider}, keyword_score=${keywordResult.score}, source=${decisionSource})`
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
    const summaryText = buildDriverLeadSummary({
      fullName,
      username,
      phone,
      route: detectedRoute,
      messageTime,
      originalMessage: originalText,
      sourceMessageId
    });

    const forwardedMessageId = await sendLeadToDriver(ctx, sourceMessageId, summaryText);

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
      decisionSource,
      confidence: classification.confidence,
      reason: shouldSendByKeywordRescue ? `keyword_rescue: ${keywordResult.reason}` : classification.reason
    });

    await deletePassengerMessage(ctx, sourceMessageId, "forwarded_passenger_request");

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
