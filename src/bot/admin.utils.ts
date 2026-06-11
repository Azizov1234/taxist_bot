import type { Context } from "grammy";
import { env } from "../config/env.js";

export function isAdmin(ctx: Context): boolean {
  const fromId = ctx.from?.id;
  if (fromId !== undefined && env.ADMIN_TELEGRAM_IDS.includes(fromId)) {
    return true;
  }

  const username = ctx.from?.username?.trim().replace(/^@/u, "").toLowerCase();
  return Boolean(username && env.ADMIN_TELEGRAM_USERNAMES.includes(username));
}

export async function requireAdmin(ctx: Context): Promise<boolean> {
  if (env.ADMIN_TELEGRAM_IDS.length === 0 && env.ADMIN_TELEGRAM_USERNAMES.length === 0) {
    await ctx.reply("Admin sozlanmagan.");
    return false;
  }

  if (!isAdmin(ctx)) {
    await ctx.reply("Bu buyruq faqat admin uchun.");
    return false;
  }

  return true;
}

export function getCommandArgument(ctx: Context): string {
  const message = ctx.msg;

  if (!message || !("text" in message) || typeof message.text !== "string") {
    return "";
  }

  const parts = message.text.trim().split(/\s+/);
  if (parts.length <= 1) {
    return "";
  }

  return parts.slice(1).join(" ").trim();
}

