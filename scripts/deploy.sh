#!/usr/bin/env bash
set -euo pipefail

# ========= helpers =========
log() { echo -e "\n\033[1;32m==>\033[0m $*"; }
warn(){ echo -e "\n\033[1;33m[!]\033[0m $*"; }
die() { echo -e "\n\033[1;31m[✗]\033[0m $*"; exit 1; }

need_root() {
  if [[ "${EUID}" -ne 0 ]]; then
    die "Run as root: sudo bash scripts/deploy.sh ..."
  fi
}

has() { command -v "$1" >/dev/null 2>&1; }

rand_hex() { openssl rand -hex "${1:-32}"; }
rand_b64() { openssl rand -base64 "${1:-32}" | tr -d '\n'; }

prompt() {
  local var_name="$1" msg="$2" default="${3:-}"
  local input=""
  if [[ -n "$default" ]]; then
    read -r -p "$msg [$default]: " input
    input="${input:-$default}"
  else
    read -r -p "$msg: " input
  fi
  printf -v "$var_name" "%s" "$input"
}

prompt_secret() {
  local var_name="$1" msg="$2" default="${3:-}"
  local input=""
  if [[ -n "$default" ]]; then
    read -r -s -p "$msg [$default]: " input; echo
    input="${input:-$default}"
  else
    read -r -s -p "$msg: " input; echo
  fi
  printf -v "$var_name" "%s" "$input"
}

usage() {
  cat <<EOF
Usage:
  sudo bash scripts/deploy.sh [--repo URL] [--branch main] [--dir /opt/mini-crm] [--domain crm.example.com] [--email admin@example.com]

If flags omitted, script prompts interactively.
EOF
}

# ========= parse args =========
REPO_URL=""
BRANCH="main"
INSTALL_DIR="/opt/mini-crm"
APP_DOMAIN=""
LE_EMAIL=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --repo) REPO_URL="$2"; shift 2;;
    --branch) BRANCH="$2"; shift 2;;
    --dir) INSTALL_DIR="$2"; shift 2;;
    --domain) APP_DOMAIN="$2"; shift 2;;
    --email) LE_EMAIL="$2"; shift 2;;
    -h|--help) usage; exit 0;;
    *) die "Unknown arg: $1";;
  esac
done

need_root

# ========= prereqs =========
log "Installing prerequisites (git, curl, ufw, openssl, jq, ca-certificates)..."
apt-get update -y
apt-get install -y git curl ufw openssl jq ca-certificates wget

if ! has docker; then
  log "Installing Docker Engine + Compose plugin..."
  # official convenience script
  curl -fsSL https://get.docker.com | sh
  systemctl enable --now docker
fi

# Ensure compose plugin exists
if ! docker compose version >/dev/null 2>&1; then
  die "Docker Compose plugin not found. Reinstall docker or install docker-compose-plugin."
fi

# ========= config prompts =========
if [[ -z "$REPO_URL" ]]; then
  prompt REPO_URL "Git repo URL (https://... or git@...)" ""
fi

if [[ -z "$APP_DOMAIN" ]]; then
  prompt APP_DOMAIN "Domain (e.g. crm.example.com)" ""
fi

if [[ -z "$LE_EMAIL" ]]; then
  prompt LE_EMAIL "Let's Encrypt email (for TLS cert registration)" ""
fi

log "Repo: $REPO_URL"
log "Branch: $BRANCH"
log "Install dir: $INSTALL_DIR"
log "Domain: $APP_DOMAIN"

# ========= clone or update =========
if [[ -d "$INSTALL_DIR/.git" ]]; then
  warn "Existing install detected in $INSTALL_DIR"
  prompt DO_UPDATE "Update existing install? (y/n)" "y"
  if [[ "$DO_UPDATE" =~ ^[Yy]$ ]]; then
    log "Updating repo..."
    cd "$INSTALL_DIR"
    git fetch --all --prune
    git reset --hard "origin/$BRANCH"
  else
    die "Aborted by user."
  fi
else
  log "Cloning repo..."
  mkdir -p "$INSTALL_DIR"
  git clone --branch "$BRANCH" "$REPO_URL" "$INSTALL_DIR"
  cd "$INSTALL_DIR"
fi

# ========= env file =========
ENV_FILE="$INSTALL_DIR/.env"
if [[ -f "$ENV_FILE" ]]; then
  warn ".env already exists at $ENV_FILE"
  prompt KEEP_ENV "Keep existing .env? (y/n)" "y"
else
  KEEP_ENV="n"
fi

