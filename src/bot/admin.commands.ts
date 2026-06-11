import { KeywordCategory } from "@prisma/client";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { env, type SourceRegion } from "../config/env.js";
import { addKeyword, listActiveKeywords, removeKeyword } from "../services/keyword.service.js";
import { addKeywordEntry, mapInputCategory } from "../services/keywordDictionary.service.js";
import { classifyMessage } from "../services/leadClassifier.service.js";
import { getAdminStatsSnapshot, getStatsSnapshot, getStatusSnapshot } from "../services/lead.service.js";
import {
  addAdminUsername,
  addPassengerSource,
  getRuntimeConfigText,
  parsePassengerSourceInput,
  parseSourceRegionInput,
  parseTelegramChatIdInput,
  parseTelegramUsernameInput,
  removeAdminUsername,
  setDriverChat,
  toggleRuntimeBooleanSetting,
  type PassengerSourceAddResult,
  type RuntimeBooleanSetting
} from "../services/runtimeConfig.service.js";
import { checkConfiguredChats, type ChatAccessCheck } from "../services/telegramHealth.service.js";
import { getCommandArgument, requireAdmin } from "./admin.utils.js";

type PendingAdminAction =
  | { type: "add_passenger"; region: SourceRegion }
  | { type: "set_driver"; region: SourceRegion }
  | { type: "add_admin" }
  | { type: "remove_admin" }
  | { type: "add_keyword"; region: SourceRegion; category: KeywordCategory };

const pendingAdminActions = new Map<number, PendingAdminAction>();
const SOURCE_REGIONS: SourceRegion[] = ["TASHKENT", "GULISTON", "KOMSOMOL"];
const TOGGLE_SETTINGS: RuntimeBooleanSetting[] = [
  "PASSENGER_GROUP_AUTO_REPLIES",
  "SEND_PRIVATE_ACK_TO_PASSENGER",
  "DELETE_SOURCE_MESSAGE_IF_ADMIN",
  "DELETE_IGNORED_MESSAGE_IF_ADMIN"
];
const KEYWORD_CATEGORIES: KeywordCategory[] = [
  KeywordCategory.PASSENGER,
  KeywordCategory.DRIVER,
  KeywordCategory.CARGO,
  KeywordCategory.SPAM,
  KeywordCategory.AMBIGUOUS
];

function groupKeywordsByType(items: Awaited<ReturnType<typeof listActiveKeywords>>): string {
  const latin = items.filter((x) => x.type === "LATIN").map((x) => x.word);
  const cyrillic = items.filter((x) => x.type === "CYRILLIC").map((x) => x.word);
  const route = items.filter((x) => x.type === "ROUTE").map((x) => x.word);
  const extra = items.filter((x) => x.type === "EXTRA").map((x) => x.word);

  const lines = [
    `LATIN (${latin.length}): ${latin.join(", ") || "-"}`,
    `CYRILLIC (${cyrillic.length}): ${cyrillic.join(", ") || "-"}`,
    `ROUTE (${route.length}): ${route.join(", ") || "-"}`,
    `EXTRA (${extra.length}): ${extra.join(", ") || "-"}`
  ];

  const text = lines.join("\n\n");

  if (text.length <= 3900) {
    return text;
  }

  return `${text.slice(0, 3900)}...`;
}

function buildAdminPanelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Passenger guruh", "admin:add_passenger")
    .text("🚖 Driver guruh", "admin:set_driver")
    .row()
    .text("👮 Admin qo'shish", "admin:add_admin")
    .text("🚫 Admin o'chirish", "admin:remove_admin")
    .row()
    .text(`💬 Passenger javob: ${env.PASSENGER_GROUP_AUTO_REPLIES ? "ON" : "OFF"}`, "admin:toggle:PASSENGER_GROUP_AUTO_REPLIES")
    .row()
    .text(`📩 Client DM: ${env.SEND_PRIVATE_ACK_TO_PASSENGER ? "ON" : "OFF"}`, "admin:toggle:SEND_PRIVATE_ACK_TO_PASSENGER")
    .row()
    .text("📚 Lug'at qo'shish", "admin:add_keyword")
    .text("📊 Statistika", "admin:stats")
    .row()
    .text(`🗑 Source delete: ${env.DELETE_SOURCE_MESSAGE_IF_ADMIN ? "ON" : "OFF"}`, "admin:toggle:DELETE_SOURCE_MESSAGE_IF_ADMIN")
    .row()
    .text(`🧹 Ignored delete: ${env.DELETE_IGNORED_MESSAGE_IF_ADMIN ? "ON" : "OFF"}`, "admin:toggle:DELETE_IGNORED_MESSAGE_IF_ADMIN")
    .row()
    .text("📋 Ro'yxat", "admin:panel")
    .text("❌ Bekor qilish", "admin:cancel");
}

