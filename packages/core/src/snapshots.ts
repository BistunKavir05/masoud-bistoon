/** اسنپ‌شات‌های وضعیت: ثبت واقعی، بازسازی تخمینی از تاریخ‌های واقعی و پیشرفت واقعی از روی اسنپ‌شات. */
import type { IsoDate } from './date.ts';
import { compareIso } from './date.ts';
import type { Schedule } from './scheduling.ts';
import type { ProgressMetrics } from './progress.ts';
import type { Snapshot, SnapshotTaskProgress, Task } from './types.ts';

/** درصد پیشرفت هر فعالیت غیرخلاصه (گردشده به یک رقم اعشار) */
export function snapshotTaskProgress(tasks: readonly Task[], schedule: Schedule): SnapshotTaskProgress {
  const out: Record<number, number> = {};
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    const s = schedule.byId.get(t.id);
    out[t.id] = Math.round((s?.percent ?? 0) * 10) / 10;
  }
  return out;
}

/** پیشرفت واقعی یک اسنپ‌شات با وزن‌های فعلی؛ اگر جزئیات فعالیت‌ها ندارد همان مقدار ثبت‌شده. */
export function snapshotActual(snapshot: Snapshot, tasks: readonly Task[]): number {
  if (!snapshot.tasks) return snapshot.actual;
  let sw = 0;
  let sum = 0;
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    sw += t.weight;
    sum += t.weight * (snapshot.tasks[t.id] ?? 0);
  }
  if (!sw) sw = 1;
  return sum / sw;
}

/**
 * ثبت اسنپ‌شات در تاریخ وضعیت. اسنپ‌شات هم‌تاریخ و تخمینی‌های همان تاریخ یا بعدتر جایگزین می‌شوند؛ نتیجه به ترتیب تاریخ است.
 */
export function recordSnapshot(args: {
  existing: readonly Snapshot[];
  status: IsoDate;
  progress: ProgressMetrics;
  tasks: readonly Task[];
  schedule: Schedule;
  actualCost: number;
}): Snapshot[] {
  const { existing, status, progress, tasks, schedule } = args;
  const kept = existing.filter((s) => s.date !== status && !(s.estimated && s.date >= status));
  const next: Snapshot = {
    date: status,
    actual: progress.actual,
    planned: progress.planned,
    estimated: false,
    tasks: snapshotTaskProgress(tasks, schedule),
    actualCost: args.actualCost,
  };
  return [...kept, next].sort((a, b) => compareIso(a.date, b.date));
}

/**
 * بازسازی تخمینی منحنی پیشرفت از تاریخ‌های واقعی: برای هر پنجمین روز کاری (اندیس‌های ۴، ۹، …) پیش از روز وضعیت.
 * پیشرفت هر فعالیت: خطی بین شروع واقعی و پایان واقعی (یا روز وضعیت با درصد فعلی).
 */
export function estimateSnapshots(tasks: readonly Task[], schedule: Schedule, step = 5): Snapshot[] {
  const leaves = tasks.filter((t) => t.kind !== 'summary');
  let sw = 0;
  for (const t of leaves) sw += t.weight;
  if (!sw) sw = 1;
  const si = schedule.statusIndex;
  const axis = schedule.axis;
  const fq = (t: Task, i: number): number => {
    if (!t.actualStart && !t.actualFinish) return 0;
    const s = axis.onOrAfter((t.actualStart ?? t.actualFinish) as IsoDate);
    const e = t.actualFinish ? axis.onOrAfter(t.actualFinish) : si;
    if (i < s) return 0;
    if (t.actualFinish && i >= e) return 1;
    return (t.actualFinish ? 1 : t.percentComplete / 100) * Math.min(1, (i - s + 1) / (e - s + 1));
  };
  const out: Snapshot[] = [];
  for (let i = step - 1; i < si; i += step) {
    const per: Record<number, number> = {};
    let sum = 0;
    for (const t of leaves) {
      const f = fq(t, i);
      per[t.id] = Math.round(f * 1000) / 10;
      sum += t.weight * f;
    }
    const date = axis.dateAt(i);
    if (date) out.push({ date, actual: (sum / sw) * 100, estimated: true, tasks: per });
  }
  return out;
}
