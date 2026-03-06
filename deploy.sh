#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MeteoMapGal — Deploy to LXC Container on Proxmox
# ─────────────────────────────────────────────────────────────
# Builds locally, then rsync's dist + nginx config to LXC.
#
# Prerequisites:
#   1. LXC container created & lxc-setup.sh executed
#   2. SSH access to LXC (key-based recommended)
#   3. deploy.env configured (see deploy.env.example)
#   4. .env with VITE_AEMET_API_KEY
#
# Usage:
#   ./deploy.sh              # Full build + deploy
#   ./deploy.sh --build-only # Build without deploying
#   ./deploy.sh --push-only  # Skip build, push existing dist/
#   ./deploy.sh --setup      # Run lxc-setup.sh on remote LXC
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

LXC_HOST="${LXC_HOST:-}"
LXC_USER="${LXC_USER:-root}"
LXC_PORT="${LXC_PORT:-22}"
SSH_KEY="${SSH_KEY:-}"

SSH_OPTS="-o StrictHostKeyChecking=no -o ConnectTimeout=10 -p ${LXC_PORT}"
if [ -n "$SSH_KEY" ]; then
  SSH_OPTS="$SSH_OPTS -i $SSH_KEY"
fi

REMOTE="${LXC_USER}@${LXC_HOST}"
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
  if [ -z "$LXC_HOST" ]; then
    echo "ERROR: LXC_HOST not set."
    echo "  Create deploy.env from deploy.env.example:"
    echo "  cp deploy.env.example deploy.env"
    exit 1
  fi

  echo "==> Testing SSH connection to ${REMOTE}..."
  if ! ssh_cmd "echo ok" &>/dev/null; then
    echo "ERROR: Cannot SSH to ${REMOTE} on port ${LXC_PORT}"
    echo ""
    echo "  Troubleshooting:"
    echo "  1. Check LXC_HOST IP in deploy.env"
    echo "  2. Ensure SSH is running: pct exec <CTID> -- systemctl status sshd"
    echo "  3. Copy your SSH key: ssh-copy-id -p ${LXC_PORT} ${REMOTE}"
    exit 1
  fi
  echo "    ✓ SSH connection OK"
}

# ── Command: --setup ─────────────────────────────────────────

if [ "${1:-}" = "--setup" ]; then
  check_lxc_connection
  echo "==> Running lxc-setup.sh on ${REMOTE}..."
  ssh_cmd "bash -s" < lxc-setup.sh
  exit 0
fi

# ── Step 1: Build ────────────────────────────────────────────

if [ "${1:-}" != "--push-only" ]; then
  if [ -z "${VITE_AEMET_API_KEY:-}" ]; then
    echo "ERROR: VITE_AEMET_API_KEY not set. Add it to .env"
    exit 1
  fi

  echo "══════════════════════════════════════════════════════════"
  echo "  MeteoMapGal — Build + Deploy to LXC"
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

# ── Step 3: Deploy to LXC ────────────────────────────────────

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
echo "  ✓ MeteoMapGal deployed to LXC!"
echo ""
echo "  URL:  http://${LXC_HOST}/"
echo "  Logs: ssh ${REMOTE} journalctl -u nginx -f"
echo "══════════════════════════════════════════════════════════"
