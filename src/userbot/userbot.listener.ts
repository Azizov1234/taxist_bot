import { NewMessage, type NewMessageEvent } from "telegram/events/NewMessage.js";
import { getPeerId } from "telegram/Utils.js";
import type { TelegramClient } from "telegram";
import { LeadStatus } from "@prisma/client";
import { env } from "../config/env.js";
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

  for (const chatId of env.PASSENGER_CHAT_IDS) {
    try {
      const entity = await client.getEntity(chatId);
      const title = formatEntityName(entity) || String(chatId);
      const lastMessages = await client.getMessages(chatId, { limit: 1 });
      const lastMessage = Array.isArray(lastMessages) ? (lastMessages[0] ?? null) : null;
      const lastMessageId = lastMessage?.id ?? "-";
      const lastMessageDate = lastMessage?.date ? getMessageDate(lastMessage.date).toISOString() : "-";
      lines.push(`OK | ${chatId} | ${title} | lastMessageId=${lastMessageId} | lastMessageDate=${lastMessageDate}`);
    } catch (error) {
      lines.push(`FAIL | ${chatId} | ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  return lines.join("\n");
}

async function resolveSourceChat(event: NewMessageEvent): Promise<{ sourceChatId: string; sourceChatIdNumber: number; chat: any | null }> {
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

  return {
    sourceChatId: String(matchedId),
    sourceChatIdNumber: matchedId,
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
      [`Source chatlar: ${env.PASSENGER_CHAT_IDS.join(", ")}`, `Driver chat: ${env.DRIVER_CHAT_ID}`, `Pauza: ${state.paused ? "ha" : "yo'q"}`].join("\n")
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
    sourceChatTitle,
    sourceChatUsername,
    sourceMessageId: event.message.id,
    senderId,
    senderFullName,
    senderUsername,
    text: messageText,
    messageDate: getMessageDate(event.message.date),
    isForwarded: Boolean((event.message as any).fwdFrom)
  };
}

export async function startUserbotListener(client: TelegramClient): Promise<void> {
  const state: ListenerState = { paused: false };
  const listenerStartedAtMs = Date.now();
  const ignoredSourceLogCache = new Set<number>();

  const handler = async (event: NewMessageEvent): Promise<void> => {
    try {
      const commandText = toText(event.message.message).trim();
      const commandHandled = await handleAdminCommand(client, event, commandText, state);
      if (commandHandled) {
        return;
      }

      if (state.paused) {
        return;
      }

      const eventDateMs = getMessageDate(event.message.date).getTime();
      if (eventDateMs < listenerStartedAtMs - 5_000) {
        return;
      }

      const payload = await buildUnifiedPayload(event);
      if (!payload) {
        const peerId = event.message.peerId;
        if (peerId) {
          try {
            const candidatePeer = toNumberId(getPeerId(peerId, true));
            if (candidatePeer !== null && !ignoredSourceLogCache.has(candidatePeer)) {
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

      const actions: UnifiedMessageActions = {
        sendToDriver: async (formattedText, _originalText) => {
          const sent = await client.sendMessage(env.DRIVER_CHAT_ID, {
            message: formattedText
          });
          let forwardedOriginal = false;

          try {
            const fromPeer = (await event.getInputChat()) ?? sourceChatIdNumber;
            await client.forwardMessages(env.DRIVER_CHAT_ID, {
              messages: [payload.sourceMessageId],
              fromPeer
            });
            forwardedOriginal = true;
          } catch (forwardError) {
            await writeWarn("Failed to forward original source message to driver chat", {
              sourceChatId: payload.sourceChatId,
              sourceMessageId: payload.sourceMessageId,
              error: forwardError instanceof Error ? forwardError.message : String(forwardError)
            });

            const sourceMessageLink = buildSourceMessageLink(payload.sourceChatId, payload.sourceMessageId, payload.sourceChatUsername);
            await client.sendMessage(env.DRIVER_CHAT_ID, {
              message: [
                "Forward qilib bo'lmadi. Nusxa xabar:",
                `Source: ${payload.sourceChatTitle}`,
                `Source message: ${payload.sourceChatId}/${payload.sourceMessageId}`,
                sourceMessageLink ? `Source link: ${sourceMessageLink}` : null,
                "",
                payload.text
              ]
                .filter(Boolean)
                .join("\n")
            });
          }

          return {
            driverMessageId: sent.id,
            forwardedOriginal
          };
        }
      };

      if (env.DELETE_SOURCE_MESSAGE_IF_ADMIN) {
        actions.deleteFromSource = async () => {
          await client.deleteMessages(sourceChatIdNumber, [payload.sourceMessageId], {
            revoke: true
          });
        };
      }

      const result = await processIncomingLead(payload, actions);

      if (result.processed) {
        await writeInfo("Userbot message processed", {
          sourceChatId: payload.sourceChatId,
          sourceMessageId: payload.sourceMessageId,
          status: LeadStatus.SENT
        });
      } else {
        await writeWarn("Userbot message skipped", {
          sourceChatId: payload.sourceChatId,
          sourceMessageId: payload.sourceMessageId,
          reason: result.reason
        });
      }
    } catch (error) {
      await writeError("Unhandled userbot listener error", error);
    }
  };

  client.addEventHandler(
    handler,
    new NewMessage({
      incoming: true
    })
  );

  await writeInfo("Userbot listener started", {
    sourceChats: env.PASSENGER_CHAT_IDS,
    driverChat: env.DRIVER_CHAT_ID,
    adminId: env.ADMIN_TELEGRAM_ID
  });
}
