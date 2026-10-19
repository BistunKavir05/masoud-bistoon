/**
 * قالب‌بندی نمایشی (ارقام فارسی، تاریخ شمسی) و تجزیه‌ی ورودی کاربر.
 * مقدار ذخیره‌شده همیشه عدد لاتین و تاریخ میلادی ISO است؛ این‌جا فقط نمایش و ورودی را می‌سازیم.
 */
import { formatJalali, formatJalaliLong, fromJalali, isIsoDate, isValidJalali, normalizeDigits, toPersianDigits } from '@bistoon/core';
import type { IsoDate } from '@bistoon/core';

export const DASH = '—';

const isNum = (n: unknown): n is number => typeof n === 'number' && Number.isFinite(n);

/** عدد با جداکننده‌ی هزارگان و ارقام فارسی؛ مقدار نامعتبر هرگز NaN نشان نمی‌دهد. */
export function faNum(n: number | null | undefined, maxFraction = 0): string {
  if (!isNum(n)) return DASH;
  const s = new Intl.NumberFormat('en-US', { maximumFractionDigits: maxFraction, useGrouping: true }).format(n);
  return toPersianDigits(s.replace(/,/g, '٬').replace(/\./g, '٫').replace(/-/g, '−'));
}

export function faPct(n: number | null | undefined, maxFraction = 1): string {
  return isNum(n) ? `${faNum(n, maxFraction)}٪` : DASH;
}

export function faMoney(n: number | null | undefined, unit = 'ریال'): string {
  return isNum(n) ? `${faNum(Math.round(n))} ${unit}` : DASH;
}

/** نسبت (مثل CPI) با دو رقم اعشار */
export function faRatio(n: number | null | undefined): string {
  return isNum(n) ? faNum(n, 2) : DASH;
}

export function faDate(iso: IsoDate | null | undefined): string {
  return iso && isIsoDate(iso) ? formatJalali(iso) : DASH;
}

export function faDateLong(iso: IsoDate | null | undefined): string {
  return iso && isIsoDate(iso) ? formatJalaliLong(iso) : DASH;
}

export function faInt(n: number | null | undefined): string {
  return faNum(n, 0);
}

/** عدد از متن کاربر (ارقام فارسی/عربی، جداکننده‌ی هزارگان). متن خالی یا نامعتبر → null */
export function parseNumber(text: string): number | null {
  const t = normalizeDigits(text).replace(/[,\s‌]/g, '').replace(/[−–]/g, '-');
  if (t === '' || !/^-?\d+(\.\d+)?$/.test(t)) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

/**
 * تاریخ از متن کاربر. شمسی (۱۳۰۰ تا ۱۶۹۹) یا میلادی ISO (YYYY-MM-DD).
 * undefined = نامعتبر، null = خالی، رشته = ISO میلادی
 */
export function parseDateInput(text: string): IsoDate | null | undefined {
  const t = normalizeDigits(text).trim();
  if (t === '') return null;
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(t);
  if (!m) return undefined;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= 1300 && y < 1700) {
    if (!isValidJalali(y, mo, d)) return undefined;
    const iso = fromJalali(y, mo, d);
    return isIsoDate(iso) ? iso : undefined;
  }
  const iso = `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  return isIsoDate(iso) ? iso : undefined;
}

/** نمایش تاریخ برای فیلد ورودی (شمسی با ارقام فارسی) */
export function dateToInput(iso: IsoDate | null | undefined): string {
  return iso && isIsoDate(iso) ? formatJalali(iso) : '';
}

export function faDateTime(ts: string | Date | null | undefined): string {
  if (!ts) return DASH;
  const d = typeof ts === 'string' ? new Date(ts) : ts;
  if (Number.isNaN(d.getTime())) return DASH;
  const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  return `${formatJalali(iso)}  ${toPersianDigits(hm)}`;
}

export function todayIso(): IsoDate {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

/** فقط http و https برای لینک بیرونی */
export function isSafeUrl(url: string): boolean {
  try {
    const u = new URL(url);
    return u.protocol === 'http:' || u.protocol === 'https:';
  } catch {
    return false;
  }
}
