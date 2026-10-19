/**
 * موتور زمان‌بندی: محاسبه‌ی رفت و برگشت (CPM) روی محور «اندیس روز کاری».
 *
 * قراردادها
 * - اندیس‌ها صفرمبنا و پایان «انحصاری» است: فعالیتی که از اندیس ES شروع می‌شود و D روز طول می‌کشد، EF = ES + D دارد
 *   و آخرین روز کاری آن اندیس EF − 1 است.
 * - وابستگی‌ها: FS (پایان←شروع)، SS، FF، SF با lag به روز کاری (می‌تواند منفی باشد).
 * - فعالیت خلاصه از فرزندانش مشتق می‌شود (شروع = کمینه، پایان = بیشینه) و خودش پیش‌نیاز و تاریخ واقعی ندارد.
 * - فعالیت شروع‌شده (تاریخ واقعی دارد) روی اندیس واقعی «قفل» می‌شود و پیش‌نیازها آن را جابه‌جا نمی‌کنند.
 * - فعالیت شروع‌نشده هرگز پیش از تاریخ وضعیت برنامه‌ریزی نمی‌شود.
 * - Level-of-Effort در پایان پروژه (PF) و بحرانی بودن شرکت نمی‌کند.
 */
import type { IsoDate } from './date.ts';
import { DayAxis, DEFAULT_HORIZON_DAYS, buildWorkingDays } from './calendar.ts';
import type { Dependency, Task, WorkCalendar } from './types.ts';

export interface ScheduleInput {
  start: IsoDate;
  status: IsoDate;
  calendar: WorkCalendar;
  horizonDays?: number;
  tasks: readonly Task[];
}

export interface ScheduledTask {
  id: number;
  /** شروع زودترین: اندیس روز کاری */
  earlyStart: number;
  /** پایان زودترین: اندیس انحصاری (= earlyStart + duration) */
  earlyFinish: number;
  lateStart: number;
  lateFinish: number;
  /** شناوری کل به روز کاری؛ ≤ ۰ یعنی روی مسیر بحرانی (اگر کار تمام نشده باشد) */
  totalFloat: number;
  /** مدت مؤثر به روز کاری (برای فعالیت خلاصه: فاصله‌ی شروع تا پایان فرزندان) */
  duration: number;
  /** درصد پیشرفت مؤثر: ۱۰۰ اگر پایان واقعی دارد؛ برای خلاصه میانگین وزنی فرزندان */
  percent: number;
  critical: boolean;
  /** null یعنی خارج از افق محاسبه */
  startDate: IsoDate | null;
  finishDate: IsoDate | null;
}

export type ScheduleWarningCode = 'UNKNOWN_PREDECESSOR' | 'SELF_DEPENDENCY' | 'HORIZON_OVERFLOW' | 'NON_POSITIVE_DURATION';

export interface ScheduleWarning {
  code: ScheduleWarningCode;
  taskId: number;
  message: string;
}

export interface Schedule {
  ok: true;
  axis: DayAxis;
  /** اندیس روز وضعیت */
  statusIndex: number;
  /** به ترتیب ورودی */
  tasks: ScheduledTask[];
  byId: ReadonlyMap<number, ScheduledTask>;
  /** پایان پروژه: بیشینه‌ی EF فعالیت‌های غیرخلاصه و غیر LoE (اندیس انحصاری)؛ حداقل ۰ */
  projectFinish: number;
  /** برای هر فعالیت خلاصه: شناسه‌ی همه‌ی فعالیت‌های غیرخلاصه‌ی زیرمجموعه (به ترتیب ورودی) */
  leavesOf: ReadonlyMap<number, readonly number[]>;
  warnings: ScheduleWarning[];
}

export interface ScheduleFailure {
  ok: false;
  error: 'CYCLE' | 'DUPLICATE_ID';
  /** شناسه‌ی فعالیت‌های درگیر (برای دور: فقط عضوهای حلقه یا واقع بین حلقه‌ها) */
  taskIds: number[];
}

export type ScheduleResult = Schedule | ScheduleFailure;

