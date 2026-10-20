import { describe, expect, it } from 'vitest';
import { buildWorkingDays, defaultCalendar } from '../src/calendar.ts';
import { computeSchedule, effectiveDuration } from '../src/scheduling.ts';
import type { Schedule } from '../src/scheduling.ts';
import { DayAxis } from '../src/calendar.ts';
import { dep, input, task } from './fixtures.ts';

function ok(r: ReturnType<typeof computeSchedule>): Schedule {
  if (!r.ok) throw new Error(`schedule failed: ${r.error}`);
  return r;
}
const row = (s: Schedule, id: number) => {
  const t = s.byId.get(id);
  if (!t) throw new Error(`no task ${id}`);
  return t;
};

const abm = () => [
  task({ id: 1, name: 'A', duration: 5 }),
  task({ id: 2, name: 'B', duration: 3, dependencies: [dep(1)] }),
  task({ id: 3, name: 'M', kind: 'milestone', dependencies: [dep(2)] }),
];

describe('تقویم کاری', () => {
  it('جمعه غیرکاری است و پنجشنبه کاری', () => {
    const d = buildWorkingDays('2026-09-01', defaultCalendar());
    expect(d.slice(0, 6)).toEqual(['2026-09-01', '2026-09-02', '2026-09-03', '2026-09-05', '2026-09-06', '2026-09-07']);
    expect(d.length).toBe(1286);
    expect(d[d.length - 1]).toBe('2030-10-09');
  });
  it('تعطیلی رسمی از محور حذف می‌شود', () => {
    const cal = { ...defaultCalendar(), holidays: [{ date: '2026-09-02' as const, title: 'x' }] };
    expect(buildWorkingDays('2026-09-01', cal).slice(0, 3)).toEqual(['2026-09-01', '2026-09-03', '2026-09-05']);
  });
  it('بدون روز کاری فقط روز شروع برمی‌گردد', () => {
    const cal = { days: defaultCalendar().days.map((d) => ({ ...d, working: false })), holidays: [] };
    expect(buildWorkingDays('2026-09-01', cal)).toEqual(['2026-09-01']);
  });
  it('نگاشت تاریخ به اندیس', () => {
    const ax = new DayAxis(['2026-09-01', '2026-09-03', '2026-09-05']);
    expect(ax.onOrAfter('2026-08-01')).toBe(0);
    expect(ax.onOrAfter('2026-09-02')).toBe(1);
    expect(ax.onOrAfter('2030-01-01')).toBe(2);
    expect(ax.after('2026-09-03')).toBe(2);
    expect(ax.after('2030-01-01')).toBe(3);
    expect(ax.dateAt(3)).toBeNull();
  });
});

