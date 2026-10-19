import { describe, expect, it } from 'vitest';
import { buildBaseline } from '../src/baseline.ts';
import { computeFinance, plannedCost, laborCost, directCost, actualCost, forecastTaskCost } from '../src/finance.ts';
import { computeProgress, plannedFraction } from '../src/progress.ts';
import { computeSCurve } from '../src/scurve.ts';
import { computeSchedule } from '../src/scheduling.ts';
import { estimateSnapshots, recordSnapshot, snapshotActual } from '../src/snapshots.ts';
import type { Baseline, CostEntry, Resource, Snapshot } from '../src/types.ts';
import { dep, input, task } from './fixtures.ts';

function sched(tasks: ReturnType<typeof task>[], status: string) {
  const r = computeSchedule(input(tasks, { status: status as `${number}-${number}-${number}` }));
  if (!r.ok) throw new Error('cycle');
  return r;
}

describe('پیشرفت (مثال t17 قدیمی)', () => {
  const mk = (p = 0, as: string | null = null) => [
    task({ id: 1, name: 'A', duration: 4, weight: 4, percentComplete: p, actualStart: as as never }),
    task({ id: 2, name: 'B', duration: 6, weight: 6, dependencies: [dep(1)] }),
  ];
  const baselineAt = (): Baseline => buildBaseline(mk(), sched(mk(), '2026-09-01'), () => 0).baseline;

  it('درصد برنامه‌ای روز دوم = ۲۰٪', () => {
    const t = mk();
    const s = sched(t, '2026-09-02');
    const m = computeProgress(t, s, baselineAt());
    expect(m.planned).toBeCloseTo(20, 9);
    expect(m.actual).toBe(0);
    expect(m.statusIndex).toBe(1);
  });
  it('۵۰٪ پیشرفت A ⇒ واقعی ۲۰٪ و بدون تأخیر', () => {
    const t = mk(50, '2026-09-01');
    const s = sched(t, '2026-09-02');
    const m = computeProgress(t, s, baselineAt());
    expect(m.actual).toBeCloseTo(20, 9);
    expect(m.delay).toBe(0);
    expect(m.delayedTaskIds).toEqual([]);
  });
  it('تأخیر: پایان پیش‌بینی بعد از خط مبنا', () => {
    const t = mk(50, '2026-09-01');
    const s = sched(t, '2026-09-15'); // ۱۲ روز کاری سپری، A هنوز ۵۰٪
    const m = computeProgress(t, s, baselineAt());
    expect(m.forecastFinish).toBe(20);
    expect(m.baselineFinish).toBe(10);
    expect(m.delay).toBe(10);
    expect(m.delayedTaskIds).toEqual([1, 2]);
  });
  it('plannedFraction: مایلستون و حالت عادی', () => {
    expect(plannedFraction({ earlyStart: 3, duration: 0 }, 2)).toBe(0);
    expect(plannedFraction({ earlyStart: 3, duration: 0 }, 3)).toBe(1);
    expect(plannedFraction({ earlyStart: 2, duration: 4 }, 0)).toBe(0);
    expect(plannedFraction({ earlyStart: 2, duration: 4 }, 3)).toBe(0.5);
    expect(plannedFraction({ earlyStart: 2, duration: 4 }, 99)).toBe(1);
  });
});

