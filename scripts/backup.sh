#!/usr/bin/env bash
# Daily SQLite backup with 30-day retention
set -euo pipefail
DB="${DB_PATH:-./data/ptx.db}"
DEST="${BACKUP_DIR:-./data/backups}"
mkdir -p "$DEST"
STAMP=$(date +%Y%m%d-%H%M%S)
sqlite3 "$DB" ".backup '$DEST/ptx-$STAMP.db'"
gzip "$DEST/ptx-$STAMP.db"
find "$DEST" -name 'ptx-*.db.gz' -mtime +30 -delete
echo "[backup] $DEST/ptx-$STAMP.db.gz"
