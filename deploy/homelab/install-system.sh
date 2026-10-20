#!/usr/bin/env bash
# One-time preparation of the homelab for PerForm (with sudo):
#   sudo ~/perform/deploy/homelab/install-system.sh
# 1. creates the data folders on the data disk, owned by wost;
# 2. writes ~/perform/.env from env.homelab, with this server's Tailscale name filled in;
# 3. installs and starts the daily backup timer;
# 4. publishes PerForm with Tailscale Serve on HTTPS port 8443, only for the tailnet (never Funnel).
#    The existing Serve on port 443 is left exactly as it is.
set -euo pipefail
if [ "$(id -u)" -ne 0 ]; then
    echo "Run with sudo: sudo $0" >&2
    exit 1
fi
HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"

echo "== 1/4 Data folders under /data/perform..."
mkdir -p /data/perform/dados /data/perform/coach-auth /data/perform/copias
chown -R wost:wost /data/perform

echo "== 2/4 The .env file..."
HOST="$(tailscale status --json | python3 -c 'import json,sys; print(json.load(sys.stdin)["Self"]["DNSName"].rstrip("."))')"
if [ -f "$REPO/.env" ]; then
    echo "$REPO/.env already exists: left as it is."
else
    sed "s/HOST/$HOST/g" "$HERE/env.homelab" > "$REPO/.env"
    chown wost:wost "$REPO/.env"
    echo "Written, for https://$HOST:8443"
fi

echo "== 3/4 The daily backup timer..."
install -m 644 "$HERE"/perform-backup.service "$HERE"/perform-backup.timer /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now perform-backup.timer

echo "== 4/4 Tailscale Serve: HTTPS 8443 -> 127.0.0.1:8091 (tailnet only)..."
tailscale serve --bg --https=8443 http://127.0.0.1:8091
tailscale serve status

echo "Done. Check above that / on 443 still points at 127.0.0.1:8090 (the other app)."
