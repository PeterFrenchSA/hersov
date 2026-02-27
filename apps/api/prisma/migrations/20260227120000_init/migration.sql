CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

CREATE TYPE "Role" AS ENUM ('Admin', 'Analyst', 'ReadOnly');
CREATE TYPE "ContactMethodType" AS ENUM ('email', 'phone', 'website', 'linkedin', 'twitter', 'other');
CREATE TYPE "EmbeddingKind" AS ENUM ('notes', 'profile', 'company');

CREATE TABLE "users" (
  "id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "password_hash" TEXT NOT NULL,
  "role" "Role" NOT NULL DEFAULT 'ReadOnly',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_login_at" TIMESTAMP(3),
  CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "companies" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "domain" TEXT,
  "industry" TEXT,
  "hq_city" TEXT,
  "hq_country" TEXT,
  "size_range" TEXT,
  "linkedin_url" TEXT,
  CONSTRAINT "companies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contacts" (
  "id" TEXT NOT NULL,
  "first_name" TEXT,
  "last_name" TEXT,
  "full_name" TEXT NOT NULL,
  "notes_raw" TEXT,
  "location_city" TEXT,
  "location_country" TEXT,
  "current_title" TEXT,
  "current_company_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_enriched_at" TIMESTAMP(3),
  CONSTRAINT "contacts_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_methods" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "type" "ContactMethodType" NOT NULL,
  "value" TEXT NOT NULL,
  "is_primary" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "source" TEXT,
  CONSTRAINT "contact_methods_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "tags" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "category" TEXT NOT NULL,
  CONSTRAINT "tags_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_tags" (
  "contact_id" TEXT NOT NULL,
  "tag_id" TEXT NOT NULL,
  "confidence" DOUBLE PRECISION,
  "source" TEXT,
  CONSTRAINT "contact_tags_pkey" PRIMARY KEY ("contact_id", "tag_id")
);

CREATE TABLE "events" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "year" INTEGER,
  "location" TEXT,
  "type" TEXT,
  CONSTRAINT "events_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "contact_events" (
  "contact_id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "context_note" TEXT,
  CONSTRAINT "contact_events_pkey" PRIMARY KEY ("contact_id", "event_id")
);

CREATE TABLE "enrichment_runs" (
  "id" TEXT NOT NULL,
  "status" TEXT NOT NULL,
  "started_at" TIMESTAMP(3),
  "finished_at" TIMESTAMP(3),
  "created_by_user_id" TEXT,
  "config_json" JSONB,
  "stats_json" JSONB,
  CONSTRAINT "enrichment_runs_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "enrichment_results" (
  "id" TEXT NOT NULL,
  "run_id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "field" TEXT NOT NULL,
  "old_value" TEXT,
  "new_value" TEXT,
  "confidence" DOUBLE PRECISION,
  "provider" TEXT NOT NULL,
  "provider_ref" TEXT,
  "evidence_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "enrichment_results_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "embeddings" (
  "id" TEXT NOT NULL,
  "contact_id" TEXT NOT NULL,
  "kind" "EmbeddingKind" NOT NULL,
  "vector" vector,
  "text" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "embeddings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "audit_logs" (
  "id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "action" TEXT NOT NULL,
  "entity_type" TEXT,
  "entity_id" TEXT,
  "meta_json" JSONB,
  "ip" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "users_email_key" ON "users"("email");

CREATE INDEX "idx_companies_name" ON "companies"("name");
CREATE INDEX "idx_contacts_full_name" ON "contacts"("full_name");
CREATE INDEX "idx_contacts_company_id" ON "contacts"("current_company_id");
CREATE INDEX "idx_contact_methods_value" ON "contact_methods"("value");
CREATE INDEX "idx_contact_methods_contact_id" ON "contact_methods"("contact_id");
CREATE INDEX "idx_enrichment_runs_created_by" ON "enrichment_runs"("created_by_user_id");
CREATE INDEX "idx_enrichment_results_run_id" ON "enrichment_results"("run_id");
CREATE INDEX "idx_enrichment_results_contact_id" ON "enrichment_results"("contact_id");
CREATE INDEX "idx_embeddings_contact_id" ON "embeddings"("contact_id");
CREATE INDEX "idx_audit_logs_action" ON "audit_logs"("action");
CREATE INDEX "idx_audit_logs_created_at" ON "audit_logs"("created_at");

CREATE INDEX "idx_contacts_full_name_trgm" ON "contacts" USING GIN ("full_name" gin_trgm_ops);
CREATE INDEX "idx_companies_name_trgm" ON "companies" USING GIN ("name" gin_trgm_ops);
CREATE INDEX "idx_contact_methods_value_trgm" ON "contact_methods" USING GIN ("value" gin_trgm_ops);

ALTER TABLE "contacts"
  ADD CONSTRAINT "contacts_current_company_id_fkey"
  FOREIGN KEY ("current_company_id") REFERENCES "companies"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "contact_methods"
  ADD CONSTRAINT "contact_methods_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_tags"
  ADD CONSTRAINT "contact_tags_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_tags"
  ADD CONSTRAINT "contact_tags_tag_id_fkey"
  FOREIGN KEY ("tag_id") REFERENCES "tags"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_events"
  ADD CONSTRAINT "contact_events_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contact_events"
  ADD CONSTRAINT "contact_events_event_id_fkey"
  FOREIGN KEY ("event_id") REFERENCES "events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "enrichment_runs"
  ADD CONSTRAINT "enrichment_runs_created_by_user_id_fkey"
  FOREIGN KEY ("created_by_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "enrichment_results"
  ADD CONSTRAINT "enrichment_results_run_id_fkey"
  FOREIGN KEY ("run_id") REFERENCES "enrichment_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "enrichment_results"
  ADD CONSTRAINT "enrichment_results_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "embeddings"
  ADD CONSTRAINT "embeddings_contact_id_fkey"
  FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "audit_logs"
  ADD CONSTRAINT "audit_logs_actor_user_id_fkey"
  FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
