# راهنمای استقرار بیستون روی سرور شرکت

این پوشه همه‌ی چیزهایی را دارد که IT برای نصب، نگهداری و پشتیبان‌گیری از بیستون لازم دارد.
دو راه نصب هست؛ **یکی را** انتخاب کنید:

| | الف) Docker Compose (توصیه‌شده) | ب) بدون Docker (systemd + nginx) |
| --- | --- | --- |
| پیش‌نیاز | Docker Engine 24+ و Compose v2 | Node.js ‎≥ 22.18، PostgreSQL 16، nginx |
| نصب | چند دستور | چند دستور بیشتر |
| پایگاه‌داده | کانتینر PostgreSQL 16 با ولوم | PostgreSQL خود سرور |
| به‌روزرسانی | `update.sh --docker` | `update.sh` |

برای حدود ۱۰ کاربر یک سرور با ۲ هسته، ۲ گیگابایت RAM و ۱۰ گیگابایت دیسک کافی است.

## ساختار پوشه

| فایل | کار |
| --- | --- |
| `Dockerfile`، `docker-compose.yml`، `.env.example` | نصب با Docker |
| `systemd/bistoon.service` | سرویس برنامه (نصب بدون Docker) |
| `systemd/bistoon-backup.service` و `.timer` | پشتیبان‌گیری شبانه (نصب بدون Docker) |
| `nginx/bistoon.conf` | نمونه‌ی nginx با HTTPS |
| `scripts/backup.sh`، `restore.sh` | پشتیبان‌گیری و بازیابی |
| `scripts/update.sh` | به‌روزرسانی با پشتیبان خودکار پیش از آن |
| `scripts/healthcheck.sh` | بررسی سلامت |
| `scripts/smoke-docker.sh` | آزمون دودی کل مسیر Docker (در CI اجرا می‌شود) |

## الف) نصب با Docker Compose

    git clone https://github.com/BistunKavir05/masoud-bistoon.git /opt/bistoon     # یا بایگانی کد را همان‌جا باز کنید
    cd /opt/bistoon/deploy
    cp .env.example .env
    openssl rand -hex 24          # خروجی را در .env جلوی POSTGRES_PASSWORD بگذارید
    nano .env                     # COOKIE_SECURE و TRUST_PROXY را مطابق «HTTPS» پایین تنظیم کنید
    docker compose up -d --build
    ./scripts/healthcheck.sh      # باید «سالم» چاپ کند

ساخت ادمین سیستم (گذرواژه‌ی موقت یک‌بار چاپ می‌شود و در اولین ورود باید عوض شود):

    docker compose exec app node apps/api/src/cli.ts create-admin --username admin --name "مدیر سیستم"

برنامه به‌طور پیش‌فرض فقط روی `127.0.0.1:3000` سرور گوش می‌دهد. یا پشت nginx بگذارید (بخش HTTPS) یا در `.env`
مقدار `BISTOON_BIND=0.0.0.0` بدهید تا از شبکه‌ی داخلی مستقیم در دسترس باشد (آن‌گاه فایروال را هم تنظیم کنید).
پایگاه‌داده هیچ پورتی به بیرون باز نمی‌کند. migrationهای پایگاه‌داده هنگام بالاآمدن برنامه خودکار اجرا می‌شود.

دستورهای روزمره (همه از پوشه‌ی `deploy`):

    docker compose ps                 # وضعیت
    docker compose logs -f app        # گزارش برنامه (هر خط یک JSON)
    docker compose restart app
    docker compose down               # توقف (داده در ولوم می‌ماند؛ با -v پاک می‌شود، مراقب باشید!)

## ب) نصب بدون Docker

۱. پیش‌نیازها: Node.js ‎≥ 22.18 (`node -v`)، PostgreSQL 16 و `postgresql-client`، nginx، git.

