import { LeadStatus, Prisma } from "@prisma/client";
import type { Context } from "grammy";
import { DRIVER_AD_NEGATIVE_KEYWORDS } from "../config/defaultKeywords.js";
import { env } from "../config/env.js";
import { prisma } from "../prisma/client.js";
import { classifyMessage, keywordClassify, normalizeText } from "./leadClassifier.service.js";
import { extractPhone } from "../utils/phone.js";
import { detectRoute } from "../utils/route.js";
import { formatMessageDate } from "../utils/time.js";
import { hasSpamSignals, stripExtraPunctuation } from "../utils/text.js";
import { writeError, writeInfo, writeWarn } from "./logger.service.js";

export interface ProcessMessageResult {
  processed: boolean;
  reason?: string;
}

export interface DriverSendResult {
  driverMessageId: number;
  forwardedOriginal: boolean;
}

export interface UnifiedIncomingMessage {
  sourceChatId: string;
  sourceChatTitle: string;
  sourceChatUsername?: string | null;
  sourceMessageId: number;
  senderId: string;
  senderFullName: string;
  senderUsername: string | null;
  text: string;
  messageDate: Date;
  isForwarded?: boolean;
}

export interface UnifiedMessageActions {
  sendToDriver: (formattedText: string, originalText: string) => Promise<DriverSendResult>;
  deleteFromSource?: () => Promise<void>;
}

