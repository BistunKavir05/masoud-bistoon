/**
 * آزمون ویژگی‌ها (property-based) برای موتور زمان‌بندی، مستقل از برنامه‌ی مرجع:
 * روی پروژه‌های تصادفی (تقویم‌ها و تعطیلی‌های گوناگون، وابستگی‌های FS/SS/FF/SF با lag مثبت و منفی، خلاصه‌های تودرتو،
 * مایلستون، LoE، کار-محور، فعالیت‌های در حال انجام و تمام‌شده، قید «شروع نه زودتر») قواعد ریاضی خروجی را می‌سنجد.
 * دو قاعده‌ی کلیدی بازبینی را بدون تکرار فرمول‌های موتور انجام می‌دهند:
 *  - شناوری کل با «به‌تعویق‌انداختن واقعی» سنجیده می‌شود: شروع فعالیت را k روز عقب می‌اندازیم و دوباره زمان‌بندی می‌کنیم؛
 *    تا k = شناوری پایان پروژه عوض نمی‌شود و با k = شناوری + ۱ عقب می‌رود؛
 *  - افزودن قید «شروع نه زودتر» هیچ فعالیتی را زودتر نمی‌کند (یکنوایی).
 * تعداد پروژه با متغیر محیطی SCHED_PROP_N (پیش‌فرض ۳۰۰) و دانه با SCHED_PROP_SEED تغییر می‌کند.
 */
import { addDays, weekday } from '../src/date.ts';
import type { IsoDate } from '../src/date.ts';
import { computeSchedule } from '../src/scheduling.ts';
import type { Schedule, ScheduleInput } from '../src/scheduling.ts';
import type { Task, WorkCalendar } from '../src/types.ts';
import { dep, task } from './fixtures.ts';

const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env ?? {};
export const N = Number(env['SCHED_PROP_N'] ?? 300);
export const SEED = Number(env['SCHED_PROP_SEED'] ?? 20261020);

