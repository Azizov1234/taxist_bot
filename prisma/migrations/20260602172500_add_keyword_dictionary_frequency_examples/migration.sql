-- AlterTable
ALTER TABLE "KeywordDictionary"
ADD COLUMN IF NOT EXISTS "frequency" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "examples" JSONB;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "KeywordDictionary_frequency_idx" ON "KeywordDictionary"("frequency");
