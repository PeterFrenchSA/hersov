CREATE TYPE "ReviewKind_new" AS ENUM ('tag', 'entity', 'relationship', 'linkedin_profile');
ALTER TABLE "review_queue"
  ALTER COLUMN "kind" TYPE "ReviewKind_new"
  USING ("kind"::text::"ReviewKind_new");
ALTER TYPE "ReviewKind" RENAME TO "ReviewKind_old";
ALTER TYPE "ReviewKind_new" RENAME TO "ReviewKind";
DROP TYPE "ReviewKind_old";

CREATE TABLE "linkedin_profile_suggestions" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "review_queue_id" TEXT,
  "provider" TEXT NOT NULL,
  "profile_url" TEXT NOT NULL,
  "profile_name" TEXT NOT NULL,
  "headline" TEXT,
  "location" TEXT,
  "current_company" TEXT,
  "score" DOUBLE PRECISION NOT NULL,
  "evidence_snippet" TEXT,
  "signals_json" JSONB,
  "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "linkedin_profile_suggestions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "linkedin_profile_suggestions_review_queue_id_key"
  ON "linkedin_profile_suggestions"("review_queue_id");
CREATE UNIQUE INDEX "uq_linkedin_profile_suggestions_contact_url"
  ON "linkedin_profile_suggestions"("contact_id", "profile_url");
CREATE INDEX "idx_linkedin_profile_suggestions_contact_status_score"
  ON "linkedin_profile_suggestions"("contact_id", "status", "score");
CREATE INDEX "idx_linkedin_profile_suggestions_status_created_at"
  ON "linkedin_profile_suggestions"("status", "created_at");

ALTER TABLE "linkedin_profile_suggestions"
  ADD CONSTRAINT "linkedin_profile_suggestions_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "linkedin_profile_suggestions"
  ADD CONSTRAINT "linkedin_profile_suggestions_review_queue_id_fkey"
  FOREIGN KEY ("review_queue_id") REFERENCES "review_queue"("id") ON DELETE SET NULL ON UPDATE CASCADE;