if [[ ! "$KEEP_ENV" =~ ^[Yy]$ ]]; then
  log "Creating .env..."
  # Generate defaults
  GEN_DB_PASS="$(rand_hex 16)"
  GEN_SESSION_SECRET="$(rand_b64 48)"
  GEN_ENC_KEY="$(rand_hex 32)"

  prompt_secret OPENAI_API_KEY "OpenAI API key" ""
  prompt_secret POSTGRES_PASSWORD "Postgres password (leave blank to auto-generate)" ""
  if [[ -z "$POSTGRES_PASSWORD" ]]; then
    POSTGRES_PASSWORD="$GEN_DB_PASS"
  fi

  prompt_secret SESSION_SECRET "Session secret (leave blank to auto-generate)" ""
  if [[ -z "$SESSION_SECRET" ]]; then
    SESSION_SECRET="$GEN_SESSION_SECRET"
  fi

  prompt_secret ENCRYPTION_KEY "Encryption key (leave blank to auto-generate; 32 bytes hex recommended)" ""
  if [[ -z "$ENCRYPTION_KEY" ]]; then
    ENCRYPTION_KEY="$GEN_ENC_KEY"
  fi

  # Optional: initial admin bootstrap
  prompt ADMIN_EMAIL "Initial admin email (optional, can create later)" ""
  ADMIN_PASSWORD=""
  if [[ -n "$ADMIN_EMAIL" ]]; then
    prompt_secret ADMIN_PASSWORD "Initial admin password" ""
  fi

  cat > "$ENV_FILE" <<EOF
APP_DOMAIN=$APP_DOMAIN
APP_BASE_URL=https://$APP_DOMAIN
LETSENCRYPT_EMAIL=$LE_EMAIL

SESSION_SECRET=$SESSION_SECRET
ENCRYPTION_KEY=$ENCRYPTION_KEY
OPENAI_API_KEY=$OPENAI_API_KEY

POSTGRES_DB=minicrm
POSTGRES_USER=minicrm
POSTGRES_PASSWORD=$POSTGRES_PASSWORD
DATABASE_URL=postgresql://minicrm:$POSTGRES_PASSWORD@postgres:5432/minicrm?schema=public

REDIS_URL=redis://redis:6379

# Optional providers
APOLLO_API_KEY=
CLEARBIT_API_KEY=
PDL_API_KEY=
ZEROBOUNCE_API_KEY=

# Optional bootstrap
BOOTSTRAP_ADMIN_EMAIL=$ADMIN_EMAIL
BOOTSTRAP_ADMIN_PASSWORD=$ADMIN_PASSWORD
EOF
fi

# ========= firewall =========
log "Configuring UFW firewall (allow SSH/80/443)..."
ufw allow OpenSSH >/dev/null || true
ufw allow 80/tcp >/dev/null || true
ufw allow 443/tcp >/dev/null || true
ufw --force enable >/dev/null || true

# ========= start stack =========
log "Pulling/building and starting containers..."
cd "$INSTALL_DIR"
docker compose pull || true
docker compose build
docker compose up -d

# ========= migrations =========
log "Running database migrations (Prisma migrate deploy)..."
docker compose exec -T api sh -lc "npx prisma migrate deploy"

# ========= bootstrap admin (optional) =========
# This expects Codex to provide apps/api/scripts/bootstrap-admin.js in the built image OR a Nest command.
# We'll call a Node script in the container; it should NO-OP if env vars are empty.
log "Bootstrapping initial admin (if BOOTSTRAP_ADMIN_EMAIL is set)..."
docker compose exec -T api sh -lc "node dist/scripts/bootstrap-admin.js || true"

# ========= systemd =========
SERVICE_FILE="/etc/systemd/system/mini-crm.service"
log "Installing systemd unit at $SERVICE_FILE ..."

cat > "$SERVICE_FILE" <<EOF
[Unit]
Description=mini-crm stack (docker compose)
Requires=docker.service
After=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=$INSTALL_DIR
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down
TimeoutStartSec=0

[Install]
WantedBy=multi-user.target
EOF

systemctl daemon-reload
systemctl enable --now mini-crm.service

# ========= verification =========
log "Done."
echo "-------------------------------------------"
echo "App URL:        https://$APP_DOMAIN"
echo "Health check:   https://$APP_DOMAIN/api/health"
echo "Install dir:    $INSTALL_DIR"
echo "Env file:       $ENV_FILE"
echo ""
echo "Update later:   sudo bash $INSTALL_DIR/scripts/deploy.sh --repo $REPO_URL --branch $BRANCH --dir $INSTALL_DIR --domain $APP_DOMAIN --email $LE_EMAIL"
echo "Logs:           docker compose logs -f --tail=200"
echo "-------------------------------------------"
