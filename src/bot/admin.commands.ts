import { Bot, type Context } from "grammy";
import { env } from "../config/env.js";
import { addKeyword, listActiveKeywords, removeKeyword } from "../services/keyword.service.js";
import { classifyMessage } from "../services/leadClassifier.service.js";
import { getStatsSnapshot, getStatusSnapshot } from "../services/lead.service.js";
import { checkConfiguredChats, type ChatAccessCheck } from "../services/telegramHealth.service.js";
import { getCommandArgument, requireAdmin } from "./admin.utils.js";

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

export function registerAdminCommands(bot: Bot<Context>): void {
  bot.command("start", async (ctx) => {
    if (!(await requireAdmin(ctx))) {
      return;
    }

    await ctx.reply("Taxi lead bot ishlayapti.");
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
        `Hafta error: ${stats.week.errors}`
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
        `PASSENGER_CHAT_IDS: ${env.PASSENGER_CHAT_IDS.join(", ")}`,
        `PASSENGER_CHAT_IDS_TASHKENT: ${env.PASSENGER_CHAT_IDS_TASHKENT.join(", ") || "-"}`,
        `PASSENGER_CHAT_IDS_GULISTON: ${env.PASSENGER_CHAT_IDS_GULISTON.join(", ") || "-"}`,
        `DRIVER_CHAT_ID_TASHKENT: ${env.DRIVER_CHAT_ID_TASHKENT ?? "-"}`,
        `DRIVER_CHAT_ID_GULISTON: ${env.DRIVER_CHAT_ID_GULISTON ?? "-"}`
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

