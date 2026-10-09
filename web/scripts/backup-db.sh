#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/schedule-$TIMESTAMP.dump"
FILES_FILE="$BACKUP_DIR/schedule-$TIMESTAMP.files.tar"
CHECKSUM_FILE="$BACKUP_DIR/schedule-$TIMESTAMP.sha256"

cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "未找到 $PROJECT_DIR/.env，请先配置生产环境变量。" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

# 停止应用写入以获得一致的数据库+附件副本；完成或失败均恢复原运行状态。
APP_WAS_RUNNING=$(docker compose ps --status running -q app)
resume_app() { if [ -n "$APP_WAS_RUNNING" ]; then docker compose start app >/dev/null; fi; }
trap resume_app EXIT
trap 'exit 130' INT TERM
if [ -n "$APP_WAS_RUNNING" ]; then docker compose stop app >/dev/null; fi
docker compose run --rm --no-deps app node scripts/verify-task-files.mjs

echo "正在备份 PostgreSQL 到 $BACKUP_FILE"
docker compose exec -T db pg_dump \
  --username=schedule \
  --dbname=schedule \
  --format=custom \
  --no-owner \
  --no-privileges > "$BACKUP_FILE"

if [ ! -s "$BACKUP_FILE" ]; then
  rm -f -- "$BACKUP_FILE"
  echo "备份失败：生成的文件为空。" >&2
  exit 1
fi

docker compose run --rm --no-deps --user root -T app sh -c \
  'mkdir -p /app/data/task-files; tar -cf - -C /app/data/task-files .' > "$FILES_FILE"
if [ ! -s "$FILES_FILE" ]; then echo "附件备份为空，备份未完成。" >&2; exit 1; fi
(cd "$BACKUP_DIR" && sha256sum "$(basename "$BACKUP_FILE")" "$(basename "$FILES_FILE")") > "$CHECKSUM_FILE"

# 小规模项目保留最近 35 天的每日备份，覆盖最近 7 天和最近 4 周。
# 只清理项目固定 backups 目录下、符合本脚本命名规则的普通文件。
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'schedule-*.dump' -mtime +35 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'schedule-*.files.tar' -mtime +35 -delete
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'schedule-*.sha256' -mtime +35 -delete

echo "备份完成：$BACKUP_FILE"
echo "附件和校验清单：$FILES_FILE $CHECKSUM_FILE（须成套复制到服务器外）"
echo "请定期把备份复制到服务器之外。"
