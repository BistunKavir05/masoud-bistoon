#!/usr/bin/env bash
# بررسی سلامت: برنامه بالا باشد و به پایگاه‌داده وصل شود.   ./healthcheck.sh [نشانی=http://127.0.0.1:3000]
set -euo pipefail
URL="${1:-http://127.0.0.1:${PORT:-3000}}"
body="$(curl -fsS --max-time 10 "$URL/api/health")"
[[ "$body" == *'"ok":true'* ]] || { echo "پاسخ نامنتظره: $body" >&2; exit 1; }
echo "سالم: $URL"
