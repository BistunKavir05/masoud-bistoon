/**
 * هزینه و مدیریت ارزش کسب‌شده (EVM).
 * هزینه‌ی برنامه‌ای = نیروی انسانی/تجهیزات (نرخ روزانه × واحد × مدت) + هزینه‌های مستقیم؛ منبع «مالی» در هزینه‌ی کار نمی‌آید.
 * هزینه‌ی واقعی = جمع ثبت‌های دفتر هزینه‌ی همان فعالیت؛ اگر ثبتی نبود هزینه‌ی واقعی قدیمی روی فعالیت.
 * سربار = ثبت‌های دفتر بدون فعالیت.
 */
import type { Schedule } from './scheduling.ts';
import { plannedDuration } from './scheduling.ts';
import { baselineOrCurrent } from './baseline.ts';
import { plannedFraction } from './progress.ts';
import type { Baseline, CostEntry, Resource, Task } from './types.ts';

export type EacMethod = 'remaining' | 'cpi' | 'both';

export interface FinanceSettings {
  unit: string;
  /** بودجه‌ی مصوب پروژه؛ ۰ = تعریف نشده */
  budget: number;
  eacMethod: EacMethod;
}

export function defaultFinanceSettings(): FinanceSettings {
  return { unit: 'ریال', budget: 0, eacMethod: 'remaining' };
}

function resourceMap(resources: readonly Resource[]): Map<number, Resource> {
  return new Map(resources.map((r) => [r.id, r]));
}

/** هزینه‌ی منابع یک فعالیت */
export function laborCost(task: Task, resources: readonly Resource[]): number {
  if (task.kind !== 'task') return 0;
  const byId = resourceMap(resources);
  const days = plannedDuration(task);
  let sum = 0;
  for (const a of task.assignments) {
    const r = byId.get(a.resourceId);
    if (r && r.type !== 'financial') sum += (r.dailyRate || 0) * (a.units / 100) * days;
  }
  return sum;
}

export function directCost(task: Task): number {
  let sum = 0;
  for (const l of task.directCosts) sum += l.amount || 0;
  return sum;
}

/** هزینه‌ی برنامه‌ای فعلی (منابع + مستقیم)؛ خلاصه ۰ است (از زیرمجموعه جمع می‌شود). */
export function plannedCost(task: Task, resources: readonly Resource[]): number {
  return task.kind === 'summary' ? 0 : laborCost(task, resources) + directCost(task);
}

export function baselineCost(task: Task, baseline: Baseline, resources: readonly Resource[]): number {
  const item = baseline[task.id];
  return item && item.cost !== null ? item.cost : plannedCost(task, resources);
}

export function actualCost(task: Task, ledger: readonly CostEntry[]): number {
  let found = false;
  let sum = 0;
  for (const c of ledger) {
    if (c.taskId === task.id) {
      found = true;
      sum += c.amount;
    }
  }
  if (found) return sum;
  return task.legacyActualCost ?? 0;
}

/** پیش‌بینی هزینه‌ی کل یک فعالیت: واقعی + باقی‌مانده‌ی بودجه‌ی خط مبنا */
export function forecastTaskCost(task: Task, percent: number, baseline: Baseline, resources: readonly Resource[], ledger: readonly CostEntry[]): number {
  const b = baselineCost(task, baseline, resources);
  const a = actualCost(task, ledger);
  return percent >= 100 ? a : a + Math.max(0, b * (1 - percent / 100));
}

/** جمع هزینه‌ی برنامه‌ای زیرمجموعه‌ی یک فعالیت خلاصه */
export function rolledPlannedCost(summaryId: number, tasks: readonly Task[], schedule: Schedule, resources: readonly Resource[]): number {
  const ids = new Set(schedule.leavesOf.get(summaryId) ?? []);
  let sum = 0;
  for (const t of tasks) if (ids.has(t.id)) sum += plannedCost(t, resources);
  return sum;
}

export interface FinanceMetrics {
  /** هزینه‌ی سربار (ثبت‌های بدون فعالیت) */
  overhead: number;
  /** هزینه‌ی واقعی کل شامل سربار */
  totalActualWithOverhead: number;
  /** پیش‌بینی کل هزینه‌ی پروژه شامل سربار */
  forecastWithOverhead: number;
  /** BAC: بودجه‌ی خط مبنا (جمع هزینه‌ی خط مبنا) */
  bac: number;
  /** هزینه‌ی برنامه‌ای فعلی */
  currentPlanned: number;
  /** AC: هزینه‌ی واقعی فعالیت‌ها (بدون سربار) */
  ac: number;
  /** EV: ارزش کسب‌شده */
  ev: number;
  /** PV: ارزش برنامه‌ای تا تاریخ وضعیت */
  pv: number;
  cv: number;
  sv: number;
  cpi: number | null;
  spi: number | null;
  eac: number;
  etc: number;
  vac: number;
  tcpi: number | null;
  statusIndex: number;
  method: EacMethod;
}

export function computeFinance(args: {
  tasks: readonly Task[];
  schedule: Schedule;
  baseline: Baseline;
  resources: readonly Resource[];
  ledger: readonly CostEntry[];
  method?: EacMethod;
}): FinanceMetrics {
  const { tasks, schedule, baseline, resources, ledger } = args;
  const method = args.method ?? 'remaining';
  const si = schedule.statusIndex;
  let bac = 0;
  let cur = 0;
  let ac = 0;
  let ev = 0;
  let pv = 0;
  for (const t of tasks) {
    if (t.kind === 'summary') continue;
    const s = schedule.byId.get(t.id);
    const b = baselineCost(t, baseline, resources);
    bac += b;
    cur += plannedCost(t, resources);
    ac += actualCost(t, ledger);
    ev += (b * (s?.percent ?? 0)) / 100;
    pv += b * plannedFraction(baselineOrCurrent(t, schedule, baseline), si);
  }
  let overhead = 0;
  for (const c of ledger) if (c.taskId === null) overhead += c.amount;
  const cpi = ac > 0 ? ev / ac : null;
  const spi = pv > 0 ? ev / pv : null;
  const remaining = bac - ev;
  let eac: number;
  if (method === 'remaining') eac = ac + remaining;
  else if (method === 'both') eac = cpi && spi ? ac + remaining / (cpi * spi) : ac + remaining;
  else eac = cpi ? bac / cpi : bac;
  return {
    overhead,
    totalActualWithOverhead: ac + overhead,
    forecastWithOverhead: eac + overhead,
    bac,
    currentPlanned: cur,
    ac,
    ev,
    pv,
    cv: ev - ac,
    sv: ev - pv,
    cpi,
    spi,
    eac,
    etc: eac - ac,
    vac: bac - eac,
    tcpi: bac !== ac ? (bac - ev) / (bac - ac) : null,
    statusIndex: si,
    method,
  };
}
