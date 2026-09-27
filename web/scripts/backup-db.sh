#!/bin/sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_DIR="$PROJECT_DIR/backups"
TIMESTAMP=$(date -u +%Y%m%dT%H%M%SZ)
BACKUP_FILE="$BACKUP_DIR/schedule-$TIMESTAMP.dump"

cd "$PROJECT_DIR"

if [ ! -f .env ]; then
  echo "未找到 $PROJECT_DIR/.env，请先配置生产环境变量。" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"

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

# 小规模项目保留最近 35 天的每日备份，覆盖最近 7 天和最近 4 周。
# 只清理项目固定 backups 目录下、符合本脚本命名规则的普通文件。
find "$BACKUP_DIR" -maxdepth 1 -type f -name 'schedule-*.dump' -mtime +35 -delete

echo "备份完成：$BACKUP_FILE"
echo "请定期把备份复制到服务器之外。"
