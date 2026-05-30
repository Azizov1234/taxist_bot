import { NewMessage, type NewMessageEvent } from "telegram/events/NewMessage.js";
import { getPeerId } from "telegram/Utils.js";
import { Api } from "telegram";
import type { TelegramClient } from "telegram";
import { LeadStatus } from "@prisma/client";
import { env, getDriverChatIdBySourceChatId, getSourceRegionByPassengerChatId, isDriverChatId, type SourceRegion } from "../config/env.js";
import { prisma } from "../prisma/client.js";
import { classifyMessage, getProviderStatusSnapshot } from "../services/leadClassifier.service.js";
import {
  addKeywordEntry,
  getKeywordCacheStats,
  getKeywordCountByCategory,
  listKeywordsByCategory,
  mapInputCategory,
  reloadKeywordDictionaryCache
} from "../services/keywordDictionary.service.js";
import {
  getLastLeads,
  type ProcessMessageResult,
  getStatsSnapshot,
  getStatusSnapshot,
  processIncomingLead,
  type UnifiedIncomingMessage,
  type UnifiedMessageActions
} from "../services/lead.service.js";
import { writeError, writeInfo, writeWarn } from "../services/logger.service.js";

interface ListenerState {
  paused: boolean;
}

const REGION_ROUTE_PATTERNS: Record<SourceRegion, RegExp[]> = {
  TASHKENT: [
    /\bt[o0]sh?k?e?n?t[nm]?[\p{L}\p{N}_]*\b/iu,
    /\btashk?e?n?t[nm]?[\p{L}\p{N}_]*\b/iu,
    /\btoshketn[\p{L}\p{N}_]*\b/iu,
    /\btoshektn[\p{L}\p{N}_]*\b/iu,
    /\bтошкент[\p{L}\p{N}_]*\b/iu,
    /\bсергели[\p{L}\p{N}_]*\b/iu,
    /\bchilonzor[\p{L}\p{N}_]*\b/iu,
    /\byunusobod[\p{L}\p{N}_]*\b/iu,
    /\bchinoz[\p{L}\p{N}_]*\b/iu,
    /\bolmaliq[\p{L}\p{N}_]*\b/iu,
    /\bangren[\p{L}\p{N}_]*\b/iu,
    /\bohangaron[\p{L}\p{N}_]*\b/iu
  ],
  GULISTON: [
    /\bguliston[\p{L}\p{N}_]*\b/iu,
    /\bbekobod[\p{L}\p{N}_]*\b/iu,
    /\bshirin[\p{L}\p{N}_]*\b/iu,
    /\byangiyer[\p{L}\p{N}_]*\b/iu,
    /\bsirdaryo[\p{L}\p{N}_]*\b/iu,
    /\bгулистон[\p{L}\p{N}_]*\b/iu,
    /\bбекобод[\p{L}\p{N}_]*\b/iu
  ]
};

