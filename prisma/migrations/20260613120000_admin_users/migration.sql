CREATE TYPE "AdminRole" AS ENUM ('SUPERADMIN', 'ADMIN');

CREATE TABLE "AdminUser" (
  "id" SERIAL NOT NULL,
  "telegramId" BIGINT,
  "username" TEXT,
  "role" "AdminRole" NOT NULL DEFAULT 'ADMIN',
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "createdByTelegramId" BIGINT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "AdminUser_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AdminUser_telegramId_key" ON "AdminUser"("telegramId");
CREATE UNIQUE INDEX "AdminUser_username_key" ON "AdminUser"("username");
CREATE INDEX "AdminUser_role_isActive_idx" ON "AdminUser"("role", "isActive");
CREATE INDEX "AdminUser_isActive_createdAt_idx" ON "AdminUser"("isActive", "createdAt");