const DRIVER_AD_KEYWORDS_NORMALIZED = [...new Set(DRIVER_AD_NEGATIVE_KEYWORDS.map((keyword) => normalizeText(keyword)))];
const DRIVER_AD_REGEX_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "olib_ketaman", pattern: /\b(?:olib|ob)\s*ket(?:aman|amiz|amz)\b/iu },
  { id: "odam_olaman", pattern: /\bodam\s*(?:olaman|olamiz)\b/iu },
  { id: "yolovchi_olaman", pattern: /\byo'?lovchi\s*(?:olaman|olamiz)\b/iu },
  { id: "mijoz_olaman", pattern: /\bmijoz\s*(?:olaman|olamiz)\b/iu },
  { id: "odam_pochta_bolsa_olamiz", pattern: /\b(?:odam|pochta|yuk)\b.{0,20}\bbo'?l(?:sa|sayam?)\b.{0,20}\b(?:olaman|olamiz)\b/iu },
  {
    id: "yuramiz_odam_pochta",
    pattern: /\b(?:yuraman|yuramiz|ketaman|ketamiz|chiqaman|chiqamiz|jo'?nayman|jo'?naymiz)\b.{0,40}\b(?:odam|pochta|yuk)\b.{0,20}\b(?:olaman|olamiz)\b/iu
  },
  {
    id: "taksi_bor_olib_ketamz",
    pattern:
      /\b(?:taxi|taksi)\b.{0,30}\bbor\b.{0,30}\b(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi)\b(?:.{0,20}\bbo'?lsa\b)?(?:.{0,30}\b(?:olib|ob)\s*ket(?:aman|amiz|amz)\b)/iu
  },
  { id: "joy_bor", pattern: /\b(?:bo'?sh|bosh)?\s*joy(?:lar)?\s*bor\b/iu },
  { id: "mashina_bor", pattern: /\b(?:mashina|moshina|avto)\s*bor\b/iu },
  { id: "avto_model_ad", pattern: /\b(?:avto|mashina|moshina)\b.{0,12}\b(?:kobalt|koblt|cobalt|jentra|gentra|lasetti|lacetti|damas|nexia|malibu)\b/iu },
  { id: "private_dm_ad", pattern: /\b(?:lichka|lichkaga|lichkadan|lichku)\b/iu },
  { id: "ketadiganlar_bolsa", pattern: /\bketadiganlar?\s*bo'?lsa\b/iu },
  { id: "reklama", pattern: /\b(reklama|РґРѕСЃС‚Р°РІРєР°|dostavka|xizmat ko'?rsatamiz|taxi xizmati|С‚Р°РєСЃРё С…РёР·РјР°С‚Рё)\b/iu },
  { id: "ru_passenger_take", pattern: /\b(?:РїР°СЃСЃР°Р¶РёСЂ|РјРёР¶РѕР·|Р№[СћСѓ]Р»РѕРІС‡Рё)\s*РѕР»Р°Рј(?:Р°РЅ|РёР·)\b/iu },
  { id: "ru_seat_available", pattern: /\b(?:Р±[СћСѓ]С€\s*Р¶РѕР№|Р¶РѕР№)\s*Р±РѕСЂ\b/iu }
];
const DRIVER_COMMERCIAL_VERB_REGEX =
  /\b(?:olaman|olamiz|olamz|yuraman|yuramiz|yuramz|ketaman|ketamiz|ketamz|qatnayman|qatnaymiz|qatnaymz|chiqaman|chiqamiz|chiqamz|jo'?nayman|jo'?naymiz|jo'?naymz|yetkazib beraman|yetkazib beramiz|olib ketaman|olib ketamiz|olib ketamz|ob ketaman|ob ketamiz|ob ketamz)\b/iu;
const DRIVER_COMMERCIAL_CONTEXT_REGEX =
  /\b(?:odam|yo'?lovchi|yolovchi|yulovchi|mijoz|klient|pochta|yuk|joy|avto|mashina|moshina|taxi|taksi|kobalt|koblt|cobalt|jentra|gentra|lasetti|lacetti|damas|nexia|malibu)\b/iu;
const PRICE_QUERY_KEYWORDS_NORMALIZED = [
  "qancha",
  "qanchaga",
  "qancha boladi",
  "qancha buladi",
  "qancha bulayabdi",
  "necha pul",
  "narx",
  "narxi",
  "СЃРєРѕР»СЊРєРѕ",
  "С†РµРЅР°",
  "СЃС‚РѕРёРјРѕСЃС‚СЊ",
  "СЃРєРѕРє",
  "skolko"
].map((keyword) => normalizeText(keyword));

const STRONG_PASSENGER_INTENT_PATTERNS: RegExp[] = [
  /\b(?:taxi|taksi|takis|mashina|moshina)\b.{0,24}\b(?:kerak|kere|kerak edi|kere edi|bormi)\b/iu,
  /\b(?:kerak|kere|kerak edi|kere edi)\b.{0,24}\b(?:taxi|taksi|takis|mashina|moshina)\b/iu,
  /\b(?:taxi|taksi|takis)\s*(?:ker|kere|kerek|kerak|krk|kera|kk)\b/iu,
  /\b(?:kk|krk)\b.{0,10}\b(?:taxi|taksi|takis)\b/iu,
  /\b(?:borish kerak|ketish kerak|borishim kerak|ketishim kerak|joy bormi|poputchik bormi|olib ketadigan bormi|ob ketadigan bormi)\b/iu,
  /\b(?:С‚Р°РєСЃРё|РјР°С€РёРЅР°|РјРѕС€РёРЅР°)\b.{0,24}\b(?:РєРµСЂР°Рє|РєРµСЂРµ|Р±РѕСЂРјРё)\b/iu,
  /\b(?:Р±РѕСЂРёС€ РєРµСЂР°Рє|РєРµС‚РёС€ РєРµСЂР°Рє|Р№СћР»РѕРІС‡Рё Р±РѕСЂ|Р№СѓР»РѕРІС‡Рё Р±РѕСЂ)\b/iu
];
const PASSENGER_SOFT_SIGNAL_REGEX = /\b(?:kishi|odam|yo'?lovchi|yolovchi|yulovchi)\b/iu;

const META_INSTRUCTION_PATTERNS: Array<{ id: string; pattern: RegExp }> = [
  { id: "nickname_or_username", pattern: /\b(?:nick\s*name|nickname|nikname|username)\b/iu },
  { id: "write_instruction", pattern: /\b(?:aniq\s+yoz(?:ing|ilar)?|yoz(?:ing|ilar)?\s+deb|qayerga\s+borish(?:ingiz|iz)ni\s+aniq\s+yoz)\b/iu },
  { id: "ai_notice", pattern: /\b(?:sun[вЂ™'`]?iy|suniy)\s+intellekt\b/iu },
  { id: "operator_notice", pattern: /\b(?:taksi(?:lar|chilar)(?:imiz)?|taksislar(?:imiz)?|ulab\s+beradi)\b/iu },
  { id: "admin_notice", pattern: /\b(?:qoidalar?|e'lon|elon)\b/iu }
];

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

function hasStrongPassengerIntent(text: string): boolean {
  return STRONG_PASSENGER_INTENT_PATTERNS.some((pattern) => pattern.test(text));
}

function detectMetaInstructionHits(text: string): string[] {
  return META_INSTRUCTION_PATTERNS.filter((entry) => entry.pattern.test(text)).map((entry) => entry.id);
}

function isGenericLocationToken(value: string | null): boolean {
  if (!value) {
    return true;
  }

  const normalized = normalizeText(value)
    .replace(/[^\p{L}\p{N}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return true;
  }

  return new Set([
    "qayer",
    "qayerga",
    "qayerdan",
    "qayerda",
    "qaer",
    "qaerga",
    "qaerdan",
    "qaerda",
    "qayoqqa",
    "РєСѓРґР°",
    "РѕС‚РєСѓРґР°",
    "where",
    "where to",
    "from where"
  ]).has(normalized);
}

function sanitizeLocationValue(value: string | null): string | null {
  if (!value || isGenericLocationToken(value)) {
    return null;
  }

  return value.trim();
}

function isAmbiguousRouteOnlyMessage(normalizedText: string): boolean {
  const cleaned = normalizedText.replace(/[^\p{L}\p{N}\s]/gu, " ").replace(/\s+/g, " ").trim();
  return /^(qayerdan qayerga|qayerga qayerdan|qayerga|qayerdan|qayerda|qaerdan qaerga|qaerga|qaerdan|РєСѓРґР° РєСѓРґР°|РѕС‚РєСѓРґР° РєСѓРґР°|РєСѓРґР°|РѕС‚РєСѓРґР°|where to|from where)$/iu.test(cleaned);
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

function extractPassengerCount(text: string): number | null {
  const regexes = [/\b(\d{1,2})\s*(?:ta\s*)?(?:kishi|odam)\b/iu, /\b(?:kishi|odam)\s*(\d{1,2})\b/iu];

  for (const regex of regexes) {
    const match = text.match(regex);
    if (match?.[1]) {
      const parsed = Number(match[1]);
      if (Number.isFinite(parsed) && parsed > 0) {
        return parsed;
      }
    }
  }

  return null;
}

function extractTimeHint(text: string): string | null {
  const normalized = normalizeText(text);
  const hourMatch = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\b/);
  if (hourMatch?.[0]) {
    return hourMatch[0];
  }

  const words = ["hozir", "bugun", "ertalab", "kechqurun", "tunda", "ertaga", "СЃРµРіРѕРґРЅСЏ", "Р·Р°РІС‚СЂР°"];
  const found = words.find((word) => normalized.includes(word));

  return found ?? null;
}

function buildSourceMessageLink(sourceChatId: string, sourceMessageId: number, sourceChatUsername?: string | null): string | null {
  const usernameRaw = typeof sourceChatUsername === "string" ? sourceChatUsername.trim().replace(/^@/, "") : "";
  if (/^[a-zA-Z][a-zA-Z0-9_]{4,31}$/.test(usernameRaw)) {
    return `https://t.me/${usernameRaw}/${sourceMessageId}`;
  }

  const chatId = Number(sourceChatId);
  if (!Number.isInteger(chatId) || chatId >= 0) {
    return null;
  }

  const absChatId = String(Math.abs(chatId));
  if (!absChatId.startsWith("100")) {
    return null;
  }

  const internalId = absChatId.slice(3);
  if (!internalId) {
    return null;
  }

  return `https://t.me/c/${internalId}/${sourceMessageId}`;
}

function buildDriverLeadSummary(params: {
  senderFullName: string;
  senderUsername: string | null;
  senderId: string;
  phone: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  passengerCount: number | null;
  timeHint: string | null;
  messageTime: string;
  sourceChatTitle: string;
  originalMessage: string;
  sourceChatId: string;
  sourceChatUsername: string | null;
  sourceMessageId: number;
  provider: string;
  confidence: number;
  status: LeadStatus;
  hasHiddenSenderIdentity: boolean;
}): string {
  const usernameValue = params.senderUsername ? `@${params.senderUsername}` : "yo'q";
  const phoneValue = params.phone ?? "xabarda topilmadi";
  const sourceMessageLink = buildSourceMessageLink(params.sourceChatId, params.sourceMessageId, params.sourceChatUsername);

  return [
    "Yangi yo'lovchi topildi",
    "",
    `Ism: ${params.senderFullName}`,
    `Username: ${usernameValue}`,
    `Telefon: ${phoneValue}`,
    "",
    `Qayerdan: ${params.fromLocation ?? "aniqlanmadi"}`,
    `Qayerga: ${params.toLocation ?? "aniqlanmadi"}`,
    `Odam soni: ${params.passengerCount ?? "aniqlanmadi"}`,
    `Vaqt: ${params.timeHint ?? params.messageTime}`,
    "",
    "Xabar:",
    shorten(params.originalMessage, 2500),
    "",
    `Source link: ${sourceMessageLink ?? "mavjud emas"}`
  ].join("\n");
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

function isForwardedMessage(msg: NonNullable<Context["msg"]>): boolean {
  return (
    ("forward_origin" in msg && Boolean(msg.forward_origin)) ||
    ("forward_from" in msg && Boolean(msg.forward_from)) ||
    ("forward_from_chat" in msg && Boolean(msg.forward_from_chat)) ||
    ("forward_sender_name" in msg && Boolean(msg.forward_sender_name)) ||
    ("forward_date" in msg && typeof msg.forward_date === "number")
  );
}

function formatFullName(firstName: string, lastName?: string): string {
  const combined = `${firstName} ${lastName ?? ""}`.replace(/\s+/g, " ").trim();
  return combined.length > 0 ? combined : "Noma'lum";
}

async function saveLeadWithStatus(params: {
  payload: UnifiedIncomingMessage;
  originalText: string;
  normalizedText: string;
  detectedRoute: string | null;
  fromLocation: string | null;
  toLocation: string | null;
  phone: string | null;
  passengerCount: number | null;
  timeHint: string | null;
  confidence: number;
  isDriverAd: boolean;
  isSpam: boolean;
  status: LeadStatus;
  driverMessageId?: number;
  errorMessage?: string;
}): Promise<void> {
  const data: Prisma.LeadCreateInput = {
    sourceChatId: params.payload.sourceChatId,
    sourceMessageId: params.payload.sourceMessageId,
    sourceChatTitle: params.payload.sourceChatTitle,
    senderId: params.payload.senderId,
    senderFullName: params.payload.senderFullName,
    senderUsername: params.payload.senderUsername,
    userId: params.payload.senderId,
    fullName: params.payload.senderFullName,
    username: params.payload.senderUsername,
    phone: params.phone,
    originalText: params.originalText,
    normalizedText: params.normalizedText,
    fromLocation: params.fromLocation,
    toLocation: params.toLocation,
    passengerCount: params.passengerCount,
    timeHint: params.timeHint,
    confidence: params.confidence,
    isDriverAd: params.isDriverAd,
    isSpam: params.isSpam,
    detectedRoute: params.detectedRoute,
    status: params.status
  };

  if (params.driverMessageId !== undefined) {
    data.driverMessageId = params.driverMessageId;
    data.forwardedMessageId = params.driverMessageId;
  }

  if (params.errorMessage !== undefined) {
    data.errorMessage = params.errorMessage;
  }

  await prisma.lead.create({ data });
}

async function updateLeadStatus(params: {
  leadId: number;
  status: LeadStatus;
  driverMessageId?: number;
  errorMessage?: string;
}): Promise<void> {
  const data: Prisma.LeadUpdateInput = {
    status: params.status
  };

  if (params.driverMessageId !== undefined) {
    data.driverMessageId = params.driverMessageId;
    data.forwardedMessageId = params.driverMessageId;
  }

  if (params.errorMessage !== undefined) {
    data.errorMessage = params.errorMessage;
  }

  await prisma.lead.update({
    where: { id: params.leadId },
    data
  });
}

export async function processIncomingLead(payload: UnifiedIncomingMessage, actions: UnifiedMessageActions): Promise<ProcessMessageResult> {
  const originalText = stripExtraPunctuation(payload.text);
  if (originalText.length === 0) {
    return { processed: false, reason: "No text/caption in message" };
  }

  const existingByMessage = await prisma.lead.findUnique({
    where: {
      sourceChatId_sourceMessageId: {
        sourceChatId: payload.sourceChatId,
        sourceMessageId: payload.sourceMessageId
      }
    }
  });

  if (existingByMessage) {
    await writeInfo("Duplicate source message skipped", {
      sourceChatId: payload.sourceChatId,
      sourceMessageId: payload.sourceMessageId
    });

    return { processed: false, reason: "Duplicate source message" };
  }

  const normalizedText = normalizeText(originalText);
  const duplicateWindowStart = new Date(Date.now() - env.DUPLICATE_WINDOW_MINUTES * 60_000);

  const duplicateBySenderText = await prisma.lead.findFirst({
    where: {
      senderId: payload.senderId,
      normalizedText,
      createdAt: { gte: duplicateWindowStart }
    },
    orderBy: { createdAt: "desc" }
  });

  if (duplicateBySenderText) {
    await saveLeadWithStatus({
      payload,
      originalText,
      normalizedText,
      detectedRoute: detectRoute(originalText),
      fromLocation: null,
      toLocation: null,
      phone: extractPhone(originalText),
      passengerCount: extractPassengerCount(originalText),
      timeHint: extractTimeHint(originalText),
      confidence: 0,
      isDriverAd: false,
      isSpam: false,
      status: LeadStatus.DUPLICATE,
      errorMessage: `Duplicate sender/text in ${env.DUPLICATE_WINDOW_MINUTES} minutes`
    });

    return { processed: false, reason: "Duplicate sender/text window" };
  }

  const classification = await classifyMessage(originalText);
  const keywordResult = keywordClassify(originalText);
  const driverAdHits = detectDriverAdHits(classification.normalizedText);
  const driverAdPatternHits = detectDriverAdPatternHits(originalText);
  const priceQueryHits = detectPriceQueryHits(classification.normalizedText);
  const spamByRules = hasSpamSignals(originalText);

  const routeFromRules = detectRoute(originalText);
  const strongPassengerIntent = hasStrongPassengerIntent(originalText);
  const metaInstructionHits = detectMetaInstructionHits(originalText);
  const routeParts = extractRouteParts(routeFromRules);
  const phoneFromRules = extractPhone(originalText);
  const passengerCountFromRules = extractPassengerCount(originalText);
  const timeHintFromRules = extractTimeHint(originalText);

  const fromLocation = sanitizeLocationValue(classification.fromLocation ?? routeParts.from);
  const toLocation = sanitizeLocationValue(classification.toLocation ?? routeParts.to);
  const phone = classification.phone ?? phoneFromRules;
  const passengerCount = classification.passengerCount ?? passengerCountFromRules;
  const timeHint = classification.timeHint ?? timeHintFromRules;

  const aiOnlyDriverAd = classification.isDriverAd && driverAdHits.length === 0 && driverAdPatternHits.length === 0;
  const hasCommercialVerb = DRIVER_COMMERCIAL_VERB_REGEX.test(originalText);
  const hasCommercialContext = DRIVER_COMMERCIAL_CONTEXT_REGEX.test(classification.normalizedText);
  const looksLikeDriverCommercial = hasCommercialVerb && (hasCommercialContext || Boolean(phone));
  const categoryIsPassenger = classification.category === "PASSENGER_LEAD";
  const categoryIsDriver = classification.category === "DRIVER_AD";
  const categoryIsCargo = classification.category === "POSTAL_CARGO";
  const categoryIsSpam = classification.category === "IGNORE_SPAM";
  const isDriverAd =
    categoryIsDriver ||
    driverAdHits.length > 0 ||
    driverAdPatternHits.length > 0 ||
    looksLikeDriverCommercial ||
    (classification.isDriverAd && !(aiOnlyDriverAd && strongPassengerIntent));
  const isSpam = categoryIsSpam || classification.isSpam || spamByRules;
  const isCargo = categoryIsCargo;
  const isRouteFareInquiry = Boolean(routeFromRules) && priceQueryHits.length > 0;
  const isAmbiguousRouteOnly = isAmbiguousRouteOnlyMessage(classification.normalizedText);
  const hasRouteDetails = Boolean(routeFromRules) || Boolean(fromLocation) || Boolean(toLocation);
  const hasMinimumLeadDetails = Boolean(phone) || hasRouteDetails;
  const isMetaInstructionMessage = metaInstructionHits.length >= 2 && !hasMinimumLeadDetails;
  const hasHiddenSenderIdentity = payload.senderId.startsWith("chat:") || (!payload.senderUsername && !phone);
  const hasHardPassengerSignal = keywordResult.score >= 2 || strongPassengerIntent || Boolean(phone) || Boolean(routeFromRules);
  const hasPassengerSoftSignal = PASSENGER_SOFT_SIGNAL_REGEX.test(originalText);

  const shouldSendByAI = categoryIsPassenger || (classification.is_passenger_request && classification.confidence >= env.AI_MIN_CONFIDENCE);
  const shouldSendByKeywordRescue =
    !shouldSendByAI &&
    keywordResult.score >= 2 &&
    (keywordResult.is_passenger_request || strongPassengerIntent || Boolean(routeFromRules) || Boolean(phone));
  const shouldSendByStrongPassengerIntent =
    !shouldSendByAI &&
    !shouldSendByKeywordRescue &&
    strongPassengerIntent &&
    !isRouteFareInquiry &&
    !isDriverAd &&
    !isSpam &&
    !isCargo;
  const shouldSendByRoutePassengerPattern =
    !shouldSendByAI &&
    !shouldSendByKeywordRescue &&
    !shouldSendByStrongPassengerIntent &&
    hasRouteDetails &&
    (Boolean(passengerCount) || hasPassengerSoftSignal) &&
    !isRouteFareInquiry;
  const shouldSendByRouteFareInquiry = !shouldSendByAI && !shouldSendByKeywordRescue && isRouteFareInquiry;
  const shouldSend =
    (shouldSendByAI ||
      shouldSendByKeywordRescue ||
      shouldSendByStrongPassengerIntent ||
      shouldSendByRoutePassengerPattern ||
      shouldSendByRouteFareInquiry) &&
    !isAmbiguousRouteOnly &&
    !isMetaInstructionMessage &&
    !isDriverAd &&
    !isSpam;

  await writeInfo("Message classification", {
    sourceChatId: payload.sourceChatId,
    sourceMessageId: payload.sourceMessageId,
    provider: classification.provider,
    category: classification.category,
    confidence: classification.confidence,
    reason: classification.reason,
    keywordScore: keywordResult.score,
    driverAdHits,
    driverAdPatternHits,
    isDriverAd,
    isSpam,
    isCargo,
    isAmbiguousRouteOnly,
    metaInstructionHits,
    hasMinimumLeadDetails,
    isMetaInstructionMessage,
    hasHiddenSenderIdentity,
    hasHardPassengerSignal,
    shouldSend,
    providerStatuses: classification.providerStatuses.map((status) => ({
      name: status.name,
      status: status.status,
      disabledUntil: status.disabledUntil,
      keyConfigured: status.keyConfigured,
      reason: status.reason
    }))
  });

  const deleteFromSourceIfPossible = async (reason: string): Promise<boolean> => {
    if (!env.DELETE_SOURCE_MESSAGE_IF_ADMIN || !actions.deleteFromSource) {
      return false;
    }

    try {
      await actions.deleteFromSource();
      await writeInfo("Source message deleted", {
        sourceChatId: payload.sourceChatId,
        sourceMessageId: payload.sourceMessageId,
        reason
      });
      return true;
    } catch (deleteError) {
      await writeWarn("Failed to delete source message", {
        sourceChatId: payload.sourceChatId,
        sourceMessageId: payload.sourceMessageId,
        reason,
        error: deleteError instanceof Error ? deleteError.message : String(deleteError)
      });
      return false;
    }
  };

  if (!hasHardPassengerSignal || !shouldSend) {
    await saveLeadWithStatus({
      payload,
      originalText,
      normalizedText: classification.normalizedText,
      detectedRoute: routeFromRules,
      fromLocation,
      toLocation,
      phone,
      passengerCount,
      timeHint,
      confidence: classification.confidence,
      isDriverAd,
      isSpam,
      status: LeadStatus.IGNORED,
      errorMessage: isDriverAd
        ? "Driver ad detected"
        : isCargo
          ? "Cargo/postal message detected"
        : isSpam
          ? "Spam detected"
          : isAmbiguousRouteOnly
            ? "Ambiguous route-only message"
          : isMetaInstructionMessage
            ? "Meta instruction message ignored"
            : !hasMinimumLeadDetails
              ? "Missing minimum lead details (phone/route)"
              : "Classifier rejected"
    });

    if (isDriverAd || isCargo || isSpam || isMetaInstructionMessage) {
      await deleteFromSourceIfPossible(
        isDriverAd
          ? "Driver ad detected"
          : isCargo
            ? "Cargo/postal message detected"
            : isSpam
              ? "Spam detected"
              : "Meta instruction message ignored"
      );
    }

    return {
      processed: false,
      reason: `Skipped by classifier (${classification.provider}, score=${keywordResult.score})`
    };
  }

  const createdLead = await prisma.lead.create({
    data: {
      sourceChatId: payload.sourceChatId,
      sourceMessageId: payload.sourceMessageId,
      sourceChatTitle: payload.sourceChatTitle,
      senderId: payload.senderId,
      senderFullName: payload.senderFullName,
      senderUsername: payload.senderUsername,
      userId: payload.senderId,
      fullName: payload.senderFullName,
      username: payload.senderUsername,
      phone,
      originalText,
      normalizedText: classification.normalizedText,
      fromLocation,
      toLocation,
      passengerCount,
      timeHint,
      confidence: classification.confidence,
      isDriverAd,
      isSpam,
      detectedRoute: routeFromRules,
      status: LeadStatus.NEW
    }
  });

  try {
    const messageTime = formatMessageDate(payload.messageDate);
    const formattedMessage = buildDriverLeadSummary({
      senderFullName: payload.senderFullName,
      senderUsername: payload.senderUsername,
      senderId: payload.senderId,
      phone,
      fromLocation,
      toLocation,
      passengerCount,
      timeHint,
      messageTime,
      sourceChatTitle: payload.sourceChatTitle,
      originalMessage: originalText,
      sourceChatId: payload.sourceChatId,
      sourceChatUsername: payload.sourceChatUsername ?? null,
      sourceMessageId: payload.sourceMessageId,
      provider: classification.provider,
      confidence: classification.confidence,
      status: LeadStatus.SENT,
      hasHiddenSenderIdentity
    });

    const messageToSend = env.SEND_FORMATTED_MESSAGE ? formattedMessage : originalText;
    const sendResult = await actions.sendToDriver(messageToSend, originalText);
    const driverMessageId = sendResult.driverMessageId;

    await updateLeadStatus({
      leadId: createdLead.id,
      status: LeadStatus.SENT,
      driverMessageId
    });

    if (env.DELETE_SOURCE_MESSAGE_IF_ADMIN && actions.deleteFromSource) {
      try {
        await actions.deleteFromSource();

        await updateLeadStatus({
          leadId: createdLead.id,
          status: LeadStatus.DELETED_FROM_SOURCE,
          driverMessageId
        });

        return { processed: true };
      } catch (deleteError) {
        await writeWarn("Failed to delete source message", {
          sourceChatId: payload.sourceChatId,
          sourceMessageId: payload.sourceMessageId,
          error: deleteError instanceof Error ? deleteError.message : String(deleteError)
        });

        await updateLeadStatus({
          leadId: createdLead.id,
          status: LeadStatus.NOT_DELETED_NO_PERMISSION,
          driverMessageId,
          errorMessage: deleteError instanceof Error ? deleteError.message : String(deleteError)
        });

        return { processed: true, reason: "Sent but source delete not permitted" };
      }
    }

    if (!sendResult.forwardedOriginal) {
      await writeWarn("Original source message could not be forwarded, link/text fallback was sent", {
        sourceChatId: payload.sourceChatId,
        sourceMessageId: payload.sourceMessageId,
        leadId: createdLead.id
      });
    }

    if (sendResult.forwardedOriginal) {
      return { processed: true };
    }

    return { processed: true, reason: "Sent with link fallback" };
  } catch (error) {
    await writeError("Failed to send lead to driver chat", error, {
      leadId: createdLead.id,
      sourceChatId: payload.sourceChatId,
      sourceMessageId: payload.sourceMessageId
    });

    await updateLeadStatus({
      leadId: createdLead.id,
      status: LeadStatus.ERROR,
      errorMessage: error instanceof Error ? error.message : String(error)
    });

    return { processed: false, reason: "Send failed" };
  }
}

export async function processIncomingMessage(ctx: Context): Promise<ProcessMessageResult> {
  const msg = ctx.msg;

  if (!msg || !ctx.chat) {
    return { processed: false, reason: "Message context missing" };
  }

  if (!env.PASSENGER_CHAT_IDS.includes(ctx.chat.id)) {
    return { processed: false, reason: "Message from disallowed chat" };
  }

  if (ctx.from?.is_bot) {
    return { processed: false, reason: "Message from bot user" };
  }

  const text = getMessageText(msg);
  if (!text) {
    return { processed: false, reason: "No text/caption in message" };
  }

  const senderId =
    ctx.from?.id !== undefined
      ? String(ctx.from.id)
      : "sender_chat" in msg && msg.sender_chat
        ? `chat:${msg.sender_chat.id}`
        : `chat:${ctx.chat.id}`;
  const senderFullName =
    ctx.from?.first_name !== undefined
      ? formatFullName(ctx.from.first_name, ctx.from.last_name)
      : "sender_chat" in msg && msg.sender_chat?.title
        ? msg.sender_chat.title
        : ctx.chat.title ?? "Noma'lum";

  const payload: UnifiedIncomingMessage = {
    sourceChatId: String(ctx.chat.id),
    sourceChatTitle: ctx.chat.title ?? String(ctx.chat.id),
    sourceChatUsername: ctx.chat.username ?? null,
    sourceMessageId: msg.message_id,
    senderId,
    senderFullName,
    senderUsername: ctx.from?.username ?? null,
    text,
    messageDate: new Date(msg.date * 1000),
    isForwarded: isForwardedMessage(msg)
  };

  const actions: UnifiedMessageActions = {
    sendToDriver: async (formattedText, _originalText) => {
      const summaryMessage = await ctx.api.sendMessage(env.DRIVER_CHAT_ID, formattedText);
      return {
        driverMessageId: summaryMessage.message_id,
        forwardedOriginal: true
      };
    },
    deleteFromSource: async () => {
      await ctx.api.deleteMessage(ctx.chat!.id, msg.message_id);
    }
  };

  const result = await processIncomingLead(payload, actions);
  return result;
}


export async function getStatusSnapshot(): Promise<{
  total: number;
  sent: number;
  deletedFromSource: number;
  notDeletedNoPermission: number;
  ignored: number;
  duplicate: number;
  error: number;
}> {
  const grouped = await prisma.lead.groupBy({
    by: ["status"],
    _count: { status: true }
  });

  const counts = {
    total: 0,
    sent: 0,
    deletedFromSource: 0,
    notDeletedNoPermission: 0,
    ignored: 0,
    duplicate: 0,
    error: 0
  };

  for (const row of grouped) {
    counts.total += row._count.status;

    if (row.status === LeadStatus.SENT) {
      counts.sent = row._count.status;
    }

    if (row.status === LeadStatus.DELETED_FROM_SOURCE) {
      counts.deletedFromSource = row._count.status;
    }

    if (row.status === LeadStatus.NOT_DELETED_NO_PERMISSION) {
      counts.notDeletedNoPermission = row._count.status;
    }

    if (row.status === LeadStatus.IGNORED) {
      counts.ignored = row._count.status;
    }

    if (row.status === LeadStatus.DUPLICATE) {
      counts.duplicate = row._count.status;
    }

    if (row.status === LeadStatus.ERROR) {
      counts.error = row._count.status;
    }
  }

  return counts;
}

export async function getStatsSnapshot(): Promise<{
  today: { leads: number; sent: number; deleted: number; duplicates: number; errors: number };
  week: { leads: number; sent: number; deleted: number; duplicates: number; errors: number };
}> {
  const now = new Date();
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);

  const weekStart = new Date(now);
  weekStart.setDate(now.getDate() - 6);
  weekStart.setHours(0, 0, 0, 0);

  const [
    todayLeads,
    todaySent,
    todayDeleted,
    todayDuplicates,
    todayErrors,
    weekLeads,
    weekSent,
    weekDeleted,
    weekDuplicates,
    weekErrors
  ] = await Promise.all([
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: { in: [LeadStatus.NEW, LeadStatus.SENT, LeadStatus.DELETED_FROM_SOURCE] } } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.SENT } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.DELETED_FROM_SOURCE } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.DUPLICATE } }),
    prisma.lead.count({ where: { createdAt: { gte: dayStart }, status: LeadStatus.ERROR } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: { in: [LeadStatus.NEW, LeadStatus.SENT, LeadStatus.DELETED_FROM_SOURCE] } } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.SENT } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.DELETED_FROM_SOURCE } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.DUPLICATE } }),
    prisma.lead.count({ where: { createdAt: { gte: weekStart }, status: LeadStatus.ERROR } })
  ]);

  return {
    today: {
      leads: todayLeads,
      sent: todaySent,
      deleted: todayDeleted,
      duplicates: todayDuplicates,
      errors: todayErrors
    },
    week: {
      leads: weekLeads,
      sent: weekSent,
      deleted: weekDeleted,
      duplicates: weekDuplicates,
      errors: weekErrors
    }
  };
}

export async function getLastLeads(limit = 10): Promise<
  Array<{
    id: number;
    status: LeadStatus;
    sender: string;
    route: string;
    createdAt: Date;
    source: string;
  }>
> {
  const safeLimit = Math.max(1, Math.min(50, limit));
  const rows = await prisma.lead.findMany({
    take: safeLimit,
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      status: true,
      senderFullName: true,
      fullName: true,
      fromLocation: true,
      toLocation: true,
      detectedRoute: true,
      createdAt: true,
      sourceChatTitle: true,
      sourceChatId: true,
      sourceMessageId: true
    }
  });

  return rows.map((row) => {
    const sender = row.senderFullName ?? row.fullName;
    const routeFromFields = row.fromLocation || row.toLocation ? `${row.fromLocation ?? "?"} -> ${row.toLocation ?? "?"}` : row.detectedRoute ?? "aniqlanmadi";
    const source = row.sourceChatTitle ?? `${row.sourceChatId}/${row.sourceMessageId}`;

    return {
      id: row.id,
      status: row.status,
      sender,
      route: routeFromFields,
      createdAt: row.createdAt,
      source
    };
  });
}






