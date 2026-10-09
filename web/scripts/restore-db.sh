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
FILES_FILE="${BACKUP_FILE%.dump}.files.tar"
CHECKSUM_FILE="${BACKUP_FILE%.dump}.sha256"
RESTORE_FILES=0

cd "$PROJECT_DIR"

if [ ! -f "$BACKUP_FILE" ]; then
  echo "找不到备份文件：$BACKUP_FILE" >&2
  exit 1
fi

if [ ! -f .env ]; then
  echo "未找到 $PROJECT_DIR/.env，请先配置生产环境变量。" >&2
  exit 1
fi

# v2备份必须成套；旧备份只有明确允许时才按v1数据库恢复，不覆盖附件卷。
if [ ! -f "$FILES_FILE" ] || [ ! -f "$CHECKSUM_FILE" ]; then
  if [ "${RESTORE_LEGACY_DB_ONLY:-}" != "1" ]; then
    echo "缺少附件或校验清单。v2须恢复整套备份；恢复旧v1备份需显式设置RESTORE_LEGACY_DB_ONLY=1。" >&2
    exit 1
  fi
else
  case "$(basename "$CHECKSUM_FILE")" in schedule-*.sha256|pre-restore-*.sha256) ;; *) echo "校验清单名称无效。" >&2; exit 1 ;; esac
  EXPECTED_DB=$(basename "$BACKUP_FILE")
  EXPECTED_FILES=$(basename "$FILES_FILE")
  if [ "$(wc -l < "$CHECKSUM_FILE" | tr -d ' ')" != "2" ] || ! awk -v a="$EXPECTED_DB" -v b="$EXPECTED_FILES" '{seen[$2]++} NF!=2 || length($1)!=64 || $1~/[^0-9a-f]/ || ($2!=a && $2!=b){bad=1} END{exit (bad || seen[a]!=1 || seen[b]!=1)}' "$CHECKSUM_FILE"; then
    echo "校验清单格式或成员无效。" >&2; exit 1
  fi
  (cd "$(dirname "$BACKUP_FILE")" && sha256sum -c "$(basename "$CHECKSUM_FILE")")
  if ! ARCHIVE_PATHS=$(tar -tf "$FILES_FILE"); then
    echo "附件归档已损坏，正式数据库未修改，请检查备份。" >&2; exit 1
  fi
  if ! printf '%s\n' "$ARCHIVE_PATHS" | awk '$0 != "./" && $0 !~ /^\.\/[a-f0-9-]{36}$/ {bad=1} END{exit bad}'; then
    echo "附件归档包含非法路径，已停止恢复。" >&2; exit 1
  fi
  if ! ARCHIVE_TYPES=$(tar -tvf "$FILES_FILE"); then
    echo "附件归档无法读取，正式数据库未修改，请检查备份。" >&2; exit 1
  fi
  if ! printf '%s\n' "$ARCHIVE_TYPES" | awk 'substr($0,1,1)!="-" && substr($0,1,1)!="d" {bad=1} END{exit bad}'; then
    echo "附件归档不允许链接或特殊文件，已停止恢复。" >&2; exit 1
  fi
  RESTORE_FILES=1
fi

PRE_RESTORE_DIR="$PROJECT_DIR/backups"
RESTORE_STAMP="$(date -u +%Y%m%dT%H%M%SZ)_$$"
PRE_RESTORE_FILE="$PRE_RESTORE_DIR/pre-restore-$RESTORE_STAMP.dump"
PREPARED_DUMP="$PRE_RESTORE_DIR/prepared-restore-$RESTORE_STAMP.dump"
STAGING_DB="schedule_restore_$RESTORE_STAMP"
STAGING_CREATED=0
mkdir -p "$PRE_RESTORE_DIR"