function normalizeRouteText(value: string): string {
  return value
    .toLowerCase()
    .replace(/[\u2019`']/g, "'")
    .replace(/[^\p{L}\p{N}\s']/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function routeMentionsRegion(routeText: string, region: SourceRegion): boolean {
  const normalized = normalizeRouteText(routeText);
  if (!normalized) {
    return false;
  }

  return REGION_ROUTE_PATTERNS[region].some((pattern) => pattern.test(normalized));
}

function resolvePreferredDriverChatIdByRoute(payload: UnifiedIncomingMessage, fallbackDriverChatId: number): number {
  const normalizedText = normalizeRouteText(payload.text);
  if (!normalizedText) {
    return fallbackDriverChatId;
  }

  const mentionsTashkent = routeMentionsRegion(normalizedText, "TASHKENT");
  const mentionsGuliston = routeMentionsRegion(normalizedText, "GULISTON");

  // Business rule: if route mentions Toshkent, always route to Toshkent driver chat only.
  if (mentionsTashkent && env.DRIVER_CHAT_ID_TASHKENT !== null) {
    return env.DRIVER_CHAT_ID_TASHKENT;
  }

  // If Toshkent keyword is not present but Guliston-side locations are present, route to Guliston.
  if (!mentionsTashkent && mentionsGuliston && env.DRIVER_CHAT_ID_GULISTON !== null) {
    return env.DRIVER_CHAT_ID_GULISTON;
  }

  return fallbackDriverChatId;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function toNumericId(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return null;
  }

  return parsed;
}

function toPositiveUserId(value: string): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    return null;
  }

  return parsed;
}

function toNumberId(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }

  if (typeof value === "bigint") {
    return Number(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return Math.trunc(parsed);
    }
  }

  return null;
}

function formatEntityName(entity: any): string {
  if (!entity) {
    return "";
  }

  if (typeof entity.title === "string" && entity.title.trim().length > 0) {
    return entity.title.trim();
  }

  const firstName = toText(entity.firstName || entity.first_name);
  const lastName = toText(entity.lastName || entity.last_name);
  const fullName = `${firstName} ${lastName}`.replace(/\s+/g, " ").trim();

  if (fullName.length > 0) {
    return fullName;
  }

  return "";
}

function getMessageDate(rawDate: unknown): Date {
  if (rawDate instanceof Date) {
    return rawDate;
  }

  const asNumber = Number(rawDate);
  if (Number.isFinite(asNumber) && asNumber > 0) {
    return new Date(asNumber * 1000);
  }

  return new Date();
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

function canDeleteMessagesInChat(entity: any): boolean {
  if (!entity) {
    return false;
  }

  if (entity.creator === true) {
    return true;
  }

  const rights = entity.adminRights ?? entity.admin_rights;
  if (!rights) {
    return false;
  }

  return Boolean(rights.deleteMessages ?? rights.delete_messages);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function parseFloodWaitSeconds(error: unknown): number | null {
  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toUpperCase();

  const strictMatch = normalized.match(/FLOOD_WAIT_(\d+)/);
  if (strictMatch) {
    const seconds = Number(strictMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  const genericMatch = normalized.match(/A WAIT OF (\d+) SECONDS IS REQUIRED/);
  if (genericMatch) {
    const seconds = Number(genericMatch[1]);
    return Number.isFinite(seconds) ? seconds : null;
  }

  return null;
}

type SessionAuthErrorType = "AUTH_KEY_DUPLICATED" | "AUTH_KEY_INVALID" | "SESSION_REVOKED";

function classifySessionAuthError(error: unknown): SessionAuthErrorType | null {
  const message = (error instanceof Error ? error.message : String(error)).toUpperCase();

  if (message.includes("AUTH_KEY_DUPLICATED")) {
    return "AUTH_KEY_DUPLICATED";
  }

  if (message.includes("AUTH_KEY_INVALID") || message.includes("AUTH_KEY_UNREGISTERED")) {
    return "AUTH_KEY_INVALID";
  }

  if (message.includes("SESSION_REVOKED") || message.includes("SESSION_EXPIRED")) {
    return "SESSION_REVOKED";
  }

  return null;
}

function buildSessionRecoveryHint(errorType: SessionAuthErrorType): string {
  if (errorType === "AUTH_KEY_DUPLICATED") {
    return "TELEGRAM_STRING_SESSION bir nechta joyda ishlatilgan. Yangi session oling va faqat bitta instance qoldiring.";
  }

  if (errorType === "AUTH_KEY_INVALID") {
    return "TELEGRAM_STRING_SESSION endi yaroqsiz. Yangi session oling va .env ni yangilang.";
  }

  return "Telegram session bekor qilingan. Yangi session oling va .env ni yangilang.";
}

function isInputEntityResolveError(error: unknown): boolean {
  const message = (error instanceof Error ? error.message : String(error)).toUpperCase();
  return (
    message.includes("COULD NOT FIND THE INPUT ENTITY") ||
    message.includes("PEER_ID_INVALID") ||
    message.includes("CHANNEL_INVALID")
  );
}

async function replyToEvent(client: TelegramClient, event: NewMessageEvent, text: string): Promise<void> {
  const inputChat = await event.getInputChat();
  if (!inputChat) {
    return;
  }

  await client.sendMessage(inputChat, {
    message: text
  });
}

async function probeSourceChats(client: TelegramClient): Promise<string> {
  const lines: string[] = [];
  lines.push(`Configured source chats: ${env.PASSENGER_CHAT_IDS.join(", ")}`);
  lines.push(`TASHKENT passengers: ${env.PASSENGER_CHAT_IDS_TASHKENT.join(", ") || "-"}`);
  lines.push(`GULISTON passengers: ${env.PASSENGER_CHAT_IDS_GULISTON.join(", ") || "-"}`);
  lines.push(`TASHKENT driver: ${env.DRIVER_CHAT_ID_TASHKENT ?? "-"}`);
  lines.push(`GULISTON driver: ${env.DRIVER_CHAT_ID_GULISTON ?? "-"}`);

  for (const chatId of env.PASSENGER_CHAT_IDS) {
    try {
      const entity = await client.getEntity(chatId);
      const title = formatEntityName(entity) || String(chatId);
      const sourceRegion = getSourceRegionByPassengerChatId(chatId) ?? "UNKNOWN";
      const lastMessages = await client.getMessages(chatId, { limit: 1 });
      const lastMessage = Array.isArray(lastMessages) ? (lastMessages[0] ?? null) : null;
      const lastMessageId = lastMessage?.id ?? "-";
      const lastMessageDate = lastMessage?.date ? getMessageDate(lastMessage.date).toISOString() : "-";
      lines.push(`OK | ${chatId} | ${sourceRegion} | ${title} | lastMessageId=${lastMessageId} | lastMessageDate=${lastMessageDate}`);
    } catch (error) {
      lines.push(`FAIL | ${chatId} | ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return lines.join("\n");
}

async function resolveSourceChat(
  event: NewMessageEvent
): Promise<{ sourceChatId: string; sourceChatIdNumber: number; sourceRegion: SourceRegion; driverChatId: number; chat: any | null }> {
  const candidateIds: number[] = [];

  const peerId = event.message.peerId;
  if (peerId) {
    const peerRaw = getPeerId(peerId, true);
    const peerNumber = toNumberId(peerRaw);
    if (peerNumber !== null) {
      candidateIds.push(peerNumber);
    }
  }

  let chat: any | null = null;
  try {
    chat = await event.getChat();
  } catch {
    chat = null;
  }

  if (chat) {
    try {
      const chatRaw = getPeerId(chat, true);
      const chatNumber = toNumberId(chatRaw);
      if (chatNumber !== null) {
        candidateIds.push(chatNumber);
      }
    } catch {
      // ignore
    }
  }

  const uniqueCandidateIds = [...new Set(candidateIds)];
  const matchedId = uniqueCandidateIds.find((id) => env.PASSENGER_CHAT_IDS.includes(id));
  if (matchedId === undefined) {
    throw new Error(`Source chat not matched. candidates=[${uniqueCandidateIds.join(", ")}]`);
  }

  const sourceRegion = getSourceRegionByPassengerChatId(matchedId);
  const driverChatId = getDriverChatIdBySourceChatId(matchedId);
  if (!sourceRegion || driverChatId === null) {
    throw new Error(`Source chat ${matchedId} has no region/driver mapping`);
  }

  return {
    sourceChatId: String(matchedId),
    sourceChatIdNumber: matchedId,
    sourceRegion,
    driverChatId,
    chat
  };
}

async function handleAdminCommand(client: TelegramClient, event: NewMessageEvent, commandText: string, state: ListenerState): Promise<boolean> {
  const senderId = event.message.senderId?.toString();
  if (!senderId || senderId !== String(env.ADMIN_TELEGRAM_ID ?? "")) {
    return false;
  }

  if (!commandText.startsWith(".")) {
    return false;
  }

  const [rawCommand = "", ...rest] = commandText.trim().split(/\s+/);
  const command = rawCommand.toLowerCase();
  const arg = rest.join(" ").trim();

  if (command === ".pause") {
    state.paused = true;
    await replyToEvent(client, event, "Userbot pauza holatiga o'tdi.");
    return true;
  }

  if (command === ".resume") {
    state.paused = false;
    await replyToEvent(client, event, "Userbot qayta ishga tushdi.");
    return true;
  }

  if (command === ".sources") {
    await replyToEvent(
      client,
      event,
      [
        `Source chatlar: ${env.PASSENGER_CHAT_IDS.join(", ")}`,
        `TASHKENT passenger: ${env.PASSENGER_CHAT_IDS_TASHKENT.join(", ") || "-"}`,
        `GULISTON passenger: ${env.PASSENGER_CHAT_IDS_GULISTON.join(", ") || "-"}`,
        `TASHKENT driver: ${env.DRIVER_CHAT_ID_TASHKENT ?? "-"}`,
        `GULISTON driver: ${env.DRIVER_CHAT_ID_GULISTON ?? "-"}`,
        `Pauza: ${state.paused ? "ha" : "yo'q"}`
      ].join("\n")
    );
    return true;
  }

  if (command === ".source_probe") {
    const report = await probeSourceChats(client);
    await replyToEvent(client, event, report);
    return true;
  }

  if (command === ".status") {
    const status = await getStatusSnapshot();
    const providerStatus = getProviderStatusSnapshot()
      .map((item) => `${item.name}: ${item.status}${item.keyConfigured ? "" : " (key yo'q)"}`)
      .join(" | ");

    await replyToEvent(
      client,
      event,
      [
        "Userbot status:",
        `Pauza: ${state.paused ? "ha" : "yo'q"}`,
        `Jami: ${status.total}`,
        `Sent: ${status.sent}`,
        `Deleted from source: ${status.deletedFromSource}`,
        `Not deleted (permission): ${status.notDeletedNoPermission}`,
        `Ignored: ${status.ignored}`,
        `Duplicate: ${status.duplicate}`,
        `Error: ${status.error}`,
        `Providerlar: ${providerStatus || "-"}`
      ].join("\n")
    );

    return true;
  }

  if (command === ".stats") {
    const stats = await getStatsSnapshot();

    await replyToEvent(
      client,
      event,
      [
        "Statistika:",
        "",
        `Bugun lead: ${stats.today.leads}`,
        `Bugun sent: ${stats.today.sent}`,
        `Bugun delete: ${stats.today.deleted}`,
        `Bugun duplicate: ${stats.today.duplicates}`,
        `Bugun error: ${stats.today.errors}`,
        "",
        `Hafta lead: ${stats.week.leads}`,
        `Hafta sent: ${stats.week.sent}`,
        `Hafta delete: ${stats.week.deleted}`,
        `Hafta duplicate: ${stats.week.duplicates}`,
        `Hafta error: ${stats.week.errors}`
      ].join("\n")
    );

    return true;
  }

  if (command === ".test") {
    if (!arg) {
      await replyToEvent(client, event, "Foydalanish: .test <text>");
      return true;
    }

    const result = await classifyMessage(arg);
    await replyToEvent(
      client,
      event,
      [
        `Category: ${result.category}`,
        `Passenger lead: ${result.is_passenger_request ? "ha" : "yo'q"}`,
        `Confidence: ${result.confidence}`,
        `Provider: ${result.provider}`,
        `Passenger score: ${result.passengerScore}`,
        `Driver score: ${result.driverScore}`,
        `Cargo score: ${result.cargoScore}`,
        `Spam score: ${result.spamScore}`,
        `Driver ad: ${result.isDriverAd ? "ha" : "yo'q"}`,
        `Spam: ${result.isSpam ? "ha" : "yo'q"}`,
        `From: ${result.fromLocation ?? "-"}`,
        `To: ${result.toLocation ?? "-"}`,
        `Phone: ${result.phone ?? "-"}`,
        `Passenger count: ${result.passengerCount ?? "-"}`,
        `Time hint: ${result.timeHint ?? "-"}`,
        `Matched: ${result.matchedKeywords.slice(0, 12).join(", ") || "-"}`,
        `Reason: ${result.reason}`
      ].join("\n")
    );

    return true;
  }

  if (command === ".keyword_count") {
    const counts = await getKeywordCountByCategory();
    const cacheStats = getKeywordCacheStats();
    await replyToEvent(
      client,
      event,
      [
        "Keyword counts:",
        `PASSENGER: ${counts.PASSENGER}`,
        `DRIVER: ${counts.DRIVER}`,
        `CARGO: ${counts.CARGO}`,
        `SPAM: ${counts.SPAM}`,
        `AMBIGUOUS: ${counts.AMBIGUOUS}`,
        `Cache total: ${cacheStats.total}`
      ].join("\n")
    );
    return true;
  }

  if (command === ".reload_keywords") {
    await reloadKeywordDictionaryCache();
    const cacheStats = getKeywordCacheStats();
    await replyToEvent(
      client,
      event,
      `Keyword cache reloaded. total=${cacheStats.total}, loadedAt=${new Date(cacheStats.loadedAt).toISOString()}`
    );
    return true;
  }

  if (command === ".keywords") {
    const category = mapInputCategory(arg);
    if (!category || category === "AMBIGUOUS") {
      await replyToEvent(client, event, "Foydalanish: .keywords passenger|driver|cargo|spam");
      return true;
    }

    const rows = await listKeywordsByCategory(category, 50);
    const lines = rows.map((row) => `${row.weight} | ${row.phrase}`);
    await replyToEvent(client, event, [`${category} keywords (${rows.length}):`, ...lines].join("\n"));
    return true;
  }

  if (command === ".add_keyword") {
    const match = commandText.match(/^\.add_keyword\s+(\w+)\s+"([^"]+)"(?:\s+(\d+))?$/i);
    if (!match) {
      await replyToEvent(client, event, 'Foydalanish: .add_keyword passenger "ketish kerak" 8');
      return true;
    }

    const category = mapInputCategory(match[1] ?? "");
    if (!category) {
      await replyToEvent(client, event, "Category noto'g'ri. passenger|driver|cargo|spam|ambiguous");
      return true;
    }

    const phrase = match[2] ?? "";
    const weight = Number(match[3] ?? "1");
    const added = await addKeywordEntry({
      category,
      phrase,
      weight,
      source: "admin"
    });

    if (!added) {
      await replyToEvent(client, event, "Keyword qo'shilmadi (bo'sh yoki noto'g'ri).");
      return true;
    }

    await replyToEvent(client, event, `Saqlangan: [${added.category}] ${added.phrase} (w=${added.weight})`);
    return true;
  }

  if (command === ".last") {
    const parsedLimit = Number(arg || "10");
    const limit = Number.isFinite(parsedLimit) && parsedLimit > 0 ? parsedLimit : 10;
    const rows = await getLastLeads(limit);

    if (rows.length === 0) {
      await replyToEvent(client, event, "Hali lead yozuvlari yo'q.");
      return true;
    }

    const lines = rows.map(
      (row) =>
        `#${row.id} [${row.status}] ${row.sender} | ${row.route} | ${row.source} | ${row.createdAt.toISOString().slice(0, 16).replace("T", " ")}`
    );

    await replyToEvent(client, event, lines.join("\n"));
    return true;
  }

  await replyToEvent(
    client,
    event,
    "Mavjud commandlar: .status, .stats, .test <text>, .sources, .source_probe, .pause, .resume, .last <n>, .keywords <category>, .keyword_count, .add_keyword <category> \"phrase\" <weight>, .reload_keywords"
  );
  return true;
}

async function buildUnifiedPayload(event: NewMessageEvent): Promise<UnifiedIncomingMessage | null> {
  const messageText = toText(event.message.message).trim();
  if (!messageText) {
    return null;
  }

  let resolvedSource:
    | {
        sourceChatId: string;
        sourceChatIdNumber: number;
        sourceRegion: SourceRegion;
        driverChatId: number;
        chat: any | null;
      }
    | null = null;

  try {
    resolvedSource = await resolveSourceChat(event);
  } catch {
    return null;
  }

  const sourceChatId = resolvedSource.sourceChatId;
  const chat = resolvedSource.chat ?? (await event.getChat().catch(() => null));
  const sender = await event.message.getSender();
  const senderIdRaw = event.message.senderId?.toString();

  const senderId = senderIdRaw ?? `chat:${sourceChatId}`;
  const senderFullName = formatEntityName(sender) || formatEntityName(chat) || senderId;
  const senderUsername = toText((sender as any)?.username || (sender as any)?.usernames?.[0]?.username) || null;
  const sourceChatUsername = toText((chat as any)?.username || (chat as any)?.usernames?.[0]?.username) || null;
  const sourceChatTitle = formatEntityName(chat) || sourceChatId;

  return {
    sourceChatId,
    sourceRegion: resolvedSource.sourceRegion,
    sourceChatTitle,
    sourceChatUsername,
    sourceMessageId: event.message.id,
    senderId,
    senderFullName,
    senderUsername,
    isSourceAdmin: false,
    isDriverChatMember: false,
    isStartupBackfill: false,
    text: messageText,
    messageDate: getMessageDate(event.message.date),
    isForwarded: Boolean((event.message as any).fwdFrom)
  };
}

async function buildUnifiedPayloadFromStoredMessage(
  client: TelegramClient,
  sourceChatIdNumber: number,
  message: any
): Promise<{ payload: UnifiedIncomingMessage; senderEntity: any | null } | null> {
  const messageText = toText(message?.message).trim();
  if (!messageText) {
    return null;
  }

  const sourceChatId = String(sourceChatIdNumber);
  const sourceRegion = getSourceRegionByPassengerChatId(sourceChatIdNumber);
  if (!sourceRegion) {
    return null;
  }
  const chat = await client.getEntity(sourceChatIdNumber).catch(() => null);
  const senderEntity = await message?.getSender?.().catch(() => null);
  const senderIdRaw = message?.senderId?.toString?.() ?? null;

  const senderId = senderIdRaw ?? `chat:${sourceChatId}`;
  const senderFullName = formatEntityName(senderEntity) || formatEntityName(chat) || senderId;
  const senderUsername = toText((senderEntity as any)?.username || (senderEntity as any)?.usernames?.[0]?.username) || null;
  const sourceChatUsername = toText((chat as any)?.username || (chat as any)?.usernames?.[0]?.username) || null;
  const sourceChatTitle = formatEntityName(chat) || sourceChatId;

  const payload: UnifiedIncomingMessage = {
    sourceChatId,
    sourceRegion,
    sourceChatTitle,
    sourceChatUsername,
    sourceMessageId: Number(message?.id),
    senderId,
    senderFullName,
    senderUsername,
    isSourceAdmin: false,
    isDriverChatMember: false,
    isStartupBackfill: true,
    text: messageText,
    messageDate: getMessageDate(message?.date),
    isForwarded: Boolean(message?.fwdFrom)
  };

  if (!Number.isInteger(payload.sourceMessageId) || payload.sourceMessageId <= 0) {
    return null;
  }

  return {
    payload,
    senderEntity
  };
}

export async function startUserbotListener(client: TelegramClient): Promise<void> {
  const state: ListenerState = { paused: false };
  const listenerStartedAtMs = Date.now();
  const maxStartupBackfillLimit = 20;
  const configuredStartupBackfillLimit = Math.max(0, env.LISTENER_STARTUP_BACKFILL_LIMIT);
  const startupBackfillLimit = Math.min(maxStartupBackfillLimit, configuredStartupBackfillLimit);
  const outboundMinDelayMs = 900;
  const outboundJitterMs = 600;
  const ignoredSourceLogCache = new Set<number>();
  const deleteCapabilityBySourceChat = new Map<number, boolean>();
  const sourceAdminByChatAndUser = new Map<string, boolean>();
  const driverMembershipByChatAndUser = new Map<string, boolean>();
  const driverInputPeerByChatId = new Map<number, any>();
  const highestSeenSourceMessageId = new Map<number, number>();
  const periodicCatchUpIntervalMs = 30_000;
  const periodicCatchUpLimit = Math.max(50, startupBackfillLimit * 4);
  let outboundQueue: Promise<unknown> = Promise.resolve();
  let lastOutboundWriteAt = 0;
  let periodicCatchUpInFlight = false;
  let listenerBlockedBySessionAuthError = false;

  const handleSessionAuthFailure = async (
    stage: "startup_backfill" | "periodic_catch_up" | "event_handler",
    error: unknown,
    meta?: Record<string, unknown>
  ): Promise<boolean> => {
    const errorType = classifySessionAuthError(error);
    if (!errorType) {
      return false;
    }

    const recoveryHint = buildSessionRecoveryHint(errorType);
    listenerBlockedBySessionAuthError = true;
    state.paused = true;

    await writeError("Userbot listener stopped: unrecoverable Telegram session error", error, {
      stage,
      errorType,
      recoveryHint,
      ...meta
    });

    return true;
  };

  const runThrottledTelegramWrite = async <T>(operationName: string, operation: () => Promise<T>): Promise<T> => {
    const task = outboundQueue.then(async () => {
      const now = Date.now();
      const baseWaitMs = Math.max(0, lastOutboundWriteAt + outboundMinDelayMs - now);
      const jitterWaitMs = Math.floor(Math.random() * (outboundJitterMs + 1));
      const totalWaitMs = baseWaitMs + jitterWaitMs;

      if (totalWaitMs > 0) {
        await sleep(totalWaitMs);
      }

      while (true) {
        try {
          const result = await operation();
          lastOutboundWriteAt = Date.now();
          return result;
        } catch (error) {
          const floodWaitSeconds = parseFloodWaitSeconds(error);
          if (floodWaitSeconds === null) {
            lastOutboundWriteAt = Date.now();
            throw error;
          }

          const retryAfterMs = floodWaitSeconds * 1000 + 1_500 + Math.floor(Math.random() * 700);
          await writeWarn("Telegram flood wait detected, retrying throttled write", {
            operation: operationName,
            retryAfterMs,
            floodWaitSeconds
          });
          await sleep(retryAfterMs);
        }
      }
    });

    outboundQueue = task.then(
      () => undefined,
      () => undefined
    );

    return task;
  };

  const resolveDriverInputPeer = async (driverChatId: number, forceRefresh = false): Promise<any> => {
    if (!forceRefresh) {
      const cached = driverInputPeerByChatId.get(driverChatId);
      if (cached) {
        return cached;
      }
    }

    if (forceRefresh) {
      driverInputPeerByChatId.delete(driverChatId);
      // Refresh local dialog/entity cache after membership or permission changes.
      await client.getDialogs({ limit: 500 });
    }

    const inputPeer = await client.getInputEntity(driverChatId);
    driverInputPeerByChatId.set(driverChatId, inputPeer);
    return inputPeer;
  };

  const withDriverPeerRetry = async <T>(
    operationName: string,
    driverChatId: number,
    operation: (driverInputPeer: any) => Promise<T>
  ): Promise<T> => {
    try {
      const driverInputPeer = await resolveDriverInputPeer(driverChatId);
      return await operation(driverInputPeer);
    } catch (error) {
      if (!isInputEntityResolveError(error)) {
        throw error;
      }

      await writeWarn("Driver chat peer unresolved, refreshing dialogs and retrying", {
        operation: operationName,
        driverChatId,
        error: error instanceof Error ? error.message : String(error)
      });

      const driverInputPeer = await resolveDriverInputPeer(driverChatId, true);
      return await operation(driverInputPeer);
    }
  };

  const markSeenSourceMessageId = (sourceChatIdNumber: number, sourceMessageId: number): void => {
    if (!Number.isInteger(sourceMessageId) || sourceMessageId <= 0) {
      return;
    }

    const previous = highestSeenSourceMessageId.get(sourceChatIdNumber) ?? 0;
    if (sourceMessageId > previous) {
      highestSeenSourceMessageId.set(sourceChatIdNumber, sourceMessageId);
    }
  };

  const resolveDeleteCapability = async (sourceChatIdNumber: number): Promise<boolean> => {
    const cached = deleteCapabilityBySourceChat.get(sourceChatIdNumber);
    if (cached !== undefined) {
      return cached;
    }

    let canDelete = false;
    try {
      const entity = await client.getEntity(sourceChatIdNumber);
      canDelete = canDeleteMessagesInChat(entity);
    } catch (error) {
      await writeWarn("Failed to resolve source delete permission", {
        sourceChatId: String(sourceChatIdNumber),
        error: error instanceof Error ? error.message : String(error)
      });
    }

    deleteCapabilityBySourceChat.set(sourceChatIdNumber, canDelete);
    await writeInfo("Source delete permission cached", {
      sourceChatId: String(sourceChatIdNumber),
      canDelete
    });

    return canDelete;
  };

  const resolveSenderProtectionFlags = async (
    sourceChatIdNumber: number,
    driverChatId: number,
    senderId: string
  ): Promise<{ isSourceAdmin: boolean; isDriverChatMember: boolean }> => {
    const senderUserId = toPositiveUserId(senderId);
    if (senderUserId === null) {
      return { isSourceAdmin: false, isDriverChatMember: false };
    }

    if (env.ADMIN_TELEGRAM_ID && senderUserId === env.ADMIN_TELEGRAM_ID) {
      return { isSourceAdmin: true, isDriverChatMember: false };
    }

    const sourceAdminCacheKey = `${sourceChatIdNumber}:${senderUserId}`;
    let isSourceAdmin = sourceAdminByChatAndUser.get(sourceAdminCacheKey);
    if (isSourceAdmin === undefined) {
      try {
        const participantResult = await client.invoke(
          new Api.channels.GetParticipant({
            channel: sourceChatIdNumber,
            participant: senderUserId
          })
        );
        const participant = participantResult.participant;
        isSourceAdmin = participant instanceof Api.ChannelParticipantAdmin || participant instanceof Api.ChannelParticipantCreator;
      } catch {
        isSourceAdmin = false;
      }
      sourceAdminByChatAndUser.set(sourceAdminCacheKey, isSourceAdmin);
    }

    const driverMembershipCacheKey = `${driverChatId}:${senderUserId}`;
    let isDriverChatMember = driverMembershipByChatAndUser.get(driverMembershipCacheKey);
    if (isDriverChatMember === undefined) {
      try {
        const participantResult = await client.invoke(
          new Api.channels.GetParticipant({
            channel: driverChatId,
            participant: senderUserId
          })
        );
        const participant = participantResult.participant;
        isDriverChatMember = !(participant instanceof Api.ChannelParticipantLeft || participant instanceof Api.ChannelParticipantBanned);
      } catch {
        isDriverChatMember = false;
      }
      driverMembershipByChatAndUser.set(driverMembershipCacheKey, isDriverChatMember);
    }

    return { isSourceAdmin, isDriverChatMember };
  };

  const sendSourceLinkFallback = async (payload: UnifiedIncomingMessage, driverChatId: number): Promise<void> => {
    const sourceMessageLink = buildSourceMessageLink(payload.sourceChatId, payload.sourceMessageId, payload.sourceChatUsername);
    if (sourceMessageLink) {
      try {
        await runThrottledTelegramWrite("send_source_link_fallback", async () =>
          withDriverPeerRetry("send_source_link_fallback", driverChatId, async (driverInputPeer) =>
            client.sendMessage(driverInputPeer, {
              message: sourceMessageLink
            })
          )
        );
      } catch (linkSendError) {
        await writeWarn("Failed to send source link fallback to driver chat", {
          sourceChatId: payload.sourceChatId,
          sourceMessageId: payload.sourceMessageId,
          error: linkSendError instanceof Error ? linkSendError.message : String(linkSendError)
        });
      }
    } else {
      await writeWarn("Forward failed and no source link available, keeping info-only delivery", {
        sourceChatId: payload.sourceChatId,
        sourceMessageId: payload.sourceMessageId
      });
    }
  };

  const buildActions = (
    payload: UnifiedIncomingMessage,
    sourceChatIdNumber: number,
    driverChatId: number,
    canDeleteFromSource: boolean,
    resolveForwardFromPeer: () => Promise<any>,
    resolveSenderEntity: () => Promise<any | null>
  ): UnifiedMessageActions => {
    const actions: UnifiedMessageActions = {
      sendToDriver: async (formattedText, _originalText) => {
        const sent = await runThrottledTelegramWrite("send_driver_summary", async () =>
          withDriverPeerRetry("send_driver_summary", driverChatId, async (driverInputPeer) =>
            client.sendMessage(driverInputPeer, {
              message: formattedText
            })
          )
        );
        let forwardedOriginal = false;
        let forwardedContactVisible = false;

        try {
          const fromPeer = await resolveForwardFromPeer();
          const forwardedMessages = await runThrottledTelegramWrite("forward_original_message", async () =>
            withDriverPeerRetry("forward_original_message", driverChatId, async (driverInputPeer) =>
              client.forwardMessages(driverInputPeer, {
                messages: [payload.sourceMessageId],
                fromPeer
              })
            )
          );
          forwardedOriginal = true;

          const firstForwardedMessage = Array.isArray(forwardedMessages) ? forwardedMessages[0] : null;
          const forwardedFromId = (firstForwardedMessage as any)?.fwdFrom?.fromId;
          forwardedContactVisible = forwardedFromId instanceof Api.PeerUser;
        } catch (forwardError) {
          await writeWarn("Failed to forward original source message to driver chat", {
            sourceChatId: payload.sourceChatId,
            sourceMessageId: payload.sourceMessageId,
            error: forwardError instanceof Error ? forwardError.message : String(forwardError)
          });

          await sendSourceLinkFallback(payload, driverChatId);
        }

        return {
          driverMessageId: sent.id,
          forwardedOriginal,
          forwardedContactVisible
        };
      },
      notifyPassenger: async (textToPassenger) => {
        if (payload.senderId.startsWith("chat:")) {
          return;
        }

        const senderEntity = await resolveSenderEntity();
        if (!senderEntity) {
          return;
        }

        await runThrottledTelegramWrite("notify_passenger", async () =>
          client.sendMessage(senderEntity, {
            message: textToPassenger
          })
        );
      }
    };

    if (canDeleteFromSource) {
      actions.notifySourceChat = async (textToSourceChat) => {
        await runThrottledTelegramWrite("notify_source_chat", async () =>
          client.sendMessage(sourceChatIdNumber, {
            message: textToSourceChat,
            replyTo: payload.sourceMessageId
          })
        );
      };
    }

    if (canDeleteFromSource) {
      actions.deleteFromSource = async () => {
        await runThrottledTelegramWrite("delete_source_message", async () =>
          client.deleteMessages(sourceChatIdNumber, [payload.sourceMessageId], {
            revoke: true
          })
        );
      };
    }

    return actions;
  };

  const processStoredSourceMessage = async (
    sourceChatIdNumber: number,
    driverChatId: number,
    message: any,
    canDeleteFromSource: boolean,
    shouldScanByMessageId: (messageId: number) => boolean
  ): Promise<{ scanned: boolean; leadResult: ProcessMessageResult | null }> => {
    const messageId = Number(message?.id ?? 0);
    if (!Number.isInteger(messageId) || messageId <= 0 || !shouldScanByMessageId(messageId)) {
      return { scanned: false, leadResult: null };
    }

    markSeenSourceMessageId(sourceChatIdNumber, messageId);
    if (message.out === true) {
      return { scanned: true, leadResult: null };
    }

    try {
      const built = await buildUnifiedPayloadFromStoredMessage(client, sourceChatIdNumber, message);
      if (!built) {
        return { scanned: true, leadResult: null };
      }

      const effectiveDriverChatId = resolvePreferredDriverChatIdByRoute(built.payload, driverChatId);
      const senderFlags = await resolveSenderProtectionFlags(sourceChatIdNumber, effectiveDriverChatId, built.payload.senderId);
      built.payload.isSourceAdmin = senderFlags.isSourceAdmin;
      built.payload.isDriverChatMember = senderFlags.isDriverChatMember;

      const actions = buildActions(
        built.payload,
        sourceChatIdNumber,
        effectiveDriverChatId,
        canDeleteFromSource,
        async () => sourceChatIdNumber,
        async () => built.senderEntity
      );

      const leadResult = await processIncomingLead(built.payload, actions);
      return { scanned: true, leadResult };
    } catch (error) {
      if (classifySessionAuthError(error)) {
        throw error;
      }

      await writeWarn("Failed to process stored source message", {
        sourceChatId: String(sourceChatIdNumber),
        sourceMessageId: messageId,
        error: error instanceof Error ? error.message : String(error)
      });
      return { scanned: true, leadResult: null };
    }
  };

  const getOrderedSourceMessages = async (sourceChatIdNumber: number, limit: number): Promise<any[]> => {
    const recent = await client.getMessages(sourceChatIdNumber, { limit });
    return [...recent].filter(Boolean).sort((a: any, b: any) => Number(a?.id ?? 0) - Number(b?.id ?? 0));
  };

  const runStartupBackfill = async (): Promise<void> => {
    if (startupBackfillLimit === 0 || listenerBlockedBySessionAuthError) {
      return;
    }

    for (const sourceChatIdNumber of env.PASSENGER_CHAT_IDS) {
      try {
        const sourceRegion = getSourceRegionByPassengerChatId(sourceChatIdNumber);
        const driverChatId = getDriverChatIdBySourceChatId(sourceChatIdNumber);
        if (!sourceRegion || driverChatId === null) {
          await writeWarn("Skipping startup backfill: source chat missing region/driver mapping", {
            sourceChatId: String(sourceChatIdNumber)
          });
          continue;
        }

        const canDeleteFromSource =
          env.DELETE_SOURCE_MESSAGE_IF_ADMIN && env.STARTUP_BACKFILL_DELETE_SOURCE
            ? await resolveDeleteCapability(sourceChatIdNumber)
            : false;
        const latestStored = await prisma.lead.findFirst({
          where: { sourceChatId: String(sourceChatIdNumber) },
          select: { sourceMessageId: true },
          orderBy: { sourceMessageId: "desc" }
        });
        const latestStoredSourceMessageId = latestStored?.sourceMessageId ?? 0;
        const ordered = await getOrderedSourceMessages(sourceChatIdNumber, startupBackfillLimit);
        markSeenSourceMessageId(sourceChatIdNumber, latestStoredSourceMessageId);
        const shouldResyncRecentMessages = sourceRegion === "TASHKENT";

        let processedCount = 0;
        let sentCount = 0;
        let skippedCount = 0;
        const skippedReasonCounter = new Map<string, number>();

        for (const message of ordered) {
          if (!message) {
            continue;
          }

          const result = await processStoredSourceMessage(
            sourceChatIdNumber,
            driverChatId,
            message,
            canDeleteFromSource,
            (messageId) => shouldResyncRecentMessages || messageId > latestStoredSourceMessageId
          );
          if (!result.leadResult) {
            continue;
          }

          processedCount += 1;

          if (result.leadResult.processed) {
            sentCount += 1;
          } else {
            skippedCount += 1;
            const reason = result.leadResult.reason ?? "Unknown";
            skippedReasonCounter.set(reason, (skippedReasonCounter.get(reason) ?? 0) + 1);
          }
        }

        const topSkippedReasons = [...skippedReasonCounter.entries()]
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .map(([reason, count]) => ({ reason, count }));

        await writeInfo("Userbot startup backfill completed", {
          sourceChatId: String(sourceChatIdNumber),
          sourceRegion,
          driverChatId,
          resyncedRecentMessages: shouldResyncRecentMessages,
          scanned: ordered.length,
          limit: startupBackfillLimit,
          latestStoredSourceMessageId,
          processed: processedCount,
          sent: sentCount,
          skipped: skippedCount,
          topSkippedReasons
        });
      } catch (error) {
        const isSessionAuthFailure = await handleSessionAuthFailure("startup_backfill", error, {
          sourceChatId: String(sourceChatIdNumber)
        });
        if (isSessionAuthFailure) {
          throw new Error(buildSessionRecoveryHint(classifySessionAuthError(error)!));
        }

        await writeWarn("Userbot startup backfill failed for source chat", {
          sourceChatId: String(sourceChatIdNumber),
          error: error instanceof Error ? error.message : String(error)
        });
      }
    }
  };

  const runPeriodicCatchUp = async (): Promise<void> => {
    if (periodicCatchUpInFlight || listenerBlockedBySessionAuthError) {
      return;
    }

    periodicCatchUpInFlight = true;

    try {
      for (const sourceChatIdNumber of env.PASSENGER_CHAT_IDS) {
        try {
          const sourceRegion = getSourceRegionByPassengerChatId(sourceChatIdNumber);
          const driverChatId = getDriverChatIdBySourceChatId(sourceChatIdNumber);
          if (!sourceRegion || driverChatId === null) {
            await writeWarn("Skipping periodic catch-up: source chat missing region/driver mapping", {
              sourceChatId: String(sourceChatIdNumber)
            });
            continue;
          }

          const ordered = await getOrderedSourceMessages(sourceChatIdNumber, periodicCatchUpLimit);
          const canDeleteFromSource = env.DELETE_SOURCE_MESSAGE_IF_ADMIN ? await resolveDeleteCapability(sourceChatIdNumber) : false;

          let scannedFresh = 0;
          let processedCount = 0;
          let sentCount = 0;
          let skippedCount = 0;

          for (const message of ordered) {
            if (!message) {
              continue;
            }

            const result = await processStoredSourceMessage(
              sourceChatIdNumber,
              driverChatId,
              message,
              canDeleteFromSource,
              (messageId) => messageId > (highestSeenSourceMessageId.get(sourceChatIdNumber) ?? 0)
            );
            if (!result.scanned) {
              continue;
            }

            scannedFresh += 1;
            if (!result.leadResult) {
              continue;
            }

            processedCount += 1;

            if (result.leadResult.processed) {
              sentCount += 1;
            } else {
              skippedCount += 1;
            }
          }

          if (scannedFresh > 0) {
            await writeInfo("Userbot periodic catch-up completed", {
              sourceChatId: String(sourceChatIdNumber),
              sourceRegion,
              driverChatId,
              scannedFresh,
              processed: processedCount,
              sent: sentCount,
              skipped: skippedCount
            });
          }
        } catch (error) {
          const isSessionAuthFailure = await handleSessionAuthFailure("periodic_catch_up", error, {
            sourceChatId: String(sourceChatIdNumber)
          });
          if (isSessionAuthFailure) {
            break;
          }

          await writeWarn("Userbot periodic catch-up failed for source chat", {
            sourceChatId: String(sourceChatIdNumber),
            error: error instanceof Error ? error.message : String(error)
          });
        }
      }
    } finally {
      periodicCatchUpInFlight = false;
    }
  };

  const handler = async (event: NewMessageEvent): Promise<void> => {
    try {
      if (listenerBlockedBySessionAuthError) {
        return;
      }

      const commandText = toText(event.message.message).trim();
      const commandHandled = await handleAdminCommand(client, event, commandText, state);
      if (commandHandled) {
        return;
      }

      if (state.paused) {
        return;
      }

      const eventDateMs = getMessageDate(event.message.date).getTime();
      const backfillWindowMs = Math.max(0, env.LISTENER_BACKFILL_SECONDS) * 1000;
      if (eventDateMs < listenerStartedAtMs - backfillWindowMs) {
        return;
      }

      const payload = await buildUnifiedPayload(event);
      if (!payload) {
        const peerId = event.message.peerId;
        if (peerId) {
          try {
            const candidatePeer = toNumberId(getPeerId(peerId, true));
            const shouldIgnoreLog =
              candidatePeer === null ||
              isDriverChatId(candidatePeer) ||
              candidatePeer === env.ADMIN_TELEGRAM_ID ||
              env.PASSENGER_CHAT_IDS.includes(candidatePeer);

            if (!shouldIgnoreLog && !ignoredSourceLogCache.has(candidatePeer)) {
              ignoredSourceLogCache.add(candidatePeer);
              await writeInfo("Message ignored: source chat not in configured list", {
                candidatePeerId: candidatePeer,
                configuredSourceChats: env.PASSENGER_CHAT_IDS
              });
            }
          } catch {
            // ignore
          }
        }
        return;
      }

      const sourceChatIdNumber = toNumericId(payload.sourceChatId);
      if (sourceChatIdNumber === null) {
        return;
      }

      const driverChatId = getDriverChatIdBySourceChatId(sourceChatIdNumber);
      if (driverChatId === null) {
        await writeWarn("Message skipped: source chat has no driver mapping", {
          sourceChatId: payload.sourceChatId,
          sourceMessageId: payload.sourceMessageId
        });
        return;
      }
      const effectiveDriverChatId = resolvePreferredDriverChatIdByRoute(payload, driverChatId);

      markSeenSourceMessageId(sourceChatIdNumber, payload.sourceMessageId);

      const senderFlags = await resolveSenderProtectionFlags(sourceChatIdNumber, effectiveDriverChatId, payload.senderId);
      payload.isSourceAdmin = senderFlags.isSourceAdmin;
      payload.isDriverChatMember = senderFlags.isDriverChatMember;

      const canDeleteFromSource = env.DELETE_SOURCE_MESSAGE_IF_ADMIN ? await resolveDeleteCapability(sourceChatIdNumber) : false;
      const actions = buildActions(
        payload,
        sourceChatIdNumber,
        effectiveDriverChatId,
        canDeleteFromSource,
        async () => (await event.getInputChat()) ?? sourceChatIdNumber,
        async () => await event.message.getSender().catch(() => null)
      );

      const result = await processIncomingLead(payload, actions);

      if (result.processed) {
        await writeInfo("Userbot message processed", {
          sourceChatId: payload.sourceChatId,
          sourceRegion: payload.sourceRegion,
          driverChatId: effectiveDriverChatId,
          sourceMessageId: payload.sourceMessageId,
          status: LeadStatus.SENT
        });
      } else {
        await writeWarn("Userbot message skipped", {
          sourceChatId: payload.sourceChatId,
          sourceRegion: payload.sourceRegion,
          driverChatId: effectiveDriverChatId,
          sourceMessageId: payload.sourceMessageId,
          reason: result.reason
        });
      }
    } catch (error) {
      const isSessionAuthFailure = await handleSessionAuthFailure("event_handler", error);
      if (isSessionAuthFailure) {
        return;
      }

      await writeError("Unhandled userbot listener error", error);
    }
  };

  await runStartupBackfill();

  client.addEventHandler(
    handler,
    new NewMessage({
      incoming: true
    })
  );

  setInterval(() => {
    void runPeriodicCatchUp();
  }, periodicCatchUpIntervalMs).unref();

  if (configuredStartupBackfillLimit > maxStartupBackfillLimit) {
    await writeWarn("LISTENER_STARTUP_BACKFILL_LIMIT capped to protect from duplicate/flood bursts", {
      configured: configuredStartupBackfillLimit,
      applied: startupBackfillLimit
    });
  }

  await writeInfo("Userbot outbound throttle enabled", {
    minDelayMs: outboundMinDelayMs,
    jitterMs: outboundJitterMs
  });

  await writeInfo("Userbot periodic catch-up enabled", {
    intervalMs: periodicCatchUpIntervalMs,
    limit: periodicCatchUpLimit
  });

  await writeInfo("Userbot listener started", {
    sourceChats: env.PASSENGER_CHAT_IDS,
    passengerByRegion: env.PASSENGER_CHAT_IDS_BY_REGION,
    driverByRegion: env.DRIVER_CHAT_ID_BY_REGION,
    adminId: env.ADMIN_TELEGRAM_ID
  });
}
