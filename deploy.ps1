# ─────────────────────────────────────────────────────────────
# MeteoMap — Deploy Script (Windows/PowerShell)
# ─────────────────────────────────────────────────────────────
# Builds locally, then scp's dist + nginx config to server.
#
# Prerequisites:
#   1. SSH access to target server (key-based recommended)
#   2. SSH access to LXC (OpenSSH client on Windows 10+)
#   3. deploy.env configured (see deploy.env.example)
#   4. .env with VITE_AEMET_API_KEY
#
# Usage:
#   .\deploy.ps1              # Full build + deploy
#   .\deploy.ps1 -BuildOnly   # Build without deploying
#   .\deploy.ps1 -PushOnly    # Skip build, push existing dist/
#   .\deploy.ps1 -Setup       # Run remote server setup
# ─────────────────────────────────────────────────────────────

param(
    [switch]$BuildOnly,
    [switch]$PushOnly,
    [switch]$Setup
)

$ErrorActionPreference = "Stop"
$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
Set-Location $ScriptDir

# ── Load environment ─────────────────────────────────────────

function Load-EnvFile($path) {
    if (Test-Path $path) {
        Get-Content $path | ForEach-Object {
            $line = $_.Trim()
            if ($line -and -not $line.StartsWith('#')) {
                $parts = $line -split '=', 2
                if ($parts.Count -eq 2) {
                    [Environment]::SetEnvironmentVariable($parts[0].Trim(), $parts[1].Trim(), "Process")
                }
            }
        }
    }
}

Load-EnvFile ".env"
Load-EnvFile "deploy.env"

# ── Config ───────────────────────────────────────────────────

$DEPLOY_HOST = $env:DEPLOY_HOST
$DEPLOY_USER = if ($env:DEPLOY_USER) { $env:DEPLOY_USER } else { "root" }
$DEPLOY_PORT = if ($env:DEPLOY_PORT) { $env:DEPLOY_PORT } else { "22" }
$SSH_KEY  = $env:SSH_KEY

$REMOTE = "${DEPLOY_USER}@${DEPLOY_HOST}"
$REMOTE_WEB = "/var/www/meteomap"
$REMOTE_NGINX = "/etc/nginx/sites-available/meteomap.conf"

$SSH_OPTS = @("-o", "StrictHostKeyChecking=no", "-o", "ConnectTimeout=10", "-p", $DEPLOY_PORT)
if ($SSH_KEY) { $SSH_OPTS += @("-i", $SSH_KEY) }

function Invoke-SSH {
    param([string]$Command)
    & ssh @SSH_OPTS $REMOTE $Command
    if ($LASTEXITCODE -ne 0) { throw "SSH command failed: $Command" }
}

function Test-LXCConnection {
    if (-not $DEPLOY_HOST) {
        Write-Host "ERROR: DEPLOY_HOST not set." -ForegroundColor Red
        Write-Host "  Create deploy.env from deploy.env.example:"
        Write-Host "  copy deploy.env.example deploy.env"
        exit 1
    }

    Write-Host "==> Testing SSH connection to ${REMOTE}..." -ForegroundColor Cyan
    try {
        & ssh @SSH_OPTS $REMOTE "echo ok" 2>$null | Out-Null
        Write-Host "    ✓ SSH connection OK" -ForegroundColor Green
    } catch {
        Write-Host "ERROR: Cannot SSH to ${REMOTE} on port ${DEPLOY_PORT}" -ForegroundColor Red
        Write-Host ""
        Write-Host "  Troubleshooting:"
        Write-Host "  1. Check DEPLOY_HOST IP in deploy.env"
        Write-Host "  2. Ensure SSH is installed in LXC: apt install openssh-server"
        Write-Host "  3. Copy your SSH key: ssh-copy-id -p ${DEPLOY_PORT} ${REMOTE}"
        exit 1
    }
}

# ── Command: -Setup ──────────────────────────────────────────

