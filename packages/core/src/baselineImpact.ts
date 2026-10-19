/** پیش‌نمایش اثر تعریف خط مبنای جدید: مقایسه‌ی «قبل» و «بعد» پیش از آن‌که چیزی ذخیره شود. */
import type { IsoDate } from './date.ts';
import { baselineFinishIndex, buildBaseline } from './baseline.ts';
import type { BaselineBuildIssue } from './baseline.ts';
import { baselineCost, plannedCost } from './finance.ts';
import type { Schedule } from './scheduling.ts';
import type { Baseline, BaselineItem, Resource, Task } from './types.ts';

export interface BaselineSummary {
  /** تعداد فعالیت‌های دارای مقدار در خط مبنا */
  tasks: number;
  /** پایان برنامه‌ای (بدون فعالیت‌های پشتیبانی)، یا null اگر خالی است */
  finish: IsoDate | null;
  /** بودجه‌ی مبنا (BAC) */
  bac: number;
}

export interface BaselineImpact {
  /** خط مبنای فعلی؛ null اگر هنوز ثبت نشده */
  before: BaselineSummary | null;
  after: BaselineSummary;
  /** فعالیت‌هایی که تاریخ یا هزینه‌شان نسبت به خط مبنای فعلی فرق می‌کند */
  changed: number;
  /** فعالیت‌هایی که در خط مبنای فعلی نیستند */
  added: number;
  /** فعالیت‌هایی که در خط مبنای فعلی هستند ولی دیگر وجود ندارند */
  removed: number;
  issues: BaselineBuildIssue[];
}

/** خلاصه‌ی یک خط مبنا با فعالیت‌های فعلی. خط مبنای بدون عنصر خالی حساب می‌شود (برنامه‌ی فعلی جایگزین است). */
export function summarizeBaseline(tasks: readonly Task[], schedule: Schedule, baseline: Baseline, resources: readonly Resource[]): BaselineSummary {
  const loe = new Set<number>();
  const summary = new Set<number>();
  for (const t of tasks) {
    if (t.levelOfEffort) loe.add(t.id);
    if (t.kind === 'summary') summary.add(t.id);
  }
  const ids = Object.keys(baseline);
  const idx = baselineFinishIndex(baseline, schedule.axis, (id) => !loe.has(id) && !summary.has(id));
  let bac = 0;
  for (const t of tasks) if (t.kind !== 'summary') bac += baselineCost(t, baseline, resources);
  return { tasks: ids.length, finish: idx > 0 ? schedule.axis.dateAt(idx - 1) : null, bac };
}

const same = (a: BaselineItem, b: BaselineItem): boolean => a.start === b.start && a.finish === b.finish && a.zeroDuration === b.zeroDuration && (a.cost ?? 0) === (b.cost ?? 0);

export function previewBaseline(args: { tasks: readonly Task[]; schedule: Schedule; resources: readonly Resource[]; current: Baseline }): BaselineImpact {
  const { tasks, schedule, resources, current } = args;
  const built = buildBaseline(tasks, schedule, (t) => plannedCost(t, resources));
  const hasCurrent = Object.keys(current).length > 0;
  let changed = 0;
  let added = 0;
  let removed = 0;
  if (hasCurrent) {
    const present = new Set<number>();
    for (const t of tasks) {
      present.add(t.id);
      const old = current[t.id];
      const next = built.baseline[t.id];
      if (!old) added += next ? 1 : 0;
      else if (next && !same(old, next)) changed += 1;
    }
    for (const key of Object.keys(current)) if (!present.has(Number(key))) removed += 1;
  }
  return {
    before: hasCurrent ? summarizeBaseline(tasks, schedule, current, resources) : null,
    after: summarizeBaseline(tasks, schedule, built.baseline, resources),
    changed,
    added,
    removed,
    issues: built.issues,
  };
}
