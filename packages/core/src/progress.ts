/** شاخص‌های پیشرفت و زمان: درصد واقعی، برنامه‌ای (نسبت به خط مبنا)، پایان پیش‌بینی و تأخیر. */
import type { Schedule } from './scheduling.ts';
import { baselineOrCurrent, type BaselineIndices } from './baseline.ts';
import type { Baseline, Task } from './types.ts';

/** سهم برنامه‌ریزی‌شده‌ی یک فعالیت در انتهای روز کاری `i` (۰ تا ۱). مایلستون: پس از رسیدن به اندیسش ۱. */
export function plannedFraction(b: BaselineIndices, i: number): number {
  if (b.duration === 0) return i >= b.earlyStart ? 1 : 0;
  return Math.min(1, Math.max(0, (i + 1 - b.earlyStart) / b.duration));
}

export interface ProgressMetrics {
  /** پیشرفت واقعی وزنی (٪) */
  actual: number;
  /** پیشرفت برنامه‌ای وزنی نسبت به خط مبنا (٪) */
  planned: number;
  /** پایان خط مبنا (اندیس انحصاری)، بدون فعالیت‌های LoE */
  baselineFinish: number;
  /** پایان پیش‌بینی (اندیس انحصاری) */
  forecastFinish: number;
  /** forecastFinish − baselineFinish؛ مثبت = دیرکرد */
  delay: number;
  /** فعالیت‌های دارای دیرکرد: مدت دارند، پایان پیش‌بینی‌شان بعد از پایان خط مبنا است و کامل نشده‌اند */
  delayedTaskIds: number[];
  /** مجموع وزن‌ها (حداقل ۱ برای جلوگیری از تقسیم بر صفر) */
  totalWeight: number;
  statusIndex: number;
}

/** فعالیت‌های «برگ» برای محاسبات وزنی: همه‌ی غیرخلاصه‌ها (شامل مایلستون و LoE) */
export function leafTasks(tasks: readonly Task[]): Task[] {
  return tasks.filter((t) => t.kind !== 'summary');
}

export function computeProgress(tasks: readonly Task[], schedule: Schedule, baseline: Baseline): ProgressMetrics {
  const leaves = leafTasks(tasks);
  let sw = 0;
  for (const t of leaves) sw += t.weight;
  if (!sw) sw = 1;
  const si = schedule.statusIndex;
  let actualSum = 0;
  let plannedSum = 0;
  let bf = 0;
  const delayed: number[] = [];
  for (const t of leaves) {
    const s = schedule.byId.get(t.id);
    if (!s) continue;
    const b = baselineOrCurrent(t, schedule, baseline);
    actualSum += t.weight * s.percent;
    plannedSum += t.weight * plannedFraction(b, si);
    if (!t.levelOfEffort && b.earlyStart + b.duration > bf) bf = b.earlyStart + b.duration;
    if (s.duration > 0 && s.earlyFinish - (b.earlyStart + b.duration) > 0 && t.percentComplete < 100) delayed.push(t.id);
  }
  const ff = schedule.projectFinish;
  return {
    actual: actualSum / sw,
    planned: (plannedSum / sw) * 100,
    baselineFinish: bf,
    forecastFinish: ff,
    delay: ff - bf,
    delayedTaskIds: delayed,
    totalWeight: sw,
    statusIndex: si,
  };
}