function mulberry32(a: number): () => number {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface Rng {
  next(): number;
  int(lo: number, hi: number): number;
  chance(p: number): boolean;
  pick<T>(xs: readonly T[]): T;
}
export function rng(seed: number): Rng {
  const f = mulberry32(seed);
  return {
    next: f,
    int: (lo, hi) => lo + Math.floor(f() * (hi - lo + 1)),
    chance: (p) => f() < p,
    pick: (xs) => xs[Math.floor(f() * xs.length)] as never,
  };
}

const WEEKS: readonly (readonly number[])[] = [
  [6, 0, 1, 2, 3, 4], // شنبه تا پنجشنبه
  [6, 0, 1, 2, 3], // شنبه تا چهارشنبه
  [0, 1, 2, 3, 4], // یکشنبه تا پنجشنبه
  [1, 2, 3, 4, 5], // دوشنبه تا جمعه
  [0, 1, 2, 3, 4, 5, 6], // هر هفت روز
  [3], // فقط چهارشنبه (کمینه‌ی ممکن)
];

function randomCalendar(r: Rng, start: IsoDate): WorkCalendar {
  const week = r.pick(WEEKS);
  const holidays: { date: IsoDate; title: string }[] = [];
  for (let i = r.int(0, 8); i > 0; i -= 1) holidays.push({ date: addDays(start, r.int(0, 100)), title: 'تعطیل' });
  return { days: [0, 1, 2, 3, 4, 5, 6].map((d) => ({ working: week.includes(d), from: '08:00', to: '16:00' })), holidays };
}

export interface Project {
  input: ScheduleInput;
  /** شناسه‌ی فعالیت‌های خلاصه */
  summaries: Set<number>;
}

/** یک پروژه‌ی تصادفی بی‌دور و معتبر. */
export function randomProject(seed: number, opts: { deadlines?: boolean; noSummaryStartLinks?: boolean } = {}): Project {
  const r = rng(seed);
  const start = addDays('2026-01-01', r.int(0, 400));
  const calendar = randomCalendar(r, start);
  const status = addDays(start, r.int(-4, 70));

  // ساختار درختی (پیش‌ترتیب)
  const nodes: { level: number; summary: boolean; ancestors: number[] }[] = [];
  const target = r.int(3, 24);
  const gen = (level: number, ancestors: number[]): void => {
    if (nodes.length >= target) return;
    const idx = nodes.length;
    const summary = level < 4 && r.chance(0.28);
    nodes.push({ level, summary, ancestors });
    if (summary) {
      const kids = r.int(1, 4);
      for (let k = 0; k < kids; k += 1) gen(level + 1, [...ancestors, idx]);
      // خلاصه‌ی بی‌فرزند (اگر سقف رسیده) عیبی ندارد
    }
  };
  while (nodes.length < target) gen(1, []);

  const hasKids = (i: number): boolean => nodes[i + 1] !== undefined && (nodes[i + 1] as { level: number }).level > (nodes[i] as { level: number }).level;
  const tasks: Task[] = nodes.map((nd, i) => {
    const id = i + 1;
    if (nd.summary && hasKids(i)) return task({ id, kind: 'summary', level: nd.level, weight: 0 });
    // برگ
    const roll = r.next();
    const kind: Task['kind'] = roll < 0.12 ? 'milestone' : 'task';
    const duration = kind === 'task' ? r.int(1, 12) : 0;
    return task({
      id,
      level: nd.level,
      kind,
      duration,
      weight: kind === 'task' ? r.int(1, 6) : 0,
      levelOfEffort: kind === 'task' && r.chance(0.06),
    });
  });

  // کار-محور
  for (const t of tasks) {
    if (t.kind === 'task' && r.chance(0.1)) {
      t.work = r.int(1, 20);
      t.assignments = [{ resourceId: 1, units: r.pick([50, 100, 100, 200]) }];
    }
  }

  // وابستگی‌ها: فقط به فعالیت‌های پیشین که نیاکان خود فعالیت نیستند (بی‌دور)
  tasks.forEach((t, j) => {
    if (t.kind === 'summary') return;
    const ancestors = new Set((nodes[j] as { ancestors: number[] }).ancestors);
    const cands: number[] = [];
    for (let p = 0; p < j; p += 1) if (!ancestors.has(p)) cands.push(p);
    if (!cands.length) return;
    const count = r.chance(0.3) ? 0 : r.int(1, 3);
    const used = new Set<number>();
    for (let k = 0; k < count; k += 1) {
      const p = r.pick(cands);
      if (used.has(p)) continue;
      used.add(p);
      const type = r.pick(['FS', 'FS', 'FS', 'FS', 'SS', 'FF', 'SF'] as const);
      const lag = r.chance(0.6) ? 0 : r.int(-2, 4);
      t.dependencies.push(dep((tasks[p] as Task).id, type, lag));
    }
  });

  // تاریخ‌های واقعی (واقع‌گرایانه: تا تاریخ وضعیت) و قید شروع
  const statusDay = (): IsoDate => addDays(status, -r.int(0, 20));
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    const roll = r.next();
    if (roll < 0.14) {
      t.actualStart = statusDay();
      t.percentComplete = r.int(1, 95);
    } else if (roll < 0.2 && t.kind === 'task') {
      const s = statusDay();
      t.actualStart = s;
      t.actualFinish = addDays(s, r.int(0, 6));
      t.percentComplete = 100;
    } else if (roll < 0.34) {
      t.startNoEarlierThan = addDays(start, r.int(0, 140));
      t.startNoEarlierSource = 'manual';
    }
    if (opts.deadlines && !t.actualFinish && r.chance(0.25)) t.deadline = addDays(start, r.int(5, 200));
  }

  const summaries = new Set(tasks.filter((t) => t.kind === 'summary').map((t) => t.id));
  // پیوند شروع‌محور (SS/SF) از یک فعالیت خلاصه: شروع خلاصه = کمینه‌ی شروع برگ‌هاست (یک «یا») و الگوریتم رفت‌وبرگشت کلاسیک آن را دقیق
  // نمی‌سنجد؛ شناوریِ برگ‌ها در این حالت تقریبی است (مثل برنامه‌ی مرجع؛ docs/divergences.md). آزمون «به‌تعویق‌انداختن» این پیوندها را FS/FF می‌کند.
  if (opts.noSummaryStartLinks) {
    for (const t of tasks) for (const d of t.dependencies) if (summaries.has(d.predecessorId)) d.type = d.type === 'SS' ? 'FS' : d.type === 'SF' ? 'FF' : d.type;
  }
  return { input: { start, status, calendar, tasks }, summaries };
}

export const locked = (t: Task): boolean => Boolean(t.actualStart || t.actualFinish);

