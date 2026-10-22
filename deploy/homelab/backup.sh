#!/usr/bin/env bash
# Daily backup: a .tar.gz of /data/perform/dados into /data/perform/copias (the newest 14 are
# kept), then the same folder to Google Drive with rclone (remote "gdrive", folder "Copias PerForm").
# Usage: runs by itself from perform-backup.timer; by hand: ~/perform/deploy/homelab/backup.sh
set -uo pipefail
DATA=/data/perform/dados
OUT=/data/perform/copias
mkdir -p "$OUT"
name="perform-$(date +%Y-%m-%d_%H%M).tar.gz"
# With the Coach on Pro (coach-pro.sh) the api runs as root, and the files it writes then are
# root's and private (0600): a tar run as wost cannot read them. Docker can, and wost is in the
# docker group, so the archive is then written from a throwaway container instead.
in_docker() {
    docker run --rm -v "$DATA":/d:ro -v "$OUT":/o alpine:3 \
        sh -c "tar czf '/o/$name.part' -C /d . && chown $(id -u):$(id -g) '/o/$name.part'"
}
if ! tar czf "$OUT/$name.part" -C "$DATA" . 2>/dev/null && ! { rm -f "$OUT/$name.part"; in_docker; }; then
    echo "ERROR: the backup archive could not be written." >&2
    rm -f "$OUT/$name.part"
    exit 1
fi
mv "$OUT/$name.part" "$OUT/$name"
echo "Backup written: $OUT/$name"
ls -1t "$OUT"/perform-*.tar.gz | tail -n +15 | xargs -r rm -f
rclone sync "$OUT" "gdrive:Copias PerForm" --checksum --max-delete 30 --exclude "*.part" --log-level NOTICE
