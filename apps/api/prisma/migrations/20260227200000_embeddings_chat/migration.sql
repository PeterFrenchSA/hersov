CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE EXTENSION IF NOT EXISTS vector;

ALTER TABLE "embeddings"
  ADD COLUMN "model" TEXT NOT NULL DEFAULT 'legacy',
  ADD COLUMN "dims" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "hash" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

UPDATE "embeddings"
SET
  "model" = COALESCE(NULLIF("model", ''), 'legacy'),
  "dims" = COALESCE("dims", 0),
  "hash" = CASE WHEN "hash" = '' THEN md5(COALESCE("text", '')) ELSE "hash" END,
  "updated_at" = COALESCE("updated_at", "created_at");

WITH ranked AS (
  SELECT
    "id",
    ROW_NUMBER() OVER (
      PARTITION BY "contact_id", "kind"
      ORDER BY "updated_at" DESC, "created_at" DESC, "id" DESC
    ) AS rn
  FROM "embeddings"
)
DELETE FROM "embeddings" e
USING ranked r
WHERE e."id" = r."id"
  AND r.rn > 1;

DROP INDEX IF EXISTS "idx_embeddings_contact_id";

CREATE INDEX "idx_embeddings_contact_kind" ON "embeddings"("contact_id", "kind");
CREATE UNIQUE INDEX "uq_embeddings_contact_kind" ON "embeddings"("contact_id", "kind");
CREATE INDEX "idx_embeddings_vector_cosine"
  ON "embeddings"
  USING ivfflat (("vector"::vector(1536)) vector_cosine_ops)
  WITH (lists = 100)
  WHERE "vector" IS NOT NULL
    AND "dims" = 1536;

CREATE TYPE "ChatMessageRole" AS ENUM ('user', 'assistant', 'tool', 'system');

CREATE TABLE "chat_threads" (
  "id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "title" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_threads_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "chat_messages" (
  "id" TEXT NOT NULL,
  "thread_id" TEXT NOT NULL,
  "role" "ChatMessageRole" NOT NULL,
  "content_text" TEXT NOT NULL,
  "tool_name" TEXT,
  "tool_json" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "chat_messages_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "idx_chat_threads_user_updated_at" ON "chat_threads"("user_id", "updated_at");
CREATE INDEX "idx_chat_messages_thread_created_at" ON "chat_messages"("thread_id", "created_at");

ALTER TABLE "chat_threads"
  ADD CONSTRAINT "chat_threads_user_id_fkey"
  FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "chat_messages"
  ADD CONSTRAINT "chat_messages_thread_id_fkey"
  FOREIGN KEY ("thread_id") REFERENCES "chat_threads"("id") ON DELETE CASCADE ON UPDATE CASCADE;
