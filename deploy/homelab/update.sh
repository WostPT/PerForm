#!/usr/bin/env bash
# Puts the newest version from GitHub on the server and checks that the app answers.
# Usage (on the homelab):  ~/perform/deploy/homelab/update.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

echo "1/3 Fetching the newest version from GitHub..."
git pull --ff-only

echo "2/3 Building and restarting the containers..."
# --pull: fresh base images (Node, nginx), with their security fixes
docker compose build --pull
docker compose up -d

echo "3/3 Checking that the app answers..."
for i in $(seq 1 60); do
    if curl -fsS http://127.0.0.1:8091/api/health >/dev/null 2>&1; then
        echo "Ready: PerForm answers at $(grep '^ORIGIN=' .env | cut -d= -f2-)"
        docker image prune -f >/dev/null
        exit 0
    fi
    sleep 2
done
echo "ERROR: the app did not answer within 2 minutes. Last log lines:" >&2
docker compose logs --tail 40 >&2
exit 1