describe('زمان‌بندی پایه', () => {
  it('زنجیره‌ی A→B→M (مقدار ثبت‌شده در آزمون t16 قدیمی)', () => {
    const s = ok(computeSchedule(input(abm())));
    expect([row(s, 1).earlyStart, row(s, 1).earlyFinish, row(s, 1).duration]).toEqual([0, 5, 5]);
    expect([row(s, 2).earlyStart, row(s, 2).earlyFinish]).toEqual([5, 8]);
    expect([row(s, 3).earlyStart, row(s, 3).earlyFinish, row(s, 3).duration]).toEqual([8, 8, 0]);
    expect(row(s, 1).startDate).toBe('2026-09-01');
    expect(row(s, 1).finishDate).toBe('2026-09-06');
    expect(row(s, 2).finishDate).toBe('2026-09-09');
    expect(row(s, 3).startDate).toBe('2026-09-09');
    expect(row(s, 3).finishDate).toBe('2026-09-09');
    expect(s.projectFinish).toBe(8);
    for (const id of [1, 2, 3]) expect(row(s, id).critical).toBe(true);
    expect(s.warnings).toEqual([]);
  });

  it('ضرب‌الاجل زودتر از پایان ⇒ شناوری منفی', () => {
    const t = abm();
    t[0] = { ...(t[0] as ReturnType<typeof task>), deadline: '2026-09-03' };
    const s = ok(computeSchedule(input(t)));
    expect([row(s, 1).lateStart, row(s, 1).lateFinish, row(s, 1).totalFloat, row(s, 1).critical]).toEqual([-2, 3, -2, true]);
    expect([row(s, 2).lateStart, row(s, 2).lateFinish, row(s, 2).totalFloat]).toEqual([5, 8, 0]);
  });

  it('فقط پایان واقعی: فعالیت روی همان روز قفل می‌شود و کامل است', () => {
    const t = abm();
    t[0] = { ...(t[0] as ReturnType<typeof task>), actualFinish: '2026-09-08' };
    const s = ok(computeSchedule(input(t)));
    const a = row(s, 1);
    expect([a.earlyStart, a.earlyFinish, a.duration, a.percent]).toEqual([6, 7, 1, 100]);
    expect([a.startDate, a.finishDate]).toEqual(['2026-09-08', '2026-09-08']);
    expect([row(s, 2).earlyStart, row(s, 2).earlyFinish]).toEqual([7, 10]);
    expect(a.critical).toBe(false);
  });

  it('درصد ۱۰۰ با شروع واقعی: مدت برنامه‌ای حفظ می‌شود', () => {
    const t = abm();
    t[0] = { ...(t[0] as ReturnType<typeof task>), actualStart: '2026-09-01', percentComplete: 100 };
    const s = ok(computeSchedule(input(t)));
    expect([row(s, 1).duration, row(s, 1).percent]).toEqual([5, 100]);
  });

  it('سرریز افق: تاریخ null و هشدار، ولی اندیس‌ها محاسبه می‌شوند', () => {
    const t = abm();
    t[0] = { ...(t[0] as ReturnType<typeof task>), duration: 3000 };
    const s = ok(computeSchedule(input(t)));
    expect(row(s, 1).earlyFinish).toBe(3000);
    expect(row(s, 1).startDate).toBe('2026-09-01');
    expect(row(s, 1).finishDate).toBeNull();
    expect(row(s, 3).startDate).toBeNull();
    expect(s.projectFinish).toBe(3003);
    expect(s.warnings.filter((w) => w.code === 'HORIZON_OVERFLOW').length).toBeGreaterThan(0);
  });

  it('تاریخ وضعیت پیش از شروع پروژه اثری ندارد', () => {
    const s = ok(computeSchedule(input(abm(), { status: '2026-08-01' })));
    expect(s.statusIndex).toBe(0);
    expect(s.tasks.map((x) => x.earlyStart)).toEqual([0, 5, 8]);
  });

  it('فعالیت شروع‌نشده پیش از تاریخ وضعیت برنامه‌ریزی نمی‌شود', () => {
    const s = ok(computeSchedule(input(abm(), { status: '2026-09-07' })));
    expect(s.statusIndex).toBe(5);
    expect(row(s, 1).earlyStart).toBe(5);
  });

  it('قید «شروع نه زودتر از»', () => {
    const t = abm();
    t[0] = { ...(t[0] as ReturnType<typeof task>), startNoEarlierThan: '2026-09-07', startNoEarlierSource: 'manual' };
    const s = ok(computeSchedule(input(t)));
    expect(row(s, 1).earlyStart).toBe(5);
    expect(row(s, 3).earlyFinish).toBe(13);
  });
});

