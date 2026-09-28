#!/bin/sh
set -eu

source_env="${1:?请提供源环境文件}"
app_url="${2:?请提供应用地址}"
app_domain="${3:-$app_url}"
target_env="${4:-.env}"

test -f "$source_env"
umask 077
cp "$source_env" "$target_env"

db_secret="$(openssl rand -hex 32)"
auth_secret="$(openssl rand -hex 32)"

sed -i \
  -e "s|^APP_DOMAIN=.*|APP_DOMAIN=$app_domain|" \
  -e "s|^APP_URL=.*|APP_URL=$app_url|" \
  -e "s|^BETTER_AUTH_TRUSTED_ORIGINS=.*|BETTER_AUTH_TRUSTED_ORIGINS=$app_url|" \
  -e "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$db_secret|" \
  -e "s|^BETTER_AUTH_SECRET=.*|BETTER_AUTH_SECRET=$auth_secret|" \
  "$target_env"

chmod 600 "$target_env"
rm -f "$source_env"

grep -q '^SCHEDULE_VISION_PROVIDER=qwen' "$target_env"
test -n "$(sed -n 's/^DASHSCOPE_API_KEY=//p' "$target_env")"
printf 'production-env-ready permissions=%s\n' "$(stat -c '%a' "$target_env")"
