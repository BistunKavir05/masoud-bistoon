/**
 * فعالیت تکرارشونده (مثل جلسه‌ی هفتگی یا گزارش ماهانه).
 * یک «گروه» (فعالیت خلاصه) با الگوی ذخیره‌شده و چند رخداد مستقل ساخته می‌شود؛ هر رخداد یک فعالیت عادی با قید
 * «شروع نه زودتر از» تاریخ خودش است و اگر آن روز غیرکاری باشد به روز کاری بعد می‌رود.
 * ویرایش الگو رخدادها را دوباره می‌سازد ولی شناسه، پیش‌نیاز، پیشرفت، تخصیص و هزینه‌ی رخدادهای هم‌شماره را نگه می‌دارد.
 * الگوریتم تاریخ‌ها با برنامه‌ی مرجع (v34) یکی است.
 */
import { buildWorkingDays } from './calendar.ts';
import { addDays, isIsoDate, weekday } from './date.ts';
import type { IsoDate } from './date.ts';
import { daysInJalaliMonth, fromJalali, toJalali, toPersianDigits } from './jalali.ts';
import { insertTask, subtreeEnd } from './structure.ts';
import type { Assignment, Task, WorkCalendar } from './types.ts';

export const RECURRENCE_TYPES = ['daily', 'weekly', 'monthly', 'yearly'] as const;
export type RecurrenceType = (typeof RECURRENCE_TYPES)[number];
export const RECURRENCE_TYPE_LABELS: Record<RecurrenceType, string> = { daily: 'روزانه (روز کاری)', weekly: 'هفتگی', monthly: 'ماهانه (شمسی)', yearly: 'سالانه (شمسی)' };
const TYPE_SHORT: Record<RecurrenceType, string> = { daily: 'روزانه', weekly: 'هفتگی', monthly: 'ماهانه', yearly: 'سالانه' };

export const RECURRENCE_LIMITS = { maxOccurrences: 400, maxDuration: 60, maxEvery: 99 } as const;

export interface RecurrencePattern {
  /** نام گروه؛ رخدادها «نام ۱»، «نام ۲»، … */
  name: string;
  /** مدت هر رخداد به روز کاری (۱ تا ۶۰) */
  duration: number;
  type: RecurrenceType;
  /** فاصله‌ی تکرار: هر n روز کاری/هفته/ماه/سال (۱ تا ۹۹) */
  every: number;
  /** هفتگی: روزهای هفته به‌سبک جاوااسکریپت (۰ یکشنبه … ۵ جمعه، ۶ شنبه) */
  weekdays: number[];
  /** ماهانه: «روز مشخصی از ماه» یا «n‌امین روز هفته‌ی ماه» */
  monthMode: 'day' | 'ordinal';
  monthDay: number;
  /** ۱ تا ۴ و ۵ = آخرین */
  monthOrdinal: number;
  monthWeekday: number;
  /** سالانه (ماه و روز شمسی) */
  yearMonth: number;
  yearDay: number;
  /** شروع بازه (میلادی ISO؛ در رابط شمسی نمایش داده می‌شود) */
  start: IsoDate;
  endMode: 'count' | 'date';
  /** تعداد رخدادها (۱ تا ۴۰۰) وقتی endMode = count */
  count: number;
  /** پایان بازه وقتی endMode = date */
  endDate: IsoDate | null;
  /** منبع هر رخداد (اختیاری) */
  resource: Assignment | null;
  /** در پیشرفت وزنی پروژه لحاظ شود؟ (وزن هر رخداد = مدتش) */
  weighted: boolean;
  /** فعالیت پشتیبانی/جلسه: در پایان پروژه و مسیر بحرانی دخالت ندارد */
  levelOfEffort: boolean;
}

export function defaultRecurrence(start: IsoDate): RecurrencePattern {
  return {
    name: '',
    duration: 1,
    type: 'weekly',
    every: 1,
    weekdays: [6],
    monthMode: 'day',
    monthDay: 1,
    monthOrdinal: 1,
    monthWeekday: 6,
    yearMonth: 1,
    yearDay: 1,
    start,
    endMode: 'count',
    count: 10,
    endDate: null,
    resource: null,
    weighted: false,
    levelOfEffort: false,
  };
}

const intIn = (v: unknown, a: number, b: number): v is number => typeof v === 'number' && Number.isInteger(v) && v >= a && v <= b;

