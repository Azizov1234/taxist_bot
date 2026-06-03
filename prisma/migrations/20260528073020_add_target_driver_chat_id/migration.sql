-- DropIndex
DROP INDEX IF EXISTS "keyword_dictionary_normalized_trgm_idx";

-- AlterTable
ALTER TABLE "KeywordDictionary" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- AlterTable
ALTER TABLE "Lead" ADD COLUMN     "targetDriverChatId" INTEGER;