describe('اسنپ‌شات و منحنی S (مثال t17 قدیمی)', () => {
  const t = [
    task({ id: 1, name: 'A', duration: 4, weight: 4, percentComplete: 50, actualStart: '2026-09-01' }),
    task({ id: 2, name: 'B', duration: 6, weight: 6, dependencies: [dep(1)] }),
  ];
  const base0 = (): Baseline => {
    const clean = t.map((x) => ({ ...x, percentComplete: 0, actualStart: null }));
    return buildBaseline(clean, sched(clean, '2026-09-01'), () => 0).baseline;
  };

  it('ثبت اسنپ‌شات واقعی', () => {
    const s = sched(t, '2026-09-02');
    const progress = computeProgress(t, s, base0());
    const list = recordSnapshot({ existing: [], status: '2026-09-02', progress, tasks: t, schedule: s, actualCost: 0 });
    expect(list).toHaveLength(1);
    const q = list[0] as Snapshot;
    expect(q.date).toBe('2026-09-02');
    expect(q.actual).toBeCloseTo(20, 9);
    expect(q.planned).toBeCloseTo(20, 9);
    expect(q.estimated).toBe(false);
    expect(q.tasks).toEqual({ 1: 50, 2: 0 });
    expect(q.actualCost).toBe(0);
  });
  it('ثبت دوباره در همان تاریخ جایگزین می‌شود و تخمینی‌های بعدتر پاک می‌شوند', () => {
    const s = sched(t, '2026-09-02');
    const progress = computeProgress(t, s, base0());
    const existing: Snapshot[] = [
      { date: '2026-09-02', actual: 1, estimated: false },
      { date: '2026-09-05', actual: 5, estimated: true },
      { date: '2026-08-30', actual: 0, estimated: true },
    ];
    const list = recordSnapshot({ existing, status: '2026-09-02', progress, tasks: t, schedule: s, actualCost: 0 });
    expect(list.map((x) => [x.date, x.estimated])).toEqual([
      ['2026-08-30', true],
      ['2026-09-02', false],
    ]);
  });
  it('بازسازی تخمینی هر پنج روز کاری', () => {
    const s = sched(t, '2026-09-15'); // اندیس ۱۲
    expect(s.statusIndex).toBe(12);
    const est = estimateSnapshots(t, s);
    expect(est.map((x) => [x.date, Math.round(x.actual * 10) / 10, x.estimated])).toEqual([
      ['2026-09-06', 7.7, true],
      ['2026-09-12', 15.4, true],
    ]);
  });
  it('داده‌ی منحنی S', () => {
    const s = sched(t, '2026-09-15');
    const progress = computeProgress(t, s, base0());
    const est = estimateSnapshots(t, s);
    const c = computeSCurve({ tasks: t, schedule: s, baseline: base0(), snapshots: est, progress, status: '2026-09-15', contractEnd: null });
    expect(c.length).toBe(23);
    expect(c.statusX).toBe(13);
    expect(c.plannedAtStatus).toBeCloseTo(100, 9);
    expect(c.actual.map((p) => [p.x, Math.round(p.y * 10) / 10])).toEqual([
      [5, 7.7],
      [10, 15.4],
      [13, 20],
    ]);
    expect(c.forecast).toHaveLength(8);
    expect(c.forecast[0]).toEqual([13, 20]);
    const last = c.forecast[c.forecast.length - 1] as readonly [number, number];
    expect(last[0]).toBe(20);
    expect(Math.round(last[1])).toBe(100);
    expect(c.contractEndX).toBeNull();
  });
  it('پیشرفت اسنپ‌شات با وزن‌های فعلی بازمحاسبه می‌شود', () => {
    const q: Snapshot = { date: '2026-09-02', actual: 99, estimated: false, tasks: { 1: 50, 2: 0 } };
    expect(snapshotActual(q, t)).toBeCloseTo(20, 9);
    expect(snapshotActual({ date: '2026-09-02', actual: 33, estimated: true }, t)).toBe(33);
  });
});