/** پیام خطای فارسی برای الگوی نامعتبر؛ null یعنی سالم */
export function validateRecurrence(p: RecurrencePattern): string | null {
  if (typeof p.name !== 'string' || p.name.trim() === '') return 'نام فعالیت را وارد کنید.';
  if (!intIn(p.duration, 1, RECURRENCE_LIMITS.maxDuration)) return 'مدت هر رخداد باید ۱ تا ۶۰ روز کاری باشد.';
  if (!(RECURRENCE_TYPES as readonly string[]).includes(p.type) || !intIn(p.every, 1, RECURRENCE_LIMITS.maxEvery)) return 'فاصله‌ی تکرار نامعتبر است.';
  if (!isIsoDate(p.start)) return 'تاریخ شروع بازه نامعتبر است.';
  if (p.type === 'weekly' && (!Array.isArray(p.weekdays) || p.weekdays.length === 0 || !p.weekdays.every((d) => intIn(d, 0, 6)))) return 'حداقل یک روز هفته را انتخاب کنید.';
  if (p.type === 'monthly') {
    if (p.monthMode !== 'day' && p.monthMode !== 'ordinal') return 'الگوی ماهانه نامعتبر است.';
    if (p.monthMode === 'day' && !intIn(p.monthDay, 1, 31)) return 'روز ماه باید ۱ تا ۳۱ باشد.';
    if (p.monthMode === 'ordinal' && (!intIn(p.monthOrdinal, 1, 5) || !intIn(p.monthWeekday, 0, 6))) return 'الگوی ماهانه نامعتبر است.';
  }
  if (p.type === 'yearly' && (!intIn(p.yearMonth, 1, 12) || !intIn(p.yearDay, 1, 31))) return 'ماه یا روز سالانه نامعتبر است.';
  if (p.endMode !== 'count' && p.endMode !== 'date') return 'نوع پایان بازه نامعتبر است.';
  if (p.endMode === 'count' && !intIn(p.count, 1, RECURRENCE_LIMITS.maxOccurrences)) return 'تعداد رخدادها باید ۱ تا ۴۰۰ باشد.';
  if (p.endMode === 'date' && (p.endDate === null || !isIsoDate(p.endDate) || p.endDate < p.start)) return 'تاریخ پایان بازه نامعتبر یا قبل از شروع است.';
  if (p.resource !== null && (!intIn(p.resource.resourceId, 1, 2_147_483_647) || !(typeof p.resource.units === 'number' && p.resource.units >= 1 && p.resource.units <= 1000))) return 'درصد منبع نامعتبر است.';
  return null;
}

/** اولین اندیس با روز ≥ d در فهرست مرتب؛ −۱ اگر نباشد */
function firstOnOrAfter(days: readonly IsoDate[], d: IsoDate): number {
  let lo = 0;
  let hi = days.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if ((days[mid] as IsoDate) >= d) hi = mid;
    else lo = mid + 1;
  }
  return lo >= days.length ? -1 : lo;
}

const jIso = (jy: number, jm: number, jd: number): IsoDate => fromJalali(jy, jm, Math.min(jd, daysInJalaliMonth(jy, jm)));

/**
 * تاریخ رخدادها (روز کاری، یکتا، مرتب). `workingDays` فهرست روزهای کاری از شروع پروژه است (`buildWorkingDays`).
 * تاریخی که در روز غیرکاری بیفتد به روز کاری بعد می‌رود؛ تاریخ بیرون از افق برنامه رخدادی نمی‌سازد.
 */
