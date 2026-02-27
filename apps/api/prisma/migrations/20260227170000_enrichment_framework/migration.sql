CREATE TYPE "EnrichmentRunStatus" AS ENUM ('queued', 'processing', 'completed', 'failed', 'canceled');

ALTER TABLE "enrichment_runs"
  ADD COLUMN "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  ADD COLUMN "total_targets" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "processed_targets" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "updated_contacts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "skipped_contacts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "error_sample_json" JSONB;

ALTER TABLE "enrichment_runs"
  ALTER COLUMN "status" TYPE "EnrichmentRunStatus"
  USING (
    CASE LOWER("status")
      WHEN 'queued' THEN 'queued'::"EnrichmentRunStatus"
      WHEN 'processing' THEN 'processing'::"EnrichmentRunStatus"
      WHEN 'completed' THEN 'completed'::"EnrichmentRunStatus"
      WHEN 'failed' THEN 'failed'::"EnrichmentRunStatus"
      WHEN 'canceled' THEN 'canceled'::"EnrichmentRunStatus"
      ELSE 'queued'::"EnrichmentRunStatus"
    END
  );

ALTER TABLE "enrichment_runs"
  ALTER COLUMN "status" SET DEFAULT 'queued';

CREATE TABLE "contact_field_confidence" (
  "contact_id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "provider" TEXT NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_field_confidence_pkey" PRIMARY KEY ("contact_id", "field")
);

CREATE INDEX "idx_contact_field_confidence_updated_at" ON "contact_field_confidence"("updated_at");
CREATE INDEX "idx_enrichment_runs_status_created_at" ON "enrichment_runs"("status", "created_at");

DROP INDEX IF EXISTS "idx_enrichment_results_run_id";
DROP INDEX IF EXISTS "idx_enrichment_results_contact_id";
CREATE INDEX "idx_enrichment_results_run_created_at" ON "enrichment_results"("run_id", "created_at");
CREATE INDEX "idx_enrichment_results_contact_created_at" ON "enrichment_results"("contact_id", "created_at");

DELETE FROM "contact_methods" a
USING "contact_methods" b
WHERE a."id" > b."id"
  AND a."contact_id" = b."contact_id"
  AND a."type" = b."type"
  AND a."value" = b."value";

CREATE INDEX "idx_contact_methods_type_value" ON "contact_methods"("type", "value");
CREATE UNIQUE INDEX "uq_contact_methods_contact_type_value" ON "contact_methods"("contact_id", "type", "value");

WITH duplicate_tags AS (
  SELECT
    "id" AS duplicate_id,
    MIN("id") OVER (PARTITION BY LOWER("name"), LOWER("category")) AS keep_id
  FROM "tags"
)
DELETE FROM "contact_tags" ct
USING duplicate_tags dt
WHERE ct."tag_id" = dt.duplicate_id
  AND dt.duplicate_id <> dt.keep_id
  AND EXISTS (
    SELECT 1
    FROM "contact_tags" existing_ct
    WHERE existing_ct."contact_id" = ct."contact_id"
      AND existing_ct."tag_id" = dt.keep_id
  );

WITH duplicate_tags AS (
  SELECT
    "id" AS duplicate_id,
    MIN("id") OVER (PARTITION BY LOWER("name"), LOWER("category")) AS keep_id
  FROM "tags"
),
tag_rows_to_rank AS (
  SELECT
    ct."contact_id",
    ct."tag_id",
    dt.keep_id,
    ROW_NUMBER() OVER (
      PARTITION BY ct."contact_id", dt.keep_id
      ORDER BY ct."tag_id"
    ) AS row_num
  FROM "contact_tags" ct
  INNER JOIN duplicate_tags dt ON ct."tag_id" = dt.duplicate_id
  WHERE dt.duplicate_id <> dt.keep_id
)
DELETE FROM "contact_tags" ct
USING tag_rows_to_rank ranked
WHERE ct."contact_id" = ranked."contact_id"
  AND ct."tag_id" = ranked."tag_id"
  AND ranked.row_num > 1;

WITH duplicate_tags AS (
  SELECT
    "id" AS duplicate_id,
    MIN("id") OVER (PARTITION BY LOWER("name"), LOWER("category")) AS keep_id
  FROM "tags"
)
UPDATE "contact_tags" ct
SET "tag_id" = dt.keep_id
FROM duplicate_tags dt
WHERE ct."tag_id" = dt.duplicate_id
  AND dt.duplicate_id <> dt.keep_id;

WITH duplicate_tags AS (
  SELECT
    "id" AS duplicate_id,
    MIN("id") OVER (PARTITION BY LOWER("name"), LOWER("category")) AS keep_id
  FROM "tags"
)
DELETE FROM "tags" t
USING duplicate_tags dt
WHERE t."id" = dt.duplicate_id
  AND dt.duplicate_id <> dt.keep_id;

CREATE UNIQUE INDEX "uq_tags_name_category" ON "tags"("name", "category");

ALTER TABLE "contact_field_confidence"
  ADD CONSTRAINT "contact_field_confidence_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
