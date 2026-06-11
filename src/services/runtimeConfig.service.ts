import { readFile, writeFile } from "node:fs/promises";
import {
  ENV_FILE_PATH,
  env,
  normalizeTelegramChatUsername,
  registerResolvedPassengerChat,
  registerResolvedPassengerChatUsername,
  type SourceRegion
} from "../config/env.js";

const SOURCE_REGIONS: SourceRegion[] = ["TASHKENT", "GULISTON", "KOMSOMOL"];

export type RuntimeBooleanSetting =
  | "PASSENGER_GROUP_AUTO_REPLIES"
  | "DELETE_SOURCE_MESSAGE_IF_ADMIN"
  | "DELETE_IGNORED_MESSAGE_IF_ADMIN"
  | "SEND_PRIVATE_ACK_TO_PASSENGER";

export type PassengerSourceAddResult = { kind: "chat_id"; value: number } | { kind: "username"; value: string };

function uniqueNumbers(values: Array<number | null | undefined>): number[] {
  const result: number[] = [];
  for (const value of values) {
    if (typeof value === "number" && Number.isInteger(value) && !result.includes(value)) {
      result.push(value);
    }
  }

  return result;
}

function parseChatId(rawValue: string): number | null {
  const value = rawValue.trim();
  if (!/^-?\d+$/u.test(value)) {
    return null;
  }

  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && Math.abs(parsed) >= 1 ? parsed : null;
}

