# Mini CRM + Enrichment + GPT Query (Self-Hosted) — SPEC

## 1. Purpose

Build a self-hosted “mini CRM” that can ingest a legacy contacts CSV (tens of thousands of rows), normalize and deduplicate it, enrich records via pluggable providers, and provide a GPT-powered interface to query the database in natural language.

The app must run reliably on an Ubuntu 24.04 VPS, behind HTTPS, with password-protected login, role-based access control, and a scripted deployment flow that pulls from a Git repo.

## 2. Non-Negotiable Constraints

- Runtime: Node.js (LTS) + TypeScript
- Database: PostgreSQL 16+
  - Must enable extensions: `vector` (pgvector) and `pg_trgm`
- Queue/Jobs: Redis + BullMQ (or equivalent)
- Backend: NestJS REST API (preferred) or Express (only if necessary)
- Frontend: Next.js (App Router)
- ORM: Prisma (preferred)
- Reverse proxy & HTTPS: Caddy (automatic Let’s Encrypt TLS)
- Auth: email+password login (bcrypt), secure session cookies
- Must be deployable on Ubuntu 24.04 via a single script: `scripts/deploy.sh`
- Must include Docker Compose production stack

## 3. High-Level Architecture

### Services (Docker Compose)
- `postgres` (Postgres 16)
- `redis` (Redis 7)
- `api` (NestJS)
- `worker` (BullMQ job worker)
- `web` (Next.js)
- `caddy` (reverse proxy + TLS termination)

### Networking
- Only Caddy exposes ports 80/443.
- All other containers are on an internal Docker network.

## 4. Core Features

### 4.1 Authentication & Security
- Login UI: `/login`
- Protected app pages require auth
- Session cookies:
  - `httpOnly`, `secure`, `sameSite=lax` (or stricter)
- Password hashing: bcrypt (>= 12 rounds)
- RBAC roles:
  - `Admin`
  - `Analyst`
  - `ReadOnly`
- Rate limiting:
  - Login endpoint is rate-limited
- Audit log:
  - Record logins, exports, enrichment runs, record edits
- CORS:
  - Strict, allow only `APP_BASE_URL`
- Headers:
  - Helmet or equivalent, plus HSTS set by Caddy

### 4.2 Contacts: CRUD, Search, Filters
- Contacts list: `/contacts`
- Contact detail: `/contacts/:id`
- Must support:
  - full-text search (name/company/notes)
  - fuzzy matching (pg_trgm)
  - filters:
    - country/city
    - tags (category + values)
    - company
    - title/role
    - missing key fields (email/linkedin/location)
    - last enriched date
  - sorting: last_updated, last_enriched, name

### 4.3 CSV Import + Normalization + Deduplication
Page: `/import`

Must include:
- CSV upload
- Column mapping wizard:
  - map fields to standard columns:
    - first_name, last_name, full_name
    - emails (multi)
    - phones (multi)
    - company
    - title
    - notes/context
    - city, country
- Normalization:
  - emails lowercased/trimmed
  - phone normalization toward E.164 when possible
  - split multi-email/phone fields into arrays
- Deduplication:
  - deterministic keys: email, phone, LinkedIn URL
  - optional fuzzy fallback: name + company + location (configurable threshold)
- Provenance:
  - store original row JSON (raw) and import batch reference
- Import should run as background job (queue), with progress UI.

### 4.4 Enrichment Framework (Pluggable Providers)
Page: `/enrichment`

Design an enrichment provider interface:
- Provider supports a subset of fields:
  - email, phone, linkedin, twitter, website, location, company, role
- Each enrichment run:
  - created from UI with selection/filter
  - queued as a background job
  - processes contacts in batches
  - respects provider rate limits and concurrency
- Storage rules:
  - Never overwrite fields blindly
  - Apply merge rules with confidence score
  - Record each field change in `enrichment_results`:
    - old_value, new_value, provider, confidence, timestamp, evidence URL if available
- Must ship with:
  - `mockProvider` for testing
  - at least one real-provider skeleton (Clearbit/Apollo style) that is *disabled by default* unless API key provided
- Provider keys:
  - read from env vars; do not hardcode
  - if stored in DB, must be encrypted at rest (optional but preferred)

### 4.5 Tags + Relationship Intelligence from Notes
- Parse the free-text `notes/context` into structured metadata:
  - tags (sector, investor type, meeting context, events)
  - extracted entities (companies, locations, people, events)
  - relationship strength score (heuristic + optional LLM)
- This should be optional and configurable (some users may not want LLM processing).
- Store:
  - tags with confidence and source
  - extracted entities in structured fields or JSON

### 4.6 Embeddings + Semantic Search
- Use pgvector to store embeddings for:
  - notes
  - profile summary
  - company data
- Provide:
  - endpoint to (re)generate embeddings for missing/outdated rows
  - semantic retrieval for GPT query mode

### 4.7 GPT-Powered Query Interface
Page: `/chat`

Goal: ask natural language questions and get structured results from the CRM.

Must:
- Implement `/api/chat` using OpenAI API
- Use tool/function calling with strict JSON schema tools:
  - `crm.searchContacts`
  - `crm.aggregateContacts`
  - `crm.getContactById`
- The LLM must not receive the entire database.
- The system should:
  1) parse the user request into query intent
  2) call tools that query SQL + optionally vector search
  3) return concise summaries + result lists
- Stream responses to UI via SSE.

## 5. Data Model (PostgreSQL / Prisma)

