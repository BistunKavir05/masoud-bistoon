/** بارگذاری منابع، تشخیص بیش‌تخصیص و تسطیح (Resource Leveling) پیشنهادی. */
import type { IsoDate } from './date.ts';
import { addDays, toEpochDay, weekday } from './date.ts';
import { computeSchedule, type Schedule, type ScheduleInput } from './scheduling.ts';
import type { Resource, Task } from './types.ts';

const EPS = 1e-9;

function capacityOf(resources: readonly Resource[]): (id: number) => number {
  const m = new Map(resources.map((r) => [r.id, r.capacityPercent / 100]));
  return (id) => m.get(id) ?? 1;
}

/** ایندکس هفته (شروع از شنبه) برای یک تاریخ ISO */
export function weekIndexOf(iso: IsoDate): number {
  return Math.floor((toEpochDay(iso) - 2) / 7);
}

/** تاریخ شنبه‌ی هفته‌ی یک تاریخ */
export function weekStartOf(iso: IsoDate): IsoDate {
  const back = (weekday(iso) + 1) % 7; // شنبه=۰ … جمعه=۶
  return addDays(iso, -back);
}

export interface Utilization {
  weeks: { week: number; start: IsoDate }[];
  /** منبع → هفته → بیشینه‌ی درصد بارگذاری روزانه نسبت به ظرفیت */
  load: Map<number, Map<number, number>>;
}

export function computeUtilization(tasks: readonly Task[], schedule: Schedule, resources: readonly Resource[]): Utilization {
  const cap = capacityOf(resources);
  const daily = new Map<number, Map<number, number>>();
  for (const t of tasks) {
    const s = schedule.byId.get(t.id);
    if (!s || t.kind !== 'task') continue;
    for (const a of t.assignments) {
      let m = daily.get(a.resourceId);
      if (!m) daily.set(a.resourceId, (m = new Map()));
      for (let i = s.earlyStart; i < s.earlyStart + s.duration; i += 1) m.set(i, (m.get(i) ?? 0) + a.units / 100);
    }
  }
  const load = new Map<number, Map<number, number>>();
  const weeks = new Map<number, IsoDate>();
  for (const [rid, days] of [...daily.entries()]) {
    const wk = new Map<number, number>();
    for (const [i, v] of [...days.entries()].sort((a, b) => a[0] - b[0])) {
      const date = schedule.axis.dateAt(i);
      if (!date) continue;
      const w = weekIndexOf(date);
      if (!weeks.has(w)) weeks.set(w, weekStartOf(date));
      wk.set(w, Math.max(wk.get(w) ?? 0, (v / cap(rid)) * 100));
    }
    load.set(rid, wk);
  }
  return { weeks: [...weeks.entries()].sort((a, b) => a[0] - b[0]).map(([week, start]) => ({ week, start })), load };
}

interface ConflictItem {
  task: Task;
  units: number;
}

interface Conflict {
  key: string;
  resourceId: number;
  index: number;
  capacity: number;
  items: ConflictItem[];
}

/** اولین (زودترین روز) بیش‌تخصیص که در `skip` نیست */
function findConflict(tasks: readonly Task[], schedule: Schedule, cap: (id: number) => number, skip: ReadonlySet<string>): Conflict | null {
  const map = new Map<string, { resourceId: number; index: number; items: ConflictItem[] }>();
  for (const t of tasks) {
    const s = schedule.byId.get(t.id);
    if (!s || t.kind !== 'task' || !s.duration) continue;
    for (const a of t.assignments) {
      for (let i = s.earlyStart; i < s.earlyFinish; i += 1) {
        const key = `${a.resourceId}\u0001${i}`;
        let e = map.get(key);
        if (!e) map.set(key, (e = { resourceId: a.resourceId, index: i, items: [] }));
        e.items.push({ task: t, units: a.units / 100 });
      }
    }
  }
  let best: Conflict | null = null;
  for (const [key, e] of map) {
    if (skip.has(key)) continue;
    const c = cap(e.resourceId);
    const total = e.items.reduce((acc, x) => acc + x.units, 0);
    if (total > c + EPS && (!best || e.index < best.index)) best = { key, resourceId: e.resourceId, index: e.index, capacity: c, items: e.items };
  }
  return best;
}

