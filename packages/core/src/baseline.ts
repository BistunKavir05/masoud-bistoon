/**
 * خط مبنا (Baseline): تصویری از تاریخ‌های برنامه و هزینه‌ی هر فعالیت.
 * برخلاف نسخه‌ی قبلی که اندیس روز کاری ذخیره می‌کرد، این‌جا «تاریخ» ذخیره می‌شود تا با تغییر تقویم (افزودن تعطیلی)
 * معنای خط مبنا جابه‌جا نشود؛ اندیس‌ها هر بار از تقویم جاری مشتق می‌شوند.
 */
import type { DayAxis } from './calendar.ts';
import type { Schedule } from './scheduling.ts';
import type { Baseline, BaselineItem, Task } from './types.ts';
import type { IsoDate } from './date.ts';

export interface BaselineIndices {
  earlyStart: number;
  duration: number;
}

export function baselineIndices(item: BaselineItem, axis: DayAxis): BaselineIndices {
  const es = axis.onOrAfter(item.start);
  const duration = item.zeroDuration ? 0 : Math.max(0, axis.onOrAfter(item.finish) - es + 1);
  return { earlyStart: es, duration };
}

/** اندیس‌های خط مبنای یک فعالیت؛ اگر خط مبنا ندارد، برنامه‌ی جاری (رفتار سازگاری). */
export function baselineOrCurrent(task: Pick<Task, 'id'>, schedule: Schedule, baseline: Baseline): BaselineIndices {
  const item = baseline[task.id];
  if (item) return baselineIndices(item, schedule.axis);
  const s = schedule.byId.get(task.id);
  return s ? { earlyStart: s.earlyStart, duration: s.duration } : { earlyStart: 0, duration: 0 };
}

export interface BaselineBuildIssue {
  taskId: number;
  message: string;
}

export interface BaselineBuild {
  baseline: Baseline;
  issues: BaselineBuildIssue[];
}

/**
 * خط مبنا را از برنامه‌ی جاری می‌سازد. `costOf` هزینه‌ی برنامه‌ای هر فعالیت را می‌دهد.
 * فعالیتی که تاریخش از افق بیرون است در خط مبنا نمی‌آید و در `issues` گزارش می‌شود.
 */
export function buildBaseline(tasks: readonly Task[], schedule: Schedule, costOf: (task: Task) => number): BaselineBuild {
  const items: Record<number, BaselineItem> = {};
  const issues: BaselineBuildIssue[] = [];
  const last = schedule.axis.length - 1;
  for (const t of tasks) {
    const s = schedule.byId.get(t.id);
    if (!s) continue;
    const zero = s.duration <= 0;
    const startIdx = Math.min(s.earlyStart, last);
    const start = schedule.axis.dateAt(startIdx) as IsoDate;
    if (s.earlyStart > last || (!zero && s.earlyStart + s.duration - 1 > last)) {
      issues.push({ taskId: t.id, message: 'تاریخ فعالیت از افق محاسبه بیرون است؛ در خط مبنا نیامد.' });
      continue;
    }
    const finish = zero ? start : (schedule.axis.dateAt(s.earlyStart + s.duration - 1) as IsoDate);
    items[t.id] = { start, finish, zeroDuration: zero, cost: costOf(t) };
  }
  return { baseline: items, issues };
}

/** پایان پروژه در یک خط مبنا (اندیس انحصاری): بیشینه‌ی ES + D */
export function baselineFinishIndex(baseline: Baseline, axis: DayAxis, only?: (taskId: number) => boolean): number {
  let max = 0;
  for (const key of Object.keys(baseline)) {
    const id = Number(key);
    if (only && !only(id)) continue;
    const b = baselineIndices(baseline[id] as BaselineItem, axis);
    if (b.earlyStart + b.duration > max) max = b.earlyStart + b.duration;
  }
  return max;
}
