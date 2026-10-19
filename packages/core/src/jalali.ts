/**
 * تبدیل تاریخ شمسی ⇔ میلادی و قالب‌بندی/تجزیه.
 * الگوریتم: تقویم جلالی بر پایه‌ی جدول «نقاط شکست» (روش رایج jalaali-js) که برای سال‌های ۱۶۰ ق‌ه تا ۳۱۷۷ معتبر است.
 * همه‌ی تبدیل‌ها در این فایل متمرکزند؛ هیچ جای دیگری نباید تاریخ شمسی را خودش حساب کند.
 */
import type { IsoDate } from './date.ts';
import { fromEpochDay, isIsoDate, toEpochDay } from './date.ts';

export interface JalaliDate {
  jy: number;
  jm: number;
  jd: number;
}

const BREAKS = [-61, 9, 38, 199, 426, 686, 756, 818, 1111, 1181, 1210, 1635, 2060, 2097, 2192, 2262, 2324, 2394, 2456, 3178];

const div = (a: number, b: number): number => Math.floor(a / b);
const mod = (a: number, b: number): number => a - Math.floor(a / b) * b;

export const JALALI_MONTHS = ['فروردین', 'اردیبهشت', 'خرداد', 'تیر', 'مرداد', 'شهریور', 'مهر', 'آبان', 'آذر', 'دی', 'بهمن', 'اسفند'] as const;
/** نام روزهای هفته با اندیس جاوااسکریپت: ۰ یکشنبه … ۶ شنبه */
export const WEEKDAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'] as const;

interface JalCal {
  leap: number;
  gy: number;
  march: number;
}

function jalCal(jy: number): JalCal {
  const bl = BREAKS.length;
  const gy = jy + 621;
  let leapJ = -14;
  let jp = BREAKS[0]!;
  let jump = 0;
  if (jy < jp || jy >= BREAKS[bl - 1]!) throw new RangeError(`سال شمسی نامعتبر: ${jy}`);
  let i = 1;
  for (; i < bl; i += 1) {
    const jm = BREAKS[i]!;
    jump = jm - jp;
    if (jy < jm) break;
    leapJ = leapJ + div(jump, 33) * 8 + div(mod(jump, 33), 4);
    jp = jm;
  }
  let n = jy - jp;
  leapJ = leapJ + div(n, 33) * 8 + div(mod(n, 33) + 3, 4);
  if (mod(jump, 33) === 4 && jump - n === 4) leapJ += 1;
  const leapG = div(gy, 4) - div((div(gy, 100) + 1) * 3, 4) - 150;
  const march = 20 + leapJ - leapG;
  if (jump - n < 6) n = n - jump + div(jump + 4, 33) * 33;
  let leap = mod(mod(n + 1, 33) - 1, 4);
  if (leap === -1) leap = 4;
  return { leap, gy, march };
}

/** روز ۱ فروردین سال شمسی به‌صورت روز از مبدأ یونیکس */
function newYearEpochDay(jy: number): number {
  const { gy, march } = jalCal(jy);
  return toEpochDay(`${String(gy).padStart(4, '0')}-03-01`) + (march - 1);
}

export function isJalaliLeap(jy: number): boolean {
  return jalCal(jy).leap === 0;
}

export function daysInJalaliMonth(jy: number, jm: number): number {
  if (jm <= 6) return 31;
  if (jm <= 11) return 30;
  return isJalaliLeap(jy) ? 30 : 29;
}

export function isValidJalali(jy: number, jm: number, jd: number): boolean {
  if (!Number.isInteger(jy) || !Number.isInteger(jm) || !Number.isInteger(jd)) return false;
  if (jy < -61 || jy >= 3178 || jm < 1 || jm > 12 || jd < 1) return false;
  return jd <= daysInJalaliMonth(jy, jm);
}

export function fromJalali(jy: number, jm: number, jd: number): IsoDate {
  if (!isValidJalali(jy, jm, jd)) throw new RangeError(`تاریخ شمسی نامعتبر: ${jy}/${jm}/${jd}`);
  const dayOfYear = jm <= 6 ? (jm - 1) * 31 + jd - 1 : 186 + (jm - 7) * 30 + jd - 1;
  return fromEpochDay(newYearEpochDay(jy) + dayOfYear);
}

export function toJalali(iso: IsoDate): JalaliDate {
  const day = toEpochDay(iso);
  const gy = Number(iso.slice(0, 4));
  let jy = gy - 621;
  let start = newYearEpochDay(jy);
  if (day < start) {
    jy -= 1;
    start = newYearEpochDay(jy);
  }
  const k = day - start;
  if (k <= 185) return { jy, jm: 1 + div(k, 31), jd: mod(k, 31) + 1 };
  const k2 = k - 186;
  return { jy, jm: 7 + div(k2, 30), jd: mod(k2, 30) + 1 };
}

// ─────────── ارقام ───────────

const FA = '۰۱۲۳۴۵۶۷۸۹';
const AR = '٠١٢٣٤٥٦٧٨٩';

/** ارقام فارسی و عربی را به لاتین تبدیل می‌کند؛ جداکننده‌های هزارگان و اعشار عربی را هم یکسان می‌کند. */
export function normalizeDigits(s: string): string {
  return s
    .replace(/[۰-۹]/g, (d) => String(FA.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String(AR.indexOf(d)))
    .replace(/٫/g, '.')
    .replace(/٬/g, ',');
}

export function toPersianDigits(value: string | number): string {
  return String(value).replace(/\d/g, (d) => FA[Number(d)]!);
}

// ─────────── قالب‌بندی و تجزیه ───────────

export interface FormatOptions {
  /** جداکننده؛ پیش‌فرض «/» */
  sep?: string;
  /** ارقام فارسی؛ پیش‌فرض true */
  persianDigits?: boolean;
}

/** `۱۴۰۵/۰۷/۲۴` از `2026-10-16` */
export function formatJalali(iso: IsoDate, opts: FormatOptions = {}): string {
  const { jy, jm, jd } = toJalali(iso);
  const sep = opts.sep ?? '/';
  const s = `${String(jy).padStart(4, '0')}${sep}${String(jm).padStart(2, '0')}${sep}${String(jd).padStart(2, '0')}`;
  return opts.persianDigits === false ? s : toPersianDigits(s);
}

/** `۲۴ مهر ۱۴۰۵` */
export function formatJalaliLong(iso: IsoDate): string {
  const { jy, jm, jd } = toJalali(iso);
  return `${toPersianDigits(jd)} ${JALALI_MONTHS[jm - 1]} ${toPersianDigits(jy)}`;
}

/**
 * متن شمسی (با ارقام فارسی/عربی/لاتین و جداکننده‌ی `/`، `-` یا `.`) را به ISO میلادی تبدیل می‌کند.
 * سال دو رقمی پذیرفته نمی‌شود. نتیجه‌ی نامعتبر `null` است.
 */
export function parseJalali(text: string): IsoDate | null {
  const t = normalizeDigits(text).trim();
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(t);
  if (!m) return null;
  const jy = Number(m[1]);
  const jm = Number(m[2]);
  const jd = Number(m[3]);
  if (!isValidJalali(jy, jm, jd)) return null;
  const iso = fromJalali(jy, jm, jd);
  return isIsoDate(iso) ? iso : null;
}
