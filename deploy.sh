#!/bin/bash
# MeteoMap — Deploy script for Proxmox / Docker host
# Usage: ./deploy.sh [--build-only]

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

# Load env vars
if [ -f .env ]; then
  export $(grep -v '^#' .env | xargs)
fi

if [ -z "${VITE_AEMET_API_KEY:-}" ]; then
  echo "ERROR: VITE_AEMET_API_KEY not set. Add it to .env or export it."
  exit 1
fi

echo "==> Building MeteoMap Docker image..."
docker compose build

if [ "${1:-}" = "--build-only" ]; then
  echo "==> Build complete (--build-only flag set)."
  exit 0
fi

echo "==> Stopping existing container (if any)..."
docker compose down 2>/dev/null || true

echo "==> Starting MeteoMap on port 8080..."
docker compose up -d

echo ""
echo "==> MeteoMap deployed! Access at http://$(hostname -I | awk '{print $1}'):8080"
echo "    Logs: docker compose logs -f meteomap"
