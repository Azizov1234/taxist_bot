import { env, getSourceRegionByPassengerChatId } from "../config/env.js";

export function isPassengerGroupChatId(chatId: number): boolean {
  return getSourceRegionByPassengerChatId(chatId) !== null || env.PASSENGER_CHAT_IDS.includes(chatId);
}

export function shouldBlockPassengerGroupWrite(chatId: number): boolean {
  return !env.PASSENGER_GROUP_AUTO_REPLIES && isPassengerGroupChatId(chatId);
}

export function toNumericChatId(chatId: number | string): number | null {
  const parsed = Number(chatId);
  return Number.isInteger(parsed) && Number.isFinite(parsed) ? parsed : null;
}
