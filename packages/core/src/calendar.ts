/**
 * تقویم کاری و محور «اندیس روز کاری».
 * موتور زمان‌بندی روی اندیس روزهای کاری کار می‌کند، نه تفریق روزهای تقویمی.
 */
import type { IsoDate } from './date.ts';
import { addDays, isIsoDate, weekday } from './date.ts';
import type { WorkCalendar, WorkDay } from './types.ts';

export const DEFAULT_HORIZON_DAYS = 1500;

/** تقویم پیش‌فرض: جمعه غیرکاری، بقیه‌ی روزها کاری؛ ۰۷:۳۰–۱۵:۰۰ و پنجشنبه تا ۱۴:۰۰ */
export function defaultCalendar(): WorkCalendar {
  const days: WorkDay[] = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ working: i !== 5, from: '07:30', to: i === 4 ? '14:00' : '15:00' }));
  return { days, holidays: [] };
}

export interface CalendarTemplate {
  key: string;
  label: string;
  days: WorkDay[];
}

/** هفته‌ی کاری با فهرست اندیس روزهای کاری (۰ یکشنبه … ۶ شنبه) و ساعت یکسان */
function weekOf(working: readonly number[], from: string, to: string): WorkDay[] {
  return [0, 1, 2, 3, 4, 5, 6].map((i) => ({ working: working.includes(i), from, to }));
}

/** الگوهای آماده‌ی هفته‌ی کاری؛ فقط مقدار اولیه‌ی فرم‌اند و پس از اعمال قابل ویرایش‌اند. */
export const CALENDAR_TEMPLATES: readonly CalendarTemplate[] = [
  { key: 'default', label: 'پیش‌فرض: شنبه تا پنجشنبه (پنجشنبه تا ۱۴:۰۰)، جمعه تعطیل', days: defaultCalendar().days },
  { key: 'sat-wed', label: 'شنبه تا چهارشنبه، پنجشنبه و جمعه تعطیل (۰۸:۰۰ تا ۱۶:۰۰)', days: weekOf([6, 0, 1, 2, 3], '08:00', '16:00') },
  { key: 'sun-thu', label: 'یکشنبه تا پنجشنبه، جمعه و شنبه تعطیل (۰۸:۰۰ تا ۱۶:۰۰)', days: weekOf([0, 1, 2, 3, 4], '08:00', '16:00') },
  { key: 'mon-fri', label: 'دوشنبه تا جمعه، شنبه و یکشنبه تعطیل (۰۹:۰۰ تا ۱۷:۰۰)', days: weekOf([1, 2, 3, 4, 5], '09:00', '17:00') },
  { key: 'seven', label: 'هر هفت روز هفته کاری (۰۸:۰۰ تا ۱۶:۰۰)', days: weekOf([0, 1, 2, 3, 4, 5, 6], '08:00', '16:00') },
];

export interface CalendarIssue {
  code: 'NO_WORKING_WEEKDAY' | 'INVALID_HOLIDAY' | 'INVALID_TIME' | 'WRONG_DAY_COUNT';
  message: string;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export function validateCalendar(cal: WorkCalendar): CalendarIssue[] {
  const issues: CalendarIssue[] = [];
  if (cal.days.length !== 7) issues.push({ code: 'WRONG_DAY_COUNT', message: 'تقویم باید دقیقاً هفت روز هفته داشته باشد.' });
  if (!cal.days.some((d) => d.working)) issues.push({ code: 'NO_WORKING_WEEKDAY', message: 'دست‌کم یک روز هفته باید کاری باشد.' });
  cal.days.forEach((d, i) => {
    if (!TIME_RE.test(d.from) || !TIME_RE.test(d.to)) issues.push({ code: 'INVALID_TIME', message: `ساعت روز ${i} نامعتبر است.` });
  });
  cal.holidays.forEach((h) => {
    if (!isIsoDate(h.date)) issues.push({ code: 'INVALID_HOLIDAY', message: `تاریخ تعطیلی نامعتبر: ${String(h.date)}` });
  });
  return issues;
}

/** مجموع ساعت نمایشی هفته: فقط برای نمایش در تب تقویم */
export function weeklyHours(cal: WorkCalendar): number {
  const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
  return cal.days.reduce((a, d) => a + (d.working ? Math.max(0, toMin(d.to) - toMin(d.from)) / 60 : 0), 0);
}

/**
 * فهرست روزهای کاری از `start` در بازه‌ی `horizonDays` روز تقویمی.
 * اگر هیچ روز کاری نبود، فقط خود `start` برمی‌گردد (رفتار سازگاری) تا اندیس‌ها هرگز تهی نباشند.
 */
export function buildWorkingDays(start: IsoDate, calendar: WorkCalendar, horizonDays: number = DEFAULT_HORIZON_DAYS): IsoDate[] {
  const holidays = new Set(calendar.holidays.map((h) => h.date));
  const out: IsoDate[] = [];
  for (let i = 0; i < horizonDays; i += 1) {
    const iso = addDays(start, i);
    if (calendar.days[weekday(iso)]?.working && !holidays.has(iso)) out.push(iso);
  }
  if (out.length === 0) out.push(start);
  return out;
}

/** اندیس‌گذاری روی فهرست مرتب روزهای کاری */
export class DayAxis {
  readonly days: readonly IsoDate[];

  constructor(days: readonly IsoDate[]) {
    this.days = days;
  }

  get length(): number {
    return this.days.length;
  }

  /** اولین اندیس با تاریخ ≥ iso؛ پیش از شروع → ۰؛ پس از افق → آخرین اندیس (نگاشت «روز کاری بعدی»). */
  onOrAfter(iso: IsoDate): number {
    const k = this.lowerBound(iso);
    return k >= this.days.length ? this.days.length - 1 : k;
  }

  /** آیا تاریخ از افق بیرون است؟ (پس از آخرین روز کاری) */
  isBeyond(iso: IsoDate): boolean {
    return iso > (this.days[this.days.length - 1] as IsoDate);
  }

  /** اولین اندیس با تاریخ > iso؛ اگر نبود، طول فهرست (برای ضرب‌الاجل) */
  after(iso: IsoDate): number {
    let lo = 0;
    let hi = this.days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.days[mid] as IsoDate) > iso) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }

  /** تاریخ اندیس یا null در صورت خروج از افق */
  dateAt(i: number): IsoDate | null {
    return i >= 0 && i < this.days.length ? (this.days[i] as IsoDate) : null;
  }

  private lowerBound(iso: IsoDate): number {
    let lo = 0;
    let hi = this.days.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if ((this.days[mid] as IsoDate) >= iso) hi = mid;
      else lo = mid + 1;
    }
    return lo;
  }
}