export interface LevelingSuggestion {
  taskId: number;
  name: string;
  from: IsoDate | null;
  to: IsoDate | null;
  /** قید «شروع نه زودتر از» پیشنهادی */
  startNoEarlierThan: IsoDate;
  /** تأخیر به روز کاری */
  delayDays: number;
}

export interface LevelingResult {
  suggestions: LevelingSuggestion[];
  finishBefore: number;
  finishAfter: number;
  /** تعداد روز-منبعی که با جابه‌جایی قابل رفع نبود */
  unresolved: number;
}

const MAX_ITERATIONS = 600;

/**
 * تسطیح پیشنهادی: تا وقتی بیش‌تخصیص هست، از میان فعالیت‌های جابه‌جاشدنی (غیر شروع‌شده و غیر مایلستون)
 * فعالیتی را که بیشترین شناوری را دارد یک روز کاری عقب می‌اندازد. نتیجه فقط پیشنهاد است و چیزی اعمال نمی‌شود.
 * اگر وابستگی دایره‌ای باشد `null` برمی‌گردد.
 */
export function levelResources(input: ScheduleInput, resources: readonly Resource[]): LevelingResult | null {
  const cap = capacityOf(resources);
  let work: Task[] = input.tasks.map((t) => ({ ...t }));
  let sched = computeSchedule({ ...input, tasks: work });
  if (!sched.ok) return null;
  const start0 = new Map(sched.tasks.map((s) => [s.id, s.startDate]));
  const f0 = sched.projectFinish;
  const skip = new Set<string>();
  const moved = new Map<number, IsoDate>();
  const fixed = (t: Task): boolean => Boolean(t.actualStart || t.actualFinish) || t.kind === 'milestone';

  let it = 0;
  let c: Conflict | null;
  while (it < MAX_ITERATIONS && sched.ok && (c = findConflict(work, sched, cap, skip))) {
    it += 1;
    const fx = c.items.filter((x) => fixed(x.task)).reduce((a, x) => a + x.units, 0);
    const mov = c.items.filter((x) => !fixed(x.task));
    if (!mov.length || fx > c.capacity + EPS || (mov.length === c.items.length && mov.length === 1 && (mov[0] as ConflictItem).units > c.capacity + EPS)) {
      skip.add(c.key);
      continue;
    }
    const cur = sched;
    const sc = (x: ConflictItem): { tf: number; es: number } => {
      const s = cur.byId.get(x.task.id) as Schedule['tasks'][number];
      return { tf: s.totalFloat, es: s.earlyStart };
    };
    mov.sort((a, b) => sc(b).tf - sc(a).tf || sc(b).es - sc(a).es);
    const pick = (mov[0] as ConflictItem).task;
    const es = (cur.byId.get(pick.id) as Schedule['tasks'][number]).earlyStart;
    const next = cur.axis.dateAt(es + 1);
    if (!next) {
      skip.add(c.key);
      continue;
    }
    moved.set(pick.id, next);
    work = work.map((t) => (t.id === pick.id ? { ...t, startNoEarlierThan: next, startNoEarlierSource: 'leveling' as const } : t));
    const r = computeSchedule({ ...input, tasks: work });
    if (!r.ok) return null;
    sched = r;
  }
  if (!sched.ok) return null;
  const final = sched;
  const suggestions: LevelingSuggestion[] = [];
  for (const t of work) {
    const snet = moved.get(t.id);
    if (!snet) continue;
    const s = final.byId.get(t.id) as Schedule['tasks'][number];
    const from = start0.get(t.id) ?? null;
    const idxFrom = from ? final.axis.onOrAfter(from) : 0;
    suggestions.push({
      taskId: t.id,
      name: t.name,
      from,
      to: s.startDate,
      startNoEarlierThan: snet,
      delayDays: (s.startDate ? final.axis.onOrAfter(s.startDate) : idxFrom) - idxFrom,
    });
  }
  return { suggestions, finishBefore: f0, finishAfter: final.projectFinish, unresolved: skip.size };
}
