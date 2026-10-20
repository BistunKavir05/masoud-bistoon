#!/usr/bin/env bash
# آزمون نصب‌کننده‌ی یک‌دستوری (install.sh) روی Docker: نصب تازه ← ورود با گذرواژه‌ی موقت ← اجرای دوباره (بی‌اثر روی .env و کاربران).
# در CI اجرا می‌شود. روی نمونه‌ی آزمایشی بزنید: همه‌ی داده‌ی همان پروژه‌ی compose در پایان پاک می‌شود و deploy/.env حذف می‌شود!
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY="$(cd "$HERE/.." && pwd)"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bistoon-install}"
PORT="${SMOKE_INSTALL_PORT:-3010}"
C=(docker compose -f "$DEPLOY/docker-compose.yml")
URL="http://127.0.0.1:$PORT"

cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    "${C[@]}" ps -a || true
    "${C[@]}" logs --no-color --tail 60 || true
  fi
  "${C[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -f "$DEPLOY/.env"
  exit $status
}
trap cleanup EXIT

[[ ! -e "$DEPLOY/.env" ]] || { echo "deploy/.env از قبل وجود دارد؛ این آزمون آن را پاک می‌کند. ابتدا کنار بگذارید." >&2; trap - EXIT; exit 2; }

login_status() { # گذرواژه → کد HTTP
  curl -s -o /dev/null -w '%{http_code}' -X POST "$URL/api/auth/login" -H 'content-type: application/json' \
    -d "{\"username\":\"admin\",\"password\":\"$1\"}"
}

echo "── نصب تازه"
out1="$("$DEPLOY/install.sh" --bind 127.0.0.1 --port "$PORT")"
sed 's/^\(.*گذرواژه‌ی موقت: *\)[^ ]*/\1***/; s/^ADMIN_TEMP_PASSWORD=.*/ADMIN_TEMP_PASSWORD=***/' <<<"$out1"
pw="$(sed -n 's/^ADMIN_TEMP_PASSWORD=//p' <<<"$out1")"
[[ -n "$pw" ]] || { echo "گذرواژه‌ی موقت در خروجی نصب‌کننده نیست" >&2; exit 1; }
[[ "$(stat -c %a "$DEPLOY/.env")" == 600 ]] || { echo "دسترسی deploy/.env باید ۶۰۰ باشد" >&2; exit 1; }
[[ "$(login_status "$pw")" == 200 ]] || { echo "ورود با گذرواژه‌ی موقت شکست خورد" >&2; exit 1; }
[[ "$(login_status 'Wrong-pass-0000')" == 401 ]] || { echo "گذرواژه‌ی غلط باید ۴۰۱ بدهد" >&2; exit 1; }

echo "── اجرای دوباره (باید بی‌اثر باشد)"
sum1="$(sha1sum "$DEPLOY/.env")"
out2="$("$DEPLOY/install.sh" --bind 127.0.0.1 --port "$PORT")"
if grep -q 'ADMIN_TEMP_PASSWORD' <<<"$out2"; then echo "اجرای دوم نباید ادمین تازه بسازد" >&2; exit 1; fi
[[ "$(sha1sum "$DEPLOY/.env")" == "$sum1" ]] || { echo "اجرای دوم .env را عوض کرد" >&2; exit 1; }
[[ "$(login_status "$pw")" == 200 ]] || { echo "پس از اجرای دوم، ورود با همان گذرواژه شکست خورد" >&2; exit 1; }
"$HERE/healthcheck.sh" "$URL" >/dev/null

echo "آزمون نصب‌کننده موفق بود."
