# Mini CRM (PR #1 Skeleton)

PR #1 delivers a working deployable skeleton for Ubuntu 24.04 with:
- NestJS API (`apps/api`) + Prisma/PostgreSQL
- Next.js web app (`apps/web`)
- BullMQ worker baseline (`apps/worker`)
- Shared zod schemas/types (`packages/shared`)

Deferred to later PRs:
- CSV import pipeline
- Enrichment providers and runs implementation
- Embeddings generation pipeline
- GPT tool-calling chat implementation

## Tech choices

- Package manager: **npm workspaces**
- Runtime: Node.js LTS + TypeScript
- API: NestJS
- Web: Next.js App Router
- DB: PostgreSQL 16 + `pg_trgm` + `vector`
- Queue: Redis + BullMQ
- ORM: Prisma
- Reverse proxy/TLS: Caddy

## Repo layout

- `apps/api`: API, auth/session, contacts endpoints, Prisma schema/migrations, bootstrap admin script
- `apps/web`: login/dashboard/contacts UI
- `apps/worker`: Redis-connected idle worker on queue `default`
- `packages/shared`: zod input schemas and shared types

## Local development

1. Copy env file:
   - `cp .env.example .env`
2. Fill required values in `.env`:
   - `POSTGRES_PASSWORD`
   - `SESSION_SECRET`
   - `APP_DOMAIN` and `APP_BASE_URL` for your environment
3. Install dependencies:
   - `npm install`
4. Start infra services:
   - `docker compose up -d postgres redis`
5. Run migrations:
   - `docker compose run --rm api npx prisma migrate deploy`
6. Start apps locally (separate terminals):
   - `npm run start:dev --workspace @hersov/api`
   - `npm run dev --workspace @hersov/web`
   - `npm run start --workspace @hersov/worker`

## Production deploy (Ubuntu 24.04)

Use the deploy script:

```bash
sudo bash scripts/deploy.sh --repo <git-url> --branch main --dir /opt/mini-crm --domain <your-domain> --email <letsencrypt-email>
```

What it does:
- installs prerequisites (docker, compose plugin, ufw, etc.)
- clones or updates repo
- creates `.env` interactively if missing
- runs `docker compose build && docker compose up -d`
- runs Prisma deploy migration inside `api`
- runs bootstrap admin script inside `api`
- installs/enables systemd unit `mini-crm.service`

## `.env` location

- Production: `/opt/mini-crm/.env`
- Local: `<repo-root>/.env`

## Admin bootstrap

Set these in `.env` before deploy:
- `BOOTSTRAP_ADMIN_EMAIL`
- `BOOTSTRAP_ADMIN_PASSWORD`

Then deploy script calls:
- `node dist/scripts/bootstrap-admin.js`

Behavior:
- no-ops if either variable is missing
- no-ops if user already exists
- otherwise creates `Admin` user and writes an audit log

## Runtime checks

- Health endpoint: `https://<domain>/api/health`
- Login page: `https://<domain>/login`

## Logs and operations

- Tail all logs:
  - `docker compose logs -f --tail=200`
- API logs only:
  - `docker compose logs -f --tail=200 api`
- Restart stack:
  - `docker compose up -d`
- Restart systemd service:
  - `sudo systemctl restart mini-crm.service`

## Migrations

- Apply migrations in running stack:
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
- If TLS cert issuance fails:
  - verify domain DNS points to VPS
  - verify ports 80/443 open (`ufw status`)
  - inspect caddy logs: `docker compose logs -f caddy`
- If API migration/bootstrap fails:
  - `docker compose logs -f api`
  - rerun migration command manually
- If site does not start on reboot:
  - `sudo systemctl status mini-crm.service`
