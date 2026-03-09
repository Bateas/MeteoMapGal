#!/bin/bash
# ──────────────────────────────────────────────────────────
# GoAccess setup for MeteoMapGal (LXC 305)
#
# Real-time web analytics dashboard — no cookies, no JS,
# no GDPR consent needed. Reads nginx access logs directly.
#
# Run on LXC 305:
#   curl -sL https://raw.githubusercontent.com/Bateas/MeteoMapGal/master/scripts/setup-goaccess.sh | bash
#
# Or copy and paste into the LXC console.
# ──────────────────────────────────────────────────────────

set -euo pipefail

echo "── Installing GoAccess ──"
apt-get update -qq
apt-get install -y -qq goaccess

echo "── Creating GoAccess config ──"
cat > /etc/goaccess/meteomapgal.conf << 'CONF'
# GoAccess config for MeteoMapGal
# nginx combined log format (default)
log-format COMBINED
time-format %H:%M:%S
date-format %d/%b/%Y

# Exclude API proxy paths (internal, noisy)
exclude-ip 127.0.0.1
ignore-panel REFERRING_SITES
ignore-panel KEYPHRASES

# Real-time HTML output
real-time-html true
ws-url wss://meteomapgal.navia3d.com/goaccess
port 7890
CONF

echo "── Creating systemd service ──"
cat > /etc/systemd/system/goaccess.service << 'SERVICE'
[Unit]
Description=GoAccess Real-Time Web Analytics
After=nginx.service

[Service]
Type=simple
ExecStart=/usr/bin/goaccess /var/log/nginx/access.log \
  -o /var/www/meteomapgal/stats.html \
  --log-format=COMBINED \
  --real-time-html \
  --ws-url=wss://meteomapgal.navia3d.com/goaccess \
  --port=7890 \
  --no-query-string
Restart=on-failure
RestartSec=10

[Install]
WantedBy=multi-user.target
SERVICE

echo "── Enabling and starting GoAccess ──"
systemctl daemon-reload
systemctl enable goaccess
systemctl start goaccess

echo ""
echo "✅ GoAccess installed and running!"
echo ""
echo "📊 Dashboard: https://meteomapgal.navia3d.com/stats.html"
echo ""
echo "⚠️  Para que funcione el WebSocket real-time, añade esto a nginx.conf:"
echo ""
echo '    location /goaccess {'
echo '        proxy_pass http://127.0.0.1:7890;'
echo '        proxy_http_version 1.1;'
echo '        proxy_set_header Upgrade $http_upgrade;'
echo '        proxy_set_header Connection "upgrade";'
echo '    }'
echo ""
echo "   Después: nginx -t && systemctl reload nginx"
echo ""
echo "   Si no quieres el WebSocket (refresco manual), GoAccess"
echo "   igualmente regenera stats.html cada vez que accedes."
echo ""

# Generate initial report from existing logs
if [ -f /var/log/nginx/access.log ]; then
    echo "── Generating initial report from existing logs ──"
    goaccess /var/log/nginx/access.log \
      -o /var/www/meteomapgal/stats.html \
      --log-format=COMBINED \
      --no-query-string 2>/dev/null || true
    echo "✅ Initial report generated at /var/www/meteomapgal/stats.html"
fi
