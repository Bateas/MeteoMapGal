#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MeteoMapGal — Deploy Script
# ─────────────────────────────────────────────────────────────
# Builds locally, then rsync's dist + nginx config to server.
#
# Prerequisites:
#   1. SSH access to target server (key-based recommended)
#   2. deploy.env configured (see deploy.env.example)
#   3. .env with VITE_AEMET_API_KEY
#
# Usage:
#   ./deploy.sh              # Full build + deploy
#   ./deploy.sh --build-only # Build without deploying
#   ./deploy.sh --push-only  # Skip build, push existing dist/
# ─────────────────────────────────────────────────────────────

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# ── Load environment ─────────────────────────────────────────

if [ -f .env ]; then
  set -a
  source .env
  set +a
fi

if [ -f deploy.env ]; then
  set -a
  source deploy.env
  set +a
fi

# ── Validate config ──────────────────────────────────────────

DEPLOY_HOST="${DEPLOY_HOST:-}"
DEPLOY_USER="${DEPLOY_USER:-root}"
DEPLOY_PORT="${DEPLOY_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${DEPLOY_PORT}"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

REMOTE="${DEPLOY_USER}@${DEPLOY_HOST}"
REMOTE_WEB="/var/www/meteomapgal"
REMOTE_NGINX="/etc/nginx/sites-available/meteomap.conf"

# ── Helper functions ─────────────────────────────────────────

ssh_cmd() {
  ssh $SSH_OPTS "$REMOTE" "$@"
}

rsync_cmd() {
  local rsync_ssh="ssh $SSH_OPTS"
  rsync -azP --delete -e "$rsync_ssh" "$@"
}

check_lxc_connection() {
  if [ -z "$DEPLOY_HOST" ]; then
    echo "ERROR: DEPLOY_HOST not set."
    echo "  Create deploy.env from deploy.env.example:"
    echo "  cp deploy.env.example deploy.env"
    exit 1
  fi

  echo "==> Testing SSH connection to ${REMOTE}..."
  if ! ssh_cmd "echo ok" &>/dev/null; then
    echo "ERROR: Cannot SSH to ${REMOTE} on port ${DEPLOY_PORT}"
    echo ""
    echo "  Troubleshooting:"
    echo "  1. Check DEPLOY_HOST IP in deploy.env"
    echo "  2. Ensure SSH is running: systemctl status sshd"
    echo "  3. Copy your SSH key: ssh-copy-id -p ${DEPLOY_PORT} ${REMOTE}"
    exit 1
  fi
  echo "    ✓ SSH connection OK"
}

# ── Command: --setup ─────────────────────────────────────────

if [ "${1:-}" = "--setup" ]; then
  check_lxc_connection
  echo "==> Setting up server: ${REMOTE}..."
  exit 0
fi

# ── Step 1: Build ────────────────────────────────────────────

if [ "${1:-}" != "--push-only" ]; then
  if [ -z "${VITE_AEMET_API_KEY:-}" ]; then
    echo "ERROR: VITE_AEMET_API_KEY not set. Add it to .env"
    exit 1
  fi

  echo "══════════════════════════════════════════════════════════"
  echo "  MeteoMapGal — Build + Deploy"
  echo "══════════════════════════════════════════════════════════"
  echo ""

  echo "==> Installing dependencies..."
  npm ci --silent

  echo "==> Building production bundle..."
  npm run build

  echo "    ✓ Build complete ($(du -sh dist | awk '{print $1}'))"

  if [ "${1:-}" = "--build-only" ]; then
    echo ""
    echo "==> Build complete (--build-only). dist/ ready for deployment."
    exit 0
  fi
fi

# ── Step 2: Validate dist exists ─────────────────────────────

if [ ! -d "dist" ]; then
  echo "ERROR: dist/ not found. Run without --push-only first."
  exit 1
fi

# ── Step 3: Deploy to server ────────────────────────────────────

check_lxc_connection

echo ""
echo "==> Deploying to ${REMOTE}..."

# Push dist/ contents
echo "    Syncing dist/ → ${REMOTE_WEB}/"
rsync_cmd dist/ "${REMOTE}:${REMOTE_WEB}/"

# Push nginx config
echo "    Syncing nginx.conf → ${REMOTE_NGINX}"
scp $SSH_OPTS nginx.conf "${REMOTE}:${REMOTE_NGINX}"

# Ensure symlink exists + reload nginx
echo "    Reloading nginx..."
ssh_cmd "
  ln -sf ${REMOTE_NGINX} /etc/nginx/sites-enabled/meteomap.conf && \
  chown -R www-data:www-data ${REMOTE_WEB} && \
  nginx -t && \
  systemctl reload nginx
"

# ── Step 4: Verify ───────────────────────────────────────────

echo ""
echo "==> Verifying deployment..."
HTTP_STATUS=$(ssh_cmd "curl -s -o /dev/null -w '%{http_code}' http://localhost/")
if [ "$HTTP_STATUS" = "200" ]; then
  echo "    ✓ HTTP 200 OK"
else
  echo "    ⚠ HTTP ${HTTP_STATUS} — check nginx logs: journalctl -u nginx"
fi

# Quick proxy check (AEMET)
PROXY_STATUS=$(ssh_cmd "curl -s -o /dev/null -w '%{http_code}' http://localhost/aemet-api/api/valores/climatologicos/inventarioestaciones/todasestaciones" 2>/dev/null || echo "000")
if [ "$PROXY_STATUS" = "401" ] || [ "$PROXY_STATUS" = "200" ]; then
  echo "    ✓ AEMET proxy working (HTTP ${PROXY_STATUS})"
else
  echo "    ⚠ AEMET proxy returned HTTP ${PROXY_STATUS}"
fi

echo ""
echo "══════════════════════════════════════════════════════════"
echo "  ✓ MeteoMapGal deployed!"
echo ""
echo "  URL:  http://${DEPLOY_HOST}/"
echo "  Logs: ssh ${REMOTE} journalctl -u nginx -f"
echo "══════════════════════════════════════════════════════════"