APP_WAS_RUNNING=$(docker compose ps --status running -q app)
restart_app() {
  if [ -z "$APP_WAS_RUNNING" ]; then return 0; fi
  if ! docker compose start app >/dev/null; then
    echo "应用启动失败，请检查Compose日志后手动启动并验证健康；恢复不能判定成功。" >&2
    return 1
  fi
  APP_CONTAINER=$(docker compose ps -q app) || return 1
  if [ -z "$APP_CONTAINER" ]; then echo "应用容器不存在，请检查Compose配置。" >&2; return 1; fi
  ATTEMPT=0
  while [ "$ATTEMPT" -lt 45 ]; do
    APP_HEALTH=$(docker inspect --format '{{if .State.Running}}{{if .State.Health}}{{.State.Health.Status}}{{else}}missing-healthcheck{{end}}{{else}}stopped{{end}}' "$APP_CONTAINER") || return 1
    case "$APP_HEALTH" in
      healthy) return 0 ;;
      starting) ;;
      *) echo "应用健康检查失败（$APP_HEALTH），请检查日志及/api/health后重试；恢复不能判定成功。" >&2; return 1 ;;
    esac
    ATTEMPT=$((ATTEMPT + 1))
    sleep 2
  done
  echo "应用健康检查超时，请检查日志及/api/health；恢复不能判定成功。" >&2
  return 1
}
RESTORE_STARTED=0
RESTORE_DATA_READY=0
APP_STOPPED=0
restore_exit() {
  RESTORE_EXIT_CODE=$?
  trap - EXIT INT TERM
  if [ "$STAGING_CREATED" = "1" ]; then docker compose exec -T db dropdb --username=schedule "$STAGING_DB" >/dev/null 2>&1 || true; fi
  rm -f -- "$PREPARED_DUMP"
  if [ "$RESTORE_DATA_READY" = "1" ]; then
    echo "数据库和附件已恢复，但后续启动或清理失败。请检查应用状态；不要仅凭数据库恢复判定业务可用。" >&2
  elif [ "$RESTORE_STARTED" = "1" ]; then
    echo "恢复未完成，应用保持停止。请检查错误并使用恢复前副本重新恢复，验证通过后再启动应用。" >&2
  elif [ "$APP_STOPPED" = "1" ]; then
    if ! restart_app; then
      if [ "$RESTORE_EXIT_CODE" = "0" ]; then RESTORE_EXIT_CODE=1; fi
    fi
  fi
  exit "$RESTORE_EXIT_CODE"
}
trap restore_exit EXIT
trap 'exit 130' INT TERM

# 验证并升级隔离副本，旧快照不在正在使用的数据库内直接删除表或约束。
docker compose exec -T db createdb --username=schedule "$STAGING_DB"
STAGING_CREATED=1
docker compose exec -T db pg_restore --username=schedule --dbname="$STAGING_DB" --no-owner --no-privileges --exit-on-error < "$BACKUP_FILE"
if [ "$RESTORE_FILES" = "1" ]; then
  docker compose run --rm --no-deps -T -e "RESTORE_DATABASE=$STAGING_DB" app node scripts/prepare-restore.mjs --files < "$FILES_FILE"
else
  docker compose run --rm --no-deps -T -e "RESTORE_DATABASE=$STAGING_DB" app node scripts/prepare-restore.mjs --legacy
fi
docker compose exec -T db pg_dump --username=schedule --dbname="$STAGING_DB" --format=custom --no-owner --no-privileges > "$PREPARED_DUMP"
if [ ! -s "$PREPARED_DUMP" ]; then echo "临时恢复库导出失败，正式数据库未修改。" >&2; exit 1; fi
APP_STOPPED=1
docker compose stop app

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
docker compose run --rm --no-deps --user root -T app sh -c \
  'mkdir -p /app/data/task-files; tar -cf - -C /app/data/task-files .' > "${PRE_RESTORE_FILE%.dump}.files.tar"
(cd "$PRE_RESTORE_DIR" && sha256sum "$(basename "$PRE_RESTORE_FILE")" "$(basename "${PRE_RESTORE_FILE%.dump}.files.tar")" > "${PRE_RESTORE_FILE%.dump}.sha256")

echo "停止应用连接并恢复数据库"
RESTORE_STARTED=1
docker compose exec -T db pg_restore \
  --username=schedule \
  --dbname=schedule \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges --exit-on-error < "$PREPARED_DUMP"

if [ "$RESTORE_FILES" = "1" ]; then
  # 仅覆盖备份内的UUID文件，保留卷内其他文件，不递归删除数据。
  docker compose run --rm --no-deps --user root -T app sh -c \
    'mkdir -p /app/data/task-files; tar -xf - -C /app/data/task-files; chown -R 1001:1001 /app/data/task-files' < "$FILES_FILE"
  docker compose run --rm --no-deps app node scripts/verify-task-files.mjs
fi

RESTORE_DATA_READY=1
restart_app
docker compose exec -T db dropdb --username=schedule "$STAGING_DB"
STAGING_CREATED=0
rm -f -- "$PREPARED_DUMP"
trap - EXIT INT TERM

if [ -n "$APP_WAS_RUNNING" ]; then
  echo "恢复完成，应用健康检查通过。仍须验证登录、课表、任务历史、消息和附件实际下载。"
else
  echo "数据库和附件恢复完成，应用按原状态保持停止；启动后须验证健康、登录及业务。"
fi
