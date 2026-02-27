# Mini CRM (PR #4 Embeddings + Semantic Search + GPT Chat)

PR #4 extends the deployed CRM/import/enrichment baseline with embeddings storage/jobs, semantic search, and GPT chat with server-side tool calling + SSE streaming.

Implemented in this PR:
- Prisma migration updates for:
  - `embeddings` metadata (`model`, `dims`, `hash`, `updated_at`)
  - `chat_threads` and `chat_messages`
  - pgvector/trgm extension ensure + vector index
- worker embedding jobs:
  - `embeddings:upsertContact`
  - `embeddings:backfill`
- deterministic embedding text builder + hash-based staleness detection
- API endpoints:
  - `POST /api/embeddings/backfill`
  - `GET /api/embeddings/status`
  - `GET /api/search/semantic`
  - `POST /api/chat` (SSE)
- chat tool/function calling:
  - `crm.searchContacts`
  - `crm.aggregateContacts`
  - `crm.getContactById`
  - `crm.semanticSearch`
- data minimization controls in chat:
  - tool row caps (`default <=20`, hard max `50`)
  - sensitive field redaction by RBAC + explicit request intent
  - mass extraction refusal in chat
- UI updates:
  - `/chat` page with streamed responses and tool activity
  - `/contacts` semantic search mode
  - `/admin/settings` embeddings status + backfill controls

Deferred to later PRs:
- LLM parsing of notes/tags/entities
- browser automation scraping

## Tech choices

- Package manager: **npm workspaces**
- Runtime: Node.js LTS + TypeScript
- API: NestJS
- Web: Next.js App Router
- Worker: BullMQ + Redis
- DB: PostgreSQL 16 + `pg_trgm` + `vector`
- ORM: Prisma
- Reverse proxy/TLS: Caddy

## Repo layout

- `apps/api`: auth/session/RBAC, contacts/import/enrichment APIs, Prisma schema+migrations, bootstrap script
- `apps/web`: login/dashboard/contacts/import/enrichment/admin pages
- `apps/worker`: BullMQ worker with CSV import + enrichment processors
- `packages/shared`: shared zod schemas/types/constants

## Local development

1. Copy env file:
   - `cp .env.example .env`
2. Fill required values in `.env`:
   - `POSTGRES_PASSWORD`
   - `SESSION_SECRET`
   - `APP_DOMAIN` and `APP_BASE_URL`
3. Install dependencies:
   - `npm install`
4. Start infra:
   - `docker compose up -d postgres redis`
5. Run migrations:
   - `docker compose run --rm api npx prisma migrate deploy`
6. Start apps (separate terminals):
   - `npm run start:dev --workspace @hersov/api`
   - `npm run dev --workspace @hersov/web`
   - `npm run start --workspace @hersov/worker`

## Production deploy (Ubuntu 24.04)

```bash
sudo bash scripts/deploy.sh --repo <git-url> --branch main --dir /opt/mini-crm --domain <your-domain> --email <letsencrypt-email>
```

The deploy script:
- installs prerequisites
- clones/updates repo
- creates `.env` interactively (if missing)
- runs `docker compose build && docker compose up -d`
- runs Prisma migrations
- runs bootstrap admin script
- installs/enables `mini-crm.service`

## `.env` location

- Production: `/opt/mini-crm/.env`
- Local: `<repo-root>/.env`

## Import env vars

- `IMPORT_MAX_UPLOAD_MB` (default `50`)
- `IMPORT_STORE_RAW_ROWS` (`true|false`, default `false`)
- `IMPORT_FUZZY_THRESHOLD` (default `0.86`)
- `IMPORT_BATCH_WRITE_INTERVAL_ROWS` (default `250`)

## Enrichment env vars

Provider keys:
- `APOLLO_API_KEY` (required to enable `apollo` provider skeleton)

Provider rate limits:
- `ENRICHMENT_PROVIDER_MOCK_RPM` (default `600`)
- `ENRICHMENT_PROVIDER_MOCK_CONCURRENCY` (default `4`)
- `ENRICHMENT_PROVIDER_APOLLO_RPM` (default `120`)
- `ENRICHMENT_PROVIDER_APOLLO_CONCURRENCY` (default `2`)

Run/merge controls:
- `ENRICHMENT_OVERWRITE_CONFIDENCE_DELTA` (default `0.1`)
- `ENRICHMENT_BATCH_SIZE` (default `50`)
- `ENRICHMENT_BATCH_WRITE_INTERVAL_TARGETS` (default `100`)
- `ENRICHMENT_ERROR_SAMPLE_LIMIT` (default `25`)

