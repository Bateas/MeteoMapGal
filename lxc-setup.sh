#!/bin/bash
# ─────────────────────────────────────────────────────────────
# MeteoMap — LXC Container Initial Setup (Debian 12)
# ─────────────────────────────────────────────────────────────
# Run this ONCE inside a fresh Debian 12 LXC container on Proxmox.
#
# Recommended LXC specs:
#   Template:  Debian 12 (bookworm)
#   Type:      Unprivileged
#   CPU:       1 core
#   RAM:       256 MB
#   Disk:      2 GB
#   Network:   Bridge (vmbr0), static IP
#
# From your Proxmox host:
#   pct exec <CTID> -- bash -s < lxc-setup.sh
#
# Or SSH into the LXC and run:
#   bash lxc-setup.sh
# ─────────────────────────────────────────────────────────────

set -euo pipefail

echo "══════════════════════════════════════════════════════════"
echo "  MeteoMap — LXC Setup (Debian 12)"
echo "══════════════════════════════════════════════════════════"

# ── 1. Update system ──────────────────────────────────────────
echo ""
echo "==> Updating system packages..."
apt-get update -qq
apt-get upgrade -y -qq

# ── 2. Install nginx + essentials ────────────────────────────
echo "==> Installing nginx, curl, openssh-server..."
apt-get install -y -qq nginx curl openssh-server ca-certificates

# Enable SSH (for deploy.sh rsync/scp access)
systemctl enable ssh
systemctl start ssh

# ── 3. Create web root ───────────────────────────────────────
echo "==> Creating /var/www/meteomap..."
mkdir -p /var/www/meteomap
chown -R www-data:www-data /var/www/meteomap

# ── 4. Deploy nginx config ──────────────────────────────────
echo "==> Installing nginx config..."

# Remove default site
rm -f /etc/nginx/sites-enabled/default

# The full meteomap.conf will be deployed by deploy.sh,
# but create a placeholder so nginx starts clean
cat > /etc/nginx/sites-available/meteomap.conf << 'NGINX_CONF'
server {
    listen 80;
    server_name _;
    root /var/www/meteomap;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
NGINX_CONF

ln -sf /etc/nginx/sites-available/meteomap.conf /etc/nginx/sites-enabled/meteomap.conf

# ── 5. Tune nginx for SPA + reverse proxy ────────────────────
# Increase proxy buffer size for large upstream responses (AEMET, WRF)
cat > /etc/nginx/conf.d/proxy-tuning.conf << 'PROXY_CONF'
# MeteoMap proxy tuning
proxy_buffer_size       16k;
proxy_buffers           8 32k;
proxy_busy_buffers_size 64k;

# DNS resolver for proxy_pass with variables (public DNS)
resolver 8.8.8.8 1.1.1.1 valid=300s;
resolver_timeout 5s;
PROXY_CONF

# ── 6. Enable & start nginx ──────────────────────────────────
echo "==> Enabling nginx..."
systemctl enable nginx
systemctl restart nginx

# ── 7. Install Cloudflare Tunnel (cloudflared) ────────────────
echo "==> Installing cloudflared..."
# Official Cloudflare package repository for Debian
mkdir -p /etc/apt/keyrings
curl -fsSL https://pkg.cloudflare.com/cloudflare-main.gpg \
    -o /etc/apt/keyrings/cloudflare-main.gpg

echo "deb [signed-by=/etc/apt/keyrings/cloudflare-main.gpg] https://pkg.cloudflare.com/cloudflared bookworm main" \
    > /etc/apt/sources.list.d/cloudflared.list

apt-get update -qq
apt-get install -y -qq cloudflared

echo "    ✓ cloudflared $(cloudflared --version 2>&1 | head -1)"

# ── 8. Verify ────────────────────────────────────────────────
echo ""
if systemctl is-active --quiet nginx; then
    echo "✓ nginx is running"
else
    echo "✗ nginx failed to start — check: journalctl -u nginx"
    exit 1
fi

IP=$(hostname -I | awk '{print $1}')
echo ""
echo "══════════════════════════════════════════════════════════"
echo "  LXC setup complete!"
echo ""
echo "  Services installed:"
echo "    ✓ nginx         (reverse proxy + static SPA)"
echo "    ✓ cloudflared   (Cloudflare Tunnel)"
echo "    ✓ openssh       (for deploy.sh access)"
echo ""
echo "  Next steps:"
echo ""
echo "  1. Deploy the app from your dev machine:"
echo "     ./deploy.sh  (or .\\deploy.ps1 on Windows)"
echo ""
echo "  2. Create a Cloudflare Tunnel:"
echo "     cloudflared tunnel login"
echo "     cloudflared tunnel create meteomap"
echo "     cloudflared tunnel route dns meteomap meteomap.tudominio.com"
echo ""
echo "  3. Configure the tunnel (create /etc/cloudflared/config.yml):"
echo '     tunnel: <TUNNEL_ID>'
echo '     credentials-file: /root/.cloudflared/<TUNNEL_ID>.json'
echo '     ingress:'
echo '       - hostname: meteomap.tudominio.com'
echo '         service: http://localhost:80'
echo '       - service: http_status:404'
echo ""
echo "  4. Run as service:"
echo "     cloudflared service install"
echo "     systemctl enable cloudflared"
echo "     systemctl start cloudflared"
echo ""
echo "  LXC IP (local): ${IP}"
echo "══════════════════════════════════════════════════════════"
