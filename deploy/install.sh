#!/usr/bin/env bash
# نصب‌کننده‌ی یک‌دستوری بیستون با Docker Compose روی یک سرور لینوکسی.
#
#   روی سرور (Docker و git نصب باشد):
#     git clone https://github.com/BistunKavir05/masoud-bistoon.git /opt/bistoon && sudo /opt/bistoon/deploy/install.sh
#   یا بی‌نیاز از کلون دستی:
#     curl -fsSL https://raw.githubusercontent.com/BistunKavir05/masoud-bistoon/main/deploy/install.sh | sudo bash
#
# کارهایی که می‌کند: کد را می‌گیرد (اگر از داخل کلون اجرا نشده باشد) ← فایل deploy/.env را با گذرواژه‌ی تصادفی پایگاه‌داده
# می‌سازد ← تصویر را می‌سازد و برنامه را بالا می‌آورد ← منتظر سلامت می‌ماند ← اگر هنوز کاربری نیست، ادمین سیستم را با
# گذرواژه‌ی موقت تصادفی می‌سازد ← نشانی و گذرواژه را چاپ می‌کند.
# اجرای دوباره ایمن است: .env و کاربران موجود دست نمی‌خورند؛ فقط کد به‌روز و برنامه دوباره ساخته می‌شود.
#
# گزینه‌ها:
#   --dir /opt/bistoon      مسیر نصب کد (فقط وقتی از داخل کلون اجرا نمی‌شود)
#   --ref main              شاخه/برچسب گیت برای نصب
#   --port 3000             پورت برنامه روی سرور
#   --bind 0.0.0.0          نشانی انتشار (پیش‌فرض 0.0.0.0 برای سرور آزمایشی؛ پشت nginx: 127.0.0.1)
#   --https-proxy           پشت nginx با HTTPS: COOKIE_SECURE=true ، TRUST_PROXY=loopback ، انتشار فقط روی 127.0.0.1
#   --admin admin           نام کاربری ادمین سیستم
#   --repo URL              نشانی مخزن گیت
# گزینه‌های پورت/نشانی/https فقط هنگام «ساخت» .env اثر دارند؛ بعداً deploy/.env را مستقیم ویرایش کنید.
set -euo pipefail

DIR=/opt/bistoon
REF=main
PORT=3000
BIND=0.0.0.0
HTTPS_PROXY_MODE=0
ADMIN=admin
REPO=https://github.com/BistunKavir05/masoud-bistoon.git

usage() {
  cat <<'USAGE'
نصب‌کننده‌ی یک‌دستوری بیستون با Docker Compose (لینوکس؛ Docker + Compose v2 + git + openssl + curl).
استفاده:  sudo deploy/install.sh [گزینه‌ها]
  --dir /opt/bistoon   مسیر نصب کد (فقط وقتی از داخل کلون اجرا نمی‌شود)
  --ref main           شاخه/برچسب گیت
  --port 3000          پورت برنامه روی سرور
  --bind 0.0.0.0       نشانی انتشار (پشت nginx: 127.0.0.1)
  --https-proxy        پشت nginx با HTTPS: COOKIE_SECURE=true ، TRUST_PROXY=loopback ، فقط 127.0.0.1
  --admin admin        نام کاربری ادمین سیستم
  --repo URL           نشانی مخزن گیت
گزینه‌های پورت/نشانی/https فقط هنگام ساخت deploy/.env اثر دارند. اجرای دوباره ایمن است (.env و کاربران دست نمی‌خورند).
USAGE
}

die() { echo "خطا: $*" >&2; exit 1; }
step() { echo "── $*"; }

# همه‌ی منطق داخل یک تابع است تا با «curl … | bash» کل اسکریپت پیش از اجرا خوانده شود (دستورهایی که stdin می‌خوانند بقیه‌ی متن را نخورند).
main() {
while [[ $# -gt 0 ]]; do
  case "$1" in
    --dir) DIR="${2:?مقدار --dir لازم است}"; shift 2 ;;
    --ref) REF="${2:?مقدار --ref لازم است}"; shift 2 ;;
    --port) PORT="${2:?مقدار --port لازم است}"; shift 2 ;;
    --bind) BIND="${2:?مقدار --bind لازم است}"; shift 2 ;;
    --https-proxy) HTTPS_PROXY_MODE=1; shift ;;
    --admin) ADMIN="${2:?مقدار --admin لازم است}"; shift 2 ;;
    --repo) REPO="${2:?مقدار --repo لازم است}"; shift 2 ;;
    -h|--help) usage; exit 0 ;;
    *) die "گزینه‌ی ناشناخته: $1 (با --help راهنما را ببینید)" ;;
  esac
