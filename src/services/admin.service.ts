import { AdminRole, type AdminUser, type Prisma } from "@prisma/client";
import { env, normalizeTelegramChatUsername } from "../config/env.js";
import { prisma } from "../prisma/client.js";

export interface AdminIdentityInput {
  telegramId?: bigint;
  username?: string;
}

export interface AdminSaveResult {
  admin: AdminUser;
  created: boolean;
}

export type AdminRemoveResult =
  | { status: "removed"; admin: AdminUser }
  | { status: "not_found" }
  | { status: "superadmin"; admin: AdminUser };

function normalizeTelegramId(value: number | bigint | string | undefined | null): bigint | null {
  if (value === undefined || value === null) {
    return null;
  }

  if (typeof value === "bigint") {
    return value > 0n ? value : null;
  }

  if (typeof value === "number") {
    return Number.isSafeInteger(value) && value > 0 ? BigInt(value) : null;
  }

  const raw = value.trim();
  if (!/^[1-9]\d{3,19}$/u.test(raw)) {
    return null;
  }

  try {
    const parsed = BigInt(raw);
    return parsed > 0n ? parsed : null;
  } catch {
    return null;
  }
}

function uniqueBigints(values: Array<bigint | null | undefined>): bigint[] {
  const result: bigint[] = [];
  for (const value of values) {
    if (value !== undefined && value !== null && !result.includes(value)) {
      result.push(value);
    }
  }

  return result;
}

function roleRank(role: AdminRole): number {
  return role === AdminRole.SUPERADMIN ? 2 : 1;
}

function strongestRole(values: AdminRole[]): AdminRole {
  return values.some((role) => role === AdminRole.SUPERADMIN) ? AdminRole.SUPERADMIN : AdminRole.ADMIN;
}

function buildIdentityWhere(identity: AdminIdentityInput, includeInactive = true): Prisma.AdminUserWhereInput {
  const or: Prisma.AdminUserWhereInput[] = [];
  if (identity.telegramId !== undefined) {
    or.push({ telegramId: identity.telegramId });
  }
  if (identity.username !== undefined) {
    or.push({ username: identity.username });
  }

  const where: Prisma.AdminUserWhereInput = or.length > 0 ? { OR: or } : { id: -1 };
  if (!includeInactive) {
    where.isActive = true;
  }

  return where;
}

function normalizeAdminIdentity(identity: AdminIdentityInput): AdminIdentityInput | null {
  const telegramId = normalizeTelegramId(identity.telegramId);
  const username = normalizeTelegramChatUsername(identity.username);
  if (telegramId === null && !username) {
    return null;
  }

  const normalized: AdminIdentityInput = {};
  if (telegramId !== null) {
    normalized.telegramId = telegramId;
  }
  if (username) {
    normalized.username = username;
  }

  return normalized;
}

export function parseAdminIdentityInput(rawValue: string): AdminIdentityInput | null {
  const value = rawValue.trim();
  if (!value) {
    return null;
  }

  const telegramId = normalizeTelegramId(value);
  if (telegramId !== null) {
    return { telegramId };
  }

  const username = normalizeTelegramChatUsername(value);
  return username ? { username } : null;
}

export function formatAdminIdentity(admin: Pick<AdminUser, "telegramId" | "username" | "role">): string {
  const parts = [
    admin.username ? `@${admin.username}` : null,
    admin.telegramId !== null ? `ID ${admin.telegramId.toString()}` : null,
    admin.role === AdminRole.SUPERADMIN ? "superadmin" : "admin"
  ].filter((part): part is string => Boolean(part));

  return parts.join(" | ");
}

