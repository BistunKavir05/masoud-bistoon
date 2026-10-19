import { describe, expect, it } from 'vitest';
import { buildWorkingDays, defaultCalendar } from '../src/calendar.ts';
import { addDays, weekday } from '../src/date.ts';
import { importLegacyProject } from '../src/legacy.ts';
import { fromJalali, toJalali } from '../src/jalali.ts';
import { planMspImport } from '../src/mspImport.ts';
import { parseMspXml } from '../src/msp.ts';
import { RECURRENCE_LIMITS, createRecurrence, defaultRecurrence, recurrenceDates, recurrenceText, updateRecurrence, validateRecurrence } from '../src/recurrence.ts';
import type { RecurrencePattern } from '../src/recurrence.ts';
import { repairForStorage } from '../src/repair.ts';
import { computeSchedule } from '../src/scheduling.ts';
import { defaultFinanceSettings } from '../src/finance.ts';
import { emptyCharter, emptyContract } from '../src/charter.ts';
import type { ProjectModel } from '../src/project.ts';
import type { Task } from '../src/types.ts';
import { task } from './fixtures.ts';

const START = '2026-09-12';
const cal = defaultCalendar();
const wd = buildWorkingDays(START, cal);
const pat = (p: Partial<RecurrencePattern> = {}): RecurrencePattern => ({ ...defaultRecurrence(START), name: 'جلسه', ...p });
const dates = (p: Partial<RecurrencePattern>): string[] => recurrenceDates(pat(p), wd);
const isWorking = (d: string): boolean => cal.days[weekday(d)]!.working;

function model(tasks: Task[]): ProjectModel {
  return {
    name: 'پروژه',
    start: START,
    status: START,
    contractEnd: null,
    calendar: cal,
    tasks,
    resources: [{ id: 1, name: 'علی', type: 'human', capacityPercent: 100, dailyRate: 1000 }],
    baseline: {},
    baselineHistory: [],
    snapshots: [],
    costs: [],
    finance: defaultFinanceSettings(),
    charter: emptyCharter(),
    contract: emptyContract(),
    risks: [],
    issues: [],
    changes: [],
    decisions: [],
    documents: [],
  };
}

describe('اعتبارسنجی الگو', () => {
  it('الگوی پیش‌فرض با نام سالم است؛ هر خطا پیام فارسی مشخصات را دارد', () => {
    expect(validateRecurrence(pat())).toBeNull();
    expect(validateRecurrence(pat({ name: '  ' }))).toBe('نام فعالیت را وارد کنید.');
    expect(validateRecurrence(pat({ duration: 0 }))).toBe('مدت هر رخداد باید ۱ تا ۶۰ روز کاری باشد.');
    expect(validateRecurrence(pat({ duration: 61 }))).toBe('مدت هر رخداد باید ۱ تا ۶۰ روز کاری باشد.');
    expect(validateRecurrence(pat({ duration: 1.5 }))).toBe('مدت هر رخداد باید ۱ تا ۶۰ روز کاری باشد.');
    expect(validateRecurrence(pat({ every: 0 }))).toBe('فاصله‌ی تکرار نامعتبر است.');
    expect(validateRecurrence(pat({ every: 100 }))).toBe('فاصله‌ی تکرار نامعتبر است.');
    expect(validateRecurrence(pat({ weekdays: [] }))).toBe('حداقل یک روز هفته را انتخاب کنید.');
    expect(validateRecurrence(pat({ weekdays: [7] }))).toBe('حداقل یک روز هفته را انتخاب کنید.');
    expect(validateRecurrence(pat({ count: 0 }))).toBe('تعداد رخدادها باید ۱ تا ۴۰۰ باشد.');
    expect(validateRecurrence(pat({ count: 401 }))).toBe('تعداد رخدادها باید ۱ تا ۴۰۰ باشد.');
    expect(validateRecurrence(pat({ endMode: 'date', endDate: null }))).toBe('تاریخ پایان بازه نامعتبر یا قبل از شروع است.');
    expect(validateRecurrence(pat({ endMode: 'date', endDate: '2026-09-01' }))).toBe('تاریخ پایان بازه نامعتبر یا قبل از شروع است.');
    expect(validateRecurrence(pat({ resource: { resourceId: 1, units: 0 } }))).toBe('درصد منبع نامعتبر است.');
    expect(validateRecurrence(pat({ resource: { resourceId: 1, units: 1001 } }))).toBe('درصد منبع نامعتبر است.');
    expect(validateRecurrence(pat({ type: 'monthly', monthDay: 32 }))).toBe('روز ماه باید ۱ تا ۳۱ باشد.');
    expect(validateRecurrence(pat({ type: 'yearly', yearMonth: 13 }))).toBe('ماه یا روز سالانه نامعتبر است.');
    expect(validateRecurrence({ ...pat(), start: '2026-02-30' })).toBe('تاریخ شروع بازه نامعتبر است.');
  });

  it('خلاصه‌ی متنی', () => {
    expect(recurrenceText(pat({ type: 'weekly', every: 2, duration: 3 }))).toBe('هفتگی، هر ۲ — ۳ روز کاری');
  });
});