export function recurrenceDates(p: RecurrencePattern, workingDays: readonly IsoDate[]): IsoDate[] {
  const out: IsoDate[] = [];
  const limit: IsoDate = p.endMode === 'date' && p.endDate ? p.endDate : '9999-12-31';
  const max = p.endMode === 'count' ? p.count : RECURRENCE_LIMITS.maxOccurrences;
  const add = (d: IsoDate | undefined): boolean => {
    if (d === undefined || out.length >= max || d > limit) return false;
    const k = firstOnOrAfter(workingDays, d);
    if (k < 0) return false;
    const day = workingDays[k] as IsoDate;
    if (!out.includes(day)) out.push(day);
    return true;
  };

  if (p.type === 'daily') {
    const k0 = firstOnOrAfter(workingDays, p.start);
    if (k0 < 0) return out;
    for (let k = k0; out.length < max && k < workingDays.length; k += p.every) {
      const day = workingDays[k] as IsoDate;
      if (day > limit) break;
      out.push(day);
    }
  } else if (p.type === 'weekly') {
    // هفته از شنبه شروع می‌شود
    const weekStart = addDays(p.start, -((weekday(p.start) + 1) % 7));
    const days = [6, 0, 1, 2, 3, 4, 5].filter((d) => p.weekdays.includes(d));
    for (let w = 0; w < 400; w += p.every) {
      for (const d of days) {
        const nd = addDays(weekStart, w * 7 + ((d + 1) % 7));
        if (nd < p.start) continue;
        if (!add(nd)) return out;
      }
    }
  } else if (p.type === 'monthly') {
    let { jy, jm } = toJalali(p.start);
    for (let i = 0; i < 400; i += 1) {
      let d: IsoDate | undefined;
      if (p.monthMode === 'day') d = jIso(jy, jm, p.monthDay);
      else {
        const same: IsoDate[] = [];
        for (let x = 1; x <= daysInJalaliMonth(jy, jm); x += 1) {
          const s = fromJalali(jy, jm, x);
          if (weekday(s) === p.monthWeekday) same.push(s);
        }
        d = p.monthOrdinal >= 5 ? same[same.length - 1] : same[p.monthOrdinal - 1];
      }
      if (d !== undefined && d >= p.start && !add(d)) break;
      jm += p.every;
      while (jm > 12) {
        jm -= 12;
        jy += 1;
      }
    }
  } else {
    let { jy } = toJalali(p.start);
    for (let i = 0; i < 400; i += 1) {
      const d = jIso(jy, p.yearMonth, p.yearDay);
      if (d >= p.start && !add(d)) break;
      jy += p.every;
    }
  }
  return out;
}

/** خلاصه‌ی یک‌خطی الگو برای نمایش کنار گروه */
export function recurrenceText(p: RecurrencePattern): string {
  return `${TYPE_SHORT[p.type]}، هر ${toPersianDigits(p.every)} — ${toPersianDigits(p.duration)} روز کاری`;
}

// ───────────────────────── ساخت و ویرایش ─────────────────────────

export type RecurrenceFailure = 'INVALID' | 'NO_DATES' | 'NOT_FOUND' | 'NOT_RECURRING' | 'MAX_LEVEL' | 'OUT_OF_HORIZON';

export type RecurrenceResult =
  | { ok: true; tasks: Task[]; summaryId: number; dates: IsoDate[]; removedIds: number[]; addedIds: number[]; keptIds: number[]; nextId: number }
  | { ok: false; error: RecurrenceFailure; message: string };

const fail = (error: RecurrenceFailure, message: string): { ok: false; error: RecurrenceFailure; message: string } => ({ ok: false, error, message });
const NO_DATES = 'با این الگو هیچ رخدادی ساخته نشد؛ بازه‌ی زمانی و تقویم را بررسی کنید.';

/** شناسه‌ی رخدادهای جدید از `firstId` به بعد پشت‌سرهم گرفته می‌شود (سرور از شمارنده‌ی پروژه می‌دهد). */
export function occurrencesNeeded(p: RecurrencePattern, projectStart: IsoDate, calendar: WorkCalendar): IsoDate[] {
  return recurrenceDates(p, buildWorkingDays(projectStart, calendar));
}

function occurrence(base: Task, p: RecurrencePattern, date: IsoDate, k: number, resource: Assignment | null): Task {
  const started = base.actualStart !== null;
  return {
    ...base,
    name: `${p.name.trim()} ${k + 1}`,
    kind: 'task',
    duration: p.duration,
    weight: p.weighted ? p.duration : 0,
    levelOfEffort: p.levelOfEffort,
    startNoEarlierThan: started ? null : date,
    startNoEarlierSource: started ? null : 'manual',
    assignments: base.assignments.length > 0 ? base.assignments : resource ? [resource] : [],
    recurrence: null,
  };
}