if ($Setup) {
    Test-LXCConnection
    Write-Host "==> Running lxc-setup.sh on ${REMOTE}..." -ForegroundColor Cyan
    Get-Content "lxc-setup.sh" | & ssh @SSH_OPTS $REMOTE "bash -s"
    exit 0
}

# ── Step 1: Build ────────────────────────────────────────────

if (-not $PushOnly) {
    if (-not $env:VITE_AEMET_API_KEY) {
        Write-Host "ERROR: VITE_AEMET_API_KEY not set. Add it to .env" -ForegroundColor Red
        exit 1
    }

    Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host "  MeteoMap — Build + Deploy to LXC" -ForegroundColor Yellow
    Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Yellow
    Write-Host ""

    Write-Host "==> Installing dependencies..." -ForegroundColor Cyan
    npm ci --silent
    if ($LASTEXITCODE -ne 0) { throw "npm ci failed" }

    Write-Host "==> Building production bundle..." -ForegroundColor Cyan
    npm run build
    if ($LASTEXITCODE -ne 0) { throw "Build failed" }

    $size = "{0:N1} MB" -f ((Get-ChildItem -Recurse dist | Measure-Object Length -Sum).Sum / 1MB)
    Write-Host "    ✓ Build complete ($size)" -ForegroundColor Green

    if ($BuildOnly) {
        Write-Host ""
        Write-Host "==> Build complete (-BuildOnly). dist/ ready for deployment." -ForegroundColor Green
        exit 0
    }
}

# ── Step 2: Validate dist exists ─────────────────────────────

if (-not (Test-Path "dist")) {
    Write-Host "ERROR: dist/ not found. Run without -PushOnly first." -ForegroundColor Red
    exit 1
}

# ── Step 3: Deploy to LXC ────────────────────────────────────

Test-LXCConnection

Write-Host ""
Write-Host "==> Deploying to ${REMOTE}..." -ForegroundColor Cyan

# Push dist/ contents using scp recursive
Write-Host "    Syncing dist/ → ${REMOTE_WEB}/" -ForegroundColor Gray
# First clear old files, then copy new ones
Invoke-SSH "rm -rf ${REMOTE_WEB}/*"
& scp @SSH_OPTS -r dist/* "${REMOTE}:${REMOTE_WEB}/"
if ($LASTEXITCODE -ne 0) { throw "scp dist failed" }

# Push nginx config
Write-Host "    Syncing nginx.conf → ${REMOTE_NGINX}" -ForegroundColor Gray
& scp @SSH_OPTS nginx.conf "${REMOTE}:${REMOTE_NGINX}"
if ($LASTEXITCODE -ne 0) { throw "scp nginx.conf failed" }

# Reload nginx
Write-Host "    Reloading nginx..." -ForegroundColor Gray
Invoke-SSH "ln -sf ${REMOTE_NGINX} /etc/nginx/sites-enabled/meteomap.conf && chown -R www-data:www-data ${REMOTE_WEB} && nginx -t && systemctl reload nginx"

# ── Step 4: Verify ───────────────────────────────────────────

Write-Host ""
Write-Host "==> Verifying deployment..." -ForegroundColor Cyan

$httpStatus = & ssh @SSH_OPTS $REMOTE "curl -s -o /dev/null -w '%{http_code}' http://localhost/" 2>$null
if ($httpStatus -eq "200") {
    Write-Host "    ✓ HTTP 200 OK" -ForegroundColor Green
} else {
    Write-Host "    ⚠ HTTP ${httpStatus} — check: ssh ${REMOTE} journalctl -u nginx" -ForegroundColor Yellow
}

Write-Host ""
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Green
Write-Host "  ✓ MeteoMap deployed to LXC!" -ForegroundColor Green
Write-Host "" -ForegroundColor Green
Write-Host "  URL:  http://${DEPLOY_HOST}/" -ForegroundColor Green
Write-Host "  Logs: ssh ${REMOTE} journalctl -u nginx -f" -ForegroundColor Green
Write-Host "══════════════════════════════════════════════════════════" -ForegroundColor Green
