/** ساخت ردیف‌های جدول فعالیت‌ها از مدل + نتیجه‌ی زمان‌بندی؛ بدون React تا قابل آزمون باشد. */
import { plannedCost, wbsMap } from '@bistoon/core';
import type { Analysis, Baseline, Resource, ScheduledTask, TaskDto } from '@bistoon/core';

export interface TaskRow {
  t: TaskDto;
  wbs: string;
  s: ScheduledTask | undefined;
  hasChildren: boolean;
  /** فعالیتی که بعد از ثبت خط مبنا ساخته شده است (فقط وقتی خط مبنایی وجود دارد) */
  afterBaseline: boolean;
  plannedCost: number;
  /** پایان پیش‌بینی بعد از پایان خط مبنا؟ */
  delayed: boolean;
}

export function buildRows(tasks: readonly TaskDto[], analysis: Analysis | null, resources: readonly Resource[], baseline: Baseline | null): TaskRow[] {
  const wbs = wbsMap(tasks);
  const delayed = new Set(analysis?.progress.delayedTaskIds ?? []);
  const hasBaseline = baseline !== null && Object.keys(baseline).length > 0;
  return tasks.map((t, i) => ({
    t,
    wbs: wbs.get(t.id) ?? '',
    s: analysis?.schedule.byId.get(t.id),
    hasChildren: (tasks[i + 1]?.level ?? 0) > t.level,
    afterBaseline: hasBaseline && t.kind !== 'summary' && baseline![t.id] === undefined,
    plannedCost: plannedCost(t, resources),
    delayed: delayed.has(t.id),
  }));
}

export type RowFilter = 'all' | 'critical' | 'delayed' | 'active' | 'done' | 'todo';

export const FILTER_LABELS: Record<RowFilter, string> = {
  all: 'همه',
  critical: 'بحرانی',
  delayed: 'دیرکرددار',
  active: 'در حال انجام',
  done: 'تکمیل‌شده',
  todo: 'شروع‌نشده',
};

export function matchesFilter(r: TaskRow, f: RowFilter): boolean {
  if (f === 'all') return true;
  if (r.t.kind === 'summary') return false;
  const pct = r.s?.percent ?? r.t.percentComplete;
  switch (f) {
    case 'critical':
      return r.s?.critical === true;
    case 'delayed':
      return r.delayed;
    case 'active':
      return pct > 0 && pct < 100;
    case 'done':
      return pct >= 100;
    case 'todo':
      return pct <= 0;
  }
}

/**
 * ردیف‌های قابل‌نمایش: گروه‌های بسته‌شده زیرمجموعه‌شان را پنهان می‌کنند؛ با جست‌وجو یا فیلتر،
 * ردیف‌های مطابق نشان داده می‌شوند و همه‌ی گروه‌های پدرشان هم برای حفظ ساختار نمایش داده می‌شود.
 */
export function visibleRows(rows: readonly TaskRow[], collapsed: ReadonlySet<number>, query: string, filter: RowFilter): TaskRow[] {
  const q = query.trim().toLowerCase();
  const filtering = q !== '' || filter !== 'all';
  if (!filtering) {
    const out: TaskRow[] = [];
    let hideBelow = Infinity;
    for (const r of rows) {
      if (r.t.level > hideBelow) continue;
      hideBelow = Infinity;
      out.push(r);
      if (r.hasChildren && collapsed.has(r.t.id)) hideBelow = r.t.level;
    }
    return out;
  }
  const keep = new Set<number>();
  const stack: TaskRow[] = [];
  for (const r of rows) {
    while (stack.length && stack[stack.length - 1]!.t.level >= r.t.level) stack.pop();
    const textOk = q === '' || r.t.name.toLowerCase().includes(q) || r.wbs.startsWith(q) || String(r.t.id) === q;
    if (textOk && matchesFilter(r, filter) && (r.t.kind !== 'summary' || filter === 'all')) {
      keep.add(r.t.id);
      for (const p of stack) keep.add(p.t.id);
    }
    stack.push(r);
  }
  return rows.filter((r) => keep.has(r.t.id));
}
