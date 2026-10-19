#!/usr/bin/env bash
# اجرای آزمون‌های SQL روی یک پایگاه‌داده‌ی موقت.
# استفاده:  PGHOST=127.0.0.1 PGPORT=5432 PGUSER=postgres ./db/tests/run.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
DB="bistoon_test_$$"
cleanup() { psql -v ON_ERROR_STOP=1 -q -d postgres -c "DROP DATABASE IF EXISTS $DB" >/dev/null 2>&1 || true; }
trap cleanup EXIT
psql -v ON_ERROR_STOP=1 -q -d postgres -c "CREATE DATABASE $DB"
for f in db/migrations/*.sql; do
  echo "migration: $f"
  psql -v ON_ERROR_STOP=1 -q -1 -d "$DB" -f "$f"
done
psql -v ON_ERROR_STOP=1 -q -d "$DB" -f db/tests/schema_test.sql
