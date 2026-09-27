#!/bin/sh
set -eu

if [ "$#" -ne 1 ]; then
  echo "用法：RESTORE_CONFIRM=RESTORE_SCHEDULE sh scripts/restore-db.sh backups/schedule-时间.dump" >&2
  exit 1
fi

if [ "${RESTORE_CONFIRM:-}" != "RESTORE_SCHEDULE" ]; then
  echo "恢复会覆盖当前数据库。确认后请设置 RESTORE_CONFIRM=RESTORE_SCHEDULE。" >&2
  exit 1
fi

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
PROJECT_DIR=$(dirname "$SCRIPT_DIR")
BACKUP_FILE=$1

cd "$PROJECT_DIR"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "找不到备份文件：$BACKUP_FILE" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "未找到 $PROJECT_DIR/.env，请先配置生产环境变量。" >&2
  exit 1
fi

PRE_RESTORE_DIR="$PROJECT_DIR/backups"
PRE_RESTORE_FILE="$PRE_RESTORE_DIR/pre-restore-$(date -u +%Y%m%dT%H%M%SZ).dump"
mkdir -p "$PRE_RESTORE_DIR"

echo "恢复前先备份当前数据库到 $PRE_RESTORE_FILE"
docker compose exec -T db pg_dump \
  --username=schedule \
  --dbname=schedule \
  --format=custom \
  --no-owner \
  --no-privileges > "$PRE_RESTORE_FILE"

if [ ! -s "$PRE_RESTORE_FILE" ]; then
  rm -f -- "$PRE_RESTORE_FILE"
  echo "恢复前备份失败，已停止恢复。" >&2
  exit 1
fi

echo "停止应用连接并恢复数据库"
docker compose stop app

restart_app() {
  docker compose up -d app caddy >/dev/null 2>&1 || true
}
trap restart_app EXIT INT TERM

docker compose exec -T db pg_restore \
  --username=schedule \
  --dbname=schedule \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges < "$BACKUP_FILE"

docker compose up -d app caddy
trap - EXIT INT TERM

echo "恢复完成。请立即检查 /api/health、登录、成员课表和注册统计。"
