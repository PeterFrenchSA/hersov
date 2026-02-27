# AGENTS.md — Codex Operating Rules

This repository builds a self-hosted mini CRM + enrichment + GPT query app.

## 1) Absolute constraints
- Language: TypeScript
- Runtime: Node.js (LTS)
- Backend: NestJS REST API (preferred)
- Frontend: Next.js (App Router)
- DB: PostgreSQL 16+ with `pg_trgm` and `vector` (pgvector) extensions
- Jobs/Queue: Redis + BullMQ
- ORM: Prisma
- Deployment: Docker Compose + Caddy for HTTPS
- Target host: Ubuntu 24.04 VPS

If any alternative tech is proposed, it must be clearly justified and must not break the deployment contract.

## 2) Contract files (do not rewrite)
Treat these files as *contracts*; only make minimal changes if required for correctness:
- `docker-compose.yml`
- `Caddyfile`
- `scripts/deploy.sh`
- `.env.example`

If a contract file must change, keep the diff minimal and explain why in the commit message.

## 3) Required repo outputs
Implement everything described in `SPEC.md`, including:
- Monorepo structure:
  - `apps/web` (Next.js)
  - `apps/api` (NestJS)
  - `apps/worker` (BullMQ worker)
  - `packages/shared` (shared types + zod schemas)
- `apps/api` must expose `GET /api/health`
- Auth:
  - email+password login
  - bcrypt hashing (>=12 rounds)
  - session cookie auth (`httpOnly`, `secure`, `sameSite=lax` or stricter)
  - RBAC roles: Admin / Analyst / ReadOnly
- Audit logging for login, exports, enrichment runs, edits
- CSV import with mapping wizard + normalization + dedupe
- Enrichment framework with provider interface + mock provider + 1 real provider skeleton (disabled unless key present)
- Embeddings pipeline using pgvector
- GPT chat endpoint using OpenAI tool-calling pattern and streaming (SSE)

## 4) Deployment contract requirements
The deployment flow must work end-to-end using `scripts/deploy.sh`:
- Must run on a fresh Ubuntu 24.04 server
- Must install prerequisites (docker, compose plugin, ufw, etc.)
- Must clone/update repo from a user-provided git URL
- Must create `.env` interactively if missing (or keep existing)
- Must `docker compose up -d`
- Must run: `npx prisma migrate deploy` inside `api`
- Must bootstrap initial admin user by calling:
  - `node dist/scripts/bootstrap-admin.js`
- Must install a `systemd` unit so stack starts on boot

**Important:** Ensure `apps/api` build produces `dist/scripts/bootstrap-admin.js` inside the API image and that it NOOPs if bootstrap env vars are not set.

## 5) OpenAI integration rules
- Use environment variable `OPENAI_API_KEY`
- Implement `/api/chat` with tool/function calling:
  - `crm.searchContacts`
  - `crm.aggregateContacts`
  - `crm.getContactById`
- Never send the whole database to the model
- Prefer retrieving records via SQL + optional vector similarity search
- Stream responses to the UI via SSE

## 6) Quality and testing
- Add input validation with zod (or class-validator if Nest, but prefer zod schemas in `packages/shared`)
- Add basic unit tests:
  - dedupe logic
  - enrichment merge rules
- Add a basic integration test:
  - login + access protected endpoint
  - search contacts with pagination
- Ensure linting and type checks pass in CI-like command:
  - `npm run lint`
  - `npm run typecheck`
  - `npm test`

## 7) Security baseline
- Use helmet (API)
- Strict CORS allowlist to `APP_BASE_URL`
- Rate-limit login route
- Store secrets only in env vars (preferred). If provider keys are stored in DB, encrypt them at rest using `ENCRYPTION_KEY`.

## 8) Documentation
Update `README.md` with:
- Fresh install steps (Ubuntu 24.04)
- Update steps (re-run deploy.sh)
- Backup/restore Postgres steps
- Troubleshooting (view logs, restart stack, renew TLS if needed)

## 9) Change discipline
- Work in small commits
- Prefer clarity over cleverness
- Keep the UI minimal but complete for required workflows
