-- Expand LeadStatus enum for userbot lifecycle states
CREATE TYPE "LeadStatus_new" AS ENUM ('NEW', 'SENT', 'DELETED_FROM_SOURCE', 'NOT_DELETED_NO_PERMISSION', 'IGNORED', 'DUPLICATE', 'ERROR');

ALTER TABLE "Lead" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "Lead"
ALTER COLUMN "status" TYPE "LeadStatus_new"
USING (
  CASE
    WHEN "status"::text = 'FORWARDED' THEN 'SENT'::"LeadStatus_new"
    ELSE "status"::text::"LeadStatus_new"
  END
);

ALTER TYPE "LeadStatus" RENAME TO "LeadStatus_old";
ALTER TYPE "LeadStatus_new" RENAME TO "LeadStatus";
DROP TYPE "LeadStatus_old";

ALTER TABLE "Lead" ALTER COLUMN "status" SET DEFAULT 'NEW';

ALTER TABLE "Lead"
ADD COLUMN "sourceChatTitle" TEXT,
ADD COLUMN "senderId" TEXT,
ADD COLUMN "senderFullName" TEXT,
ADD COLUMN "senderUsername" TEXT,
ADD COLUMN "fromLocation" TEXT,
ADD COLUMN "toLocation" TEXT,
ADD COLUMN "passengerCount" INTEGER,
ADD COLUMN "timeHint" TEXT,
ADD COLUMN "confidence" DOUBLE PRECISION,
ADD COLUMN "isDriverAd" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isSpam" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "driverMessageId" INTEGER,
ADD COLUMN "errorMessage" TEXT;

CREATE INDEX "Lead_senderId_normalizedText_createdAt_idx" ON "Lead"("senderId", "normalizedText", "createdAt");
