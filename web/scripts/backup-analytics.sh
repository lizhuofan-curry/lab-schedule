#!/bin/sh
set -eu
SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_DIR="$PROJECT_DIR/backups/analytics"
cd "$PROJECT_DIR"
umask 077
mkdir -p "$BACKUP_DIR"
STAMP=$(date -u +%Y%m%dT%H%M%SZ)
FILE="umami-$STAMP.dump"
docker compose -f compose.yaml -f compose.analytics.yaml exec -T umami-db \
  pg_dump -U umami -d umami --format=custom --no-owner --no-privileges > "$BACKUP_DIR/$FILE"
test -s "$BACKUP_DIR/$FILE"
(cd "$BACKUP_DIR" && sha256sum "$FILE" > "$FILE.sha256")
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'umami-*.dump' -mtime +35 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'umami-*.dump.sha256' -mtime +35 -delete
printf 'ANALYTICS_BACKUP_PASS=%s\n' "$FILE"
