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

// ───── جدول اسنپ‌شات‌ها و علت افت پیشرفت ─────

/** کاهش کمتر از این مقدار (نقطه‌ی درصد) افت به حساب نمی‌آید؛ گردکردن ذخیره‌سازی تا یک رقم اعشار است. */
export const DROP_EPSILON = 0.05;

export type SnapshotRowKind = 'recorded' | 'estimated' | 'current';

export interface SnapshotRow {
  date: IsoDate;
  kind: SnapshotRowKind;
  /** پیشرفت واقعی با وزن‌های فعلی */
  actual: number;
  /** پیشرفت برنامه‌ای (ثبت‌شده در اسنپ‌شات، وگرنه از منحنی خط مبنای فعلی) */
  planned: number;
  /** actual − planned */
  deviation: number;
  /** درصد هر فعالیت در آن گزارش؛ null اگر گزارش جزئیات ندارد */
  tasks: SnapshotTaskProgress | null;
  /** تاریخ گزارش قبلی اگر پیشرفت این ردیف از آن کمتر است، وگرنه null */
  dropFrom: IsoDate | null;
  /** فقط برای گزارش ثبت‌شده در تاریخ وضعیت: پیشرفت زنده بعد از ثبت تغییر کرده است */
  staleAgainstLive: boolean;
}

/**
 * ردیف‌های جدول اسنپ‌شات‌ها به ترتیب تاریخ. اگر در تاریخ وضعیت گزارش «ثبت‌شده»ای نیست، ردیف «وضعیت فعلی» از مقادیر زنده افزوده می‌شود.
 * `plannedAt` درصد برنامه‌ای یک اسنپ‌شات را می‌دهد (وقتی خودش ثبت نکرده است).
 */
export function buildSnapshotRows(args: {
  snapshots: readonly Snapshot[];
  tasks: readonly Task[];
  status: IsoDate;
  current: { actual: number; planned: number; tasks: SnapshotTaskProgress };
  plannedAt: (snapshot: Snapshot) => number;
}): SnapshotRow[] {
  const { snapshots, tasks, status, current, plannedAt } = args;
  const rows: SnapshotRow[] = snapshots.map((s) => {
    const actual = snapshotActual(s, tasks);
    const planned = s.planned ?? plannedAt(s);
    const atStatus = s.date === status && !s.estimated;
    return {
      date: s.date,
      kind: s.estimated ? 'estimated' : 'recorded',
      actual,
      planned,
      deviation: actual - planned,
      tasks: s.tasks ?? null,
      dropFrom: null,
      staleAgainstLive: atStatus && Math.abs(actual - current.actual) > DROP_EPSILON,
    };
  });
  if (!snapshots.some((s) => s.date === status && !s.estimated)) {
    rows.push({
      date: status,
      kind: 'current',
      actual: current.actual,
      planned: current.planned,
      deviation: current.actual - current.planned,
      tasks: current.tasks,
      dropFrom: null,
      staleAgainstLive: false,
    });
  }
  rows.sort((a, b) => compareIso(a.date, b.date));
  for (let k = 1; k < rows.length; k += 1) {
    const prev = rows[k - 1] as SnapshotRow;
    const row = rows[k] as SnapshotRow;
    if (row.actual < prev.actual - DROP_EPSILON) row.dropFrom = prev.date;
  }
  return rows;
}

export interface DropItem {
  taskId: number;
  name: string;
  from: number;
  to: number;
  /** سهم این فعالیت در افت (نقطه‌ی درصدِ کل پروژه) */
  impact: number;
}

export type DropExplanation =
  | { available: false; message: string }
  | { available: true; fromDate: IsoDate; toDate: IsoDate; fromActual: number; toActual: number; items: DropItem[] };

function weighted(per: SnapshotTaskProgress, tasks: readonly Task[]): number {
  let sw = 0;
  let sum = 0;
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    sw += t.weight;
    sum += t.weight * (per[t.id] ?? 0);
  }
  return sw ? sum / sw : 0;
}

/**
 * چرا پیشرفتِ یک گزارش کمتر از گزارش قبلی است؟ دو گزارش با وزن‌های فعلی مقایسه می‌شوند و فعالیت‌هایی که درصدشان کم شده
 * به ترتیب سهم در افت می‌آیند. اگر هر کدام جزئیات فعالیت‌ها را ندارند، توضیح روشن می‌دهد که مقایسه ممکن نیست.
 * فهرست خالی با `available: true` یعنی افت فقط از تغییر وزن‌ها یا حذف فعالیت‌هاست.
 */
export function explainDrop(prev: Pick<SnapshotRow, 'date' | 'tasks'>, next: Pick<SnapshotRow, 'date' | 'tasks'>, tasks: readonly Task[]): DropExplanation {
  if (!prev.tasks || !next.tasks) {
    return { available: false, message: 'جزئیات این دو گزارش در دسترس نیست؛ فقط گزارش‌هایی که پیشرفت تک‌تک فعالیت‌ها را همراه دارند قابل مقایسه‌اند.' };
  }
  let sw = 0;
  for (const t of tasks) if (t.kind !== 'summary') sw += t.weight;
  if (!sw) sw = 1;
  const items: DropItem[] = [];
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    const from = prev.tasks[t.id] ?? 0;
    const to = next.tasks[t.id] ?? 0;
    if (to < from - DROP_EPSILON) items.push({ taskId: t.id, name: t.name, from, to, impact: (t.weight * (from - to)) / sw });
  }
  items.sort((a, b) => b.impact - a.impact || a.taskId - b.taskId);
  return { available: true, fromDate: prev.date, toDate: next.date, fromActual: weighted(prev.tasks, tasks), toActual: weighted(next.tasks, tasks), items };
}
