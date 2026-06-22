import { KeywordCategory } from "@prisma/client";
import { Bot, InlineKeyboard, type Context } from "grammy";
import { env, type SourceRegion } from "../config/env.js";
import {
  formatAdminIdentity,
  getAdminListSummary,
  parseAdminIdentityInput,
  removeAdminByInput,
  saveAdminIdentity,
  type AdminIdentityInput
} from "../services/admin.service.js";
import { addKeyword, listActiveKeywords, removeKeyword } from "../services/keyword.service.js";
import { addKeywordEntry, mapInputCategory } from "../services/keywordDictionary.service.js";
import { classifyMessage } from "../services/leadClassifier.service.js";
import { getAdminStatsSnapshot, getStatsSnapshot, getStatusSnapshot } from "../services/lead.service.js";
import {
  addPassengerSource,
  getRuntimeConfigText,
  parsePassengerSourceInput,
  parseSourceRegionInput,
  parseTelegramChatIdInput,
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
const SOURCE_REGIONS: SourceRegion[] = ["TASHKENT", "GULISTON", "KOMSOMOL", "ANDIJON"];
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

const REGION_LABELS: Record<SourceRegion, string> = {
  TASHKENT: "Toshkent",
  GULISTON: "Guliston",
  KOMSOMOL: "Komsomol",
  ANDIJON: "Andijon"
};

const CATEGORY_LABELS: Record<KeywordCategory, string> = {
  [KeywordCategory.PASSENGER]: "Yo'lovchi kerak",
  [KeywordCategory.DRIVER]: "Haydovchi reklama",
  [KeywordCategory.CARGO]: "Pochta/yuk",
  [KeywordCategory.SPAM]: "Reklama/spam",
  [KeywordCategory.AMBIGUOUS]: "Noaniq"
};

const TOGGLE_LABELS: Record<RuntimeBooleanSetting, string> = {
  PASSENGER_GROUP_AUTO_REPLIES: "Guruhga javob yozish",
  SEND_PRIVATE_ACK_TO_PASSENGER: "Mijozga lichka yozish",
  DELETE_SOURCE_MESSAGE_IF_ADMIN: "Topilgan xabarni o'chirish",
  DELETE_IGNORED_MESSAGE_IF_ADMIN: "Keraksiz xabarni o'chirish"
};

function onOff(value: boolean): string {
  return value ? "YONIQ" : "O'CHIQ";
}

function groupKeywordsByType(items: Awaited<ReturnType<typeof listActiveKeywords>>): string {
  const latin = items.filter((x) => x.type === "LATIN").map((x) => x.word);
  const cyrillic = items.filter((x) => x.type === "CYRILLIC").map((x) => x.word);
  const route = items.filter((x) => x.type === "ROUTE").map((x) => x.word);
  const extra = items.filter((x) => x.type === "EXTRA").map((x) => x.word);

  const lines = [
    `Lotin (${latin.length}): ${latin.join(", ") || "-"}`,
    `Kirill (${cyrillic.length}): ${cyrillic.join(", ") || "-"}`,
    `Yo'nalish (${route.length}): ${route.join(", ") || "-"}`,
    `Qo'shimcha (${extra.length}): ${extra.join(", ") || "-"}`
  ];

  const text = lines.join("\n\n");

  if (text.length <= 3900) {
    return text;
  }

  return `${text.slice(0, 3900)}...`;
}

function buildAdminPanelKeyboard(): InlineKeyboard {
  return new InlineKeyboard()
    .text("➕ Yo'lovchi guruhi", "admin:add_passenger")
    .text("🚖 Haydovchilar guruhi", "admin:set_driver")
    .row()
    .text("👮 Admin qo'shish", "admin:add_admin")
    .text("🚫 Admin o'chirish", "admin:remove_admin")
    .row()
    .text(`💬 ${TOGGLE_LABELS.PASSENGER_GROUP_AUTO_REPLIES}: ${onOff(env.PASSENGER_GROUP_AUTO_REPLIES)}`, "admin:toggle:PASSENGER_GROUP_AUTO_REPLIES")
    .row()
    .text(`📩 ${TOGGLE_LABELS.SEND_PRIVATE_ACK_TO_PASSENGER}: ${onOff(env.SEND_PRIVATE_ACK_TO_PASSENGER)}`, "admin:toggle:SEND_PRIVATE_ACK_TO_PASSENGER")
    .row()
    .text("📚 Gap/so'z qo'shish", "admin:add_keyword")
    .text("📊 Statistika", "admin:stats")
    .row()
    .text(`🗑 ${TOGGLE_LABELS.DELETE_SOURCE_MESSAGE_IF_ADMIN}: ${onOff(env.DELETE_SOURCE_MESSAGE_IF_ADMIN)}`, "admin:toggle:DELETE_SOURCE_MESSAGE_IF_ADMIN")
    .row()
    .text(`🧹 ${TOGGLE_LABELS.DELETE_IGNORED_MESSAGE_IF_ADMIN}: ${onOff(env.DELETE_IGNORED_MESSAGE_IF_ADMIN)}`, "admin:toggle:DELETE_IGNORED_MESSAGE_IF_ADMIN")
    .row()
    .text("📋 Ro'yxat", "admin:panel")
    .text("❌ Bekor qilish", "admin:cancel");
}

function buildRegionKeyboard(prefix: "admin:add_passenger_region" | "admin:set_driver_region" | "admin:add_keyword_region"): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const region of SOURCE_REGIONS) {
    keyboard.text(REGION_LABELS[region], `${prefix}:${region}`).row();
  }

  keyboard.text("⬅️ Orqaga", "admin:panel");
  return keyboard;
}