// ───────────────────────── مدت ─────────────────────────

/** مجموع واحدهای تخصیص (۱.۰ = یک نفر کامل) */
export function assignedUnits(task: Pick<Task, 'assignments'>): number {
  let sum = 0;
  for (const a of task.assignments) if (a.units > 0) sum += a.units;
  return sum / 100;
}

/** آیا مدت از «کار ÷ واحد تخصیص» محاسبه می‌شود؟ */
export function isEffortDriven(task: Pick<Task, 'work' | 'assignments'>): boolean {
  return task.work > 0 && assignedUnits(task) > 0;
}

/** مدت برنامه‌ای (پیش از اثر پیشرفت): ۰ برای مایلستون/خلاصه؛ از کار و تخصیص یا مدت ورودی. */
export function plannedDuration(task: Task): number {
  if (task.kind !== 'task') return 0;
  if (isEffortDriven(task)) return Math.max(1, Math.ceil(task.work / assignedUnits(task) - 1e-9));
  return task.duration;
}

/** مدت مؤثر با توجه به تاریخ‌های واقعی و پیشرفت */
export function effectiveDuration(task: Task, axis: DayAxis, statusIndex: number): number {
  if (task.kind === 'milestone') return 0;
  if (task.actualFinish) {
    const s = task.actualStart ?? task.actualFinish;
    return axis.onOrAfter(task.actualFinish) - axis.onOrAfter(s) + 1;
  }
  const planned = plannedDuration(task);
  let d = planned;
  if (task.actualStart && task.percentComplete < 100) {
    const elapsed = Math.max(0, statusIndex - axis.onOrAfter(task.actualStart));
    const remaining = Math.ceil(planned * (1 - task.percentComplete / 100));
    d = Math.max(d, elapsed + remaining);
  }
  return d;
}

// ───────────────────────── گراف ─────────────────────────

interface Edge {
  to: number;
  type: 'FS' | 'SS' | 'FF' | 'SF' | 'SUM';
  lag: number;
}