۲. کد و کاربر سرویس:

        sudo useradd --system --home /opt/bistoon --shell /usr/sbin/nologin bistoon
        sudo git clone https://github.com/BistunKavir05/masoud-bistoon.git /opt/bistoon
        cd /opt/bistoon && sudo npm ci && sudo npm run build -w @bistoon/web
        sudo chmod +x deploy/scripts/*.sh

۳. پایگاه‌داده:

        sudo -u postgres psql -c "CREATE ROLE bistoon LOGIN PASSWORD 'یک-گذرواژه‌ی-قوی'" \
                              -c "CREATE DATABASE bistoon OWNER bistoon"

۴. تنظیمات — فایل `/etc/bistoon/bistoon.env` (فقط root و گروه bistoon بتوانند بخوانند):

        sudo mkdir -p /etc/bistoon /var/backups/bistoon
        sudo chown bistoon: /var/backups/bistoon
        sudo install -m 640 -o root -g bistoon /dev/null /etc/bistoon/bistoon.env
        sudo nano /etc/bistoon/bistoon.env

   محتوا:

        DATABASE_URL=postgres://bistoon:یک-گذرواژه‌ی-قوی@127.0.0.1:5432/bistoon
        HOST=127.0.0.1
        PORT=3000
        WEB_DIST=/opt/bistoon/apps/web/dist
        COOKIE_SECURE=true
        TRUST_PROXY=loopback

   گذرواژه‌ی پایگاه‌داده فقط حرف/رقم باشد (در نشانی می‌آید). مقدار هر متغیر در بخش «تنظیمات» پایین توضیح داده شده است.

۵. ساخت ادمین سیستم:

        sudo -u bistoon bash -c 'set -a; . /etc/bistoon/bistoon.env; set +a; cd /opt/bistoon/apps/api && node src/cli.ts create-admin --username admin --name "مدیر سیستم"'

۶. سرویس:

        sudo cp deploy/systemd/bistoon.service deploy/systemd/bistoon-backup.service deploy/systemd/bistoon-backup.timer /etc/systemd/system/
        sudo systemctl daemon-reload
        sudo systemctl enable --now bistoon bistoon-backup.timer
        ./deploy/scripts/healthcheck.sh

   اگر `node` در `/usr/bin/node` نیست (مثلاً با nvm نصب شده)، مسیر `ExecStart` را در `bistoon.service` درست کنید (`which node`).

۷. nginx: `deploy/nginx/bistoon.conf` را در `/etc/nginx/conf.d/` بگذارید، `server_name` و مسیر گواهی را عوض کنید، سپس `sudo nginx -t && sudo systemctl reload nginx`.

گزارش‌ها: `journalctl -u bistoon -f`

## HTTPS و پروکسی

- **پشت HTTPS (توصیه‌شده):** `COOKIE_SECURE=true` و برای nginx روی همان سرور `TRUST_PROXY=loopback`. nginx باید سرایند `Host` را با پورت اصلی بفرستد (`proxy_set_header Host $http_host` در نمونه هست)؛ برنامه مبدأ درخواست‌های تغییردهنده را با `Host` مقایسه می‌کند.
- **فقط HTTP در شبکه‌ی داخلی:** `COOKIE_SECURE=false` بماند. اگر `true` باشد مرورگر کوکی را روی HTTP نگه نمی‌دارد و ورود ممکن نیست.
- اگر برنامه با نامی غیر از `Host` پروکسی دیده می‌شود، همان نشانی کامل را (مثلاً `https://bistoon.example.ir`) در `ALLOWED_ORIGINS` بگذارید.
- `client_max_body_size` در nginx با `BODY_LIMIT` برنامه (پیش‌فرض ‎16mb) هم‌خوان باشد؛ فایل‌های ورود MS Project و پشتیبان JSON تا این اندازه‌اند.

## تنظیمات (متغیرهای محیطی)

| متغیر | پیش‌فرض | توضیح |
| --- | --- | --- |
| `DATABASE_URL` | — (الزامی) | نشانی PostgreSQL (در Docker خودکار ساخته می‌شود) |
| `HOST` / `PORT` | `127.0.0.1` / `3000` | نشانی و پورت گوش‌دادن |
| `WEB_DIST` | — | پوشه‌ی رابط ساخته‌شده؛ در Docker خودکار تنظیم می‌شود |
| `COOKIE_SECURE` | `false` | پشت HTTPS حتماً `true` |
| `TRUST_PROXY` | خالی | پشت nginx محلی: `loopback`؛ بدون پروکسی: خالی (برای محدودکننده‌ی تلاش‌های ورود به نشانی واقعی کاربر) |
| `ALLOWED_ORIGINS` | خالی | مبداهای اضافی مجاز، با ویرگول |
| `SESSION_TTL_HOURS` | `12` | عمر مطلق نشست |
| `BODY_LIMIT` | `16mb` | سقف اندازه‌ی درخواست |
| `LOG_REQUESTS` | `true` | گزارش هر درخواست |

## شروع کار پس از نصب

۱. با ادمین سیستم وارد شوید و گذرواژه‌ی موقت را عوض کنید.
۲. از تب «کاربران» کاربران را بسازید (نام کاربری لاتین، گذرواژه‌ی موقت).
۳. پروژه بسازید (یا از «ورود» پروژه‌ی قدیمی/فایل MS Project بیاورید) و در «اعضا» به هر کاربر نقش بدهید. نقش‌ها به‌ازای هر پروژه‌اند و بعداً قابل تغییرند.
۴. **بازرگانی** فقط پورسانت، وضعیت/مرحله‌ی پروژه، مبلغ قرارداد، صورتحساب و وصول را می‌بیند.

## پشتیبان‌گیری و بازیابی

پشتیبان کل پایگاه‌داده را می‌گیرد (پروژه‌ها، کاربران، ممیزی، گفتگو…) و دقیقاً با همان فایل قابل بازیابی است.

    # Docker (از پوشه‌ی deploy)
    ./scripts/backup.sh --docker /var/backups/bistoon 30
    # بدون Docker (شبانه با تایمر systemd انجام می‌شود؛ دستی:)
    sudo -u bistoon bash -c 'set -a; . /etc/bistoon/bistoon.env; set +a; /opt/bistoon/deploy/scripts/backup.sh /var/backups/bistoon 30'

عدد آخر تعداد روز نگهداری است. خروجی `bistoon-سال‌ماه‌روز-ساعت.dump` است (دسترسی `600`). **فایل‌ها را روی ماشین دیگری هم کپی کنید**؛ پشتیبانی که روی همان دیسک بماند در خرابی دیسک از بین می‌رود.

بازیابی (همه‌ی داده‌ی فعلی جایگزین می‌شود و در یک تراکنش است؛ اگر فایل خراب باشد پایگاه‌داده دست‌نخورده می‌ماند):

    docker compose stop app                                   # یا: sudo systemctl stop bistoon
    ./scripts/restore.sh --docker /var/backups/bistoon/فایل.dump   # بدون Docker: DATABASE_URL را بدهید و --docker را حذف کنید
    docker compose start app                                  # یا: sudo systemctl start bistoon

**پیشنهاد:** ماهی یک بار بازیابی را روی یک پایگاه‌داده‌ی آزمایشی تمرین کنید؛ پشتیبانِ بازیابی‌نشده اطمینان نمی‌دهد.
علاوه بر این، از هر پروژه می‌توان از داخل برنامه (منوی «خروجی» ← پشتیبان JSON) نسخه‌ی جدا گرفت.

## به‌روزرسانی و بازگشت

    cd /opt/bistoon && git pull
    ./deploy/scripts/update.sh --docker      # بدون Docker:  sudo ./deploy/scripts/update.sh

اسکریپت ابتدا پشتیبان می‌گیرد، می‌سازد، دوباره راه می‌اندازد و سلامت را می‌سنجد. اگر سالم نشد، دستور بازگشت را چاپ می‌کند:
نسخه‌ی قبلی کد را با `git checkout <کامیت قبلی>` برگردانید و فایل پشتیبانِ پیش از به‌روزرسانی را با `restore.sh` بازیابی کنید
(migrationها فقط به جلو می‌روند، پس بازگشت به کد قدیمی بدون بازیابی پشتیبان ممکن نیست).

## چک‌لیست امنیتی

- فقط HTTPS؛ `COOKIE_SECURE=true`؛ گذرواژه‌ی ادمین قوی (برنامه حداقل ۱۰ نویسه می‌خواهد؛ بلندتر بهتر است) و تغییر گذرواژه‌ی موقت.
- پورت PostgreSQL به شبکه باز نباشد (در Docker باز نمی‌شود؛ بدون Docker `listen_addresses = 'localhost'`).
- فایل `.env` یا `/etc/bistoon/bistoon.env` فقط برای مدیر سرور خواندنی باشد.
- فایل‌های پشتیبان رمزنگاری نمی‌شوند و همه‌ی داده را دارند؛ دسترسی پوشه‌ی پشتیبان را محدود کنید و در صورت لزوم دیسک/پشتیبان را رمزنگاری کنید.
- سرور و Docker/Node به‌روز بمانند. برنامه هدرهای CSP، `X-Frame-Options` و `nosniff` را خودش می‌فرستد و هیچ منبعی از اینترنت (CDN، فونت) نمی‌خواند، پس روی شبکه‌ی بسته هم کار می‌کند.
- ورود ناموفق پشت‌سرهم محدود می‌شود: ۲۰ تلاش ناموفق در ۱۰ دقیقه از یک نشانی، و ۵ تلاش ناموفق روی یک حساب آن را ۱۵ دقیقه قفل می‌کند. برای دیدن نشانی واقعی کاربر پشت پروکسی `TRUST_PROXY` را درست بگذارید.

## عیب‌یابی

| نشانه | علت و راه‌حل |
| --- | --- |
| ورود «موفق» است ولی دوباره به صفحه‌ی ورود برمی‌گردد | `COOKIE_SECURE=true` ولی دسترسی با HTTP. یا HTTPS بگذارید یا موقتاً `false` |
| خطای «مبدأ درخواست مجاز نیست» (`BAD_ORIGIN`) | `Host` درست به برنامه نرسیده (در nginx از `$http_host` استفاده کنید) یا نشانی در `ALLOWED_ORIGINS` نیست |
| ۴۱۳ هنگام ورود فایل | `client_max_body_size` در nginx کمتر از فایل است |
| برنامه بالا نمی‌آید: `listen failed` | پورت اشغال است؛ `PORT` را عوض کنید یا فرایند دیگر را ببندید |
| `DATABASE_URL لازم است` / خطای اتصال | تنظیمات پایگاه‌داده؛ در Docker `docker compose logs db` |
| بعد از به‌روزرسانی «checksum» migration | فایل migration قدیمی دستکاری شده؛ هیچ migrationی که یک‌بار اجرا شده را ویرایش نکنید |
| `pg_dump: server version mismatch` | نسخه‌ی `postgresql-client` از سرور PostgreSQL قدیمی‌تر است؛ همان نسخه را نصب کنید |

## چه چیزی آزمایش شده است

- ✔ **پشتیبان‌گیری و بازیابی بدون Docker** (`backup.sh` / `restore.sh`) روی PostgreSQL 16 اجرا شد: پشتیبان ← بازیابی در پایگاه‌داده‌ی دیگر ← راه‌اندازی برنامه و ورود با کاربر بازیابی‌شده؛ بازیابی روی پایگاه‌داده‌ی پر؛ فایل ناقص بدون دست‌زدن به داده رد می‌شود؛ بدون تأیید (`RESTORE`) اجرا نمی‌شود.
- ✔ نحو فایل‌های systemd با `systemd-analyze verify` سنجیده شد (تنها هشدارها مربوط به نبودن مسیرهای نصب بود، چون روی سرور آزمایشی نصب نشده‌اند).
- ✔ **مسیر Docker در CI (GitHub Actions، کار `deploy`) اجرا و سبز شد** (کامیت 91e3dd9): `npm ci` با لاک‌فایل، ساخت تصویر، بالاآمدن compose، ساخت ادمین، ورود، سرو رابط و مسیرهای SPA، هدرهای امنیتی، پشتیبان‌گیری، حذف داده‌ی نمونه، بازیابی و ورود دوباره. این آزمون دودی روی رانر GitHub بود، نه روی سرور شما؛ ساخت روی سرور خودتان با `./scripts/smoke-docker.sh` (روی نمونه‌ی آزمایشی، چون داده را پاک می‌کند) قابل تکرار است.
- ◻ **nginx و systemd روی یک سرور واقعی** آزمایش نشده‌اند؛ پیکربندی‌ها نمونه‌اند و باید با نام میزبان و گواهی شما تنظیم و با `nginx -t` وارسی شوند.
