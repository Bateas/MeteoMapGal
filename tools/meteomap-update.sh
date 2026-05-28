#!/bin/bash
#
# meteomap-update — smart deploy script for LXC 305 (App).
#
# Detects which parts of the repo changed since last pull and only runs
# the steps that are actually needed. Reduces typical deploy from
# ~60-90s to ~5-15s when only the ingestor changed (no rebuild, no npm
# install). Always safe — when in doubt it does the heavier path.
#
# Install (one-time, on LXC 305):
#     sudo cp /opt/MeteoMapGal/scripts/meteomap-update.sh /usr/local/bin/meteomap-update
#     sudo chmod +x /usr/local/bin/meteomap-update
#
# Usage:
#     meteomap-update            # smart deploy: git pull + build only what changed
#     meteomap-update --force    # rebuild + redeploy the current frontend even if
#                                # git is already up to date (use after a manual
#                                # pull left "nothing to deploy", or to re-push)
#
# What it does NOT handle (manual on LXC 306 / nginx):
#   - schema.sql changes      → run psql on DB LXC 306
#   - nginx.conf changes      → cp + nginx -t + reload, manually
# It WARNS at the end if either of those changed.

set -euo pipefail

REPO=/opt/MeteoMapGal
WWW=/var/www/meteomapgal

cd "$REPO"

# ── Parse args ────────────────────────────────────────
FORCE=false
for arg in "$@"; do
  case "$arg" in
    --force|-f) FORCE=true ;;
  esac
done

# ── Save current state ────────────────────────────────
OLD_HEAD=$(git rev-parse HEAD)
OLD_VERSION=$(grep -oE '"version": "[^"]+"' package.json | head -1 | cut -d'"' -f4)

# ── Discard local lockfile drift before pull ──────────
# LXC regenerates lockfiles on npm install — they always diverge from
# what CI / dev produces, but the content is equivalent. Discarding
# avoids "local changes would be overwritten by merge".
git checkout -- package-lock.json ingestor/package-lock.json ingestor/package.json 2>/dev/null || true

# ── Pull ──────────────────────────────────────────────
echo "🔽 git pull origin master..."
git pull origin master --quiet

NEW_HEAD=$(git rev-parse HEAD)
NEW_VERSION=$(grep -oE '"version": "[^"]+"' package.json | head -1 | cut -d'"' -f4)

if [ "$OLD_HEAD" = "$NEW_HEAD" ]; then
    if [ "$FORCE" = false ]; then
        echo "✅ Already up to date (HEAD $OLD_HEAD). Nothing to deploy."
        echo "   (meteomap-update --force → rebuild + redeploy the current frontend anyway)"
        exit 0
    fi
    echo "⚙️  Up to date, but --force given → rebuilding + redeploying frontend."
fi

# ── Detect what changed ───────────────────────────────
CHANGED=$(git diff --name-only "$OLD_HEAD" "$NEW_HEAD")
echo "── Changed files ──"
echo "$CHANGED" | sed 's/^/  /'
echo

has_change() { echo "$CHANGED" | grep -qE "$1"; }

ROOT_PKG_CHANGED=false;     has_change '^package\.json$|^package-lock\.json$' && ROOT_PKG_CHANGED=true
INGESTOR_PKG_CHANGED=false; has_change '^ingestor/package\.json$|^ingestor/package-lock\.json$' && INGESTOR_PKG_CHANGED=true
FRONTEND_CHANGED=false;     has_change '^src/|^public/|^index\.html$|^widget\.html$|^vite\.config|^tailwind|^tsconfig|^postcss' && FRONTEND_CHANGED=true
INGESTOR_CHANGED=false;     has_change '^ingestor/' && INGESTOR_CHANGED=true
SCHEMA_CHANGED=false;       has_change '^ingestor/schema\.sql$' && SCHEMA_CHANGED=true
NGINX_CHANGED=false;        has_change '^nginx\.conf$' && NGINX_CHANGED=true
VERSION_BUMPED=false;       [ "$OLD_VERSION" != "$NEW_VERSION" ] && VERSION_BUMPED=true

# --force: rebuild + redeploy the frontend regardless of the git diff (covers
# "a manual pull left nothing to deploy" + plain re-push of the current bundle).
# Frontend-only: does NOT npm-install or restart services.
if [ "$FORCE" = true ]; then FRONTEND_CHANGED=true; VERSION_BUMPED=true; fi

