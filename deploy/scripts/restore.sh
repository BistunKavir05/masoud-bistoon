#!/usr/bin/env bash
# بازیابی پایگاه‌داده‌ی بیستون از یک فایل پشتیبان (ساخته‌شده با backup.sh). همه‌ی داده‌ی فعلی جایگزین می‌شود.
#
#   بدون Docker:   DATABASE_URL=postgres://... ./restore.sh [--yes] فایل.dump
#   Docker:        ./restore.sh --docker [--yes] فایل.dump
#
# پیش از اجرا برنامه را متوقف کنید (systemctl stop bistoon  یا  docker compose stop app) و پس از آن دوباره روشن کنید.
# بازیابی در «یک تراکنش» انجام می‌شود: اگر خطایی رخ دهد، پایگاه‌داده‌ی فعلی دست‌نخورده می‌ماند.
set -euo pipefail

MODE=host
YES=0
while [[ "${1:-}" == --* ]]; do
  case "$1" in
    --docker) MODE=docker ;;
    --yes) YES=1 ;;
    *) echo "گزینه‌ی ناشناخته: $1" >&2; exit 2 ;;
  esac
  shift
done
FILE="${1:?استفاده: restore.sh [--docker] [--yes] فایل.dump}"
[[ -f "$FILE" ]] || { echo "فایل پیدا نشد: $FILE" >&2; exit 2; }
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.yml")

if [[ "$YES" != 1 ]]; then
  echo "هشدار: همه‌ی داده‌ی فعلی بیستون با محتوای «$FILE» جایگزین می‌شود."
  read -r -p "برای ادامه کلمه‌ی RESTORE را تایپ کنید: " ans
  [[ "$ans" == RESTORE ]] || { echo "لغو شد."; exit 1; }
fi

if [[ "$MODE" == docker ]]; then
  "${COMPOSE[@]}" exec -T db pg_restore --list < "$FILE" > /dev/null
  "${COMPOSE[@]}" exec -T db sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists --no-owner --single-transaction --exit-on-error' < "$FILE"
else
  : "${DATABASE_URL:?متغیر DATABASE_URL لازم است}"
  pg_restore --list "$FILE" > /dev/null
  pg_restore --dbname="$DATABASE_URL" --clean --if-exists --no-owner --single-transaction --exit-on-error "$FILE"
fi
echo "بازیابی انجام شد. برنامه را دوباره راه‌اندازی کنید؛ migrationهای جدیدتر هنگام بالاآمدن خودکار اجرا می‌شود."