describe('تاریخ رخدادها', () => {
  it('روزانه: فقط روز کاری (جمعه رد می‌شود) با گام n', () => {
    const d = dates({ type: 'daily', every: 1, count: 8, start: '2026-09-10' });
    expect(d).toHaveLength(8);
    expect(d.every(isWorking)).toBe(true);
    expect(d.some((x) => weekday(x) === 5)).toBe(false);
    expect(dates({ type: 'daily', every: 3, count: 3, start: '2026-09-12' })).toEqual([wd[0]!, wd[3]!, wd[6]!]);
  });

  it('هفتگی: روزهای انتخاب‌شده، هفته از شنبه، هر دو هفته', () => {
    const d = dates({ type: 'weekly', weekdays: [6], count: 4 }); // شنبه‌ها
    expect(d).toHaveLength(4);
    expect(d.every((x) => weekday(x) === 6)).toBe(true);
    expect(d[1]).toBe(addDays(d[0]!, 7));
    const biweekly = dates({ type: 'weekly', every: 2, weekdays: [0, 2], count: 4 }); // یکشنبه و سه‌شنبه هر دو هفته
    expect(biweekly.map(weekday)).toEqual([0, 2, 0, 2]);
    expect(addDays(biweekly[2]!, -14)).toBe(biweekly[0]!);
    expect(biweekly.every((x) => x >= START)).toBe(true);
  });

  it('هفتگی در روز غیرکاری (جمعه) به روز کاری بعد می‌رود و تکراری حذف می‌شود', () => {
    const fri = dates({ type: 'weekly', weekdays: [5], count: 3 });
    expect(fri.every((x) => weekday(x) === 6)).toBe(true); // شنبه‌ی بعد از جمعه
    const both = dates({ type: 'weekly', weekdays: [5, 6], count: 6 });
    expect(new Set(both).size).toBe(both.length);
  });

  it('تعداد و تاریخ پایان بازه', () => {
    expect(dates({ type: 'weekly', weekdays: [6], endMode: 'count', count: 5 })).toHaveLength(5);
    const until = dates({ type: 'weekly', weekdays: [6], endMode: 'date', endDate: '2026-10-31' });
    expect(until.length).toBeGreaterThan(3);
    expect(until.every((x) => x <= '2026-10-31')).toBe(true);
    // پایان بازه خودِ روز رخداد را هم شامل می‌شود
    const sat = dates({ type: 'weekly', weekdays: [6], count: 1 })[0]!;
    expect(dates({ type: 'weekly', weekdays: [6], endMode: 'date', endDate: sat })).toEqual([sat]);
  });

  it('ماهانه (شمسی): روز ۳۱ در ماه‌های ۳۰روزه به آخر ماه کوتاه می‌شود و تاریخ غیرکاری به روز کاری بعد می‌رود', () => {
    const s = fromJalali(1405, 7, 1);
    const d = recurrenceDates(pat({ type: 'monthly', monthMode: 'day', monthDay: 31, count: 6, start: s }), buildWorkingDays(s, cal));
    expect(d).toHaveLength(6);
    expect(d.slice(0, 4).map((x) => { const jd = toJalali(x); return [jd.jm, jd.jd]; })).toEqual([[7, 30], [8, 30], [9, 30], [10, 30]]);
    expect(d[4]).toBe('2027-02-20'); // ۳۰ بهمن جمعه است → شنبه ۱ اسفند
    expect(d.every(isWorking)).toBe(true);
  });

  it('ماهانه: n‌امین روز هفته و «آخرین» روز هفته‌ی ماه', () => {
    const s = fromJalali(1405, 1, 1);
    const wdays = buildWorkingDays(s, cal);
    const second = recurrenceDates(pat({ type: 'monthly', monthMode: 'ordinal', monthOrdinal: 2, monthWeekday: 0, count: 4, start: s }), wdays); // دومین یکشنبه
    expect(second.map((x) => weekday(x))).toEqual([0, 0, 0, 0]);
    expect(second.map((x) => toJalali(x).jd).every((x) => x >= 8 && x <= 14)).toBe(true);
    const last = recurrenceDates(pat({ type: 'monthly', monthMode: 'ordinal', monthOrdinal: 5, monthWeekday: 6, count: 4, start: s }), wdays); // آخرین شنبه
    for (const d of last) {
      expect(weekday(d)).toBe(6);
      expect(toJalali(addDays(d, 7)).jm).not.toBe(toJalali(d).jm); // هفته‌ی بعد دیگر در همان ماه نیست
    }
  });

  it('ماهانه هر ۳ ماه و شروع وسط ماه: رخداد قبل از شروع ساخته نمی‌شود', () => {
    const s = fromJalali(1405, 1, 15);
    const d = recurrenceDates(pat({ type: 'monthly', monthMode: 'day', monthDay: 10, every: 3, count: 3, start: s }), buildWorkingDays(s, cal));
    expect(d).toHaveLength(3);
    expect(d.every((x) => x >= s)).toBe(true);
    expect(toJalali(d[0]!).jm).toBe(4); // ده فروردین گذشته؛ فصل بعدی ۱۰ تیر
  });

  it('سالانه (شمسی)', () => {
    const s = '2026-03-20';
    const d = recurrenceDates(pat({ type: 'yearly', yearMonth: 1, yearDay: 1, count: 3, start: s }), buildWorkingDays(s, cal));
    expect(d).toHaveLength(3);
    expect(d[0]).toBe('2026-03-21');
    expect(toJalali(d[1]!)).toMatchObject({ jy: 1406, jm: 1, jd: 1 });
  });

  it('بیرون از افق برنامه رخدادی ساخته نمی‌شود', () => {
    expect(dates({ type: 'weekly', weekdays: [6], count: 400 }).length).toBeLessThan(400); // افق ۱۵۰۰ روز تقویمی
    expect(dates({ type: 'daily', start: '2040-01-01', count: 3 })).toEqual([]);
    expect(RECURRENCE_LIMITS.maxOccurrences).toBe(400);
  });
});

