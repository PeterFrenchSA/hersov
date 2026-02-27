# Mini CRM (PR #2 Import Pipeline)

PR #2 extends the deployed skeleton with a full CSV import workflow:
- CSV upload (`/api/import/csv`)
- header mapping + delimiter config (`/api/import/:batchId/mapping`)
- background import processing via BullMQ (`import:process`)
- progress/status polling (`/api/import/:batchId/status`)
- results view (`/api/import/:batchId/results`)
- UI flow at `/import`

Deferred to later PRs:
- external enrichment providers
- LLM parsing of notes/tags
- embeddings generation and GPT query/chat

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

- `apps/api`: auth/session/RBAC, contacts API, import API, Prisma schema/migrations, bootstrap script
- `apps/web`: login/dashboard/contacts/import UI
- `apps/worker`: BullMQ worker including CSV import processor
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

## How to run an import

1. Log in to the app.
2. Open `/import`.
3. Upload a `.csv` file.
4. Map detected headers to canonical fields.
5. Configure email/phone delimiters and save mapping.
6. Start import.
7. Watch progress and counters update.
8. Review duplicate/error rows in results.

## Runtime checks

- Health endpoint: `https://<domain>/api/health`
- Login page: `https://<domain>/login`
- Import page: `https://<domain>/import`

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
- Import fails immediately:
  - verify mapping was saved before start
  - inspect batch errors from `/api/import/:batchId/results?outcome=error`
- Upload rejected:
  - verify file extension is `.csv`
  - increase `IMPORT_MAX_UPLOAD_MB` if needed
- TLS issues:
  - verify DNS points to VPS and ports 80/443 are open
  - inspect Caddy logs: `docker compose logs -f caddy`
