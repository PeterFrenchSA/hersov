#!/usr/bin/env bash
set -euo pipefail
cd /opt/mini-crm
sudo bash scripts/deploy.sh --repo "$(git remote get-url origin)" --branch main --dir /opt/mini-crm --domain "$(grep '^APP_DOMAIN=' .env | cut -d= -f2)" --email "$(grep '^LETSENCRYPT_EMAIL=' .env | cut -d= -f2)"
