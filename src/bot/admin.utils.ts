import type { Context } from "grammy";
import { normalizeTelegramChatUsername } from "../config/env.js";
import { hasActiveAdmin, isAdminIdentity } from "../services/admin.service.js";

export async function isAdmin(ctx: Context): Promise<boolean> {
  const fromId = ctx.from?.id;
  const username = normalizeTelegramChatUsername(ctx.from?.username);
  if (fromId === undefined && !username) {
    return false;
  }

  const identity: { telegramId?: bigint; username?: string } = {};
  if (fromId !== undefined) {
    identity.telegramId = BigInt(fromId);
  }
  if (username) {
    identity.username = username;
  }

  return isAdminIdentity(identity);
}

export async function requireAdmin(ctx: Context): Promise<boolean> {
  if (!(await hasActiveAdmin())) {
    await ctx.reply("Admin sozlanmagan.");
    return false;
  }

  if (!(await isAdmin(ctx))) {
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

