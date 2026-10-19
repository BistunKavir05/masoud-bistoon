import { describe, expect, it } from 'vitest';
import { analyzeProject, buildBaseline, defaultCalendar, plannedCost } from '@bistoon/core';
import type { Analysis, ProjectModel, Task, TaskDto } from '@bistoon/core';
import { buildRows } from '../src/tabs/tasks/rows.ts';
import { PX_PER_DAY, ROW_H, barGeom, buildLinks, linkPath, rowCenter, timeBands } from '../src/tabs/gantt/layout.ts';

const mk = (p: Partial<Task> & { id: number }): TaskDto => {
  const kind = p.kind ?? 'task';
  return {
    name: `T${p.id}`,
    level: 1,
    kind,
    duration: kind === 'task' ? 1 : 0,
    dependencies: [],
    weight: kind === 'summary' ? 0 : 1,
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
    version: 1,
    ...p,
  };
};

function model(tasks: TaskDto[], over: Partial<ProjectModel> = {}): ProjectModel {
  return {
    name: 'x',
    start: '2026-09-12',
    status: '2026-09-12',
    contractEnd: null,
    calendar: defaultCalendar(),
    tasks,
    resources: [],
    baseline: {},
    baselineHistory: [],
    snapshots: [],
    costs: [],
    finance: { unit: 'ریال', budget: 0, eacMethod: 'remaining' },
    charter: {} as ProjectModel['charter'],
    contract: {} as ProjectModel['contract'],
    risks: [],
    issues: [],
    changes: [],
    decisions: [],
    documents: [],
    ...over,
  };
}

function analyze(m: ProjectModel): Analysis {
  const a = analyzeProject(m);
  if (!('schedule' in a)) throw new Error('cycle');
  return a;
}

describe('هندسه‌ی گانت', () => {
  const tasks = [
    mk({ id: 1, name: 'گروه', kind: 'summary', level: 1 }),
    mk({ id: 2, name: 'الف', duration: 4, level: 2 }),
    mk({ id: 3, name: 'ب', duration: 6, level: 2, dependencies: [{ predecessorId: 2, type: 'FS', lag: 0 }] }),
    mk({ id: 4, name: 'مایلستون', kind: 'milestone', level: 1, dependencies: [{ predecessorId: 3, type: 'FS', lag: 0 }] }),
  ];

  it('میله‌ی هر فعالیت از اندیس و مدت موتور می‌آید؛ خلاصه و مایلستون نوع خودشان را دارند', () => {
    const m = model(tasks);
    const a = analyze(m);
    const rows = buildRows(m.tasks as TaskDto[], a, m.resources, null);
    const px = PX_PER_DAY.day;
    const g = (id: number) => barGeom(rows.find((r) => r.t.id === id)!, null, a.schedule.axis, px)!;
    expect(g(2)).toMatchObject({ kind: 'task', x: 0, w: 4 * px, doneW: 0 });
    expect(g(3)).toMatchObject({ kind: 'task', x: 4 * px, w: 6 * px });
    expect(g(1).kind).toBe('summary');
    expect(g(1).w).toBe(10 * px);
    expect(g(4)).toMatchObject({ kind: 'milestone', x: 10 * px, w: 0 });
    expect(g(2).base).toBeNull();
  });

  it('خط مبنا و پیشرفت: میله‌ی مبنا با تاریخ ثبت‌شده و بخش انجام‌شده متناسب با درصد', () => {
    const m0 = model(tasks);
    const a0 = analyze(m0);
    const base = buildBaseline(m0.tasks, a0.schedule, (t) => plannedCost(t, [])).baseline;
    // «الف» ۵۰٪ پیشرفت
    const t2 = tasks.map((t) => (t.id === 2 ? { ...t, percentComplete: 50, actualStart: '2026-09-12' as const } : t));
    const m = model(t2, { baseline: base });
    const a = analyze(m);
    const rows = buildRows(m.tasks as TaskDto[], a, [], base);
    const px = 10;
    const g = barGeom(rows.find((r) => r.t.id === 2)!, base, a.schedule.axis, px)!;
    expect(g.doneW).toBeCloseTo(g.w * 0.5, 9);
    expect(g.base).toEqual({ x: 0, w: 4 * px, zero: false });
  });

  it('خطوط ارتباط: یکی به‌ازای هر وابستگی و فقط بین ردیف‌های نمایان', () => {
    const m = model(tasks);
    const a = analyze(m);
    const rows = buildRows(m.tasks as TaskDto[], a, [], null);
    const geoms = new Map(rows.map((r) => [r.t.id, barGeom(r, null, a.schedule.axis, 20)!]));
    const all = buildLinks(rows, geoms);
    expect(all.map((l) => l.key).sort()).toEqual(['2>3', '3>4']);
    // گروه بسته: ردیف‌های ۲ و ۳ پنهان‌اند
    const hidden = rows.filter((r) => r.t.id === 1 || r.t.id === 4);
    expect(buildLinks(hidden, geoms)).toEqual([]);
  });

  it('نوارهای ماه: عرض هر ماه = تعداد روز کاری × px؛ سال در ماه‌های پهن می‌آید و ماه خیلی باریک بی‌برچسب است', () => {
    const m = model(tasks);
    const a = analyze(m);
    const { months, ticks } = timeBands(a.schedule.axis, 120, 'day');
    expect(months.length).toBeGreaterThan(3);
    expect(months.reduce((s, b) => s + b.w, 0)).toBeCloseTo(120 * PX_PER_DAY.day, 6);
    expect(/۱۴۰۵/.test(months[0]!.label)).toBe(true);
    expect(months.slice(0, -1).every((m) => /۱۴۰[۵۶]/.test(m.label))).toBe(true);
    expect(ticks).toHaveLength(120);
    const week = timeBands(a.schedule.axis, 120, 'week');
    expect(week.ticks.length).toBeLessThan(40);
    expect(timeBands(a.schedule.axis, 120, 'month').ticks).toEqual([]);
  });
});

describe('مسیر خط ارتباط', () => {
  const a = { start: 100, end: 160, y: rowCenter(0) };
  const b = { start: 200, end: 260, y: rowCenter(1) };
  it('FS رو به جلو: از پایان پیش‌نیاز تا آغاز پس‌نیاز بدون دور اضافه', () => {
    expect(linkPath('FS', a, b)).toBe(`M160,${rowCenter(0)}H167V${rowCenter(1)}H200`);
  });
  it('FS برگشتی (پس‌نیاز زودتر شروع می‌شود): از میان ردیف‌ها دور می‌زند و به آغاز می‌رسد', () => {
    const d = linkPath('FS', { start: 100, end: 300, y: rowCenter(0) }, b);
    expect(d.startsWith(`M300,${rowCenter(0)}H307V${rowCenter(0) + ROW_H / 2}`)).toBe(true);
    expect(d.endsWith(`V${rowCenter(1)}H200`)).toBe(true);
  });
  it('SS، FF و SF به نقطه‌ی درست می‌رسند', () => {
    expect(linkPath('SS', a, b).endsWith(`H200`)).toBe(true);
    expect(linkPath('SS', a, b).startsWith(`M100,`)).toBe(true);
    expect(linkPath('FF', a, b).startsWith(`M160,`)).toBe(true);
    expect(linkPath('FF', a, b).endsWith(`H260`)).toBe(true);
    expect(linkPath('SF', a, b).startsWith(`M100,`)).toBe(true);
    expect(linkPath('SF', a, b).endsWith(`H260`)).toBe(true);
  });
});