## Embeddings + Chat env vars

- `OPENAI_API_KEY` (required for embeddings + chat)
- `OPENAI_EMBEDDING_MODEL` (default `text-embedding-3-small`)
- `OPENAI_CHAT_MODEL` (default `gpt-4.1-mini`)
- `EMBEDDINGS_BATCH_SIZE` (default `100`)
- `EMBEDDINGS_STALE_AFTER_DAYS` (default `30`)
- `CHAT_MAX_TOOL_CALLS` (default `6`, max `20`)
- `CHAT_MAX_RESULTS_PER_TOOL` (default `20`, hard max `50`)
- `CHAT_MAX_INPUT_CHARS` (default `4000`, max `12000`)

## Admin bootstrap

Set before deploy:
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Deploy calls:
- `node dist/scripts/bootstrap-admin.js`

Behavior:
- no-op if either variable is missing
- no-op if user already exists
- otherwise creates Admin user and audit log

## How to run CSV import

1. Log in to the app.
2. Open `/import`.
3. Upload a `.csv` file.
4. Map detected headers to canonical fields.
5. Configure email/phone delimiters and save mapping.
6. Start import.
7. Watch progress and counters update.
8. Review duplicate/error rows in results.

## How to run enrichment

1. Log in as Admin or Analyst.
2. Open `/enrichment/new`.
3. Select target contacts (filters and/or explicit IDs).
4. Select providers and merge policy.
5. Optionally set dry-run.
6. Create run.
7. Monitor `/enrichment/:id` for progress, counters, and field-level changes.

## How to run embeddings backfill

1. Log in as Admin or Analyst.
2. Open `/admin/settings`.
3. In **Embeddings**, configure filters (optional), then click **Queue Embeddings Backfill**.
4. Monitor worker logs and refresh `/admin/settings` for counts/staleness updates.

## How semantic search works

- Query text is embedded server-side via OpenAI Embeddings API.
- API runs pgvector cosine similarity against `embeddings.kind = profile`.
- Results return contact summary fields + bounded similarity score (`0..1`).
- UI integration: `/contacts` -> switch mode to **Semantic**.

## How chat works (tool calling + SSE)

- `/chat` calls `POST /api/chat` and receives `text/event-stream`.
- Backend runs a Responses API loop:
  1. model proposes tool calls
  2. server validates args (zod), executes SQL/vector tools, and returns structured outputs
  3. repeats until final answer
- Tool activity is emitted as SSE events and shown in UI.
- Chat is rate-limited per IP and per user.

Security notes:
- `OPENAI_API_KEY` is server-side only (never exposed to browser).
- Tool outputs are capped and redacted by default.
- Bulk/mass extraction requests are refused in chat; use export flows instead.

## Provider compliance note

Use provider APIs only under valid credentials and compliant terms of service. This project does not implement unauthorized scraping bypasses.

## Runtime checks

- Health endpoint: `https://<domain>/api/health`
- Login page: `https://<domain>/login`
- Import page: `https://<domain>/import`
- Enrichment page: `https://<domain>/enrichment`
- Chat page: `https://<domain>/chat`

## Quality checks

- `npm run lint`
- `npm run typecheck`
- `npm test`

## Logs and operations

- Tail all logs:
  - `docker compose logs -f --tail=200`
- API logs:
  - `docker compose logs -f --tail=200 api`
- Worker logs:
  - `docker compose logs -f --tail=200 worker`
- Restart stack:
  - `docker compose up -d`
- Restart service:
  - `sudo systemctl restart mini-crm.service`

## Migrations

- Apply migrations:
  - `docker compose exec -T api sh -lc "npx prisma migrate deploy"`

## Backup / restore (Postgres)

Backup:

```bash
docker compose exec -T postgres sh -lc 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB"' > backup.sql
```

Restore:

```bash
cat backup.sql | docker compose exec -T postgres sh -lc 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
```

## Troubleshooting

- Check service health:
  - `docker compose ps`
- Import stuck in `processing`:
  - check worker logs: `docker compose logs -f worker`
  - verify Redis is healthy: `docker compose ps redis`
- Enrichment run stuck in `processing`:
  - check worker logs for `enrichment:run`
  - confirm provider key/config in `/admin/settings`
- Enrichment provider disabled:
  - verify provider key env vars are set in `.env`
- TLS issues:
  - verify DNS points to VPS and ports 80/443 are open
  - inspect Caddy logs: `docker compose logs -f caddy`