describe('ساخت گروه تکرارشونده', () => {
  const base = (): Task[] => [task({ id: 1, name: 'مهندسی', kind: 'summary' }), task({ id: 2, name: 'طراحی', level: 2, duration: 3 }), task({ id: 3, name: 'ساخت', duration: 4 })];
  const ctx = (over: Partial<Parameters<typeof createRecurrence>[2]> = {}) => ({ projectStart: START, calendar: cal, referenceId: null, asChild: false, firstId: 10, ...over });

  it('ابتدای فهرست: گروه + رخدادها با شناسه‌های پیوسته، قید شروع، وزن و منبع', () => {
    const r = createRecurrence(base(), pat({ count: 3, duration: 2, weighted: true, levelOfEffort: true, resource: { resourceId: 1, units: 50 } }), ctx());
    if (!r.ok) throw new Error(r.message);
    expect(r.summaryId).toBe(10);
    expect(r.tasks.slice(0, 4).map((t) => [t.id, t.level, t.kind, t.name])).toEqual([[10, 1, 'summary', 'جلسه'], [11, 2, 'task', 'جلسه 1'], [12, 2, 'task', 'جلسه 2'], [13, 2, 'task', 'جلسه 3']]);
    expect(r.tasks[0]!.recurrence).toMatchObject({ name: 'جلسه', type: 'weekly' });
    const kid = r.tasks[1]!;
    expect(kid).toMatchObject({ duration: 2, weight: 2, levelOfEffort: true, startNoEarlierSource: 'manual', assignments: [{ resourceId: 1, units: 50 }], recurrence: null });
    expect(kid.startNoEarlierThan).toBe(r.dates[0]);
    expect(r.nextId).toBe(14);
    expect(r.tasks.slice(4).map((t) => t.id)).toEqual([1, 2, 3]);
    expect(r.addedIds).toEqual([11, 12, 13]);
  });

  it('بدون وزن و بدون منبع: وزن صفر و تخصیص خالی', () => {
    const r = createRecurrence(base(), pat({ count: 2 }), ctx());
    if (!r.ok) throw new Error(r.message);
    expect(r.tasks[1]).toMatchObject({ weight: 0, assignments: [], levelOfEffort: false });
  });

  it('جای درج: بعد از یک فعالیت یا زیرمجموعه‌ی یک خلاصه (و تبدیل مرجع به خلاصه)', () => {
    const after = createRecurrence(base(), pat({ count: 2 }), ctx({ referenceId: 1 }));
    if (!after.ok) throw new Error(after.message);
    expect(after.tasks.map((t) => t.id)).toEqual([1, 2, 10, 11, 12, 3]); // بعد از خلاصه‌ی ۱ و زیردرختش
    expect(after.tasks[2]!.level).toBe(1);
    const child = createRecurrence(base(), pat({ count: 2 }), ctx({ referenceId: 1, asChild: true }));
    if (!child.ok) throw new Error(child.message);
    expect(child.tasks.map((t) => [t.id, t.level])).toEqual([[1, 1], [2, 2], [10, 2], [11, 3], [12, 3], [3, 1]]);
    const toSummary = createRecurrence(base(), pat({ count: 1 }), ctx({ referenceId: 3, asChild: true }));
    if (!toSummary.ok) throw new Error(toSummary.message);
    expect(toSummary.tasks.find((t) => t.id === 3)!.kind).toBe('summary');
  });

  it('خطاها: الگوی نامعتبر، بدون رخداد، مرجع ناموجود، عمق بیش از ۹', () => {
    const none = createRecurrence(base(), pat({ type: 'daily', start: '2040-01-01', count: 3 }), ctx());
    expect(none).toMatchObject({ ok: false, error: 'NO_DATES', message: 'با این الگو هیچ رخدادی ساخته نشد؛ بازه‌ی زمانی و تقویم را بررسی کنید.' });
    expect(createRecurrence(base(), pat({ name: '' }), ctx())).toMatchObject({ ok: false, error: 'INVALID' });
    expect(createRecurrence(base(), pat(), ctx({ referenceId: 99 }))).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    const deep = [task({ id: 1, name: 'L9', level: 9, kind: 'summary' })];
    expect(createRecurrence(deep, pat(), ctx({ referenceId: 1, asChild: true }))).toMatchObject({ ok: false, error: 'MAX_LEVEL' });
    const lvl8 = [task({ id: 1, name: 'L8', level: 8, kind: 'summary' })];
    expect(createRecurrence(lvl8, pat(), ctx({ referenceId: 1, asChild: true }))).toMatchObject({ ok: false, error: 'MAX_LEVEL' }); // گروه سطح ۹ و رخدادها سطح ۱۰
  });

  it('هر رخداد در برنامه از تاریخ خودش زودتر شروع نمی‌شود', () => {
    const r = createRecurrence(base(), pat({ count: 4 }), ctx());
    if (!r.ok) throw new Error(r.message);
    const s = computeSchedule({ start: START, status: START, calendar: cal, tasks: r.tasks });
    if (!s.ok) throw new Error('schedule');
    r.tasks.slice(1, 5).forEach((t, k) => expect(s.byId.get(t.id)!.startDate! >= r.dates[k]!).toBe(true));
    expect(s.byId.get(10)!.startDate).toBe(r.dates[0]);
  });
});

