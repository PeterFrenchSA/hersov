#!/usr/bin/env bash
set -euo pipefail

BRANCH="${1:-main}"
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

log() {
  echo
  echo "==> $*"
}

if ! command -v docker >/dev/null 2>&1; then
  echo "docker is required" >&2
  exit 1
fi

cd "$REPO_DIR"

log "Stopping running services"
docker compose down --remove-orphans

log "Updating repository from origin/$BRANCH"
git fetch origin "$BRANCH"
git checkout "$BRANCH"
git reset --hard "origin/$BRANCH"

log "Rebuilding containers"
docker compose build

log "Starting services with existing .env"
docker compose up -d

log "Running Prisma migrations"
docker compose exec -T api sh -lc "npx prisma migrate deploy"

log "Bootstrapping admin if configured"
docker compose exec -T api sh -lc "node dist/scripts/bootstrap-admin.js || true"

log "Current service status"
docker compose ps

log "Health check"
docker compose exec -T api sh -lc "wget -qO- http://127.0.0.1:3001/api/health"
