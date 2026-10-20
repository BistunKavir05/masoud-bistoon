/**
 * هندسه‌ی نمودار گانت: ستون‌های زمان، میله‌ها و مسیر خطوط ارتباط. بدون React تا قابل آزمون باشد.
 *
 * همه‌ی مختصات این فایل «منطقی»اند: x از صفر (نخستین روز کاری) به‌سمت زمان‌های بعدی افزایش می‌یابد.
 * نمایش فارسی راست‌به‌چپ است (نخستین ماه کنار ستون نام فعالیت‌ها در راست)؛ تبدیل به مختصات صفحه با `flipX` و پارامتر `total`
 * در لحظه‌ی رسم انجام می‌شود تا محاسبات هندسه از جهت نمایش مستقل بماند.
 */
import { JALALI_MONTHS, baselineIndices, toJalali, toPersianDigits, weekday } from '@bistoon/core';
import type { Baseline, DayAxis, DependencyType } from '@bistoon/core';
import type { TaskRow } from '../tasks/rows.ts';

export type Zoom = 'day' | 'week' | 'month';

/** پیکسل به‌ازای هر روز کاری */
export const PX_PER_DAY: Record<Zoom, number> = { day: 22, week: 7, month: 3.4 };
export const ZOOM_LABELS: Record<Zoom, string> = { day: 'روز', week: 'هفته', month: 'ماه' };

export const ROW_H = 30;
export const HEADER_H = 46;
const BAR_Y = 6;
const BAR_H = 14;
const BASE_Y = 22;
const BASE_H = 4;

/** مختصات منطقی (از راست) → مختصات صفحه: لبه‌ی چپ یک بازه‌ی [x, x+w] در نمودارِ راست‌به‌چپ به عرض کل `total` */
export const flipX = (total: number, x: number, w = 0): number => total - x - w;

export interface Band {
  x: number;
  w: number;
  label: string;
}

/**
 * نوارهای سرستون: ماه شمسی (بالا) و برچسب روز/هفته (پایین). محور فقط روزهای کاری را دارد،
 * پس عرض ماه = تعداد روز کاری آن ماه × px. `length` تعداد روز کاری نمایش‌داده‌شده است.
 */
export function timeBands(axis: DayAxis, length: number, zoom: Zoom): { months: Band[]; ticks: Band[] } {
  const px = PX_PER_DAY[zoom];
  const n = Math.min(length, axis.length);
  const months: Band[] = [];
  const ticks: Band[] = [];
  let cur: { key: string; start: number; jy: number; jm: number } | null = null;
  let first = true;
  const closeMonth = (end: number): void => {
    if (!cur) return;
    const w = (end - cur.start) * px;
    // سال: در ماه‌های پهن همیشه، در ماه‌های باریک فقط برای اولین ماه و فروردین؛ ماهِ خیلی باریک بی‌برچسب است
    const showYear = w >= 90 || ((first || cur.jm === 1) && w >= 64);
    months.push({ x: cur.start * px, w, label: w < 30 ? '' : `${JALALI_MONTHS[cur.jm - 1]}${showYear ? ` ${toPersianDigits(cur.jy)}` : ''}` });
    first = false;
  };
  for (let i = 0; i < n; i += 1) {
    const iso = axis.dateAt(i);
    if (!iso) break;
    const j = toJalali(iso);
    const key = `${j.jy}-${j.jm}`;
    if (!cur || cur.key !== key) {
      closeMonth(i);
      cur = { key, start: i, jy: j.jy, jm: j.jm };
    }
    if (zoom === 'day') ticks.push({ x: i * px, w: px, label: toPersianDigits(j.jd) });
    else if (zoom === 'week' && (i === 0 || weekday(iso) === 6)) ticks.push({ x: i * px, w: px * 5, label: toPersianDigits(j.jd) });
  }
  closeMonth(n);
  return { months, ticks };
}

export interface BarGeom {
  kind: 'task' | 'summary' | 'milestone';
  /** آغاز میله در مختصات منطقی (برای مایلستون مرکز لوزی) */
  x: number;
  w: number;
  /** عرض بخش انجام‌شده */
  doneW: number;
  critical: boolean;
  /** میله‌ی خط مبنا (مایلستون: x مرکز) */
  base: { x: number; w: number; zero: boolean } | null;
}

