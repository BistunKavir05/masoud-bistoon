/**
 * آماده‌سازی مدل برای ذخیره در پایگاه‌داده. داده‌ی ورودی (فایل قدیمی یا پشتیبان) ممکن است قواعدی را بشکند
 * که پایگاه‌داده اجبار می‌کند؛ این‌جا هر ناسازگاری اصلاح و در `warnings` گزارش می‌شود (چیزی بی‌صدا از دست نمی‌رود).
 */
import type { ProjectModel } from './project.ts';
import type { Assignment, Dependency, Task } from './types.ts';

export interface RepairWarning {
  code: string;
  message: string;
  taskId?: number;
}

export type RepairResult = { ok: true; model: ProjectModel; warnings: RepairWarning[] } | { ok: false; error: string };

const clamp = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, v));
const round = (v: number, digits: number): number => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};

export function repairForStorage(input: ProjectModel): RepairResult {
  const warnings: RepairWarning[] = [];
  const warn = (code: string, message: string, taskId?: number): void => void warnings.push(taskId === undefined ? { code, message } : { code, message, taskId });

  for (const t of input.tasks) {
    if (!Number.isInteger(t.id) || t.id < 1 || t.id > 2_000_000_000) return { ok: false, error: `شناسه‌ی فعالیت «${t.name}» باید عدد صحیح مثبت باشد (${String(t.id)}).` };
  }
  const name = input.name.trim() || 'پروژه‌ی بدون نام';
  if (!input.name.trim()) warn('PROJECT_NAME_EMPTY', 'نام پروژه خالی بود و «پروژه‌ی بدون نام» گذاشته شد.');

  // منابع
  const resources = input.resources.map((r) => ({
    ...r,
    name: r.name.replace(/[,،:]/g, ' ').trim() || `منبع ${r.id}`,
    capacityPercent: r.capacityPercent > 0 ? round(r.capacityPercent, 2) : 100,
    dailyRate: r.dailyRate >= 0 ? round(r.dailyRate, 2) : 0,
  }));
  const names = new Set<string>();
  for (const r of resources) {
    let n = r.name;
    for (let k = 2; names.has(n); k++) n = `${r.name} (${k})`;
    if (n !== r.name) warn('RESOURCE_RENAMED', `نام منبع تکراری «${r.name}» به «${n}» تغییر کرد.`);
    names.add(n);
    r.name = n;
  }
  const resourceIds = new Set(resources.map((r) => r.id));

  // فعالیت‌ها
  const taskIds = new Set(input.tasks.map((t) => t.id));
  const tasks: Task[] = input.tasks.map((src) => {
    const t: Task = { ...src, dependencies: [...src.dependencies], assignments: [...src.assignments], directCosts: [...src.directCosts] };
    if (!t.name.trim()) {
      t.name = 'فعالیت بدون نام';
      warn('TASK_NAME_EMPTY', 'نام فعالیت خالی بود و «فعالیت بدون نام» گذاشته شد.', t.id);
    }
    t.name = t.name.trim();
    t.level = clamp(Math.trunc(t.level) || 1, 1, 9);
    const seenDep = new Set<number>();
    const deps: Dependency[] = [];
    for (const d of t.dependencies) {
      if (d.predecessorId === t.id) {
        warn('SELF_DEPENDENCY_DROPPED', 'فعالیت پیش‌نیاز خودش بود؛ حذف شد.', t.id);
      } else if (!taskIds.has(d.predecessorId)) {
        warn('UNKNOWN_PREDECESSOR_DROPPED', `پیش‌نیاز ${d.predecessorId} وجود ندارد؛ حذف شد.`, t.id);
      } else if (seenDep.has(d.predecessorId)) {
        warn('DUPLICATE_PREDECESSOR_DROPPED', `پیش‌نیاز ${d.predecessorId} دوبار آمده بود؛ مورد دوم حذف شد.`, t.id);
      } else {
        seenDep.add(d.predecessorId);
        deps.push({ predecessorId: d.predecessorId, type: d.type, lag: Math.trunc(d.lag) });
      }
    }
    t.dependencies = deps;

    if (t.kind === 'summary') {
      Object.assign(t, {
        duration: 0,
        weight: 0,
        percentComplete: 0,
        work: 0,
        actualStart: null,
        actualFinish: null,
        startNoEarlierThan: null,
        startNoEarlierSource: null,
        deadline: null,
        levelOfEffort: false,
        legacyActualCost: null,
        assignments: [],
        directCosts: [],
      });
      return t;
    }
    t.duration = t.kind === 'milestone' ? 0 : Math.max(1, Math.round(t.duration));
    t.weight = round(Math.max(0, t.weight), 3);
    t.work = round(Math.max(0, t.work), 3);
    t.percentComplete = round(clamp(t.percentComplete, 0, 100), 2);
    if (t.actualFinish && t.actualStart && t.actualFinish < t.actualStart) {
      warn('FINISH_BEFORE_START', 'پایان واقعی قبل از شروع واقعی بود؛ پایان واقعی حذف شد.', t.id);
      t.actualFinish = null;
    }
    if (t.actualFinish && t.percentComplete < 100) {
      warn('FINISH_WITH_INCOMPLETE', `پایان واقعی ثبت شده بود ولی درصد ${t.percentComplete} بود؛ درصد ۱۰۰ شد.`, t.id);
      t.percentComplete = 100;
    }
    if (!t.startNoEarlierThan) t.startNoEarlierSource = null;
    else if (!t.startNoEarlierSource) t.startNoEarlierSource = 'manual';
    if (t.legacyActualCost !== null && !(t.legacyActualCost >= 0)) t.legacyActualCost = null;

    const merged = new Map<number, number>();
    for (const a of t.assignments) {
      if (!resourceIds.has(a.resourceId)) {
        warn('UNKNOWN_RESOURCE_DROPPED', `منبع ${a.resourceId} وجود ندارد؛ تخصیص حذف شد.`, t.id);
      } else if (!(a.units > 0)) {
        warn('INVALID_ASSIGNMENT_DROPPED', 'درصد تخصیص نامعتبر بود؛ حذف شد.', t.id);
      } else {
        if (merged.has(a.resourceId)) warn('ASSIGNMENTS_MERGED', 'تخصیص‌های تکراری یک منبع جمع شد.', t.id);
        merged.set(a.resourceId, (merged.get(a.resourceId) ?? 0) + a.units);
      }
    }
    t.assignments = [...merged.entries()].map(([resourceId, units]): Assignment => ({ resourceId, units: round(units, 2) }));
    t.directCosts = t.directCosts.filter((c) => c.amount > 0).map((c) => ({ name: c.name.slice(0, 80), amount: round(c.amount, 2) }));
    return t;
  });

  // سلسله‌مراتب: ردیف اول سطح ۱؛ پرش بیش از یک سطح ممنوع؛ زیرمجموعه فقط زیر خلاصه
  for (let i = 0; i < tasks.length; i++) {
    const t = tasks[i] as Task;
    const prev = tasks[i - 1];
    let level = t.level;
    if (!prev) level = 1;
    else {
      if (level > prev.level + 1) level = prev.level + 1;
      if (level > prev.level && prev.kind !== 'summary') level = prev.level;
    }
    if (level !== t.level) {
      warn('LEVEL_ADJUSTED', `سطح سلسله‌مراتب از ${t.level} به ${level} اصلاح شد.`, t.id);
      t.level = level;
    }
  }

  // دفتر هزینه
  const costIdSeen = new Set<number>();
  const costs = input.costs
    .filter((c) => c.amount > 0)
    .map((c) => {
      let id = c.id;
      if (!Number.isInteger(id) || id < 1 || costIdSeen.has(id)) id = Math.max(0, ...costIdSeen) + 1;
      costIdSeen.add(id);
      const taskId = c.taskId !== null && taskIds.has(c.taskId) ? c.taskId : null;
      if (c.taskId !== null && taskId === null) warn('COST_TASK_MISSING', `هزینه‌ی ${id} به فعالیت ناموجود اشاره داشت و به سربار تبدیل شد.`);
      return { ...c, id, taskId, amount: round(c.amount, 2), description: c.description.slice(0, 120), document: c.document.slice(0, 60) };
    });

  // ریسک و سایر رکوردها: شناسه‌ی یکتا و بازه‌ی معتبر
  const uniqueIds = <T extends { id: number }>(list: readonly T[], label: string): T[] => {
    const seen = new Set<number>();
    return list.map((x) => {
      let id = x.id;
      if (!Number.isInteger(id) || id < 1 || seen.has(id)) {
        id = Math.max(0, ...seen, ...list.map((y) => (Number.isInteger(y.id) ? y.id : 0))) + 1;
        warn('RECORD_ID_RENUMBERED', `شناسه‌ی ${label} تکراری یا نامعتبر بود و ${id} شد.`);
      }
      seen.add(id);
      return { ...x, id };
    });
  };
  const risks = uniqueIds(input.risks, 'ریسک').map((r) => {
    const probability = clamp(Math.round(r.probability), 1, 5);
    const impact = clamp(Math.round(r.impact), 1, 5);
    if (probability !== r.probability || impact !== r.impact) warn('RISK_SCALE_ADJUSTED', `احتمال/اثر ریسک ${r.id} به بازه‌ی ۱ تا ۵ اصلاح شد.`);
    return { ...r, probability, impact };
  });
  const issues = uniqueIds(input.issues, 'مسئله');
  const changes = uniqueIds(input.changes, 'درخواست تغییر');
  const decisions = uniqueIds(input.decisions, 'تصمیم');
  const documents = uniqueIds(input.documents, 'سند').map((d) => ({ ...d, taskId: d.taskId !== null && taskIds.has(d.taskId) ? d.taskId : null, title: d.title.slice(0, 200) }));

  // قرارداد
  const c = input.contract;
  const rial = (v: number): number => Math.max(0, Math.round(v));
  const contract = {
    ...c,
    amount: rial(c.amount),
    advanceAmount: rial(c.advanceAmount),
    invoicedTotal: rial(c.invoicedTotal),
    collectedTotal: rial(c.collectedTotal),
    retentionValue: c.retentionMode === 'percent' ? clamp(c.retentionValue, 0, 100) : rial(c.retentionValue),
    salesCommissionPercent: round(clamp(c.salesCommissionPercent, 0, 100), 2),
    retentionCommissionPercent: round(clamp(c.retentionCommissionPercent, 0, 100), 2),
  };

  // اسنپ‌شات: یکتا به‌ازای تاریخ (آخری می‌ماند)
  const snapByDate = new Map(input.snapshots.map((s) => [s.date, { ...s, actual: round(clamp(s.actual, 0, 100), 4), ...(s.planned !== undefined ? { planned: round(clamp(s.planned, 0, 100), 4) } : {}) }]));
  if (snapByDate.size !== input.snapshots.length) warn('SNAPSHOT_DUPLICATE_DATES', 'اسنپ‌شات‌های هم‌تاریخ ادغام شدند (آخری ماند).');

  return {
    ok: true,
    warnings,
    model: {
      ...input,
      name,
      tasks,
      resources,
      costs,
      risks,
      issues,
      changes,
      decisions,
      documents,
      contract,
      snapshots: [...snapByDate.values()].sort((a, b) => (a.date < b.date ? -1 : 1)),
      finance: { ...input.finance, unit: input.finance.unit.slice(0, 24) || 'ریال', budget: Math.max(0, input.finance.budget) },
    },
  };
}
