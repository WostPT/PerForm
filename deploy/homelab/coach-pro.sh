#!/usr/bin/env bash
# Switches the AI Coach on a Claude subscription (Pro/Max) on or off, then rebuilds and restarts.
# Usage (on the homelab, no sudo):  ~/perform/deploy/homelab/coach-pro.sh on|off
#
#   on   builds the api image with Claude in it (API_TARGET=coach) and runs the api as root, so it
#        can start Claude as the locked-down `coach` user (compose.coach.yml). Then, in the app:
#        Settings -> Account -> Admin dashboard -> AI Coach -> "Claude (Anthropic)" -> Add CLI
#        token, with the token `claude setup-token` prints on your PC.
#   off  back to the plain image. For an Anthropic API key, which needs neither.
# The Coach's history is kept on the server per profile, whichever provider is used.
set -euo pipefail
cd "$(dirname "$0")/../.."
case "${1:-}" in on|off) ;; *) echo "Usage: $0 on|off" >&2; exit 1 ;; esac

LAYER=deploy/homelab/compose.coach.yml
files="$(grep '^COMPOSE_FILE=' .env | cut -d= -f2-)"
files="$(echo "$files" | tr ':' '\n' | grep -vx "$LAYER" | paste -sd: -)"
sed -i '/^API_TARGET=/d' .env
if [ "$1" = on ]; then
    files="$files:$LAYER"
    echo "API_TARGET=coach" >> .env
fi
sed -i "s|^COMPOSE_FILE=.*|COMPOSE_FILE=$files|" .env
echo "Coach on Pro: $1. Rebuilding (the first build with Claude in it takes a few minutes)."
exec deploy/homelab/update.sh
