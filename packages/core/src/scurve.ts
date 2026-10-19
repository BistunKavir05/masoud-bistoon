/**
 * داده‌ی منحنی S: برنامه‌ای (خط مبنا)، واقعی (اسنپ‌شات‌ها + نقطه‌ی امروز) و پیش‌بینی.
 * محور x «تعداد روز کاری سپری‌شده» است (۰ = ابتدای پروژه).
 */
import type { Schedule } from './scheduling.ts';
import { baselineOrCurrent } from './baseline.ts';
import { plannedFraction, type ProgressMetrics } from './progress.ts';
import { snapshotActual } from './snapshots.ts';
import type { Baseline, Snapshot, Task } from './types.ts';
import type { IsoDate } from './date.ts';

export type CurvePoint = readonly [x: number, y: number];

export interface ActualPoint {
  x: number;
  y: number;
  /** null برای نقطه‌ی «وضعیت جاری» که اسنپ‌شات نیست */
  snapshot: Snapshot | null;
}

export interface SCurve {
  /** آخرین مقدار محور x */
  length: number;
  /** x نقطه‌ی وضعیت جاری (= اندیس وضعیت + ۱) */
  statusX: number;
  planned: CurvePoint[];
  actual: ActualPoint[];
  forecast: CurvePoint[];
  /** درصد برنامه‌ای در وضعیت جاری */
  plannedAtStatus: number;
  /** x تاریخ پایان قرارداد روی محور، یا null */
  contractEndX: number | null;
}

/** اولین اندیس با تاریخ بعد از `iso` (انحصاری)؛ اگر نبود طول محور */
export function indexAfterDate(schedule: Schedule, iso: IsoDate): number {
  return schedule.axis.after(iso);
}

export function computeSCurve(args: {
  tasks: readonly Task[];
  schedule: Schedule;
  baseline: Baseline;
  snapshots: readonly Snapshot[];
  progress: ProgressMetrics;
  status: IsoDate;
  contractEnd: IsoDate | null;
}): SCurve {
  const { tasks, schedule, baseline, snapshots, progress, status, contractEnd } = args;
  const leaves = tasks.filter((t) => t.kind !== 'summary');
  const sw = progress.totalWeight || 1;
  const endIdx = contractEnd ? indexAfterDate(schedule, contractEnd) : 0;
  const length = Math.max(schedule.projectFinish, progress.baselineFinish, endIdx) + 3;
  const s0 = progress.statusIndex + 1;

  const baseIdx = leaves.map((t) => baselineOrCurrent(t, schedule, baseline));
  const curIdx = leaves.map((t) => {
    const s = schedule.byId.get(t.id);
    return { earlyStart: s?.earlyStart ?? 0, duration: s?.duration ?? 0 };
  });
  const sumAt = (idx: readonly { earlyStart: number; duration: number }[], u: number): number => {
    if (u <= 0) return 0;
    let a = 0;
    for (let k = 0; k < leaves.length; k += 1) a += (leaves[k] as Task).weight * plannedFraction(idx[k] as { earlyStart: number; duration: number }, u - 1);
    return (a / sw) * 100;
  };
  const P = (u: number): number => sumAt(baseIdx, u);
  const C = (u: number): number => sumAt(curIdx, u);

  const planned: CurvePoint[] = [];
  for (let u = 0; u <= length; u += 1) planned.push([u, P(u)]);

  const actual: ActualPoint[] = snapshots
    .filter((q) => q.date !== status)
    .map((q) => ({ x: schedule.axis.onOrAfter(q.date) + 1, y: snapshotActual(q, tasks), snapshot: q as Snapshot | null }));
  actual.push({ x: s0, y: progress.actual, snapshot: null });
  actual.sort((a, b) => a.x - b.x);

  const cs = C(s0);
  const forecast: CurvePoint[] = [[s0, progress.actual]];
  if (progress.actual < 99.999 && cs < 99.999) {
    for (let u = s0 + 1; u <= length; u += 1) {
      const v = progress.actual + (100 - progress.actual) * Math.max(0, Math.min(1, (C(u) - cs) / (100 - cs)));
      forecast.push([u, v]);
      if (v >= 99.999) break;
    }
  }
  return { length, statusX: s0, planned, actual, forecast, plannedAtStatus: P(s0), contractEndX: contractEnd ? endIdx : null };
}
