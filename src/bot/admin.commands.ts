import { Bot, type Context } from "grammy";
import { env } from "../config/env.js";
import { addKeyword, listActiveKeywords, removeKeyword } from "../services/keyword.service.js";
import { classifyLead } from "../services/leadClassifier.service.js";
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
        `Forward qilingan: ${status.forwarded}`,
        `Ignored: ${status.ignored}`,
        `Duplicate: ${status.duplicate}`
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
        `Bugun forward: ${stats.today.forwarded}`,
        `Bugun duplicate: ${stats.today.duplicates}`,
        "",
        `Hafta lead: ${stats.week.leads}`,
        `Hafta forward: ${stats.week.forwarded}`,
        `Hafta duplicate: ${stats.week.duplicates}`
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

    const result = await classifyLead(arg);

    await ctx.reply(
      [
        `Lead: ${result.isLead ? "ha" : "yo'q"}`,
        `Spam: ${result.isSpam ? "ha" : "yo'q"}`,
        `Score: ${result.score}`,
        `Route: ${result.route ?? "aniqlanmadi"}`,
        `Keywords: ${result.matchedKeywords.join(", ") || "-"}`,
        `Patterns: ${result.matchedPatterns.join(", ") || "-"}`
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
        `PASSENGER_GROUP_ID: ${env.PASSENGER_GROUP_ID}`,
        `DRIVER_GROUP_OR_CHANNEL_ID: ${env.DRIVER_GROUP_OR_CHANNEL_ID}`
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
