CREATE TYPE "ImportBatchStatus" AS ENUM ('queued', 'processing', 'completed', 'failed', 'canceled');
CREATE TYPE "ImportRowOutcome" AS ENUM ('inserted', 'updated', 'skipped', 'duplicate', 'error');

ALTER TABLE "contacts"
  ADD COLUMN "source_import_batch_id" UUID;

CREATE TABLE "import_batches" (
  "id" UUID NOT NULL,
  "filename" TEXT NOT NULL,
  "original_headers_json" JSONB NOT NULL,
  "column_mapping_json" JSONB,
  "status" "ImportBatchStatus" NOT NULL DEFAULT 'queued',
  "created_by_user_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "total_rows" INTEGER NOT NULL DEFAULT 0,
  "processed_rows" INTEGER NOT NULL DEFAULT 0,
  "inserted_count" INTEGER NOT NULL DEFAULT 0,
  "updated_count" INTEGER NOT NULL DEFAULT 0,
  "skipped_count" INTEGER NOT NULL DEFAULT 0,
  "duplicate_count" INTEGER NOT NULL DEFAULT 0,
  "error_count" INTEGER NOT NULL DEFAULT 0,
  "error_sample_json" JSONB,
  CONSTRAINT "import_batches_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "import_rows" (
  "id" BIGSERIAL NOT NULL,
  "batch_id" UUID NOT NULL,
  "row_index" INTEGER NOT NULL,
  "raw_json" JSONB,
  "normalized_json" JSONB,
  "outcome" "ImportRowOutcome" NOT NULL,
  "contact_id" TEXT,
  "error_message" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "import_rows_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_contacts_source_import_batch_id" ON "contacts"("source_import_batch_id");
CREATE INDEX "idx_import_batches_status" ON "import_batches"("status");
CREATE INDEX "idx_import_batches_created_by_user_id" ON "import_batches"("created_by_user_id");
CREATE INDEX "idx_import_rows_batch_id" ON "import_rows"("batch_id");
CREATE INDEX "idx_import_rows_batch_id_row_index" ON "import_rows"("batch_id", "row_index");
CREATE INDEX "idx_import_rows_batch_id_outcome" ON "import_rows"("batch_id", "outcome");

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_source_import_batch_id_fkey"
  FOREIGN KEY ("source_import_batch_id") REFERENCES "import_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_batches"
  ADD CONSTRAINT "import_batches_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_batch_id_fkey"
  FOREIGN KEY ("batch_id") REFERENCES "import_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "import_rows"
  ADD CONSTRAINT "import_rows_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;
