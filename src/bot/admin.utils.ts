import type { Context } from "grammy";
import { env } from "../config/env.js";

export function isAdmin(ctx: Context): boolean {
  return ctx.from?.id === env.ADMIN_TELEGRAM_ID;
}

export async function requireAdmin(ctx: Context): Promise<boolean> {
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