/** گروه تکرارشونده‌ی تازه را در جای خواسته می‌سازد. `firstId` شناسه‌ی گروه است و رخدادها بعد از آن می‌آیند. */
export function createRecurrence(
  tasks: readonly Task[],
  p: RecurrencePattern,
  ctx: { projectStart: IsoDate; calendar: WorkCalendar; referenceId: number | null; asChild: boolean; firstId: number },
): RecurrenceResult {
  const bad = validateRecurrence(p);
  if (bad) return fail('INVALID', bad);
  const dates = occurrencesNeeded(p, ctx.projectStart, ctx.calendar);
  if (dates.length === 0) return fail('NO_DATES', NO_DATES);
  const ins = insertTask(tasks, { referenceId: ctx.referenceId, asChild: ctx.asChild, kind: 'summary', name: p.name, newId: ctx.firstId });
  if (!ins.ok) return fail(ins.error === 'MAX_LEVEL' ? 'MAX_LEVEL' : 'NOT_FOUND', ins.message);
  const list = ins.tasks.slice();
  const gi = list.findIndex((t) => t.id === ctx.firstId);
  const group = list[gi] as Task;
  if (group.level + 1 > 9) return fail('MAX_LEVEL', 'حداکثر عمق سلسله‌مراتب ۹ سطح است.');
  list[gi] = { ...group, name: p.name.trim(), recurrence: p };
  const kids = dates.map((d, k) => occurrence(blankChild(ctx.firstId + 1 + k, group.level + 1), p, d, k, p.resource));
  list.splice(gi + 1, 0, ...kids);
  return { ok: true, tasks: list, summaryId: ctx.firstId, dates, removedIds: [], addedIds: kids.map((t) => t.id), keptIds: [], nextId: ctx.firstId + 1 + kids.length };
}

function blankChild(id: number, level: number): Task {
  return {
    id,
    name: '',
    level,
    kind: 'task',
    duration: 1,
    dependencies: [],
    weight: 0,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    work: 0,
    assignments: [],
    startNoEarlierThan: null,
    startNoEarlierSource: null,
    deadline: null,
    levelOfEffort: false,
    directCosts: [],
    legacyActualCost: null,
    costTracked: false,
    recurrence: null,
  };
}

/**
 * الگوی گروه موجود را عوض می‌کند و رخدادها را دوباره می‌سازد. رخدادِ k‌ام اگر قبلاً بوده شناسه، پیش‌نیاز، پیشرفت، تاریخ واقعی،
 * تخصیص و هزینه‌اش را نگه می‌دارد؛ رخدادهای اضافه (اگر تعداد کم شود) حذف می‌شوند و ارجاع به آن‌ها از پیش‌نیازها پاک می‌شود.
 * زیرمجموعه‌ی عمیق‌تر رخدادها (اگر کسی ساخته بود) با رخداد حذف می‌شود.
 */
export function updateRecurrence(
  tasks: readonly Task[],
  groupId: number,
  p: RecurrencePattern,
  ctx: { projectStart: IsoDate; calendar: WorkCalendar; firstId: number },
): RecurrenceResult {
  const i = tasks.findIndex((t) => t.id === groupId);
  if (i < 0) return fail('NOT_FOUND', 'فعالیت پیدا نشد.');
  const group = tasks[i] as Task;
  if (group.kind !== 'summary' || group.recurrence === null) return fail('NOT_RECURRING', 'این فعالیت گروه تکرارشونده نیست.');
  const bad = validateRecurrence(p);
  if (bad) return fail('INVALID', bad);
  const dates = occurrencesNeeded(p, ctx.projectStart, ctx.calendar);
  if (dates.length === 0) return fail('NO_DATES', NO_DATES);

  const end = subtreeEnd(tasks, i);
  const old = tasks.slice(i + 1, end).filter((t) => t.level === group.level + 1);
  let next = ctx.firstId;
  const addedIds: number[] = [];
  const kids = dates.map((d, k) => {
    const o = old[k];
    if (o) return occurrence(o, p, d, k, p.resource);
    const id = next;
    next += 1;
    addedIds.push(id);
    return occurrence(blankChild(id, group.level + 1), p, d, k, p.resource);
  });
  const keptIds = old.slice(0, dates.length).map((t) => t.id);
  const kidIds = new Set(kids.map((t) => t.id));
  const removed = tasks.slice(i + 1, end).map((t) => t.id).filter((id) => !kidIds.has(id));
  const gone = new Set(removed);
  const strip = (t: Task): Task => (t.dependencies.some((d) => gone.has(d.predecessorId)) ? { ...t, dependencies: t.dependencies.filter((d) => !gone.has(d.predecessorId)) } : t);
  const list = [...tasks.slice(0, i), { ...group, name: p.name.trim(), recurrence: p }, ...kids, ...tasks.slice(end)].map(strip);
  return { ok: true, tasks: list, summaryId: groupId, dates, removedIds: removed, addedIds, keptIds, nextId: next };
}
