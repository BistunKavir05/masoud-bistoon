#!/usr/bin/env bash
# به‌روزرسانی بیستون به نسخه‌ی جدید کد (که از قبل در پوشه‌ی نصب قرار گرفته: git pull یا بازکردن بایگانی).
#
#   بدون Docker (روی سرور، با دسترسی root/sudo):   sudo ./update.sh
#   Docker Compose:                                  ./update.sh --docker
#
# مراحل: پشتیبان‌گیری ← ساخت ← راه‌اندازی دوباره (migration خودکار هنگام بالاآمدن) ← بررسی سلامت.
# در صورت شکست بررسی سلامت، دستور بازگشت (restore) چاپ می‌شود؛ نسخه‌ی قبلی کد را با git برگردانید و فایل پشتیبان را بازیابی کنید.
set -euo pipefail

MODE=host
if [[ "${1:-}" == "--docker" ]]; then MODE=docker; shift; fi
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BACKUP_DIR="${BISTOON_BACKUP_DIR:-/var/backups/bistoon}"

if [[ "$MODE" == docker ]]; then
  BACKUP="$("$HERE/backup.sh" --docker "$BACKUP_DIR" | tail -n1)"
  echo "پشتیبان پیش از به‌روزرسانی: $BACKUP"
  docker compose -f "$HERE/../docker-compose.yml" up -d --build
  PORT_="$(docker compose -f "$HERE/../docker-compose.yml" port app 3000 | sed 's/.*://')"
  URL="http://127.0.0.1:${PORT_:-3000}"
else
  set -a; . /etc/bistoon/bistoon.env; set +a
  BACKUP="$("$HERE/backup.sh" "$BACKUP_DIR" | tail -n1)"
  echo "پشتیبان پیش از به‌روزرسانی: $BACKUP"
  (cd "$ROOT" && npm ci --no-audit --no-fund && npm run build -w @bistoon/web)
  systemctl restart bistoon
  URL="http://127.0.0.1:${PORT:-3000}"
fi

for i in $(seq 1 30); do
  if "$HERE/healthcheck.sh" "$URL" >/dev/null 2>&1; then
    echo "به‌روزرسانی انجام شد و برنامه سالم است."
    exit 0
  fi
  sleep 2
done
echo "هشدار: برنامه پس از به‌روزرسانی سالم نشد. گزارش را ببینید (journalctl -u bistoon  یا  docker compose logs app)." >&2
echo "بازگشت: نسخه‌ی قبلی کد را برگردانید و اجرا کنید:  $HERE/restore.sh $([[ $MODE == docker ]] && echo --docker) $BACKUP" >&2
exit 1