done
[[ "$PORT" =~ ^[0-9]+$ ]] && (( PORT >= 1 && PORT <= 65535 )) || die "پورت نامعتبر است: $PORT"
[[ "$ADMIN" =~ ^[A-Za-z0-9._-]{3,64}$ ]] || die "نام کاربری ادمین باید ۳ تا ۶۴ نویسه‌ی لاتین/رقم/نقطه/خط‌تیره/زیرخط باشد."

# ───────── پیش‌نیازها ─────────
command -v docker >/dev/null 2>&1 || die "Docker نصب نیست. نصب رسمی: https://docs.docker.com/engine/install/ (به Compose v2 هم نیاز است)."
docker compose version >/dev/null 2>&1 || die "«docker compose» (نسخه‌ی ۲) در دسترس نیست. افزونه‌ی Compose را نصب کنید."
docker info >/dev/null 2>&1 || die "به Docker وصل نمی‌شود. سرویس Docker روشن باشد و این اسکریپت با sudo یا کاربر عضو گروه docker اجرا شود."
command -v openssl >/dev/null 2>&1 || die "openssl لازم است (برای ساخت گذرواژه‌ی تصادفی)."
command -v curl >/dev/null 2>&1 || die "curl لازم است."

# ───────── کد ─────────
SELF_DIR=""
if [[ -n "${BASH_SOURCE[0]:-}" && -f "${BASH_SOURCE[0]}" ]]; then SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"; fi
if [[ -n "$SELF_DIR" && -f "$SELF_DIR/docker-compose.yml" ]]; then
  ROOT="$(cd "$SELF_DIR/.." && pwd)"
  step "استفاده از کد موجود در $ROOT"
else
  command -v git >/dev/null 2>&1 || die "git لازم است (یا کد را دستی در $DIR بگذارید و install.sh را از همان‌جا اجرا کنید)."
  ROOT="$DIR"
  if [[ -d "$ROOT/.git" ]]; then
    step "به‌روزرسانی کد در $ROOT"
    git -C "$ROOT" fetch --quiet origin "$REF"
    git -C "$ROOT" checkout --quiet "$REF"
    git -C "$ROOT" pull --quiet --ff-only origin "$REF"
  else
    [[ ! -e "$ROOT" || -z "$(ls -A "$ROOT" 2>/dev/null)" ]] || die "$ROOT از قبل وجود دارد و کلون گیت نیست."
    step "گرفتن کد در $ROOT"
    git clone --quiet --branch "$REF" "$REPO" "$ROOT"
  fi
fi
DEPLOY="$ROOT/deploy"
[[ -f "$DEPLOY/docker-compose.yml" ]] || die "فایل $DEPLOY/docker-compose.yml پیدا نشد."
C=(docker compose -f "$DEPLOY/docker-compose.yml")

# ───────── پیکربندی (.env) ─────────
ENVF="$DEPLOY/.env"
set_env() { # KEY VALUE  — مقدار موجود را عوض می‌کند یا خط تازه می‌افزاید
  if grep -q "^$1=" "$ENVF"; then sed -i "s|^$1=.*|$1=$2|" "$ENVF"; else printf '%s=%s\n' "$1" "$2" >> "$ENVF"; fi
}
if [[ -f "$ENVF" ]]; then
  step "فایل .env موجود است؛ همان استفاده می‌شود (گذرواژه‌ها و تنظیمات دست‌نخورده)"
else
  step "ساخت $ENVF"
  umask 077
  cp "$DEPLOY/.env.example" "$ENVF"
  set_env POSTGRES_PASSWORD "$(openssl rand -hex 24)"
  set_env BISTOON_PORT "$PORT"
  if [[ "$HTTPS_PROXY_MODE" == 1 ]]; then
    set_env BISTOON_BIND 127.0.0.1
    set_env COOKIE_SECURE true
    set_env TRUST_PROXY loopback
  else
    set_env BISTOON_BIND "$BIND"
    set_env COOKIE_SECURE false
  fi
  chmod 600 "$ENVF"