/** همه‌ی قواعد ساختاری؛ فهرست نقض‌ها (متن فارسی/انگلیسی کوتاه) برمی‌گرداند. */
export function structuralViolations(p: Project, s: Schedule, opts: { deadlines: boolean }): string[] {
  const out: string[] = [];
  const T = p.input.tasks;
  const row = (id: number) => s.byId.get(id) as NonNullable<ReturnType<typeof s.byId.get>>;
  const idx = (d: IsoDate): number => s.axis.onOrAfter(d);
  const holidays = new Set(p.input.calendar.holidays.map((h) => h.date));
  const si = s.statusIndex;
  const bad = (id: number, msg: string): void => {
    out.push(`task ${id}: ${msg}`);
  };

  let pf = 0;
  for (const t of T) {
    const r = row(t.id);
    const isLeaf = t.kind !== 'summary';
    if (isLeaf && !t.levelOfEffort && r.earlyFinish > pf) pf = r.earlyFinish;

    if (r.earlyStart < 0) bad(t.id, `ES<0 (${r.earlyStart})`);
    if (isLeaf) {
      if (r.earlyFinish !== r.earlyStart + r.duration) bad(t.id, `EF≠ES+D (${r.earlyStart}+${r.duration}≠${r.earlyFinish})`);
      if (t.kind === 'milestone' && r.duration !== 0) bad(t.id, 'مایلستون با مدت غیرصفر');
      if (t.kind === 'task' && r.duration < 1 && !t.actualFinish) bad(t.id, `مدت فعالیت <1 (${r.duration})`);
    }
    // تاریخ‌ها روی روز کاری‌اند
    for (const dt of [r.startDate, r.finishDate]) {
      if (dt === null || (isLeaf && r.duration === 0 && t.kind !== 'milestone')) continue;
      if (t.kind === 'milestone' && dt === r.finishDate && r.duration === 0 && !locked(t)) continue; // پایان روز کاری قبل
      if (!p.input.calendar.days[weekday(dt)]?.working) bad(t.id, `تاریخ ${dt} غیرکاری (روز هفته)`);
      if (holidays.has(dt)) bad(t.id, `تاریخ ${dt} تعطیل است`);
    }
    if (isLeaf && r.duration > 0) {
      if (r.startDate !== s.axis.dateAt(r.earlyStart)) bad(t.id, 'startDate با اندیس نمی‌خواند');
      if (r.finishDate !== s.axis.dateAt(r.earlyFinish - 1)) bad(t.id, 'finishDate با اندیس نمی‌خواند');
    }

    if (isLeaf && !locked(t)) {
      // ۱) هیچ فعالیت شروع‌نشده‌ای پیش از تاریخ وضعیت و قید شروع
      if (r.earlyStart < si) bad(t.id, `پیش از تاریخ وضعیت شروع می‌شود (${r.earlyStart}<${si})`);
      if (t.startNoEarlierThan && r.earlyStart < idx(t.startNoEarlierThan)) bad(t.id, 'قید «شروع نه زودتر» رعایت نشد');
      // ۲) همه‌ی وابستگی‌ها برقرارند
      let need = Math.max(0, si, t.startNoEarlierThan ? idx(t.startNoEarlierThan) : 0);
      for (const d of t.dependencies) {
        const pr = row(d.predecessorId);
        let v: number;
        if (d.type === 'FS') v = pr.earlyFinish + d.lag;
        else if (d.type === 'SS') v = pr.earlyStart + d.lag;
        else if (d.type === 'FF') v = pr.earlyFinish + d.lag - r.duration;
        else v = pr.earlyStart + d.lag - r.duration;
        if (v > need) need = v;
        const holds =
          d.type === 'FS' ? r.earlyStart >= pr.earlyFinish + d.lag : d.type === 'SS' ? r.earlyStart >= pr.earlyStart + d.lag : d.type === 'FF' ? r.earlyFinish >= pr.earlyFinish + d.lag : r.earlyFinish >= pr.earlyStart + d.lag;
        if (!holds) bad(t.id, `وابستگی ${d.type}${d.lag} به ${d.predecessorId} برقرار نیست`);
      }
      // ۳) «زودترین» است: دقیقاً برابر بیشینه‌ی همه‌ی قیدها
      if (r.earlyStart !== need) bad(t.id, `شروع زودترین نیست (${r.earlyStart} ≠ ${need})`);
    }

    // شناوری و دیرترین‌ها
    if (isLeaf) {
      if (r.totalFloat !== r.lateStart - r.earlyStart) bad(t.id, 'TF≠LS−ES');
      if (r.totalFloat !== r.lateFinish - r.earlyFinish) bad(t.id, 'TF≠LF−EF');
      if (r.lateFinish - r.lateStart !== r.duration) bad(t.id, 'LF−LS≠D');
      if (!opts.deadlines && !t.levelOfEffort && r.totalFloat < 0) bad(t.id, `شناوری منفی بدون ضرب‌الاجل (${r.totalFloat})`);
      const wantCritical = r.totalFloat <= 0 && r.percent < 100 && !t.levelOfEffort;
      if (r.critical !== wantCritical) bad(t.id, `پرچم بحرانی با شناوری نمی‌خواند (TF=${r.totalFloat}, %=${r.percent}, critical=${r.critical})`);
      if (!opts.deadlines && r.lateFinish > s.projectFinish) bad(t.id, 'LF از پایان پروژه بیشتر است');
    }
  }
  if (s.projectFinish !== pf) bad(0, `projectFinish ${s.projectFinish} ≠ بیشینه‌ی EF برگ‌های غیر LoE ${pf}`);

  // دیرترین‌ها با وابستگی‌ها سازگارند (برای پسین‌های قفل‌نشده)
  for (const t of T) {
    // LoE سقف پایان پروژه ندارد (D-029): اگر پسینِ واقعی نداشته باشد پیش‌نیازهایش را محدود نمی‌کند و دیرترین‌های نمایشی‌اش (با سقف پایان پروژه)
    // قیدی نیستند؛ درستی انتشار قید از راه LoE با آزمون به‌تعویق‌انداختن (بالا) سنجیده می‌شود.
    if (t.kind === 'summary' || locked(t) || t.levelOfEffort) continue;
    const b = row(t.id);
    for (const d of t.dependencies) {
      const a = row(d.predecessorId);
      const pred = T.find((x) => x.id === d.predecessorId) as Task;
      if (pred.kind === 'summary') continue; // خلاصه: سازگاری از راه برگ‌هایش (یال SUM) سنجیده می‌شود
      const ok =
        d.type === 'FS' ? a.lateFinish <= b.lateStart - d.lag : d.type === 'SS' ? a.lateStart <= b.lateStart - d.lag : d.type === 'FF' ? a.lateFinish <= b.lateFinish - d.lag : a.lateStart <= b.lateFinish - d.lag;
      if (!ok) bad(t.id, `دیرترین‌ها با وابستگی ${d.type}${d.lag} از ${d.predecessorId} سازگار نیستند`);
    }
  }

  // خلاصه‌ها از برگ‌هایشان
  for (const [id, leaf] of s.leavesOf) {
    const r = row(id);
    if (!leaf.length) continue;
    const rs = leaf.map(row);
    const lo = Math.min(...rs.map((x) => x.earlyStart));
    const hi = Math.max(...rs.map((x) => x.earlyFinish));
    if (r.earlyStart !== lo || r.earlyFinish !== hi) bad(id, `خلاصه [${r.earlyStart},${r.earlyFinish}) ≠ برگ‌ها [${lo},${hi})`);
    const minTf = Math.min(...rs.map((x) => x.totalFloat));
    if (r.totalFloat !== minTf) bad(id, 'شناوری خلاصه ≠ کمینه‌ی برگ‌ها');
    if (r.critical !== rs.some((x) => x.critical)) bad(id, 'بحرانی بودن خلاصه ≠ وجود برگ بحرانی');
    let sw = 0;
    let swp = 0;
    for (const lid of leaf) {
      const w = (T.find((x) => x.id === lid) as Task).weight;
      sw += w;
      swp += w * row(lid).percent;
    }
    const want = sw ? swp / sw : rs.every((x) => x.percent === 100) ? 100 : 0;
    if (Math.abs(r.percent - want) > 1e-9) bad(id, `درصد خلاصه ${r.percent} ≠ میانگین وزنی ${want}`);
  }
  return out;
}

export function okSchedule(inp: ScheduleInput): Schedule {
  const r = computeSchedule(inp);
  if (!r.ok) throw new Error(`schedule failed: ${r.error} ${JSON.stringify(r.taskIds)}`);
  return r;
}

export const withSnet = (inp: ScheduleInput, id: number, date: IsoDate): ScheduleInput => ({
  ...inp,
  tasks: inp.tasks.map((t) => (t.id === id ? { ...t, startNoEarlierThan: date, startNoEarlierSource: 'manual' as const } : t)),
});

