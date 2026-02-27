CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "EntityType" AS ENUM ('company', 'event', 'location', 'topic', 'person_ref');
CREATE TYPE "RelationshipStatus" AS ENUM ('suggested', 'approved', 'rejected');
CREATE TYPE "ReviewKind" AS ENUM ('tag', 'entity', 'relationship');
CREATE TYPE "ReviewStatus" AS ENUM ('pending', 'approved', 'rejected');
CREATE TYPE "LlmRunStatus" AS ENUM ('queued', 'processing', 'completed', 'failed');

CREATE TABLE "contact_insights" (
  "contact_id" TEXT NOT NULL,
  "notes_hash" TEXT NOT NULL,
  "insights_json" JSONB NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "confidence_overall" DOUBLE PRECISION NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_insights_pkey" PRIMARY KEY ("contact_id")
);

CREATE TABLE "entities" (
  "id" TEXT NOT NULL,
  "type" "EntityType" NOT NULL,
  "canonical_name" TEXT NOT NULL,
  "external_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entities_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "entity_aliases" (
  "id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "alias" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "entity_aliases_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_entity_mentions" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "entity_id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "evidence_snippet" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "contact_entity_mentions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "relationships" (
  "id" TEXT NOT NULL,
  "from_contact_id" TEXT NOT NULL,
  "to_contact_id" TEXT,
  "type" TEXT NOT NULL,
  "entity_id" TEXT,
  "evidence_snippet" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "status" "RelationshipStatus" NOT NULL DEFAULT 'suggested',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "relationships_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "review_queue" (
  "id" TEXT NOT NULL,
  "kind" "ReviewKind" NOT NULL,
  "payload_json" JSONB NOT NULL,
  "status" "ReviewStatus" NOT NULL DEFAULT 'pending',
  "created_by_user_id" TEXT NOT NULL,
  "reviewed_by_user_id" TEXT,
  "reviewed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "review_queue_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "llm_prompt_versions" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "version" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_prompt_versions_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "llm_runs" (
  "id" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "prompt_version" TEXT NOT NULL,
  "input_hash" TEXT NOT NULL,
  "status" "LlmRunStatus" NOT NULL,
  "tokens_in" INTEGER,
  "tokens_out" INTEGER,
  "latency_ms" INTEGER,
  "error_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "llm_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_scores" (
  "contact_id" TEXT NOT NULL,
  "connector_score" DOUBLE PRECISION NOT NULL,
  "influence_score" DOUBLE PRECISION,
  "computed_at" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "contact_scores_pkey" PRIMARY KEY ("contact_id")
);

CREATE UNIQUE INDEX "uq_entities_type_canonical_name" ON "entities"("type", "canonical_name");
CREATE INDEX "idx_entities_type_canonical_name" ON "entities"("type", "canonical_name");
CREATE UNIQUE INDEX "uq_entity_aliases_alias" ON "entity_aliases"("alias");
CREATE INDEX "idx_entity_aliases_entity_id" ON "entity_aliases"("entity_id");
CREATE UNIQUE INDEX "uq_contact_entity_mentions_contact_entity" ON "contact_entity_mentions"("contact_id", "entity_id");
CREATE INDEX "idx_contact_entity_mentions_contact_id" ON "contact_entity_mentions"("contact_id");
CREATE INDEX "idx_contact_entity_mentions_entity_id" ON "contact_entity_mentions"("entity_id");
CREATE INDEX "idx_relationships_from_status" ON "relationships"("from_contact_id", "status");
CREATE INDEX "idx_relationships_to_status" ON "relationships"("to_contact_id", "status");
CREATE INDEX "idx_relationships_entity_id" ON "relationships"("entity_id");
CREATE INDEX "idx_relationships_status_created_at" ON "relationships"("status", "created_at");
CREATE INDEX "idx_review_queue_status_kind_created_at" ON "review_queue"("status", "kind", "created_at");
CREATE INDEX "idx_review_queue_created_by" ON "review_queue"("created_by_user_id");
CREATE INDEX "idx_review_queue_reviewed_by" ON "review_queue"("reviewed_by_user_id");
CREATE UNIQUE INDEX "uq_llm_prompt_versions_name_version" ON "llm_prompt_versions"("name", "version");
CREATE INDEX "idx_llm_prompt_versions_created_at" ON "llm_prompt_versions"("created_at");
CREATE INDEX "idx_llm_runs_purpose_created_at" ON "llm_runs"("purpose", "created_at");
CREATE INDEX "idx_llm_runs_status_created_at" ON "llm_runs"("status", "created_at");
CREATE INDEX "idx_contact_scores_connector_score" ON "contact_scores"("connector_score");
CREATE INDEX "idx_contact_scores_computed_at" ON "contact_scores"("computed_at");
CREATE INDEX "idx_contact_insights_updated_at" ON "contact_insights"("updated_at");

ALTER TABLE "contact_insights"
  ADD CONSTRAINT "contact_insights_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "entity_aliases"
  ADD CONSTRAINT "entity_aliases_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_entity_mentions"
  ADD CONSTRAINT "contact_entity_mentions_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_entity_mentions"
  ADD CONSTRAINT "contact_entity_mentions_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "relationships"
  ADD CONSTRAINT "relationships_from_contact_id_fkey"
  FOREIGN KEY ("from_contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "relationships"
  ADD CONSTRAINT "relationships_to_contact_id_fkey"
  FOREIGN KEY ("to_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "relationships"
  ADD CONSTRAINT "relationships_entity_id_fkey"
  FOREIGN KEY ("entity_id") REFERENCES "entities"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "review_queue"
  ADD CONSTRAINT "review_queue_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "review_queue"
  ADD CONSTRAINT "review_queue_reviewed_by_user_id_fkey"
  FOREIGN KEY ("reviewed_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact_scores"
  ADD CONSTRAINT "contact_scores_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;
