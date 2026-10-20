#!/usr/bin/env bash
# پشتیبان‌گیری از پایگاه‌داده‌ی بیستون (pg_dump با قالب custom فشرده؛ شامل همه‌ی پروژه‌ها، کاربران، ممیزی و نشست‌ها).
#
#   حالت عادی (بدون Docker):  DATABASE_URL=postgres://... ./backup.sh [پوشه=./backups] [نگهداری_به_روز=30]
#   حالت Docker Compose:       ./backup.sh --docker [پوشه=./backups] [نگهداری_به_روز=30]
#
# خروجی: مسیر فایل ساخته‌شده در آخرین خط. فایل ابتدا با پسوند .partial نوشته و پس از وارسی (pg_restore --list) نام‌گذاری می‌شود.
# نکته: نسخه‌ی pg_dump روی سرور باید کمتر از نسخه‌ی PostgreSQL نباشد.
set -euo pipefail

MODE=host
if [[ "${1:-}" == "--docker" ]]; then MODE=docker; shift; fi
DIR="${1:-./backups}"
KEEP_DAYS="${2:-30}"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
COMPOSE=(docker compose -f "$HERE/../docker-compose.yml")

mkdir -p "$DIR"
STAMP="$(date +%Y%m%d-%H%M%S)"
OUT="$DIR/bistoon-$STAMP.dump"
TMP="$OUT.partial"
trap 'rm -f "$TMP"' EXIT

if [[ "$MODE" == docker ]]; then
  "${COMPOSE[@]}" exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc --no-owner' > "$TMP"
  "${COMPOSE[@]}" exec -T db pg_restore --list < "$TMP" > /dev/null
else
  : "${DATABASE_URL:?متغیر DATABASE_URL لازم است}"
  pg_dump --dbname="$DATABASE_URL" -Fc --no-owner > "$TMP"
  pg_restore --list "$TMP" > /dev/null
fi

mv "$TMP" "$OUT"
chmod 600 "$OUT"
trap - EXIT
# پشتیبان‌های قدیمی‌تر از مهلت حذف می‌شوند
find "$DIR" -maxdepth 1 -name 'bistoon-*.dump' -type f -mtime +"$KEEP_DAYS" -delete
echo "$OUT"
