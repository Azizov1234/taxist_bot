-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'FORWARDED', 'IGNORED', 'DUPLICATE');

-- CreateEnum
CREATE TYPE "KeywordType" AS ENUM ('LATIN', 'CYRILLIC', 'ROUTE', 'EXTRA');

-- CreateEnum
CREATE TYPE "LogLevel" AS ENUM ('INFO', 'WARN', 'ERROR');

-- CreateTable
CREATE TABLE "Lead" (
    "id" SERIAL NOT NULL,
    "sourceChatId" TEXT NOT NULL,
    "sourceMessageId" INTEGER NOT NULL,
    "userId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "username" TEXT,
    "phone" TEXT,
    "originalText" TEXT NOT NULL,
    "normalizedText" TEXT NOT NULL,
    "detectedRoute" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "forwardedMessageId" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Keyword" (
    "id" SERIAL NOT NULL,
    "word" TEXT NOT NULL,
    "type" "KeywordType" NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Keyword_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BotLog" (
    "id" SERIAL NOT NULL,
    "level" "LogLevel" NOT NULL,
    "message" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BotLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Lead_userId_createdAt_idx" ON "Lead"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "Lead_status_createdAt_idx" ON "Lead"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_sourceChatId_sourceMessageId_key" ON "Lead"("sourceChatId", "sourceMessageId");

-- CreateIndex
CREATE UNIQUE INDEX "Keyword_word_key" ON "Keyword"("word");

-- CreateIndex
CREATE INDEX "BotLog_level_createdAt_idx" ON "BotLog"("level", "createdAt");