describe('مالی و EVM (مثال t19 قدیمی)', () => {
  const resources: Resource[] = [
    { id: 1, name: 'ENG', type: 'human', capacityPercent: 100, dailyRate: 1000 },
    { id: 2, name: 'CASH', type: 'financial', capacityPercent: 100, dailyRate: 5000 },
  ];
  const mk = (pA = 0) => [
    task({
      id: 1,
      name: 'A',
      duration: 4,
      weight: 4,
      percentComplete: pA,
      assignments: [
        { resourceId: 1, units: 100 },
        { resourceId: 2, units: 100 },
      ],
      directCosts: [{ name: 'x', amount: 500 }],
    }),
    task({ id: 2, name: 'B', duration: 6, weight: 6, dependencies: [dep(1)], assignments: [{ resourceId: 1, units: 50 }] }),
  ];
  const fin = (tasks: ReturnType<typeof mk>, ledger: CostEntry[] = [], baseline: Baseline = {}) =>
    computeFinance({ tasks, schedule: sched(tasks, '2026-09-01'), baseline, resources, ledger });

  it('هزینه‌ی برنامه‌ای: منبع مالی خارج است', () => {
    const t = mk();
    expect(laborCost(t[0] as never, resources)).toBe(4000);
    expect(directCost(t[0] as never)).toBe(500);
    expect(plannedCost(t[0] as never, resources)).toBe(4500);
    expect(plannedCost(t[1] as never, resources)).toBe(3000);
  });
  it('بدون هزینه‌ی واقعی', () => {
    const f = fin(mk());
    expect([f.bac, f.currentPlanned, f.ac, f.ev, f.pv, f.eac, f.forecastWithOverhead]).toEqual([7500, 7500, 0, 0, 1125, 7500, 7500]);
    expect(f.cpi).toBeNull();
    expect(f.tcpi).toBe(1);
  });
  it('دفتر هزینه: سربار جدا و تاریخ آینده بی‌اثر در AC', () => {
    const ledger: CostEntry[] = [
      { id: 1, date: '2026-12-01', taskId: 1, description: 'a', document: '', amount: 300 },
      { id: 2, date: '2026-09-02', taskId: 2, description: 'b', document: '', amount: 200 },
      { id: 3, date: '2026-09-02', taskId: null, description: 'g', document: '', amount: 50 },
    ];
    const f = fin(mk(), ledger);
    expect([f.ac, f.overhead, f.totalActualWithOverhead, f.eac, f.forecastWithOverhead]).toEqual([500, 50, 550, 8000, 8050]);
  });
  it('۵۰٪ پیشرفت A', () => {
    const ledger: CostEntry[] = [
      { id: 1, date: '2026-12-01', taskId: 1, description: 'a', document: '', amount: 300 },
      { id: 2, date: '2026-09-02', taskId: 2, description: 'b', document: '', amount: 200 },
      { id: 3, date: '2026-09-02', taskId: null, description: 'g', document: '', amount: 50 },
    ];
    const t = mk(50);
    const f = fin(t, ledger);
    expect(f.bac).toBe(7500);
    expect(f.ac).toBe(500);
    expect(f.ev).toBe(2250);
    expect(f.pv).toBe(1125);
    expect(f.cpi).toBe(4.5);
    expect(f.eac).toBe(5750);
    expect(f.forecastWithOverhead).toBe(5800);
    expect(f.tcpi).toBeCloseTo(0.75, 12);
    expect(f.etc).toBe(5250);
    expect(f.vac).toBe(1750);
    expect(forecastTaskCost(t[0] as never, 50, {}, resources, ledger)).toBe(2550);
    expect(forecastTaskCost(t[1] as never, 0, {}, resources, ledger)).toBe(3200);
  });
  it('هزینه‌ی خط مبنا با تغییر برآورد ثابت می‌ماند (قفل BAC)', () => {
    const t = mk();
    const base = buildBaseline(t, sched(t, '2026-09-01'), (x) => plannedCost(x, resources)).baseline;
    const changed = mk();
    changed[0] = { ...(changed[0] as never as ReturnType<typeof task>), directCosts: [{ name: 'x', amount: 900 }] };
    const f = fin(changed, [], base);
    expect(f.bac).toBe(7500);
    expect(f.currentPlanned).toBe(7900);
  });
  it('هزینه‌ی واقعی قدیمی روی فعالیت فقط وقتی ثبت دفتر نیست', () => {
    const t = task({ id: 5, legacyActualCost: 700 });
    expect(actualCost(t, [])).toBe(700);
    expect(actualCost(t, [{ id: 1, date: '2026-09-01', taskId: 5, description: '', document: '', amount: 100 }])).toBe(100);
  });
  it('روش‌های EAC', () => {
    const t = mk(50);
    const s = sched(t, '2026-09-01');
    const led: CostEntry[] = [{ id: 1, date: '2026-09-02', taskId: 1, description: '', document: '', amount: 1000 }];
    const base = { schedule: s, baseline: {}, resources, ledger: led, tasks: t };
    const cpi = computeFinance({ ...base, method: 'cpi' });
    expect(cpi.eac).toBeCloseTo(7500 / (2250 / 1000), 9);
    const both = computeFinance({ ...base, method: 'both' });
    expect(both.eac).toBeCloseTo(1000 + (7500 - 2250) / ((2250 / 1000) * (2250 / 1125)), 9);
  });
});