### Required tables (minimum)
- `users`:
  - id, email, password_hash, role, created_at, last_login_at
- `contacts`:
  - id, first_name, last_name, full_name
  - notes_raw
  - location_city, location_country
  - current_title
  - current_company_id (FK)
  - created_at, updated_at, last_enriched_at
- `contact_methods`:
  - id, contact_id
  - type: email|phone|website|linkedin|twitter|other
  - value, is_primary, verified_at, source
- `companies`:
  - id, name, domain, industry, hq_city, hq_country, size_range, linkedin_url
- `tags`:
  - id, name, category
- `contact_tags`:
  - contact_id, tag_id, confidence, source
- `events`:
  - id, name, year, location, type
- `contact_events`:
  - contact_id, event_id, context_note
- `enrichment_runs`:
  - id, status, started_at, finished_at, created_by_user_id, config_json, stats_json
- `enrichment_results`:
  - id, run_id, contact_id, field
  - old_value, new_value, confidence, provider, provider_ref, evidence_url, created_at
- `embeddings`:
  - id, contact_id, kind (notes|profile|company), vector, text, created_at
- `audit_logs`:
  - id, actor_user_id, action, entity_type, entity_id, meta_json, ip, created_at

### Postgres extensions
- `CREATE EXTENSION IF NOT EXISTS pg_trgm;`
- `CREATE EXTENSION IF NOT EXISTS vector;`

## 6. API Endpoints (Minimum)

### Auth
- `POST /api/auth/login`
- `POST /api/auth/logout`
- `GET /api/me`

### Health
- `GET /api/health` -> `{ status: "ok" }`

### Contacts
- `GET /api/contacts` (filters, pagination)
- `GET /api/contacts/:id`
- `PATCH /api/contacts/:id`

### Import
- `POST /api/import/csv` (multipart upload)
- `GET /api/import/:id/status`

### Enrichment
- `POST /api/enrichment/runs`
- `GET /api/enrichment/runs`
- `GET /api/enrichment/runs/:id`

### Chat
- `POST /api/chat` (SSE streaming)

## 7. UI Pages (Minimum)

- `/login`
- `/dashboard`
  - stats: contacts count, missing fields count, last enrichment runs
- `/contacts`
- `/contacts/:id`
  - profile, contact methods, tags, enrichment history timeline
- `/import`
  - upload + map columns + start job + progress
- `/enrichment`
  - create runs, view runs, progress
- `/chat`
  - GPT query interface
- `/admin/settings` (Admin only)
  - show provider config status (keys present/not present), manage users (optional MVP)

## 8. Deployment Contract (MANDATORY)

### 8.1 Required repo files
- `docker-compose.yml` (production ready)
- `Caddyfile` (production ready)
- `.env.example`
- `scripts/deploy.sh` (interactive deploy + update mode)
- `README.md` (fresh install + update + backups)
- `AGENTS.md` (Codex guidance)

### 8.2 Deploy script behavior (`scripts/deploy.sh`)
Must support:
- Interactive prompts (unless flags provided):
  - `--repo`, `--branch`, `--dir`, `--domain`, `--email`
- Installs prerequisites on Ubuntu 24.04:
  - git, curl, ufw, openssl, jq, ca-certificates
  - Docker Engine + Compose plugin
- Clones or updates repo:
  - if install dir exists: update mode prompt
- Creates `.env`:
  - prompts for domain, LE email, OpenAI key
  - generates secrets if blank
  - creates DB password if blank
  - optional bootstrap admin email/password
- Configures UFW:
  - allow OpenSSH, 80, 443
- Starts stack:
  - `docker compose build`
  - `docker compose up -d`
  - waits for Postgres health
  - runs `npx prisma migrate deploy` in `api`
- Bootstraps initial admin:
  - calls `node dist/scripts/bootstrap-admin.js`
  - should NOOP if env vars not set
- Installs systemd unit so service restarts on boot.

### 8.3 Bootstrap contract
The API image must contain:
- `dist/scripts/bootstrap-admin.js`

Behavior:
- If `BOOTSTRAP_ADMIN_EMAIL` or `BOOTSTRAP_ADMIN_PASSWORD` missing: exit 0
- If user exists: exit 0
- Else create admin user with bcrypt hash and role=Admin and log audit event

## 9. Testing Requirements
- Unit tests:
  - dedupe logic
  - enrichment merge rules
- Basic integration test:
  - auth login + protected route
  - search contacts endpoint responds with pagination

## 10. Repo Layout (Recommended)
Monorepo:
- `apps/web` (Next.js)
- `apps/api` (NestJS)
- `apps/worker` (BullMQ processor)
- `packages/shared` (types, zod schemas, helpers)

## 11. “Contract Files” Rule
Treat the following as contract files and do not rewrite them unless required for correctness:
- `docker-compose.yml`
- `Caddyfile`
- `scripts/deploy.sh`

If changes are necessary, explain why in commit message and keep changes minimal.

## 12. Environment Variables (Minimum)
- `APP_DOMAIN`
- `APP_BASE_URL`
- `LETSENCRYPT_EMAIL`
- `SESSION_SECRET`
- `ENCRYPTION_KEY`
- `OPENAI_API_KEY`
- `DATABASE_URL`
- `REDIS_URL`
- optional provider keys:
  - `APOLLO_API_KEY`, `CLEARBIT_API_KEY`, `PDL_API_KEY`, `ZEROBOUNCE_API_KEY`

---
End of SPEC.
