-- Enable trigram extension for fuzzy and fast text lookup
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Create enums
CREATE TYPE "KeywordCategory" AS ENUM ('PASSENGER', 'DRIVER', 'CARGO', 'SPAM', 'AMBIGUOUS');
CREATE TYPE "KeywordLanguage" AS ENUM ('LATIN', 'CYRILLIC', 'RUSSIAN', 'MIXED');
CREATE TYPE "KeywordMatchType" AS ENUM ('EXACT', 'PHRASE', 'REGEX');

-- Create table
CREATE TABLE "KeywordDictionary" (
    "id" SERIAL NOT NULL,
    "phrase" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "category" "KeywordCategory" NOT NULL,
    "weight" INTEGER NOT NULL DEFAULT 1,
    "language" "KeywordLanguage" NOT NULL DEFAULT 'MIXED',
    "matchType" "KeywordMatchType" NOT NULL DEFAULT 'PHRASE',
    "source" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "KeywordDictionary_pkey" PRIMARY KEY ("id")
);

-- Create indexes
CREATE UNIQUE INDEX "KeywordDictionary_normalized_category_key" ON "KeywordDictionary"("normalized", "category");
CREATE INDEX "KeywordDictionary_category_isActive_idx" ON "KeywordDictionary"("category", "isActive");
CREATE INDEX "KeywordDictionary_normalized_idx" ON "KeywordDictionary"("normalized");
CREATE INDEX "KeywordDictionary_weight_idx" ON "KeywordDictionary"("weight");
CREATE INDEX "KeywordDictionary_matchType_idx" ON "KeywordDictionary"("matchType");
CREATE INDEX IF NOT EXISTS keyword_dictionary_normalized_trgm_idx
ON "KeywordDictionary"
USING GIN ("normalized" gin_trgm_ops);
