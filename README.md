# بیستون — مدیریت پروژه

نسخه‌ی پایدار و چندکاربره‌ی برنامه‌ی مدیریت پروژه‌ی «بیستون» (React + Express + PostgreSQL).
برنامه‌ی تک‌فایلی اولیه به‌عنوان مرجع رفتار در `reference/bistoon-v34.html` نگه‌داری می‌شود و هیچ‌گاه تغییر نمی‌کند.

## ساختار

| مسیر | محتوا |
| --- | --- |
| `packages/core` | هسته‌ی مشترک دامنه به TypeScript: تقویم، شمسی، زمان‌بندی (CPM)، پیشرفت، خط مبنا، منحنی S، مالی/EVM، پورسانت، ریسک، ساختار فعالیت‌ها، ورود داده‌ی قدیمی. هم سرور و هم کلاینت از آن استفاده می‌کنند. |
| `apps/api` | سرویس Express و دسترسی به PostgreSQL (در دست ساخت) |
| `apps/web` | رابط React (در دست ساخت) |
| `db/migrations` | مهاجرت‌های SQL |
| `deploy` | Docker Compose، nginx، پشتیبان‌گیری، راهنمای استقرار |
| `tools/oracle` | آزمون تفاضلی: همان پروژه‌ی تصادفی را در برنامه‌ی مرجع و هسته‌ی جدید محاسبه و مقایسه می‌کند |
| `docs` | تصمیم‌ها و اختلاف‌های عمدی (`docs/divergences.md`) |

## اجرا

    npm install
    npm run typecheck
    npm test
    node tools/oracle/run.ts --count 100 --seed 1    # نیاز به Playwright و Chromium

نیازمندی: Node.js 22 یا بالاتر.

وضعیت مراحل در `PROGRESS.md` است.
