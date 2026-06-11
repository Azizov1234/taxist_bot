DROP INDEX IF EXISTS "KeywordDictionary_normalized_category_key";

UPDATE "KeywordDictionary"
SET "source" = 'global'
WHERE "source" IS NULL;

ALTER TABLE "KeywordDictionary"
ALTER COLUMN "source" SET DEFAULT 'global',
ALTER COLUMN "source" SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "KeywordDictionary_normalized_category_source_key"
ON "KeywordDictionary"("normalized", "category", "source");