describe('انواع وابستگی و lag', () => {
  const two = (type: 'FS' | 'SS' | 'FF' | 'SF', lag: number) => [
    task({ id: 1, duration: 5 }),
    task({ id: 2, duration: 3, dependencies: [dep(1, type, lag)] }),
  ];
  const es2 = (type: 'FS' | 'SS' | 'FF' | 'SF', lag: number): number => row(ok(computeSchedule(input(two(type, lag)))), 2).earlyStart;
  it('FS', () => {
    expect(es2('FS', 0)).toBe(5);
    expect(es2('FS', 2)).toBe(7);
    expect(es2('FS', -2)).toBe(3);
  });
  it('SS', () => {
    expect(es2('SS', 0)).toBe(0);
    expect(es2('SS', 2)).toBe(2);
  });
  it('FF: پایان B همزمان با پایان A', () => {
    expect(es2('FF', 0)).toBe(2); // EF_B = 5 ⇒ ES_B = 2
  });
  it('SF', () => {
    expect(es2('SF', 4)).toBe(1); // ES_A + 4 − 3
  });
  it('چند پیش‌نیاز: بزرگ‌ترین', () => {
    const t = [task({ id: 1, duration: 2 }), task({ id: 2, duration: 7 }), task({ id: 3, duration: 1, dependencies: [dep(1), dep(2)] })];
    expect(row(ok(computeSchedule(input(t))), 3).earlyStart).toBe(7);
  });
});

describe('فعالیت خلاصه', () => {
  const tree = () => [
    task({ id: 10, kind: 'summary', level: 1 }),
    task({ id: 11, level: 2, duration: 4, weight: 1, percentComplete: 100, actualStart: '2026-09-01', actualFinish: '2026-09-03' }),
    task({ id: 12, level: 2, duration: 6, weight: 3, percentComplete: 20, dependencies: [dep(11)] }),
    task({ id: 13, level: 1, duration: 2, dependencies: [dep(10)] }),
  ];
  it('بازه و درصد از فرزندان مشتق می‌شود', () => {
    const s = ok(computeSchedule(input(tree(), { status: '2026-09-03' })));
    const g = row(s, 10);
    expect(g.earlyStart).toBe(row(s, 11).earlyStart);
    expect(g.earlyFinish).toBe(row(s, 12).earlyFinish);
    expect(g.duration).toBe(g.earlyFinish - g.earlyStart);
    expect(g.percent).toBeCloseTo((1 * 100 + 3 * 20) / 4, 9);
    expect(s.leavesOf.get(10)).toEqual([11, 12]);
  });
  it('وابسته به خلاصه یعنی بعد از پایان همه‌ی زیرمجموعه', () => {
    const s = ok(computeSchedule(input(tree(), { status: '2026-09-03' })));
    expect(row(s, 13).earlyStart).toBe(row(s, 10).earlyFinish);
  });
  it('خلاصه‌ی بدون فرزند صفر است', () => {
    const s = ok(computeSchedule(input([task({ id: 1, kind: 'summary' }), task({ id: 2, duration: 3 })])));
    expect([row(s, 1).earlyStart, row(s, 1).earlyFinish, row(s, 1).duration, row(s, 1).percent]).toEqual([0, 0, 0, 0]);
  });
  it('خلاصه‌ی تو در تو همه‌ی نوه‌ها را می‌گیرد', () => {
    const t = [
      task({ id: 1, kind: 'summary', level: 1 }),
      task({ id: 2, kind: 'summary', level: 2 }),
      task({ id: 3, level: 3, duration: 2 }),
      task({ id: 4, level: 2, duration: 5 }),
    ];
    const s = ok(computeSchedule(input(t)));
    expect(s.leavesOf.get(1)).toEqual([3, 4]);
    expect(s.leavesOf.get(2)).toEqual([3]);
    expect(row(s, 1).earlyFinish).toBe(5);
    expect(row(s, 2).earlyFinish).toBe(2);
  });
});

describe('مسیر بحرانی و شناوری', () => {
  it('شاخه‌ی کوتاه‌تر شناور دارد', () => {
    const t = [
      task({ id: 1, duration: 5 }),
      task({ id: 2, duration: 2 }),
      task({ id: 3, duration: 1, dependencies: [dep(1), dep(2)] }),
    ];
    const s = ok(computeSchedule(input(t)));
    expect(row(s, 2).totalFloat).toBe(3);
    expect(row(s, 2).critical).toBe(false);
    expect(row(s, 1).critical).toBe(true);
  });
  it('فعالیت کامل‌شده بحرانی نیست', () => {
    const t = [task({ id: 1, duration: 3, percentComplete: 100, actualStart: '2026-09-01', actualFinish: '2026-09-03' })];
    expect(row(ok(computeSchedule(input(t, { status: '2026-09-05' }))), 1).critical).toBe(false);
  });
  it('LoE در پایان پروژه و بحرانی بودن شرکت نمی‌کند', () => {
    const t = [task({ id: 1, duration: 3 }), task({ id: 2, duration: 40, levelOfEffort: true })];
    const s = ok(computeSchedule(input(t)));
    expect(s.projectFinish).toBe(3);
    expect(row(s, 2).critical).toBe(false);
  });
});