export async function saveAdminIdentity(
  identity: AdminIdentityInput,
  role: AdminRole = AdminRole.ADMIN,
  createdByTelegramId?: number | bigint | null
): Promise<AdminSaveResult> {
  const normalized = normalizeAdminIdentity(identity);
  if (!normalized) {
    throw new Error("Admin ID yoki username noto'g'ri.");
  }

  const matches = await prisma.adminUser.findMany({
    where: buildIdentityWhere(normalized),
    orderBy: [{ role: "desc" }, { createdAt: "asc" }]
  });

  const target =
    (normalized.telegramId !== undefined && matches.find((item) => item.telegramId === normalized.telegramId)) ||
    (normalized.username !== undefined && matches.find((item) => item.username === normalized.username)) ||
    null;

  if (!target) {
    const data: Prisma.AdminUserCreateInput = {
      role,
      isActive: true
    };
    if (normalized.telegramId !== undefined) {
      data.telegramId = normalized.telegramId;
    }
    if (normalized.username !== undefined) {
      data.username = normalized.username;
    }
    const createdBy = normalizeTelegramId(createdByTelegramId);
    if (createdBy !== null) {
      data.createdByTelegramId = createdBy;
    }

    const admin = await prisma.adminUser.create({ data });
    return { admin, created: true };
  }

  const duplicates = matches.filter((item) => item.id !== target.id);
  const nextRole = strongestRole([role, target.role, ...duplicates.map((item) => item.role)]);
  const updateData: Prisma.AdminUserUpdateInput = {
    isActive: true,
    role: roleRank(nextRole) > roleRank(target.role) ? nextRole : target.role
  };

  if (normalized.telegramId !== undefined && target.telegramId !== normalized.telegramId) {
    updateData.telegramId = normalized.telegramId;
  }
  if (normalized.username !== undefined && target.username !== normalized.username) {
    updateData.username = normalized.username;
  }
  const createdBy = normalizeTelegramId(createdByTelegramId);
  if (target.createdByTelegramId === null && createdBy !== null) {
    updateData.createdByTelegramId = createdBy;
  }

  const updateTarget = prisma.adminUser.update({
    where: { id: target.id },
    data: updateData
  });

  if (duplicates.length === 0) {
    const admin = await updateTarget;
    return { admin, created: false };
  }

  const transaction = duplicates.map((duplicate) =>
    prisma.adminUser.update({
      where: { id: duplicate.id },
      data: {
        telegramId: null,
        username: null,
        isActive: false
      }
    })
  );
  const results = await prisma.$transaction([...transaction, updateTarget]);
  const admin = results[results.length - 1];
  if (!admin) {
    throw new Error("Admin saqlanmadi.");
  }

  return { admin, created: false };
}

export async function removeAdminByInput(rawValue: string): Promise<AdminRemoveResult> {
  const identity = parseAdminIdentityInput(rawValue);
  if (!identity) {
    return { status: "not_found" };
  }

  const admin = await prisma.adminUser.findFirst({
    where: buildIdentityWhere(identity, false)
  });

  if (!admin) {
    return { status: "not_found" };
  }

  if (admin.role === AdminRole.SUPERADMIN) {
    return { status: "superadmin", admin };
  }

  const removed = await prisma.adminUser.update({
    where: { id: admin.id },
    data: { isActive: false }
  });

  return { status: "removed", admin: removed };
}

export async function isAdminIdentity(identity: AdminIdentityInput): Promise<boolean> {
  const normalized = normalizeAdminIdentity(identity);
  if (!normalized) {
    return false;
  }

  const admin = await prisma.adminUser.findFirst({
    where: buildIdentityWhere(normalized, false)
  });

  if (!admin) {
    return false;
  }

  const shouldRefreshIdentity =
    (normalized.telegramId !== undefined && admin.telegramId === null) ||
    (normalized.username !== undefined && admin.username !== normalized.username);

  if (shouldRefreshIdentity) {
    await saveAdminIdentity(normalized, admin.role, admin.createdByTelegramId).catch(() => undefined);
  }

  return true;
}

export async function isSuperAdminIdentity(identity: AdminIdentityInput): Promise<boolean> {
  const normalized = normalizeAdminIdentity(identity);
  if (!normalized) {
    return false;
  }

  const admin = await prisma.adminUser.findFirst({
    where: buildIdentityWhere(normalized, false)
  });

  return admin?.role === AdminRole.SUPERADMIN;
}

export async function hasActiveAdmin(): Promise<boolean> {
  const count = await prisma.adminUser.count({
    where: { isActive: true }
  });

  return count > 0;
}

export async function listActiveAdmins(): Promise<AdminUser[]> {
  return prisma.adminUser.findMany({
    where: { isActive: true },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }]
  });
}

export async function getAdminListSummary(): Promise<string> {
  const admins = await listActiveAdmins();
  return admins.length > 0 ? admins.map((admin) => formatAdminIdentity(admin)).join(", ") : "-";
}

export async function seedDefaultAdminsFromEnv(): Promise<void> {
  const superAdminIds = uniqueBigints(env.ADMIN_TELEGRAM_IDS.map((item) => BigInt(item)));

  for (const telegramId of superAdminIds) {
    await saveAdminIdentity({ telegramId }, AdminRole.SUPERADMIN);
  }
}