export function computeSchedule(input: ScheduleInput): ScheduleResult {
  const T = input.tasks;
  const n = T.length;
  const axis = new DayAxis(buildWorkingDays(input.start, input.calendar, input.horizonDays ?? DEFAULT_HORIZON_DAYS));
  const si = axis.onOrAfter(input.status);

  const pos = new Map<number, number>();
  const dup: number[] = [];
  T.forEach((t, i) => {
    if (pos.has(t.id)) dup.push(t.id);
    else pos.set(t.id, i);
  });
  if (dup.length) return { ok: false, error: 'DUPLICATE_ID', taskIds: dup };

  const warnings: ScheduleWarning[] = [];

  // فرزندان (برگ‌ها) برای هر خلاصه: فعالیت‌های غیرخلاصه‌ی پسین با سطح بزرگ‌تر تا اولین فعالیت هم‌سطح یا بالاتر
  const leaves: number[][] = T.map(() => []);
  const open: number[] = [];
  T.forEach((t, i) => {
    while (open.length && (T[open[open.length - 1] as number] as Task).level >= t.level) open.pop();
    if (t.kind !== 'summary') for (const s of open) (leaves[s] as number[]).push(i);
    else open.push(i);
  });

  // یال‌ها
  const indeg = new Array<number>(n).fill(0);
  const succ: Edge[][] = T.map(() => []);
  const preds: { from: number; dep: Dependency }[][] = T.map(() => []);
  T.forEach((t, i) => {
    if (t.kind === 'summary') {
      for (const c of leaves[i] as number[]) {
        indeg[i] = (indeg[i] as number) + 1;
        (succ[c] as Edge[]).push({ to: i, type: 'SUM', lag: 0 });
      }
      return;
    }
    for (const dep of t.dependencies) {
      const from = pos.get(dep.predecessorId);
      if (from === undefined) {
        warnings.push({ code: 'UNKNOWN_PREDECESSOR', taskId: t.id, message: `پیش‌نیاز ${dep.predecessorId} وجود ندارد.` });
        continue;
      }
      if (from === i) {
        warnings.push({ code: 'SELF_DEPENDENCY', taskId: t.id, message: 'فعالیت نمی‌تواند پیش‌نیاز خودش باشد.' });
        continue;
      }
      (preds[i] as { from: number; dep: Dependency }[]).push({ from, dep });
      indeg[i] = (indeg[i] as number) + 1;
      (succ[from] as Edge[]).push({ to: i, type: dep.type, lag: dep.lag });
    }
  });

  // ترتیب توپولوژیک (Kahn)
  const remaining = indeg.slice();
  const order: number[] = [];
  for (let i = 0; i < n; i += 1) if (remaining[i] === 0) order.push(i);
  for (let h = 0; h < order.length; h += 1) {
    for (const e of succ[order[h] as number] as Edge[]) {
      remaining[e.to] = (remaining[e.to] as number) - 1;
      if (remaining[e.to] === 0) order.push(e.to);
    }
  }
  if (order.length < n) return { ok: false, error: 'CYCLE', taskIds: cycleMembers(T, succ, remaining) };

  const ES = new Array<number>(n).fill(0);
  const EF = new Array<number>(n).fill(0);
  const LS = new Array<number>(n).fill(0);
  const LF = new Array<number>(n).fill(0);
  const TF = new Array<number>(n).fill(0);
  const D = new Array<number>(n).fill(0);
  const PP = new Array<number>(n).fill(0);
  const CR = new Array<boolean>(n).fill(false);
  const hasActual = (t: Task): boolean => Boolean(t.actualStart || t.actualFinish);

  // رفت
  for (const i of order) {
    const t = T[i] as Task;
    if (t.kind === 'summary') {
      const ch = leaves[i] as number[];
      if (!ch.length) continue; // همه ۰
      let lo = Infinity;
      let hi = -Infinity;
      let sw = 0;
      let swp = 0;
      let allDone = true;
      for (const c of ch) {
        if ((ES[c] as number) < lo) lo = ES[c] as number;
        if ((EF[c] as number) > hi) hi = EF[c] as number;
        const w = (T[c] as Task).weight;
        sw += w;
        swp += w * (PP[c] as number);
        if (PP[c] !== 100) allDone = false;
      }
      ES[i] = lo;
      EF[i] = hi;
      D[i] = hi - lo;
      PP[i] = sw ? swp / sw : allDone ? 100 : 0;
      continue;
    }
    const d = effectiveDuration(t, axis, si);
    D[i] = d;
    let es = 0;
    for (const { from, dep } of preds[i] as { from: number; dep: Dependency }[]) {
      let v: number;
      switch (dep.type) {
        case 'FS':
          v = (EF[from] as number) + dep.lag;
          break;
        case 'SS':
          v = (ES[from] as number) + dep.lag;
          break;
        case 'FF':
          v = (EF[from] as number) + dep.lag - d;
          break;
        default:
          v = (ES[from] as number) + dep.lag - d;
      }
      if (v > es) es = v;
    }
    if (hasActual(t)) {
      const anchor = t.kind === 'milestone' && t.actualFinish ? t.actualFinish : ((t.actualStart || t.actualFinish) as IsoDate);
      es = axis.onOrAfter(anchor);
    } else {
      if (si > es) es = si;
      if (t.startNoEarlierThan) es = Math.max(es, axis.onOrAfter(t.startNoEarlierThan));
    }
    ES[i] = Math.max(0, es);
    EF[i] = (ES[i] as number) + d;
    PP[i] = t.actualFinish ? 100 : t.percentComplete;
    if (t.kind === 'task' && d <= 0) warnings.push({ code: 'NON_POSITIVE_DURATION', taskId: t.id, message: 'مدت مؤثر فعالیت صفر یا منفی است (پایان واقعی پیش از شروع واقعی؟).' });
  }

  let PF = 0;
  for (let i = 0; i < n; i += 1) {
    const t = T[i] as Task;
    if (t.kind !== 'summary' && !t.levelOfEffort && (EF[i] as number) > PF) PF = EF[i] as number;
  }

  // برگشت
  for (let h = order.length - 1; h >= 0; h -= 1) {
    const i = order[h] as number;
    const t = T[i] as Task;
    let lf = PF;
    if (t.deadline && t.kind !== 'summary') lf = Math.min(lf, axis.after(t.deadline));
    for (const e of succ[i] as Edge[]) {
      const b = T[e.to] as Task;
      if (b.kind !== 'summary' && hasActual(b)) continue;
      let v: number;
      switch (e.type) {
        case 'SUM':
          v = LF[e.to] as number;
          break;
        case 'FS':
          v = (LS[e.to] as number) - e.lag;
          break;
        case 'SS':
          v = (LS[e.to] as number) - e.lag + (D[i] as number);
          break;
        case 'FF':
          v = (LF[e.to] as number) - e.lag;
          break;
        default:
          v = (LF[e.to] as number) - e.lag + (D[i] as number);
      }
      if (v < lf) lf = v;
    }
    LF[i] = lf;
    LS[i] = lf - (D[i] as number);
    TF[i] = (LS[i] as number) - (ES[i] as number);
    CR[i] = (TF[i] as number) <= 0 && (PP[i] as number) < 100 && !t.levelOfEffort;
  }

  // خلاصه‌ها: شناوری و بحرانی بودن از فرزندان
  for (let i = 0; i < n; i += 1) {
    const t = T[i] as Task;
    if (t.kind !== 'summary') continue;
    const ch = leaves[i] as number[];
    if (!ch.length) continue;
    let minTf = Infinity;
    let any = false;
    for (const c of ch) {
      if ((TF[c] as number) < minTf) minTf = TF[c] as number;
      if (CR[c]) any = true;
    }
    TF[i] = minTf;
    CR[i] = any;
  }

  const out: ScheduledTask[] = T.map((t, i) => {
    const d = D[i] as number;
    const startIdx = ES[i] as number;
    const finishIdx =
      d > 0 ? (EF[i] as number) - 1 : hasActual(t) && t.kind !== 'summary' ? startIdx : Math.max(startIdx - 1, 0);
    const finishDate = axis.dateAt(finishIdx);
    const startDate = t.kind === 'milestone' ? finishDate : axis.dateAt(startIdx);
    if (t.kind !== 'summary' && d > 0 && finishDate === null) {
      warnings.push({ code: 'HORIZON_OVERFLOW', taskId: t.id, message: 'پایان فعالیت از افق محاسبه (۱۵۰۰ روز تقویمی) فراتر می‌رود.' });
    }
    return {
      id: t.id,
      earlyStart: startIdx,
      earlyFinish: EF[i] as number,
      lateStart: LS[i] as number,
      lateFinish: LF[i] as number,
      totalFloat: TF[i] as number,
      duration: d,
      percent: PP[i] as number,
      critical: CR[i] as boolean,
      startDate,
      finishDate,
    };
  });

  const byId = new Map<number, ScheduledTask>();
  const leavesOf = new Map<number, readonly number[]>();
  out.forEach((s, i) => {
    byId.set(s.id, s);
    if ((T[i] as Task).kind === 'summary') leavesOf.set(s.id, (leaves[i] as number[]).map((j) => (T[j] as Task).id));
  });

  return { ok: true, axis, statusIndex: si, tasks: out, byId, projectFinish: PF, leavesOf, warnings };
}

/** از میان گره‌های باقی‌مانده پس از Kahn، آن‌هایی را که خودشان در دور یا بین دورها هستند برمی‌گرداند. */
function cycleMembers(T: readonly Task[], succ: readonly (readonly Edge[])[], remaining: readonly number[]): number[] {
  const alive = new Set<number>();
  remaining.forEach((r, i) => {
    if (r > 0) alive.add(i);
  });
  let changed = true;
  while (changed) {
    changed = false;
    for (const i of [...alive]) {
      if (!(succ[i] as readonly Edge[]).some((e) => alive.has(e.to))) {
        alive.delete(i);
        changed = true;
      }
    }
  }
  return [...alive].sort((a, b) => a - b).map((i) => (T[i] as Task).id);
}