export function barGeom(row: TaskRow, baseline: Baseline | null, axis: DayAxis, px: number): BarGeom | null {
  const s = row.s;
  if (!s) return null;
  const kind = row.t.kind === 'summary' ? 'summary' : row.t.kind === 'milestone' || s.duration === 0 ? 'milestone' : 'task';
  const w = s.duration * px;
  let base: BarGeom['base'] = null;
  const item = baseline?.[row.t.id];
  if (item) {
    const b = baselineIndices(item, axis);
    base = { x: b.earlyStart * px, w: b.duration * px, zero: b.duration === 0 };
  }
  return { kind, x: s.earlyStart * px, w, doneW: (w * Math.max(0, Math.min(100, s.percent))) / 100, critical: s.critical && s.percent < 100, base };
}

export const barTop = (rowIndex: number): number => HEADER_H + rowIndex * ROW_H + BAR_Y;
export const rowCenter = (rowIndex: number): number => HEADER_H + rowIndex * ROW_H + ROW_H / 2;
export { BAR_H, BASE_H, BASE_Y };

/**
 * مسیر خط ارتباط بین دو ردیف. نقطه‌ی شروع روی پیش‌نیاز (آغاز یا پایان میله) و مقصد روی پس‌نیاز است؛
 * FS: پایان→آغاز، SS: آغاز→آغاز، FF: پایان→پایان، SF: آغاز→پایان. مسیر شکسته‌ی قائم/افقی است تا قابل دنبال‌کردن باشد.
 */
export function linkPath(type: DependencyType, from: { start: number; end: number; y: number }, to: { start: number; end: number; y: number }, total?: number): string {
  const x1 = type === 'FS' || type === 'FF' ? from.end : from.start;
  const x2 = type === 'FS' || type === 'SS' ? to.start : to.end;
  const y1 = from.y;
  const y2 = to.y;
  const mid = y1 + (y2 >= y1 ? ROW_H / 2 : -ROW_H / 2);
  const g = 7;
  const r = (n: number): string => (Math.round(n * 10) / 10).toString();
  // مسیر در مختصات منطقی ساخته می‌شود و فقط x ها برای نمایش راست‌به‌چپ قرینه می‌شوند (y و ترتیب فرمان‌ها بی‌تغییر)
  const X = (n: number): string => r(total === undefined ? n : total - n);
  if (type === 'FS') {
    if (x2 >= x1 + 2 * g) return `M${X(x1)},${r(y1)}H${X(x1 + g)}V${r(y2)}H${X(x2)}`;
    return `M${X(x1)},${r(y1)}H${X(x1 + g)}V${r(mid)}H${X(x2 - g)}V${r(y2)}H${X(x2)}`;
  }
  if (type === 'SS') {
    const xm = Math.min(x1, x2) - g;
    return `M${X(x1)},${r(y1)}H${X(xm)}V${r(y2)}H${X(x2)}`;
  }
  if (type === 'FF') {
    const xm = Math.max(x1, x2) + g;
    return `M${X(x1)},${r(y1)}H${X(xm)}V${r(y2)}H${X(x2)}`;
  }
  // SF
  if (x2 + g <= x1 - g) return `M${X(x1)},${r(y1)}H${X(x1 - g)}V${r(y2)}H${X(x2)}`;
  return `M${X(x1)},${r(y1)}H${X(x1 - g)}V${r(mid)}H${X(x2 + g)}V${r(y2)}H${X(x2)}`;
}

export interface GanttLink {
  key: string;
  from: number;
  to: number;
  type: DependencyType;
  d: string;
}

/** خطوط ارتباط بین ردیف‌های نمایان؛ ارتباطی که یک سرش پنهان (بسته‌شده/فیلترشده) است رسم نمی‌شود. */
export function buildLinks(rows: readonly TaskRow[], geoms: ReadonlyMap<number, BarGeom>, total?: number): GanttLink[] {
  const index = new Map<number, number>();
  rows.forEach((r, i) => index.set(r.t.id, i));
  const out: GanttLink[] = [];
  for (const r of rows) {
    const gt = geoms.get(r.t.id);
    const ti = index.get(r.t.id);
    if (!gt || ti === undefined) continue;
    for (const dep of r.t.dependencies) {
      const gf = geoms.get(dep.predecessorId);
      const fi = index.get(dep.predecessorId);
      if (!gf || fi === undefined) continue;
      const anchor = (g: BarGeom): { start: number; end: number } => (g.kind === 'milestone' ? { start: g.x, end: g.x } : { start: g.x, end: g.x + g.w });
      const d = linkPath(dep.type, { ...anchor(gf), y: rowCenter(fi) }, { ...anchor(gt), y: rowCenter(ti) }, total);
      out.push({ key: `${dep.predecessorId}>${r.t.id}`, from: dep.predecessorId, to: r.t.id, type: dep.type, d });
    }
  }
  return out;
}
