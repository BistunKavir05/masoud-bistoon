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

/** همه‌ی (منبع، روز)هایی که بار آن‌ها از ظرفیت بیشتر است */
function overbooked(tasks: readonly Task[], schedule: Schedule, cap: (id: number) => number): Conflict[] {
  const map = new Map<string, { resourceId: number; index: number; items: ConflictItem[] }>();
  for (const t of tasks) {
    const s = schedule.byId.get(t.id);
    if (!s || t.kind !== 'task' || !s.duration) continue;
    // چند تخصیص یک فعالیت به یک منبع یک ردیف حساب می‌شود (وگرنه فعالیت با خودش تداخل می‌کند)
    const perResource = new Map<number, number>();
    for (const a of t.assignments) perResource.set(a.resourceId, (perResource.get(a.resourceId) ?? 0) + a.units / 100);
    for (const [resourceId, units] of perResource) {
      for (let i = s.earlyStart; i < s.earlyFinish; i += 1) {
        const key = `${resourceId}\u0001${i}`;
        let e = map.get(key);
        if (!e) map.set(key, (e = { resourceId, index: i, items: [] }));
        e.items.push({ task: t, units });
      }
    }
  }
  const out: Conflict[] = [];
  for (const [key, e] of map) {
    const c = cap(e.resourceId);
    if (e.items.reduce((acc, x) => acc + x.units, 0) > c + EPS) out.push({ key, resourceId: e.resourceId, index: e.index, capacity: c, items: e.items });
  }
  return out;
}

/** زودترین روزِ بیش‌تخصیص (و در تساوی کوچک‌ترین شناسه‌ی منبع) که در `skip` نیست */
function firstConflict(tasks: readonly Task[], schedule: Schedule, cap: (id: number) => number, skip: ReadonlySet<string>): Conflict | null {
  let best: Conflict | null = null;
  for (const c of overbooked(tasks, schedule, cap)) {
    if (skip.has(c.key)) continue;
    if (!best || c.index < best.index || (c.index === best.index && c.resourceId < best.resourceId)) best = c;
  }
  return best;
}

/** تعداد (منبع، روز)هایی که بیش‌تخصیص دارند */
export function countOverbooked(tasks: readonly Task[], schedule: Schedule, resources: readonly Resource[]): number {
  return overbooked(tasks, schedule, capacityOf(resources)).length;
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
  /** تعداد (منبع، روز)هایی که پس از تسطیح هنوز بیش‌تخصیص دارند */
  unresolved: number;
}

/**
 * تسطیح پیشنهادی (زمان‌بندی سری با قاعده‌ی اولویت):
 * در اولین روزِ بیش‌تخصیص، از میان فعالیت‌های جابه‌جاشدنی همان روز فعالیتی که بیشترین شناوری دارد (در تساوی، دیرتر شروع‌شده، و
 * سپس ردیف پایین‌تر) تا نزدیک‌ترین زمانی که یکی از فعالیت‌های هم‌روز تمام می‌شود عقب می‌رود. فعالیت شروع‌شده و مایلستون هرگز جابه‌جا نمی‌شود.
 * هر جابه‌جایی فقط شروع یک فعالیت را به جلو می‌برد و زمان‌ها یکنوا هستند، پس نوسان (ping-pong) رخ نمی‌دهد؛ سقف تکرار هم برای اطمینان هست.
 * تا آن زمان نمی‌توان فعالیت را جا داد، چون بار منابع پیش از اولین پایان کم نمی‌شود، پس پرش نزدیک‌ترین پایان بهینه‌ی موضعی است.
 *
 * خروجی فقط «پیشنهاد» است. اگر وابستگی دایره‌ای باشد `null` برمی‌گردد.
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
  const rowOf = new Map(input.tasks.map((t, i) => [t.id, i]));
  const maxIterations = Math.max(1000, input.tasks.length * 25);

  for (let it = 0; it < maxIterations; it += 1) {
    const cur: Schedule = sched;
    const c = firstConflict(work, cur, cap, skip);
    if (!c) break;
    const at = (x: ConflictItem): Schedule['tasks'][number] => cur.byId.get(x.task.id) as Schedule['tasks'][number];
    // فعالیتی که خودش به‌تنهایی از ظرفیت بیشتر است در هیچ روزی جا نمی‌شود؛ جابه‌جایی دیگران چیزی را حل نمی‌کند.
    const immovable = (x: ConflictItem): boolean => fixed(x.task) || x.units > c.capacity + EPS;
    const movable = c.items.filter((x) => !immovable(x));
    const fixedUnits = c.items.reduce((a, x) => a + (immovable(x) ? x.units : 0), 0);
    if (c.items.length < 2 || !movable.length || fixedUnits > c.capacity + EPS) {
      skip.add(c.key);
      continue;
    }
    movable.sort(
      (a, b) =>
        at(b).totalFloat - at(a).totalFloat || at(b).earlyStart - at(a).earlyStart || (rowOf.get(b.task.id) as number) - (rowOf.get(a.task.id) as number),
    );
    const pick = (movable[0] as ConflictItem).task;
    let target = Infinity;
    for (const x of c.items) {
      if (x.task.id === pick.id) continue;
      const ef = at(x).earlyFinish;
      if (ef > c.index && ef < target) target = ef;
    }
    const next = Number.isFinite(target) ? cur.axis.dateAt(target) : null;
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
  return { suggestions, finishBefore: f0, finishAfter: final.projectFinish, unresolved: overbooked(work, final, cap).length };
}
