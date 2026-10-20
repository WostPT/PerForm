#!/usr/bin/env bash
# Daily backup: a .tar.gz of /data/perform/dados into /data/perform/copias (the newest 14 are
# kept), then the same folder to Google Drive with rclone (remote "gdrive", folder "Copias PerForm").
# Usage: runs by itself from perform-backup.timer; by hand: ~/perform/deploy/homelab/backup.sh
set -uo pipefail
DATA=/data/perform/dados
OUT=/data/perform/copias
mkdir -p "$OUT"
name="perform-$(date +%Y-%m-%d_%H%M).tar.gz"
if ! tar czf "$OUT/$name.part" -C "$DATA" .; then
    echo "ERROR: the backup archive could not be written." >&2
    rm -f "$OUT/$name.part"
    exit 1
fi
mv "$OUT/$name.part" "$OUT/$name"
echo "Backup written: $OUT/$name"
ls -1t "$OUT"/perform-*.tar.gz | tail -n +15 | xargs -r rm -f
rclone sync "$OUT" "gdrive:Copias PerForm" --checksum --max-delete 30 --exclude "*.part" --log-level NOTICE