function buildKeywordCategoryKeyboard(region: SourceRegion): InlineKeyboard {
  const keyboard = new InlineKeyboard();
  for (const category of KEYWORD_CATEGORIES) {
    keyboard.text(CATEGORY_LABELS[category], `admin:add_keyword_category:${region}:${category}`).row();
  }

  keyboard.text("⬅️ Orqaga", "admin:panel");
  return keyboard;
}

async function sendAdminPanel(ctx: Context, edit = false): Promise<void> {
  const text = getRuntimeConfigText(await getAdminListSummary());
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

function formatPassengerSourceLink(source: PassengerSourceAddResult): string | null {
  if (source.kind === "username") {
    return `https://t.me/${source.value}`;
  }

  const chatId = String(source.value);
  if (!chatId.startsWith("-100")) {
    return null;
  }

  return `https://t.me/c/${chatId.slice(4)}`;
}

function isPrivateInviteLink(rawValue: string): boolean {
  return /^https?:\/\/(?:t\.me|telegram\.me)\/(?:\+|joinchat\/)/iu.test(rawValue.trim());
}

function getChatTitle(chat: unknown): string | null {
  if (!chat || typeof chat !== "object") {
    return null;
  }

  const title = (chat as { title?: unknown }).title;
  return typeof title === "string" && title.trim() ? title.trim() : null;
}

async function getBotStartGroupLink(ctx: Context): Promise<string | null> {
  try {
    const me = await ctx.api.getMe();
    return me.username ? `https://t.me/${me.username}?startgroup=true` : null;
  } catch {
    return null;
  }
}

function toPositiveTelegramId(rawValue: unknown): bigint | null {
  if (typeof rawValue === "bigint") {
    return rawValue > 0n ? rawValue : null;
  }

  if (typeof rawValue === "number") {
    return Number.isSafeInteger(rawValue) && rawValue > 0 ? BigInt(rawValue) : null;
  }

  if (typeof rawValue === "string" && /^[1-9]\d{3,19}$/u.test(rawValue.trim())) {
    try {
      const parsed = BigInt(rawValue.trim());
      return parsed > 0n ? parsed : null;
    } catch {
      return null;
    }
  }

  return null;
}

function toSafeTelegramIdNumber(value: bigint): number | null {
  return value <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(value) : null;
}

function getResolvedChatUsername(chat: unknown): string | null {
  if (!chat || typeof chat !== "object") {
    return null;
  }

  const username = (chat as { username?: unknown }).username;
  return typeof username === "string" ? (parseAdminIdentityInput(username)?.username ?? null) : null;
}

async function resolveAdminIdentityWithBotApi(ctx: Context, rawValue: string): Promise<AdminIdentityInput | null> {
  const identity = parseAdminIdentityInput(rawValue);
  if (!identity) {
    return null;
  }

  const lookup =
    identity.username !== undefined
      ? `@${identity.username}`
      : identity.telegramId !== undefined
        ? toSafeTelegramIdNumber(identity.telegramId)
        : null;
  if (lookup === null) {
    return identity;
  }

  try {
    const chat = await ctx.api.getChat(lookup);
    const resolved: AdminIdentityInput = { ...identity };
    const telegramId = toPositiveTelegramId((chat as { id?: unknown }).id);
    if (telegramId !== null) {
      resolved.telegramId = telegramId;
    }

    const username = getResolvedChatUsername(chat);
    if (username) {
      resolved.username = username;
    }

    return resolved;
  } catch {
    return identity;
  }
}

async function addAdminFromContext(ctx: Context, rawValue: string) {
  const identity = await resolveAdminIdentityWithBotApi(ctx, rawValue);
  if (!identity) {
    return null;
  }

  return saveAdminIdentity(identity, undefined, ctx.from?.id);
}

function formatAdminAddedReply(result: Awaited<ReturnType<typeof addAdminFromContext>>): string {
  if (!result) {
    return "Admin ID yoki username noto'g'ri. Masalan: @username yoki 123456789";
  }

  const action = result.created ? "qo'shildi" : "yangilandi";
  return `✅ Admin ${action}: ${formatAdminIdentity(result.admin)}`;
}

function formatAdminRemovedReply(result: Awaited<ReturnType<typeof removeAdminByInput>>): string {
  if (result.status === "removed") {
    return `✅ Admin o'chirildi: ${formatAdminIdentity(result.admin)}`;
  }

  if (result.status === "superadmin") {
    return `❌ Superadmin o'chirilmaydi: ${formatAdminIdentity(result.admin)}`;
  }

  return "Bunday admin topilmadi.";
}

async function savePassengerSourceWithCheck(
  ctx: Context,
  region: SourceRegion,
  source: PassengerSourceAddResult
): Promise<{ added: PassengerSourceAddResult[]; botCanRead: boolean; title: string | null; warning: string | null; sourceLink: string | null; botLink: string | null }> {
  const added: PassengerSourceAddResult[] = [];
  const sourceLink = formatPassengerSourceLink(source);
  const botLink = await getBotStartGroupLink(ctx);
  let resolvedChatId: number | null = null;
  let botCanRead = false;
  let title: string | null = null;
  let warning: string | null = null;

  try {
    const lookup = source.kind === "chat_id" ? source.value : `@${source.value}`;
    const chat = await ctx.api.getChat(lookup);
    title = getChatTitle(chat);
    const chatId = Number(chat.id);

    if (Number.isInteger(chatId) && chatId < 0) {
      resolvedChatId = chatId;
      const me = await ctx.api.getMe();
      const member = await ctx.api.getChatMember(chatId, me.id);
      botCanRead = member.status !== "left" && member.status !== "kicked";
    }
  } catch (error) {
    warning = error instanceof Error ? error.message : String(error);
  }

  if (source.kind === "username") {
    added.push(await addPassengerSource(region, source));
  }

  if (resolvedChatId !== null) {
    added.push(await addPassengerSource(region, { kind: "chat_id", value: resolvedChatId }));
  } else if (source.kind === "chat_id" && warning === null) {
    added.push(await addPassengerSource(region, source));
  }

  return { added, botCanRead, title, warning, sourceLink, botLink };
}

function buildPassengerSourceAddReply(
  region: SourceRegion,
  result: Awaited<ReturnType<typeof savePassengerSourceWithCheck>>
): string {
  if (result.added.length === 0) {
    const lines = [
      "❌ Guruh qo'shilmadi.",
      "Bot bu guruhni ko'ra olmayapti yoki link noto'g'ri.",
      result.sourceLink ? `Guruh linki: ${result.sourceLink}` : null,
      result.botLink ? `Botni guruhga qo'shish: ${result.botLink}` : null,
      "Bot yoki userbot guruh ichida bo'lsin, keyin qayta urinib ko'ring."
    ].filter((line): line is string => Boolean(line));

    return lines.join("\n");
  }

  const saved = [...new Set(result.added.map((item) => formatPassengerSourceResult(item)))].join(", ");
  const lines = [
    `✅ Yo'lovchi guruhi saqlandi: ${REGION_LABELS[region]} -> ${saved}`,
    result.title ? `Guruh: ${result.title}` : null,
    "ID .env faylga ham, DBga ham yozildi.",
    result.sourceLink ? `Guruh linki: ${result.sourceLink}` : null
  ].filter((line): line is string => Boolean(line));

  if (!result.botCanRead) {
    lines.push("");
    lines.push("⚠️ Bot bu guruhda a'zo/admin ekanini tasdiqlay olmadi.");
    lines.push("Xabarlarni olish uchun bot yoki userbot guruh ichida bo'lishi kerak.");
    if (result.botLink) {
      lines.push(`Botni qo'shish: ${result.botLink}`);
    }
  }

  return lines.join("\n");
}

function getPendingActionPrompt(action: PendingAdminAction): string {
  if (action.type === "add_admin") {
    return "Yangi admin username yoki Telegram ID yuboring. Masalan: @username yoki 123456789\nBekor qilish: /cancel";
  }

  if (action.type === "remove_admin") {
    return "O'chiriladigan admin username yoki Telegram ID yuboring. Masalan: @username yoki 123456789\nBekor qilish: /cancel";
  }

  if (action.type === "add_keyword") {
    return [
      `${REGION_LABELS[action.region]} / ${CATEGORY_LABELS[action.category]} uchun so'z yoki butun gap yuboring.`,
      "",
      "Masalan: taxi kerak",
      "Kuchini berish: taxi kerak | 10",
      "Bekor qilish: /cancel"
    ].join("\n");
  }

  if (action.type === "add_passenger") {
    return [
      `${REGION_LABELS[action.region]} uchun yo'lovchi guruh ID yoki public link yuboring.`,
      "",
      "Masalan: -1001234567890",
      "Yoki: https://t.me/guruh_username",
      "Agar shu guruh ichida turgan bo'lsangiz: shu",
      "Bekor qilish: /cancel"
    ].join("\n");
  }

  return [
    `${REGION_LABELS[action.region]} uchun haydovchilar guruh/kanal ID yuboring.`,
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
    const added = await addAdminFromContext(ctx, text);
    if (!added) {
      await ctx.reply("Admin ID yoki username noto'g'ri. Masalan: @username yoki 123456789");
      return true;
    }

    pendingAdminActions.delete(adminId);
    await ctx.reply(formatAdminAddedReply(added), { reply_markup: buildAdminPanelKeyboard() });
    return true;
  }

  if (pending.type === "remove_admin") {
    const removed = await removeAdminByInput(text);
    pendingAdminActions.delete(adminId);
    await ctx.reply(formatAdminRemovedReply(removed), {
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
        ? `✅ Lug'at qo'shildi: ${REGION_LABELS[pending.region]} / ${CATEGORY_LABELS[pending.category]} / ${added.phrase} (kuchi ${added.weight})`
        : "Lug'at qo'shilmadi.",
      { reply_markup: buildAdminPanelKeyboard() }
    );
    return true;
  }

  if (pending.type === "add_passenger") {
    if (isPrivateInviteLink(text)) {
      const botLink = await getBotStartGroupLink(ctx);
      await ctx.reply(
        [
          "Bu private invite link. Undan IDni Bot API orqali olishning iloji yo'q.",
          "Avval bot yoki userbotni guruhga qo'shing.",
          botLink ? `Botni qo'shish: ${botLink}` : null,
          "Keyin guruh ichida shu buyruqni ishlating yoki guruh ID/linkini qayta yuboring."
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      );
      return true;
    }

    const source = parsePassengerSourceInput(text, ctx.chat?.id);
    if (!source || (source.kind === "chat_id" && source.value > 0)) {
      await ctx.reply("Guruh ID/link noto'g'ri. Masalan: -1001234567890 yoki https://t.me/guruh_username");
      return true;
    }

    const result = await savePassengerSourceWithCheck(ctx, pending.region, source);
    pendingAdminActions.delete(adminId);
    await ctx.reply(buildPassengerSourceAddReply(pending.region, result), {
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
  await ctx.reply(`✅ Haydovchilar guruhi sozlandi: ${REGION_LABELS[pending.region]} -> ${chatId}\nID .env faylga ham, DBga ham yozildi.`, {
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
      await ctx.editMessageText("Qaysi yo'nalish uchun yo'lovchi guruhini qo'shamiz?", {
        reply_markup: buildRegionKeyboard("admin:add_passenger_region")
      });
      return;
    }

    if (data === "admin:set_driver") {
      await ctx.editMessageText("Qaysi yo'nalish uchun haydovchilar guruh/kanalini sozlaymiz?", {
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
          "📊 Mijoz statistikasi:",
          "",
          `Bugun mijoz: ${stats.today.delivered}`,
          `Bugun takrorlanmas mijoz: ${stats.today.uniqueClients}`,
          `Bugun jami lead: ${stats.today.leads}`,
          `Bugun ignored: ${stats.today.ignored}`,
          `Bugun duplicate: ${stats.today.duplicates}`,
          `Bugun error: ${stats.today.errors}`,
          "",
          `Bu oy mijoz: ${stats.month.delivered}`,
          `Bu oy takrorlanmas mijoz: ${stats.month.uniqueClients}`,
          `Bu oy jami lead: ${stats.month.leads}`,
          `Bu oy ignored: ${stats.month.ignored}`,
          `Bu oy duplicate: ${stats.month.duplicates}`,
          `Bu oy error: ${stats.month.errors}`
        ].join("\n")
      );
      return;
    }

    if (data === "admin:add_keyword") {
      await ctx.editMessageText("Qaysi yo'nalish uchun gap/so'z qo'shamiz?", {
        reply_markup: buildRegionKeyboard("admin:add_keyword_region")
      });
      return;
    }

    const toggleMatch = data.match(/^admin:toggle:([A-Z0-9_]+)$/u);
    const toggleKey = toggleMatch?.[1] as RuntimeBooleanSetting | undefined;
    if (toggleKey && TOGGLE_SETTINGS.includes(toggleKey)) {
      const nextValue = await toggleRuntimeBooleanSetting(toggleKey);
      await ctx.answerCallbackQuery(`${TOGGLE_LABELS[toggleKey]}: ${onOff(nextValue)}`).catch(() => undefined);
      await sendAdminPanel(ctx, true);
      return;
    }

    const passengerRegionMatch = data.match(/^admin:add_passenger_region:(TASHKENT|GULISTON|KOMSOMOL|ANDIJON)$/u);
    if (passengerRegionMatch && adminId !== undefined) {
      const region = passengerRegionMatch[1] as SourceRegion;
      const pending: PendingAdminAction = { type: "add_passenger", region };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    const driverRegionMatch = data.match(/^admin:set_driver_region:(TASHKENT|GULISTON|KOMSOMOL|ANDIJON)$/u);
    if (driverRegionMatch && adminId !== undefined) {
      const region = driverRegionMatch[1] as SourceRegion;
      const pending: PendingAdminAction = { type: "set_driver", region };
      pendingAdminActions.set(adminId, pending);
      await ctx.reply(getPendingActionPrompt(pending));
      return;
    }

    const keywordRegionMatch = data.match(/^admin:add_keyword_region:(TASHKENT|GULISTON|KOMSOMOL|ANDIJON)$/u);
    if (keywordRegionMatch) {
      const region = keywordRegionMatch[1] as SourceRegion;
      await ctx.editMessageText(`${REGION_LABELS[region]} uchun turini tanlang:`, {
        reply_markup: buildKeywordCategoryKeyboard(region)
      });
      return;
    }

    const keywordCategoryMatch = data.match(/^admin:add_keyword_category:(TASHKENT|GULISTON|KOMSOMOL|ANDIJON):(PASSENGER|DRIVER|CARGO|SPAM|AMBIGUOUS)$/u);
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
        `Bugun mijoz: ${adminStats.today.delivered}`,
        `Bugun takrorlanmas mijoz: ${adminStats.today.uniqueClients}`,
        `Bu oy mijoz: ${adminStats.month.delivered}`,
        `Bu oy takrorlanmas mijoz: ${adminStats.month.uniqueClients}`
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
      await ctx.reply("Foydalanish: /addkeyword taxi kerak yoki /addkeyword taxi kerak | 10");
      return;
    }

    const parsedKeyword = parseKeywordInput(arg);
    if (!parsedKeyword) {
      await ctx.reply("Gap/so'z bo'sh bo'lmasin. Masalan: /addkeyword taxi kerak | 10");
      return;
    }

    const added = await addKeywordEntry({
      category: KeywordCategory.PASSENGER,
      phrase: parsedKeyword.phrase,
      weight: parsedKeyword.weight,
      source: "manual"
    });
    await addKeyword(parsedKeyword.phrase);

    await ctx.reply(
      added
        ? `✅ Yo'lovchi lug'atiga qo'shildi: ${added.phrase} (kuchi ${added.weight})`
        : "Lug'at qo'shilmadi.",
      { reply_markup: buildAdminPanelKeyboard() }
    );
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

    const added = await addAdminFromContext(ctx, getCommandArgument(ctx));
    if (!added) {
      await ctx.reply("Foydalanish: /addadmin @username yoki /addadmin 123456789");
      return;
    }

    await ctx.reply(formatAdminAddedReply(added), { reply_markup: buildAdminPanelKeyboard() });
  });

  bot.command("removeadmin", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const removed = await removeAdminByInput(getCommandArgument(ctx));
    await ctx.reply(formatAdminRemovedReply(removed), {
      reply_markup: buildAdminPanelKeyboard()
    });
  });

  bot.command("addpassenger", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const arg = getCommandArgument(ctx);
    if (isPrivateInviteLink(arg)) {
      const botLink = await getBotStartGroupLink(ctx);
      await ctx.reply(
        [
          "Bu private invite link. Avval bot yoki userbotni guruhga qo'shing.",
          botLink ? `Botni qo'shish: ${botLink}` : null,
          "Keyin /addpassenger TASHKENT -100... yoki public https://t.me/guruh linkini yuboring."
        ]
          .filter((line): line is string => Boolean(line))
          .join("\n")
      );
      return;
    }

    const parsedArg = parseRegionAndPassengerSource(arg);
    if (!parsedArg) {
      await ctx.reply("Foydalanish: /addpassenger TASHKENT -1001234567890 yoki /addpassenger TASHKENT https://t.me/guruh");
      return;
    }

    const result = await savePassengerSourceWithCheck(ctx, parsedArg.region, parsedArg.source);
    await ctx.reply(buildPassengerSourceAddReply(parsedArg.region, result), {
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
      await ctx.reply("Foydalanish: /adddict KOMSOMOL reklama reklama matni yoki /adddict TASHKENT haydovchi bosh joy bor");
      return;
    }

    const added = await addKeywordEntry({
      category,
      phrase,
      weight: 8,
      source: region
    });

    await ctx.reply(added ? `✅ Lug'at qo'shildi: ${REGION_LABELS[region]} / ${CATEGORY_LABELS[category]} / ${added.phrase}` : "Lug'at qo'shilmadi.", {
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
    await ctx.reply(`✅ Haydovchilar guruhi sozlandi: ${REGION_LABELS[parsedArg.region]} -> ${parsedArg.chatId}\nID .env faylga ham, DBga ham yozildi.`, {
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
        `Yo'lovchi so'rovi: ${result.is_passenger_request ? "ha" : "yo'q"}`,
        `Ishonch: ${result.confidence}`,
        `Provider: ${result.provider}`,
        `Sabab: ${result.reason}`,
        `Keyword score: ${result.keywordScore ?? "-"}`
      ].join("\n")
    );
  });

  bot.command("getid", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    const adminSummary = await getAdminListSummary();
    await ctx.reply(
      [
        `Chat ID: ${ctx.chat?.id ?? "n/a"}`,
        `User ID: ${ctx.from?.id ?? "n/a"}`,
        `DB adminlar: ${adminSummary}`,
        `ENV superadmin IDs: ${env.ADMIN_TELEGRAM_IDS.join(", ") || "-"}`,
        `SOURCE_CHAT_IDS: ${env.SOURCE_CHAT_IDS.join(", ") || "-"}`,
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

    await ctx.reply([line("YO'LOVCHI GURUHI", check.passenger), line("HAYDOVCHI GURUHI", check.driver)].join("\n\n"));
  });
}

