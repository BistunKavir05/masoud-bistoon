#!/usr/bin/env bash
# آزمون دودی استقرار Docker Compose: ساخت تصویر ← بالاآمدن ← ساخت ادمین ← ورود ← پشتیبان‌گیری ← بازیابی ← ورود دوباره.
# در CI اجرا می‌شود و پس از نصب روی سرور هم می‌توان آن را روی یک نمونه‌ی آزمایشی اجرا کرد (همه‌ی داده‌ی همان نمونه پاک می‌شود!).
#   ./smoke-docker.sh
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$HERE/.."
export POSTGRES_PASSWORD="${POSTGRES_PASSWORD:-$(openssl rand -hex 16)}"
export BISTOON_PORT="${BISTOON_PORT:-3000}"
export COMPOSE_PROJECT_NAME="${COMPOSE_PROJECT_NAME:-bistoon-smoke}"
C=(docker compose -f docker-compose.yml)
URL="http://127.0.0.1:$BISTOON_PORT"
WORK="$(mktemp -d)"

cleanup() {
  status=$?
  if [[ $status -ne 0 ]]; then
    echo "::group::گزارش کانتینرها"
    "${C[@]}" ps -a || true
    "${C[@]}" logs --no-color --tail 80 || true
    echo "::endgroup::"
  fi
  "${C[@]}" down -v --remove-orphans >/dev/null 2>&1 || true
  rm -rf "$WORK"
  exit $status
}
trap cleanup EXIT

step() { echo "── $*"; }

step "ساخت و بالاآوردن"
"${C[@]}" up -d --build

step "انتظار برای سلامت برنامه"
ok=0
for _ in $(seq 1 60); do
  if "$HERE/healthcheck.sh" "$URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[[ $ok == 1 ]] || { echo "برنامه سالم نشد" >&2; exit 1; }

step "ساخت ادمین سیستم"
"${C[@]}" exec -T app node apps/api/src/cli.ts create-admin --username smoke --name "آزمون دود" --password 'Smoke-pass-12345'

login() {
  curl -fsS -X POST "$URL/api/auth/login" -H 'content-type: application/json' \
    -d '{"username":"smoke","password":"Smoke-pass-12345"}'
}

step "ورود"
out="$(login)"
[[ "$out" == *'"mustChangePassword":true'* ]] || { echo "پاسخ ورود نامنتظره: $out" >&2; exit 1; }

step "رابط کاربری و مسیر SPA"
curl -fsS "$URL/" | grep -q '<div id="root"' || { echo "index.html سرو نشد" >&2; exit 1; }
curl -fsS "$URL/p/1/tasks" | grep -q '<div id="root"' || { echo "بازگشت به index برای مسیرهای SPA کار نکرد" >&2; exit 1; }
# بدون ورود، مسیرهای API ابتدا ۴۰۱ می‌دهند (وجود مسیر را لو نمی‌دهند)؛ مهم این است که به index.html SPA برنگردند.
code="$(curl -s -o /dev/null -w '%{http_code}' "$URL/api/nope")"
[[ "$code" == 401 || "$code" == 404 ]] || { echo "مسیر ناموجود API باید ۴۰۱ یا ۴۰۴ بدهد، نه $code" >&2; exit 1; }
curl -s "$URL/api/nope" | grep -q '<div id="root"' && { echo "مسیر API به index.html بازگشت" >&2; exit 1; } || true

step "هدرهای امنیتی"
hdr="$(curl -fsSI "$URL/")"
for h in content-security-policy x-content-type-options x-frame-options; do
  grep -qi "^$h:" <<<"$hdr" || { echo "هدر $h وجود ندارد" >&2; exit 1; }
done

step "پشتیبان‌گیری"
dump="$("$HERE/backup.sh" --docker "$WORK" 30 | tail -n1)"
[[ -s "$dump" ]] || { echo "فایل پشتیبان خالی است" >&2; exit 1; }

step "حذف داده‌ی نمونه و بازیابی"
"${C[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -qc "TRUNCATE users CASCADE"'
"${C[@]}" stop app >/dev/null
"$HERE/restore.sh" --docker --yes "$dump" >/dev/null
"${C[@]}" start app >/dev/null
ok=0
for _ in $(seq 1 60); do
  if "$HERE/healthcheck.sh" "$URL" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
[[ $ok == 1 ]] || { echo "برنامه پس از بازیابی سالم نشد" >&2; exit 1; }

step "ورود پس از بازیابی"
out="$(login)"
[[ "$out" == *'"username":"smoke"'* ]] || { echo "ورود پس از بازیابی شکست خورد: $out" >&2; exit 1; }

echo "آزمون دودی استقرار Docker موفق بود."