describe('ویرایش الگو', () => {
  const group = (): Task[] => {
    const r = createRecurrence([task({ id: 1, name: 'قبل' }), task({ id: 2, name: 'بعد' })], pat({ count: 4, name: 'جلسه' }), { projectStart: START, calendar: cal, referenceId: 1, asChild: false, firstId: 10 });
    if (!r.ok) throw new Error(r.message);
    // مدیر پروژه روی رخداد دوم پیشرفت ثبت کرده، رخداد سوم پیش‌نیاز دارد، «بعد» به رخداد چهارم وابسته است
    return r.tasks.map((t) => {
      if (t.id === 12) return { ...t, percentComplete: 40, actualStart: '2026-09-20', startNoEarlierThan: null, startNoEarlierSource: null, assignments: [{ resourceId: 1, units: 25 }], costTracked: true };
      if (t.id === 13) return { ...t, dependencies: [{ predecessorId: 11, type: 'FS' as const, lag: 0 }] };
      if (t.id === 2) return { ...t, dependencies: [{ predecessorId: 14, type: 'FS' as const, lag: 0 }] };
      return t;
    });
  };
  const ctx = { projectStart: START, calendar: cal, firstId: 20 };

  it('همان تعداد: شناسه، پیش‌نیاز، پیشرفت، تخصیص و تاریخ واقعی می‌ماند؛ نام و مدت و قید عوض می‌شود', () => {
    const r = updateRecurrence(group(), 10, pat({ name: 'جلسه‌ی هفتگی', count: 4, duration: 2 }), ctx);
    if (!r.ok) throw new Error(r.message);
    expect(r.removedIds).toEqual([]);
    expect(r.addedIds).toEqual([]);
    expect(r.keptIds).toEqual([11, 12, 13, 14]);
    const g = r.tasks.find((t) => t.id === 10)!;
    expect(g.name).toBe('جلسه‌ی هفتگی');
    const k2 = r.tasks.find((t) => t.id === 12)!;
    expect(k2).toMatchObject({ name: 'جلسه‌ی هفتگی 2', duration: 2, percentComplete: 40, actualStart: '2026-09-20', costTracked: true, startNoEarlierThan: null, assignments: [{ resourceId: 1, units: 25 }] });
    expect(r.tasks.find((t) => t.id === 13)!.dependencies).toEqual([{ predecessorId: 11, type: 'FS', lag: 0 }]);
    expect(r.tasks.find((t) => t.id === 11)!.startNoEarlierThan).toBe(r.dates[0]); // رخداد شروع‌نشده قید تاریخ تازه
    expect(r.tasks.map((t) => t.id)).toEqual([1, 10, 11, 12, 13, 14, 2]);
  });

  it('کمتر شدن تعداد: رخدادهای آخر حذف و ارجاع به آن‌ها از پیش‌نیازها پاک می‌شود', () => {
    const r = updateRecurrence(group(), 10, pat({ count: 2 }), ctx);
    if (!r.ok) throw new Error(r.message);
    expect(r.removedIds).toEqual([13, 14]);
    expect(r.tasks.map((t) => t.id)).toEqual([1, 10, 11, 12, 2]);
    expect(r.tasks.find((t) => t.id === 2)!.dependencies).toEqual([]); // «بعد» به رخداد چهارم وابسته بود
  });

  it('بیشتر شدن تعداد: رخدادهای تازه شناسه‌ی تازه می‌گیرند و کنار گروه می‌آیند', () => {
    const r = updateRecurrence(group(), 10, pat({ count: 6 }), ctx);
    if (!r.ok) throw new Error(r.message);
    expect(r.addedIds).toEqual([20, 21]);
    expect(r.nextId).toBe(22);
    expect(r.tasks.map((t) => t.id)).toEqual([1, 10, 11, 12, 13, 14, 20, 21, 2]);
    expect(r.tasks.find((t) => t.id === 20)).toMatchObject({ name: 'جلسه 5', level: 2, kind: 'task' });
  });

  it('خطاها: فعالیت ناموجود، گروه تکرارشونده نیست، الگوی نامعتبر', () => {
    expect(updateRecurrence(group(), 99, pat(), ctx)).toMatchObject({ ok: false, error: 'NOT_FOUND' });
    expect(updateRecurrence(group(), 1, pat(), ctx)).toMatchObject({ ok: false, error: 'NOT_RECURRING' });
    expect(updateRecurrence(group(), 10, pat({ weekdays: [] }), ctx)).toMatchObject({ ok: false, error: 'INVALID' });
    expect(updateRecurrence(group(), 10, pat({ type: 'daily', start: '2040-01-01' }), ctx)).toMatchObject({ ok: false, error: 'NO_DATES' });
  });
});