describe('LoE و پیش‌نیازها (D-029)', () => {
  it('LoE بلند با پیوند SS از اولین فعالیت، شناوری و بحرانی بودن پیش‌نیاز را عوض نمی‌کند', () => {
    // مسیر اصلی ۱→۲ (۱۰ روز) و فعالیت مستقل ۳ با شناوری؛ «نظارت» ۱۵ روزه با SS از فعالیت ۳ (که شناور است)
    const base = [
      task({ id: 1, name: 'A', duration: 5 }),
      task({ id: 2, name: 'B', duration: 5, dependencies: [dep(1)] }),
      task({ id: 3, name: 'C', duration: 2 }),
    ];
    const without = ok(computeSchedule(input(base)));
    const withLoe = ok(computeSchedule(input([...base, task({ id: 4, name: 'نظارت', duration: 15, levelOfEffort: true, dependencies: [dep(3, 'SS')] })])));
    expect(withLoe.projectFinish).toBe(without.projectFinish); // LoE پایان پروژه را تعیین نمی‌کند
    for (const id of [1, 2, 3]) {
      expect(row(withLoe, id).totalFloat).toBe(row(without, id).totalFloat);
      expect(row(withLoe, id).critical).toBe(row(without, id).critical);
    }
    expect(row(withLoe, 3).critical).toBe(false);
    expect(row(withLoe, 4).critical).toBe(false);
  });

  it('LoE که فعالیتِ بحرانی به آن وابسته است، قید را به پیش‌نیازش می‌رساند (شناوری بیش‌ازحد نمی‌گیرد)', () => {
    // ۲(۵ روز) ← «نظارت»(LoE) ← ۴(۱۰ روز): مسیر ۲→LoE→۴ از فعالیت ۱ (۱۰ روز) بلندتر و بحرانی است؛ LoE خودش بحرانی حساب نمی‌شود
    const t = [
      task({ id: 1, name: 'مستقل', duration: 10 }),
      task({ id: 2, name: 'پیش‌نیاز', duration: 5 }),
      task({ id: 3, name: 'نظارت', duration: 1, levelOfEffort: true, dependencies: [dep(2)] }),
      task({ id: 4, name: 'بحرانی', duration: 10, dependencies: [dep(3)] }),
    ];
    const s = ok(computeSchedule(input(t)));
    expect(s.projectFinish).toBe(16);
    expect(row(s, 2).totalFloat).toBe(0);
    expect(row(s, 2).critical).toBe(true);
    expect(row(s, 4).critical).toBe(true);
    expect(row(s, 3).critical).toBe(false);
    expect(row(s, 1).totalFloat).toBe(6);
    // به‌تعویق‌انداختن ۱ روزه‌ی فعالیت ۲ (فراتر از شناوری ۰) باید پایان پروژه را عقب ببرد
    const later = ok(computeSchedule(input(t.map((x) => (x.id === 2 ? { ...x, startNoEarlierThan: s.axis.dateAt(row(s, 2).earlyStart + 1), startNoEarlierSource: 'manual' as const } : x)))));
    expect(later.projectFinish).toBe(17);
  });

  it('LoE بدون پسین واقعی پیش‌نیازش را محدود نمی‌کند، حتی اگر داخل یک فاز باشد', () => {
    const t = [
      task({ id: 1, name: 'فاز', kind: 'summary', level: 1 }),
      task({ id: 2, name: 'الف', level: 2, duration: 3 }),
      task({ id: 3, name: 'نظارت', level: 2, duration: 20, levelOfEffort: true, dependencies: [dep(2, 'SS')] }),
      task({ id: 4, name: 'ب', level: 1, duration: 10 }),
    ];
    const s = ok(computeSchedule(input(t)));
    expect(s.projectFinish).toBe(10);
    expect(row(s, 2).totalFloat).toBe(7);
    expect(row(s, 2).critical).toBe(false);
  });
});

