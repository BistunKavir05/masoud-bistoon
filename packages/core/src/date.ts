/**
 * ابزارهای تاریخ میلادی ISO (`YYYY-MM-DD`) بدون وابستگی به منطقه‌ی زمانی.
 * همه‌ی محاسبات با «روز از مبدأ یونیکس» در UTC انجام می‌شود.
 */

export type IsoDate = string;

const MS_PER_DAY = 86_400_000;
const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** آیا رشته یک تاریخ ISO واقعی است؟ (۳۰ فوریه و مانند آن نامعتبر است.) */
export function isIsoDate(value: unknown): value is IsoDate {
  if (typeof value !== 'string') return false;
  const m = ISO_RE.exec(value);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInGregorianMonth(y, mo);
}

export function isGregorianLeap(y: number): boolean {
  return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}

export function daysInGregorianMonth(y: number, m: number): number {
  if (m === 2) return isGregorianLeap(y) ? 29 : 28;
  return [4, 6, 9, 11].includes(m) ? 30 : 31;
}

/** تعداد روز از ۱۹۷۰-۰۱-۰۱ (می‌تواند منفی باشد). ورودی باید معتبر باشد. */
export function toEpochDay(iso: IsoDate): number {
  const m = ISO_RE.exec(iso);
  if (!m) throw new RangeError(`تاریخ ISO نامعتبر: ${String(iso)}`);
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY);
}

export function fromEpochDay(day: number): IsoDate {
  const d = new Date(day * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const mo = d.getUTCMonth() + 1;
  const da = d.getUTCDate();
  return `${String(y).padStart(4, '0')}-${String(mo).padStart(2, '0')}-${String(da).padStart(2, '0')}`;
}

export function addDays(iso: IsoDate, n: number): IsoDate {
  return fromEpochDay(toEpochDay(iso) + n);
}

/** a − b به روز تقویمی */
export function diffDays(a: IsoDate, b: IsoDate): number {
  return toEpochDay(a) - toEpochDay(b);
}

/** روز هفته به‌سبک جاوااسکریپت: ۰ یکشنبه … ۶ شنبه؛ جمعه = ۵ */
export function weekday(iso: IsoDate): number {
  return (((toEpochDay(iso) + 4) % 7) + 7) % 7; // ۱۹۷۰-۰۱-۰۱ پنجشنبه (۴) بوده است
}

/** مقایسه‌ی لغتنامه‌ای معتبر برای ISO */
export function compareIso(a: IsoDate, b: IsoDate): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export function minIso(a: IsoDate, b: IsoDate): IsoDate {
  return a <= b ? a : b;
}

export function maxIso(a: IsoDate, b: IsoDate): IsoDate {
  return a >= b ? a : b;
}