describe('ورود قدیمی، ترمیم و ورود MSP', () => {
  it('ورود قدیمی: الگوی rec به الگوی جدید تبدیل می‌شود و {imp:true} نادیده می‌ماند؛ الگوی خراب با هشدار حذف می‌شود', () => {
    const rec = { nm: 'جلسه', dur: 2, type: 'm', every: 1, wd: [6], md: 'ord', mday: 1, mord: 5, mwd: 6, ym: 1, yd: 1, st: '2026-09-12', em: 'n', cnt: 6, end: '', res: 'علی:50', wt: true, loe: true };
    const doc = {
      ver: 34,
      name: 'قدیمی',
      start: '2026-09-12',
      status: '2026-09-12',
      res: [{ n: 'علی', t: 'انسانی', c: 100, rate: 10 }],
      tasks: [
        { id: 1, name: 'گروه', lv: 1, sm: 1, rec },
        { id: 2, name: 'جلسه 1', lv: 2, dur: 2 },
        { id: 3, name: 'وارد از MSP', lv: 1, sm: 1, rec: { imp: true } },
        { id: 4, name: 'خراب', lv: 1, sm: 1, rec: { ...rec, type: 'x' } },
        { id: 5, name: 'خراب۲', lv: 1, sm: 1, rec: { ...rec, st: 'بد' } },
        { id: 6, name: 'روی فعالیت عادی', lv: 1, dur: 1, rec },
      ],
    };
    const out = importLegacyProject(doc, { today: '2026-10-19' });
    if ('error' in out) throw new Error(out.error);
    const byId = (id: number): Task => out.model.tasks.find((t) => t.id === id)!;
    expect(byId(1).recurrence).toMatchObject({ name: 'جلسه', duration: 2, type: 'monthly', monthMode: 'ordinal', monthOrdinal: 5, monthWeekday: 6, count: 6, weighted: true, levelOfEffort: true, resource: { resourceId: 1, units: 50 }, start: '2026-09-12', endMode: 'count' });
    expect(validateRecurrence(byId(1).recurrence!)).toBeNull();
    expect(byId(3).recurrence).toBeNull();
    expect(byId(4).recurrence).toBeNull();
    expect(byId(5).recurrence).toBeNull();
    expect(byId(6).recurrence).toBeNull();
    expect(out.warnings.filter((w) => w.code === 'RECURRENCE_DROPPED').map((w) => w.taskId)).toEqual([4, 5]);
  });

  it('ترمیم برای ذخیره: الگوی روی فعالیت عادی، الگوی نامعتبر و منبع ناموجود با هشدار اصلاح می‌شود', () => {
    const good = pat({ count: 3, resource: { resourceId: 1, units: 100 } });
    const m = model([
      task({ id: 1, name: 'گروه الف', kind: 'summary', recurrence: good }),
      task({ id: 2, level: 2, name: 'x' }),
      task({ id: 3, name: 'گروه ب', kind: 'summary', recurrence: { ...good, every: 0 } }),
      task({ id: 4, name: 'گروه ج', kind: 'summary', recurrence: { ...good, resource: { resourceId: 77, units: 100 } } }),
      task({ id: 5, name: 'فعالیت عادی', recurrence: good }),
    ]);
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    const byId = (id: number): Task => r.model.tasks.find((t) => t.id === id)!;
    expect(byId(1).recurrence).toEqual(good);
    expect(byId(3).recurrence).toBeNull();
    expect(byId(4).recurrence).toMatchObject({ resource: null });
    expect(byId(5).recurrence).toBeNull();
    expect(r.warnings.map((w) => `${w.code}:${w.taskId}`).sort()).toEqual(['RECURRENCE_DROPPED:3', 'RECURRENCE_DROPPED:5', 'RECURRENCE_RESOURCE_DROPPED:4']);
  });

  it('ورود MSP: الگوی تکرار گروه‌های فعلی پاک می‌شود و در اثر ورود گفته می‌شود', () => {
    const created = createRecurrence([], pat({ count: 2 }), { projectStart: START, calendar: cal, referenceId: null, asChild: false, firstId: 1 });
    if (!created.ok) throw new Error(created.message);
    const m = model(created.tasks);
    const xml = `<Project xmlns="http://schemas.microsoft.com/project"><Name>x</Name><StartDate>${START}T07:30:00</StartDate><MinutesPerDay>480</MinutesPerDay><Tasks><Task><UID>0</UID><Summary>1</Summary></Task>` +
      `<Task><UID>1</UID><Name>جلسه</Name><OutlineLevel>1</OutlineLevel><Summary>1</Summary></Task><Task><UID>2</UID><Name>جلسه 1</Name><OutlineLevel>2</OutlineLevel><Duration>PT8H0M0S</Duration></Task></Tasks></Project>`;
    const parsed = parseMspXml(xml, { calendar: cal });
    if (!parsed.ok) throw new Error(parsed.error);
    const plan = planMspImport(m, parsed.value, { mapping: 'id', idFloor: 10 });
    expect(plan.tasks.every((t) => t.recurrence === null)).toBe(true);
    const e = plan.effects.find((x) => x.text.includes('الگوی تکرار'));
    expect(e).toBeTruthy();
    expect(e!.level).toBe('warn');
    expect(e!.text.includes('«جلسه»')).toBe(true);
  });
});