function buildRegionKeyboard(prefix: "admin:add_passenger_region" | "admin:set_driver_region" | "admin:add_keyword_region"): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const region of SOURCE_REGIONS) {
    keyboard.text(region, `${prefix}:${region}`).row();
  }

  keyboard.text("⬅️ Orqaga", "admin:panel");
  return keyboard;
}

function buildKeywordCategoryKeyboard(region: SourceRegion): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const category of KEYWORD_CATEGORIES) {
    keyboard.text(category, `admin:add_keyword_category:${region}:${category}`).row();
  }

  keyboard.text("⬅️ Orqaga", "admin:panel");
  return keyboard;
}

async function sendAdminPanel(ctx: Context, edit = false): Promise<void> {
  const text = getRuntimeConfigText();
  const replyMarkup = buildAdminPanelKeyboard();

  if (edit) {
    try {
      await ctx.editMessageText(text, { reply_markup: replyMarkup });
      return;
    } catch {
      // The old message may be too old or unchanged; send a fresh panel below.
    }
  }

  await ctx.reply(text, { reply_markup: replyMarkup });
}

function getTextMessage(ctx: Context): string {
  const message = ctx.msg;
  return message && "text" in message && typeof message.text === "string" ? message.text.trim() : "";
}

function parseRegionAndPassengerSource(arg: string): { region: SourceRegion; source: PassengerSourceAddResult } | null {
  const [rawRegion, ...sourceParts] = arg.split(/\s+/u);
  const rawSource = sourceParts.join(" ").trim();
  if (!rawRegion || !rawSource) {
    return null;
  }

  const region = parseSourceRegionInput(rawRegion);
  const source = parsePassengerSourceInput(rawSource);
  if (!region || !source || (source.kind === "chat_id" && source.value > 0)) {
    return null;
  }

  return { region, source };
}

function parseRegionAndChatId(arg: string): { region: SourceRegion; chatId: number } | null {
  const [rawRegion, rawChatId] = arg.split(/\s+/u);
  if (!rawRegion || !rawChatId) {
    return null;
  }

  const region = parseSourceRegionInput(rawRegion);
  const chatId = parseTelegramChatIdInput(rawChatId);
  if (!region || chatId === null || chatId > 0) {
    return null;
  }

  return { region, chatId };
}

function parseKeywordInput(text: string): { phrase: string; weight: number } | null {
  const [rawPhrase = "", rawWeight = ""] = text.split("|").map((item) => item.trim());
  const phrase = rawPhrase.trim();
  if (!phrase) {
    return null;
  }

  const parsedWeight = Number(rawWeight);
  return {
    phrase,
    weight: Number.isFinite(parsedWeight) && parsedWeight > 0 ? parsedWeight : 8
  };
}

function formatPassengerSourceResult(result: PassengerSourceAddResult): string {
  return result.kind === "chat_id" ? String(result.value) : `@${result.value}`;
}

function getPendingActionPrompt(action: PendingAdminAction): string {
  if (action.type === "add_admin") {
    return "Yangi admin username yuboring. Masalan: @username\nBekor qilish: /cancel";
  }

  if (action.type === "remove_admin") {
    return "O'chiriladigan admin username yuboring. Masalan: @username\nBekor qilish: /cancel";
  }

  if (action.type === "add_keyword") {
    return [
      `${action.region} / ${action.category} uchun lug'at so'z yoki phrase yuboring.`,
      "",
      "Masalan: taxi kerak",
      "Weight bilan: taxi kerak | 10",
      "Bekor qilish: /cancel"
    ].join("\n");
  }

  if (action.type === "add_passenger") {
    return [
      `${action.region} uchun passenger/source guruh ID yoki public link yuboring.`,
      "",
      "Masalan: -1001234567890",
      "Yoki: https://t.me/guruh_username",
      "Agar shu guruh ichida turgan bo'lsangiz: shu",
      "Bekor qilish: /cancel"
    ].join("\n");
  }

  return [
    `${action.region} uchun driver guruh/kanal ID yuboring.`,
    "",
    "Masalan: -1001234567890",
    "Agar shu guruh ichida turgan bo'lsangiz: shu",
    "Bekor qilish: /cancel"
  ].join("\n");
}