describe('مدت از کار و تخصیص', () => {
  it('گردکردن رو به بالا با تحمل عددی: ۳ نفر-روز با ۳۰٪ = ۱۰ روز (نه ۱۱)', () => {
    const t = [task({ id: 1, duration: 99, work: 3, assignments: [{ resourceId: 1, units: 30 }] })];
    expect(row(ok(computeSchedule(input(t))), 1).duration).toBe(10);
  });
  it('حداقل یک روز', () => {
    const t = [task({ id: 1, duration: 99, work: 0.1, assignments: [{ resourceId: 1, units: 100 }] })];
    expect(row(ok(computeSchedule(input(t))), 1).duration).toBe(1);
  });
  it('بدون تخصیص مثبت از مدت ورودی', () => {
    const t = [task({ id: 1, duration: 7, work: 5, assignments: [{ resourceId: 1, units: 0 }] })];
    expect(row(ok(computeSchedule(input(t))), 1).duration).toBe(7);
  });
  it('فعالیت در حال انجام: مدت = گذشته + باقی‌مانده', () => {
    const t = [task({ id: 1, duration: 10, actualStart: '2026-09-01', percentComplete: 40 })];
    const s = ok(computeSchedule(input(t, { status: '2026-09-07' })));
    // سپری‌شده ۵ روز کاری، باقی‌مانده ceil(10×0.6)=6 ⇒ ۱۱
    expect(row(s, 1).duration).toBe(11);
    const ax = s.axis;
    expect(effectiveDuration(t[0] as ReturnType<typeof task>, ax, s.statusIndex)).toBe(11);
  });
});

describe('خطا و هشدار', () => {
  it('دور: فقط اعضای حلقه گزارش می‌شوند', () => {
    const t = [
      task({ id: 1, duration: 1, dependencies: [dep(3)] }),
      task({ id: 2, duration: 1, dependencies: [dep(1)] }),
      task({ id: 3, duration: 1, dependencies: [dep(2)] }),
      task({ id: 4, duration: 1 }),
      task({ id: 5, duration: 1, dependencies: [dep(3)] }),
    ];
    const r = computeSchedule(input(t));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error).toBe('CYCLE');
      expect(r.taskIds).toEqual([1, 2, 3]);
    }
  });
  it('شناسه‌ی تکراری', () => {
    const r = computeSchedule(input([task({ id: 1 }), task({ id: 1 })]));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toBe('DUPLICATE_ID');
  });
  it('پیش‌نیاز ناموجود و خود-وابستگی نادیده و هشدار داده می‌شود', () => {
    const s = ok(computeSchedule(input([task({ id: 1, duration: 2, dependencies: [dep(99), dep(1)] })])));
    expect(s.warnings.map((w) => w.code).sort()).toEqual(['SELF_DEPENDENCY', 'UNKNOWN_PREDECESSOR']);
    expect(row(s, 1).earlyStart).toBe(0);
  });
  it('پایان واقعی پیش از شروع واقعی: هشدار مدت غیرمثبت', () => {
    const t = [task({ id: 1, duration: 3, actualStart: '2026-09-10', actualFinish: '2026-09-08' })];
    const s = ok(computeSchedule(input(t, { status: '2026-09-12' })));
    expect(row(s, 1).duration).toBeLessThanOrEqual(0);
    expect(s.warnings.some((w) => w.code === 'NON_POSITIVE_DURATION')).toBe(true);
  });
  it('پروژه‌ی خالی', () => {
    const s = ok(computeSchedule(input([])));
    expect(s.projectFinish).toBe(0);
    expect(s.tasks).toEqual([]);
  });
});