function parseChatIdFromTelegramLink(rawValue: string): number | null {
  const value = rawValue.trim();
  const match = value.match(/^https?:\/\/(?:t\.me|telegram\.me)\/c\/(\d+)(?:\/\d+)?(?:[/?#].*)?$/iu);
  if (!match?.[1]) {
    return null;
  }

  const internalId = Number(match[1]);
  if (!Number.isSafeInteger(internalId) || internalId <= 0) {
    return null;
  }

  const chatId = Number(`-100${internalId}`);
  return Number.isSafeInteger(chatId) ? chatId : null;
}

function pushUnique<T>(list: T[], value: T): void {
  if (!list.includes(value)) {
    list.push(value);
  }
}

function removeValue<T>(list: T[], value: T): boolean {
  const index = list.indexOf(value);
  if (index < 0) {
    return false;
  }

  list.splice(index, 1);
  return true;
}

export function parseTelegramChatIdInput(rawValue: string, currentChatId?: number): number | null {
  const normalized = rawValue.trim().toLowerCase();
  if (["shu", "this", "current", "hozirgi"].includes(normalized) && currentChatId !== undefined) {
    return currentChatId;
  }

  return parseChatId(rawValue) ?? parseChatIdFromTelegramLink(rawValue);
}

export function parseTelegramUsernameInput(rawValue: string): string | null {
  return normalizeTelegramChatUsername(rawValue);
}

export function parsePassengerSourceInput(rawValue: string, currentChatId?: number): PassengerSourceAddResult | null {
  const chatId = parseTelegramChatIdInput(rawValue, currentChatId);
  if (chatId !== null) {
    return { kind: "chat_id", value: chatId };
  }

  const username = parseTelegramUsernameInput(rawValue);
  if (username) {
    return { kind: "username", value: username };
  }

  return null;
}

export function parseSourceRegionInput(rawValue: string): SourceRegion | null {
  const normalized = rawValue.trim().toUpperCase();
  if (SOURCE_REGIONS.includes(normalized as SourceRegion)) {
    return normalized as SourceRegion;
  }

  return null;
}

function formatChatIdList(values: number[]): string {
  return uniqueNumbers(values).join(",");
}

function formatStringList(values: string[]): string {
  return [...new Set(values.map((value) => value.trim().toLowerCase()).filter(Boolean))].join(",");
}

async function updateEnvFile(updates: Record<string, string>): Promise<void> {
  let raw = "";
  try {
    raw = await readFile(ENV_FILE_PATH, "utf8");
  } catch {
    raw = "";
  }

  const eol = raw.includes("\r\n") ? "\r\n" : "\n";
  const lines = raw.length > 0 ? raw.split(/\r?\n/u) : [];
  const hasTrailingBlank = lines.length > 0 && lines[lines.length - 1] === "";
  const workingLines = hasTrailingBlank ? lines.slice(0, -1) : [...lines];
  const seen = new Set<string>();

  for (let index = 0; index < workingLines.length; index += 1) {
    const line = workingLines[index] ?? "";
    const match = line.match(/^([A-Z0-9_]+)\s*=/u);
    const key = match?.[1];
    if (!key || !(key in updates)) {
      continue;
    }

    workingLines[index] = `${key}=${updates[key]}`;
    seen.add(key);
  }

  for (const [key, value] of Object.entries(updates)) {
    if (!seen.has(key)) {
      workingLines.push(`${key}=${value}`);
    }
  }

  await writeFile(ENV_FILE_PATH, `${workingLines.join(eol)}${eol}`, "utf8");
}

function setEnvBoolean(key: RuntimeBooleanSetting, value: boolean): void {
  env[key] = value;
}

function getPassengerRegionalList(region: SourceRegion): number[] {
  return env.PASSENGER_CHAT_IDS_BY_REGION[region];
}

function getPassengerRegionalEnvKey(region: SourceRegion): string {
  return `PASSENGER_CHAT_IDS_${region}`;
}

function getPassengerUsernameRegionalEnvKey(region: SourceRegion): string {
  return `PASSENGER_CHAT_USERNAMES_${region}`;
}

function getDriverRegionalEnvKey(region: SourceRegion): string {
  return `DRIVER_CHAT_ID_${region}`;
}

function setEnvDriverRegion(region: SourceRegion, chatId: number): void {
  env.DRIVER_CHAT_ID_BY_REGION[region] = chatId;

  if (region === "TASHKENT") {
    env.DRIVER_CHAT_ID_TASHKENT = chatId;
  } else if (region === "GULISTON") {
    env.DRIVER_CHAT_ID_GULISTON = chatId;
  } else {
    env.DRIVER_CHAT_ID_KOMSOMOL = chatId;
  }

  const driverIds = uniqueNumbers(SOURCE_REGIONS.map((item) => env.DRIVER_CHAT_ID_BY_REGION[item]));
  env.DRIVER_CHAT_IDS.length = 0;
  env.DRIVER_CHAT_IDS.push(...driverIds);

  const primaryDriverId = driverIds[0];
  if (primaryDriverId !== undefined) {
    env.DRIVER_CHAT_ID = primaryDriverId;
  }
}

export async function setRuntimeBooleanSetting(key: RuntimeBooleanSetting, value: boolean): Promise<void> {
  setEnvBoolean(key, value);
  await updateEnvFile({
    [key]: String(value)
  });
}

export async function toggleRuntimeBooleanSetting(key: RuntimeBooleanSetting): Promise<boolean> {
  const nextValue = !env[key];
  await setRuntimeBooleanSetting(key, nextValue);
  return nextValue;
}

export async function addPassengerSourceChat(region: SourceRegion, chatId: number): Promise<void> {
  registerResolvedPassengerChat(chatId, region);

  const passengerRegionalUpdates = Object.fromEntries(
    SOURCE_REGIONS.map((item) => [getPassengerRegionalEnvKey(item), formatChatIdList(getPassengerRegionalList(item))])
  );

  await updateEnvFile({
    ...passengerRegionalUpdates,
    PASSENGER_CHAT_IDS: formatChatIdList(env.PASSENGER_CHAT_IDS),
    SOURCE_CHAT_IDS: formatChatIdList(env.PASSENGER_CHAT_IDS)
  });
}

export async function addPassengerSourceUsername(region: SourceRegion, username: string): Promise<string> {
  const normalizedUsername = registerResolvedPassengerChatUsername(username, region);

  const passengerUsernameRegionalUpdates = Object.fromEntries(
    SOURCE_REGIONS.map((item) => [getPassengerUsernameRegionalEnvKey(item), formatStringList(env.PASSENGER_CHAT_USERNAMES_BY_REGION[item])])
  );

  await updateEnvFile({
    ...passengerUsernameRegionalUpdates,
    PASSENGER_CHAT_USERNAMES: formatStringList(env.PASSENGER_CHAT_USERNAMES)
  });

  return normalizedUsername;
}

export async function addPassengerSource(region: SourceRegion, source: PassengerSourceAddResult): Promise<PassengerSourceAddResult> {
  if (source.kind === "chat_id") {
    await addPassengerSourceChat(region, source.value);
    return source;
  }

  const normalizedUsername = await addPassengerSourceUsername(region, source.value);
  return { kind: "username", value: normalizedUsername };
}

export async function setDriverChat(region: SourceRegion, chatId: number): Promise<void> {
  setEnvDriverRegion(region, chatId);

  await updateEnvFile({
    [getDriverRegionalEnvKey(region)]: String(chatId),
    DRIVER_CHAT_ID: String(env.DRIVER_CHAT_ID)
  });
}

export async function addAdminUsername(username: string): Promise<string> {
  const normalizedUsername = parseTelegramUsernameInput(username);
  if (!normalizedUsername) {
    throw new Error("Username noto'g'ri.");
  }

  pushUnique(env.ADMIN_TELEGRAM_USERNAMES, normalizedUsername);
  await updateEnvFile({
    ADMIN_TELEGRAM_USERNAMES: formatStringList(env.ADMIN_TELEGRAM_USERNAMES)
  });

  return normalizedUsername;
}

export async function removeAdminUsername(username: string): Promise<string | null> {
  const normalizedUsername = parseTelegramUsernameInput(username);
  if (!normalizedUsername) {
    return null;
  }

  const removed = removeValue(env.ADMIN_TELEGRAM_USERNAMES, normalizedUsername);
  if (!removed) {
    return null;
  }

  await updateEnvFile({
    ADMIN_TELEGRAM_USERNAMES: formatStringList(env.ADMIN_TELEGRAM_USERNAMES)
  });

  return normalizedUsername;
}

export function getRuntimeConfigText(): string {
  return [
    "🚕 Taxi bot boshqaruv paneli",
    "",
    `🔒 Userbot read-only: ${env.USERBOT_READ_ONLY ? "ON" : "OFF"}`,
    `🚖 Driver delivery: ${env.DRIVER_DELIVERY_MODE}`,
    `💬 Passenger javoblari: ${env.PASSENGER_GROUP_AUTO_REPLIES ? "ON" : "OFF"}`,
    `📩 Client DM: ${env.SEND_PRIVATE_ACK_TO_PASSENGER ? "ON" : "OFF"}`,
    `🗑 Lead source o'chirish: ${env.DELETE_SOURCE_MESSAGE_IF_ADMIN ? "ON" : "OFF"}`,
    `🧹 Ignored o'chirish: ${env.DELETE_IGNORED_MESSAGE_IF_ADMIN ? "ON" : "OFF"}`,
    "",
    `👮 Admin usernames: ${env.ADMIN_TELEGRAM_USERNAMES.map((item) => `@${item}`).join(", ") || "-"}`,
    "",
    `👥 Passenger guruhlar: ${env.PASSENGER_CHAT_IDS.length}`,
    `🔗 Passenger usernames: ${env.PASSENGER_CHAT_USERNAMES.length}`,
    `Toshkent: ${env.PASSENGER_CHAT_IDS_TASHKENT.length}`,
    `Guliston: ${env.PASSENGER_CHAT_IDS_GULISTON.length}`,
    `Komsomol: ${env.PASSENGER_CHAT_IDS_KOMSOMOL.length}`,
    "",
    `🚘 Driver TASHKENT: ${env.DRIVER_CHAT_ID_TASHKENT ?? "-"}`,
    `🚘 Driver GULISTON: ${env.DRIVER_CHAT_ID_GULISTON ?? "-"}`,
    `🚘 Driver KOMSOMOL: ${env.DRIVER_CHAT_ID_KOMSOMOL ?? "-"}`
  ].join("\n");
}