async function handlePendingAdminInput(ctx: Context): Promise<boolean> {
  const adminId = ctx.from?.id;
  if (adminId === undefined) {
    return false;
  }

  const pending = pendingAdminActions.get(adminId);
  if (!pending) {
    return false;
  }

  if (!(await requireAdmin(ctx))) {
    return true;
  }

  const text = getTextMessage(ctx);
  if (text.toLowerCase() === "/cancel") {
    pendingAdminActions.delete(adminId);
    await ctx.reply("Bekor qilindi.", { reply_markup: buildAdminPanelKeyboard() });
    return true;
  }

  if (text.startsWith("/")) {
    return false;
  }

  if (pending.type === "add_admin") {
    const username = parseTelegramUsernameInput(text);
    if (!username) {
      await ctx.reply("Username noto'g'ri. Masalan: @username");
      return true;
    }

    const added = await addAdminUsername(username);
    pendingAdminActions.delete(adminId);
    await ctx.reply(`✅ Admin qo'shildi: @${added}`, { reply_markup: buildAdminPanelKeyboard() });
    return true;
  }

  if (pending.type === "remove_admin") {
    const removed = await removeAdminUsername(text);
    pendingAdminActions.delete(adminId);
    await ctx.reply(removed ? `✅ Admin o'chirildi: @${removed}` : "Bunday admin username topilmadi.", {
      reply_markup: buildAdminPanelKeyboard()
    });
    return true;
  }

  if (pending.type === "add_keyword") {
    const parsedKeyword = parseKeywordInput(text);
    if (!parsedKeyword) {
      await ctx.reply("Lug'at so'zi bo'sh bo'lmasin. Masalan: taxi kerak | 10");
      return true;
    }

    const added = await addKeywordEntry({
      category: pending.category,
      phrase: parsedKeyword.phrase,
      weight: parsedKeyword.weight,
      source: pending.region
    });
    pendingAdminActions.delete(adminId);
    await ctx.reply(
      added
        ? `✅ Lug'at qo'shildi: ${pending.region} / ${pending.category} / ${added.phrase} (weight ${added.weight})`
        : "Lug'at qo'shilmadi.",
      { reply_markup: buildAdminPanelKeyboard() }
    );
    return true;
  }

  if (pending.type === "add_passenger") {
    const source = parsePassengerSourceInput(text, ctx.chat?.id);
    if (!source || (source.kind === "chat_id" && source.value > 0)) {
      await ctx.reply("Guruh ID/link noto'g'ri. Masalan: -1001234567890 yoki https://t.me/guruh_username");
      return true;
    }

    const added = await addPassengerSource(pending.region, source);
    pendingAdminActions.delete(adminId);
    await ctx.reply(`✅ Passenger guruh qo'shildi: ${pending.region} -> ${formatPassengerSourceResult(added)}`, {
      reply_markup: buildAdminPanelKeyboard()
    });
    return true;
  }

  const chatId = parseTelegramChatIdInput(text, ctx.chat?.id);
  if (chatId === null || chatId > 0) {
    await ctx.reply("Chat ID noto'g'ri. Guruh/kanal ID odatda -100... ko'rinishida bo'ladi.");
    return true;
  }

  await setDriverChat(pending.region, chatId);
  pendingAdminActions.delete(adminId);
  await ctx.reply(`✅ Driver guruh sozlandi: ${pending.region} -> ${chatId}`, {
    reply_markup: buildAdminPanelKeyboard()
  });
  return true;
}