echo "── Plan ──"
echo "  ROOT_PKG_CHANGED      = $ROOT_PKG_CHANGED"
echo "  INGESTOR_PKG_CHANGED  = $INGESTOR_PKG_CHANGED"
echo "  FRONTEND_CHANGED      = $FRONTEND_CHANGED"
echo "  INGESTOR_CHANGED      = $INGESTOR_CHANGED"
echo "  VERSION_BUMPED        = $VERSION_BUMPED ($OLD_VERSION → $NEW_VERSION)"
echo

# ── npm install (only if package.json changed) ────────
# .npmrc enforces ignore-scripts=true (supply-chain hardening: a
# trojanized dep cannot run code via postinstall on this prod box).
# esbuild (postinstall: platform binary) + sharp (ingestor, install:
# libvips) are the ONLY legit script-needing deps — re-run explicitly
# with the override. Without this, npm run build fails after any bump
# that reinstalls esbuild ("installed esbuild for another platform").
if [ "$ROOT_PKG_CHANGED" = true ]; then
    echo "📦 npm install (root)..."
    npm install --no-audit --no-fund
    npm rebuild esbuild --foreground-scripts --ignore-scripts=false
fi
if [ "$INGESTOR_PKG_CHANGED" = true ]; then
    echo "📦 npm install (ingestor)..."
    (cd ingestor && npm install --no-audit --no-fund && npm rebuild esbuild sharp --foreground-scripts --ignore-scripts=false)
fi

# ── Build frontend (if frontend changed OR version bumped) ─
# Version bump matters because the badge in the UI is read from
# package.json at BUILD-TIME via src/config/version.ts. Without rebuild
# the user sees the old version.
if [ "$FRONTEND_CHANGED" = true ] || [ "$VERSION_BUMPED" = true ]; then
    echo "🔨 Building frontend (Vite)..."
    rm -rf node_modules/.vite dist
    npm run build
    echo "📂 Copying dist → $WWW..."
    cp -r dist/* "$WWW/"
    # Purge orphaned hashed chunks from previous deploys. `cp` only ADDS files,
    # so old assets/<name>-<hash>.js pile up forever (80+ stale MeteoGuide /
    # stationDiscovery chunks seen S136+3+5). index.html only references the
    # current hashes → orphans are harmless, but they bloat the dir and turn any
    # `grep` verification into noise. Pure-bash mirror (rsync is NOT installed on
    # the LXC): remove any web asset whose name isn't in the fresh build. Scoped
    # to assets/ only — index.html / sw.js / fonts / icons at the root untouched.
    # Guarded so an empty build can never wipe the live dir.
    if [ -d dist/assets ] && [ -n "$(ls -A dist/assets 2>/dev/null)" ]; then
      for f in "$WWW"/assets/*; do
        [ -e "$f" ] || continue
        [ -e "dist/assets/$(basename "$f")" ] || rm -f "$f"
      done
      echo "🧹 Pruned orphaned asset chunks"
    fi
    echo "✅ Frontend deployed"
fi

# ── Restart services ──────────────────────────────────
if [ "$INGESTOR_CHANGED" = true ] || [ "$INGESTOR_PKG_CHANGED" = true ]; then
    echo "🔄 Restarting meteo-ingestor + meteo-api..."
    sudo systemctl restart meteo-ingestor meteo-api
fi

# ── Manual steps reminders ────────────────────────────
echo
if [ "$SCHEMA_CHANGED" = true ]; then
    echo "⚠️  ingestor/schema.sql cambió. Ejecuta MANUALMENTE en LXC 306 (DB):"
    echo "     cat $REPO/ingestor/schema.sql | ssh root@DB_LXC 'sudo -u postgres psql -d meteomapgal'"
    echo "   Schema es idempotente — re-ejecutarlo es seguro."
    echo
fi
if [ "$NGINX_CHANGED" = true ]; then
    echo "⚠️  nginx.conf cambió. Aplica manualmente:"
    echo "     sudo cp $REPO/nginx.conf /etc/nginx/sites-available/meteomapgal"
    echo "     sudo nginx -t && sudo systemctl reload nginx"
    echo
fi

echo "✅ Deploy complete: $OLD_VERSION → $NEW_VERSION"
echo "   Frontend hash: $(curl -s https://meteomapgal.navia3d.com/ 2>/dev/null | grep -oE 'main-[A-Za-z0-9_-]+\.js' || echo 'check manually')"