fi
get_env() { sed -n "s/^$1=//p" "$ENVF" | tail -n1; }
PORT_NOW="$(get_env BISTOON_PORT)"; PORT_NOW="${PORT_NOW:-3000}"
BIND_NOW="$(get_env BISTOON_BIND)"; BIND_NOW="${BIND_NOW:-127.0.0.1}"
SECURE_NOW="$(get_env COOKIE_SECURE)"; SECURE_NOW="${SECURE_NOW:-false}"

# ───────── ساخت و راه‌اندازی ─────────
step "ساخت تصویر و راه‌اندازی (بار اول چند دقیقه طول می‌کشد)"
"${C[@]}" up -d --build

step "انتظار برای سلامت برنامه"
ok=0
for _ in $(seq 1 90); do
  if "$DEPLOY/scripts/healthcheck.sh" "http://127.0.0.1:$PORT_NOW" >/dev/null 2>&1; then ok=1; break; fi
  sleep 2
done
if [[ "$ok" != 1 ]]; then
  "${C[@]}" ps -a >&2 || true
  "${C[@]}" logs --no-color --tail 60 app >&2 || true
  die "برنامه سالم نشد (گزارش بالا). بعد از رفع مشکل همین اسکریپت را دوباره اجرا کنید."
fi

# ───────── ادمین سیستم ─────────
USERS="$("${C[@]}" exec -T db sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -tAc "SELECT count(*) FROM users"' | tr -d '[:space:]')"
[[ "$USERS" =~ ^[0-9]+$ ]] || die "شمارش کاربران ممکن نشد: «$USERS»"
TEMP_PW=""
if [[ "$USERS" == 0 ]]; then
  step "ساخت ادمین سیستم «$ADMIN»"
  TEMP_PW="$(openssl rand -base64 24 | tr -d '/+=\n' | cut -c1-16)"
  ADMIN_PASSWORD="$TEMP_PW" "${C[@]}" exec -T -e ADMIN_PASSWORD app node apps/api/src/cli.ts create-admin --username "$ADMIN" --name "مدیر سیستم" >/dev/null
else
  step "کاربر از قبل وجود دارد ($USERS)؛ ادمین تازه ساخته نشد"
fi

# ───────── گزارش پایانی ─────────
HOST_IP="$( (hostname -I 2>/dev/null || true) | awk '{print $1}')"
if [[ "$BIND_NOW" == 127.0.0.1 ]]; then SHOW_HOST=127.0.0.1; else SHOW_HOST="${HOST_IP:-IP-سرور}"; fi
SCHEME=http; [[ "$SECURE_NOW" == true ]] && SCHEME=https
if [[ "$BIND_NOW" == 127.0.0.1 && "$SECURE_NOW" == true ]]; then URL="(از طریق nginx/HTTPS شما؛ برنامه روی http://127.0.0.1:$PORT_NOW)"; else URL="$SCHEME://$SHOW_HOST:$PORT_NOW"; fi

echo
echo "════════════════ نصب بیستون انجام شد ════════════════"
echo "نشانی:  $URL"
if [[ -n "$TEMP_PW" ]]; then
  echo "نام کاربری:  $ADMIN"
  echo "گذرواژه‌ی موقت:  $TEMP_PW    ← فقط همین یک بار نمایش داده می‌شود؛ در اولین ورود باید عوض شود."
  echo "ADMIN_USERNAME=$ADMIN"
  echo "ADMIN_TEMP_PASSWORD=$TEMP_PW"
fi
echo "BISTOON_URL=http://127.0.0.1:$PORT_NOW"
if [[ "$BIND_NOW" != 127.0.0.1 && "$SECURE_NOW" != true ]]; then
  echo
  echo "هشدار: برنامه روی HTTP ساده در دسترس است (گذرواژه‌ها رمزنگاری‌نشده می‌روند). فقط برای شبکه‌ی داخلی/آزمایشی."
  echo "       برای استفاده‌ی واقعی HTTPS بگذارید: deploy/README.md بخش «HTTPS و پروکسی»."
  echo "       پورت $PORT_NOW باید در فایروال سرور باز باشد."
fi
echo
echo "دستورهای بعدی:"
echo "  پشتیبان‌گیری:    $DEPLOY/scripts/backup.sh --docker /var/backups/bistoon 30"
echo "  به‌روزرسانی:      cd $ROOT && git pull && $DEPLOY/scripts/update.sh --docker"
echo "  گزارش برنامه:    docker compose -f $DEPLOY/docker-compose.yml logs -f app"
echo "  راهنمای کامل:    $DEPLOY/README.md"
}

main "$@"