export function registerAdminCommands(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    await ctx.reply("Salom admin.");
    await sendAdminPanel(ctx);
  });

  bot.command("panel", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    await sendAdminPanel(ctx);
  });

  bot.command("cancel", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    if (ctx.from?.id !== undefined) {
      pendingAdminActions.delete(ctx.from.id);
    }

    await ctx.reply("Bekor qilindi.", { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.on("message:text", async (ctx, next) => {
    const handled = await handlePendingAdminInput(ctx);
    if (handled) {
      return;
    }

    await next();
  });

  bot.callbackQuery(/^admin:/u, async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const data = ctx.callbackQuery.data;
    const adminId = ctx.from?.id;
    await ctx.answerCallbackQuery().catch(() => undefined);

    if (data === "admin:panel") {
      await sendAdminPanel(ctx, true);
      return;
    }

    if (data === "admin:cancel") {
      if (adminId !== undefined) {
        pendingAdminActions.delete(adminId);
      }
      await sendAdminPanel(ctx, true);
      return;
    }

    if (data === "admin:add_passenger") {
      await ctx.editMessageText("Qaysi route uchun passenger guruh qo'shamiz?", {
        reply_markup: buildRegionKeyboard("admin:add_passenger_region")
      });
      return;
    }

    if (data === "admin:set_driver") {
      await ctx.editMessageText("Qaysi route uchun driver guruh/kanal sozlaymiz?", {
        reply_markup: buildRegionKeyboard("admin:set_driver_region")
      });
      return;
    }

    if (data === "admin:add_admin" && adminId !== undefined) {
      const pending: PendingAdminAction = { type: "add_admin" };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    if (data === "admin:remove_admin" && adminId !== undefined) {
      const pending: PendingAdminAction = { type: "remove_admin" };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    if (data === "admin:stats") {
      const stats = await getAdminStatsSnapshot();
      await ctx.reply(
        [
          "📊 Client statistikasi:",
          "",
          `Bugun client: ${stats.today.delivered}`,
          `Bugun unique client: ${stats.today.uniqueClients}`,
          `Bugun jami lead: ${stats.today.leads}`,
          `Bugun ignored: ${stats.today.ignored}`,
          `Bugun duplicate: ${stats.today.duplicates}`,
          `Bugun error: ${stats.today.errors}`,
          "",
          `Bu oy client: ${stats.month.delivered}`,
          `Bu oy unique client: ${stats.month.uniqueClients}`,
          `Bu oy jami lead: ${stats.month.leads}`,
          `Bu oy ignored: ${stats.month.ignored}`,
          `Bu oy duplicate: ${stats.month.duplicates}`,
          `Bu oy error: ${stats.month.errors}`
        ].join("\n")
      );
      return;
    }

    if (data === "admin:add_keyword") {
      await ctx.editMessageText("Qaysi route uchun lug'at qo'shamiz?", {
        reply_markup: buildRegionKeyboard("admin:add_keyword_region")
      });
      return;
    }

    const toggleMatch = data.match(/^admin:toggle:([A-Z0-9_]+)$/u);
    const toggleKey = toggleMatch?.[1] as RuntimeBooleanSetting | undefined;
    if (toggleKey && TOGGLE_SETTINGS.includes(toggleKey)) {
      const nextValue = await toggleRuntimeBooleanSetting(toggleKey);
      await ctx.answerCallbackQuery(`${toggleKey}: ${nextValue ? "ON" : "OFF"}`).catch(() => undefined);
      await sendAdminPanel(ctx, true);
      return;
    }

    const passengerRegionMatch = data.match(/^admin:add_passenger_region:(TASHKENT|GULISTON|KOMSOMOL)$/u);
    if (passengerRegionMatch && adminId !== undefined) {
      const region = passengerRegionMatch[1] as SourceRegion;
      const pending: PendingAdminAction = { type: "add_passenger", region };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    const driverRegionMatch = data.match(/^admin:set_driver_region:(TASHKENT|GULISTON|KOMSOMOL)$/u);
    if (driverRegionMatch && adminId !== undefined) {
      const region = driverRegionMatch[1] as SourceRegion;
      const pending: PendingAdminAction = { type: "set_driver", region };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    const keywordRegionMatch = data.match(/^admin:add_keyword_region:(TASHKENT|GULISTON|KOMSOMOL)$/u);
    if (keywordRegionMatch) {
      const region = keywordRegionMatch[1] as SourceRegion;
      await ctx.editMessageText(`${region} uchun category tanlang:`, {
        reply_markup: buildKeywordCategoryKeyboard(region)
      });
      return;
    }

    const keywordCategoryMatch = data.match(/^admin:add_keyword_category:(TASHKENT|GULISTON|KOMSOMOL):(PASSENGER|DRIVER|CARGO|SPAM|AMBIGUOUS)$/u);
    if (keywordCategoryMatch && adminId !== undefined) {
      const region = keywordCategoryMatch[1] as SourceRegion;
      const category = keywordCategoryMatch[2] as KeywordCategory;
      const pending: PendingAdminAction = { type: "add_keyword", region, category };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
    }
  });

  bot.command("status", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const status = await getStatusSnapshot();

    await ctx.reply(
      [
        "Bot status:",
        `Jami yozuv: ${status.total}`,
        `Sent: ${status.sent}`,
        `Source'dan o'chirilgan: ${status.deletedFromSource}`,
        `O'chirilmadi (permission): ${status.notDeletedNoPermission}`,
        `Ignored: ${status.ignored}`,
        `Duplicate: ${status.duplicate}`,
        `Error: ${status.error}`
      ].join("\n")
    );
  });

  bot.command("stats", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const stats = await getStatsSnapshot();
    const adminStats = await getAdminStatsSnapshot();

    await ctx.reply(
      [
        "Statistika:",
        "",
        `Bugun lead: ${stats.today.leads}`,
        `Bugun sent: ${stats.today.sent}`,
        `Bugun source delete: ${stats.today.deleted}`,
        `Bugun duplicate: ${stats.today.duplicates}`,
        `Bugun error: ${stats.today.errors}`,
        "",
        `Hafta lead: ${stats.week.leads}`,
        `Hafta sent: ${stats.week.sent}`,
        `Hafta source delete: ${stats.week.deleted}`,
        `Hafta duplicate: ${stats.week.duplicates}`,
        `Hafta error: ${stats.week.errors}`,
        "",
        `Bugun client: ${adminStats.today.delivered}`,
        `Bugun unique client: ${adminStats.today.uniqueClients}`,
        `Bu oy client: ${adminStats.month.delivered}`,
        `Bu oy unique client: ${adminStats.month.uniqueClients}`
      ].join("\n")
    );
  });

  bot.command("keywords", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const keywords = await listActiveKeywords();
    await ctx.reply(groupKeywordsByType(keywords));
  });

  bot.command("addkeyword", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const arg = getCommandArgument(ctx);

    if (!arg) {
      await ctx.reply("Foydalanish: /addkeyword taxi_soz");
      return;
    }

    const added = await addKeyword(arg);
    await ctx.reply(`Qo'shildi: ${added.word} (${added.type})`);
  });

  bot.command("removekeyword", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const arg = getCommandArgument(ctx);

    if (!arg) {
      await ctx.reply("Foydalanish: /removekeyword taxi_soz");
      return;
    }

    const removed = await removeKeyword(arg);

    if (!removed) {
      await ctx.reply("Bunday keyword topilmadi.");
      return;
    }

    await ctx.reply(`O'chirildi (inactive): ${removed.word}`);
  });

  bot.command("addadmin", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const username = parseTelegramUsernameInput(getCommandArgument(ctx));
    if (!username) {
      await ctx.reply("Foydalanish: /addadmin @username");
      return;
    }

    const added = await addAdminUsername(username);
    await ctx.reply(`✅ Admin qo'shildi: @${added}`, { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.command("removeadmin", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const removed = await removeAdminUsername(getCommandArgument(ctx));
    await ctx.reply(removed ? `✅ Admin o'chirildi: @${removed}` : "Bunday admin username topilmadi.", {
      reply_markup: buildAdminPanelKeyboard()
    });
  });

  bot.command("addpassenger", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const parsedArg = parseRegionAndPassengerSource(getCommandArgument(ctx));
    if (!parsedArg) {
      await ctx.reply("Foydalanish: /addpassenger TASHKENT -1001234567890 yoki /addpassenger TASHKENT https://t.me/guruh");
      return;
    }

    const added = await addPassengerSource(parsedArg.region, parsedArg.source);
    await ctx.reply(`✅ Passenger guruh qo'shildi: ${parsedArg.region} -> ${formatPassengerSourceResult(added)}`, {
      reply_markup: buildAdminPanelKeyboard()
    });
  });

  bot.command("adddict", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const arg = getCommandArgument(ctx);
    const [rawRegion = "", rawCategory = "", ...phraseParts] = arg.split(/\s+/u);
    const region = parseSourceRegionInput(rawRegion);
    const category = mapInputCategory(rawCategory);
    const phrase = phraseParts.join(" ").trim();

    if (!region || !category || !phrase) {
      await ctx.reply("Foydalanish: /adddict KOMSOMOL spam reklama matni");
      return;
    }

    const added = await addKeywordEntry({
      category,
      phrase,
      weight: 8,
      source: region
    });

    await ctx.reply(added ? `✅ Lug'at qo'shildi: ${region} / ${category} / ${added.phrase}` : "Lug'at qo'shilmadi.", {
      reply_markup: buildAdminPanelKeyboard()
    });
  });

  bot.command("setdriver", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const parsedArg = parseRegionAndChatId(getCommandArgument(ctx));
    if (!parsedArg) {
      await ctx.reply("Foydalanish: /setdriver GULISTON -1001234567890");
      return;
    }

    await setDriverChat(parsedArg.region, parsedArg.chatId);
    await ctx.reply(`✅ Driver guruh sozlandi: ${parsedArg.region} -> ${parsedArg.chatId}`, {
      reply_markup: buildAdminPanelKeyboard()
    });
  });

  bot.command("test", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const arg = getCommandArgument(ctx);

    if (!arg) {
      await ctx.reply("Foydalanish: /test matn");
      return;
    }

    const result = await classifyMessage(arg);

    await ctx.reply(
      [
        `Passenger request: ${result.is_passenger_request ? "ha" : "yo'q"}`,
        `Confidence: ${result.confidence}`,
        `Provider: ${result.provider}`,
        `Reason: ${result.reason}`,
        `Keyword score: ${result.keywordScore ?? "-"}`
      ].join("\n")
    );
  });

  bot.command("getid", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    await ctx.reply(
      [
        `Chat ID: ${ctx.chat?.id ?? "n/a"}`,
        `User ID: ${ctx.from?.id ?? "n/a"}`,
        `ADMIN_TELEGRAM_IDS: ${env.ADMIN_TELEGRAM_IDS.join(", ") || "-"}`,
        `ADMIN_TELEGRAM_USERNAMES: ${env.ADMIN_TELEGRAM_USERNAMES.map((item) => `@${item}`).join(", ") || "-"}`,
        `PASSENGER_CHAT_IDS: ${env.PASSENGER_CHAT_IDS.join(", ")}`,
        `PASSENGER_CHAT_IDS_TASHKENT: ${env.PASSENGER_CHAT_IDS_TASHKENT.join(", ") || "-"}`,
        `PASSENGER_CHAT_IDS_GULISTON: ${env.PASSENGER_CHAT_IDS_GULISTON.join(", ") || "-"}`,
        `PASSENGER_CHAT_IDS_KOMSOMOL: ${env.PASSENGER_CHAT_IDS_KOMSOMOL.join(", ") || "-"}`,
        `PASSENGER_CHAT_USERNAMES_TASHKENT: ${env.PASSENGER_CHAT_USERNAMES_TASHKENT.map((item) => `@${item}`).join(", ") || "-"}`,
        `PASSENGER_CHAT_USERNAMES_GULISTON: ${env.PASSENGER_CHAT_USERNAMES_GULISTON.map((item) => `@${item}`).join(", ") || "-"}`,
        `PASSENGER_CHAT_USERNAMES_KOMSOMOL: ${env.PASSENGER_CHAT_USERNAMES_KOMSOMOL.map((item) => `@${item}`).join(", ") || "-"}`,
        `DRIVER_CHAT_ID_TASHKENT: ${env.DRIVER_CHAT_ID_TASHKENT ?? "-"}`,
        `DRIVER_CHAT_ID_GULISTON: ${env.DRIVER_CHAT_ID_GULISTON ?? "-"}`,
        `DRIVER_CHAT_ID_KOMSOMOL: ${env.DRIVER_CHAT_ID_KOMSOMOL ?? "-"}`,
        `DRIVER_DELIVERY_MODE: ${env.DRIVER_DELIVERY_MODE} (requested: ${env.DRIVER_DELIVERY_REQUESTED_MODE})`
      ].join("\n")
    );
  });

  bot.command("checkconfig", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const check = await checkConfiguredChats(ctx.api);

    const line = (prefix: string, info: ChatAccessCheck) =>
      info.ok
        ? `${prefix}: OK | chatId=${info.chatId} | type=${info.type} | title=${info.title ?? "-"} | member=${info.membershipStatus ?? "-"}`
        : `${prefix}: XATO | chatId=${info.chatId} | error=${info.error ?? "unknown"}`;

    await ctx.reply([line("PASSENGER", check.passenger), line("DRIVER", check.driver)].join("\n\n"));
  });
}

