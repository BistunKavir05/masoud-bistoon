/**
 * اعمال ویرایش روی یک فعالیت با همان قواعد برنامه‌ی قبلی (تابع `upd`)، به‌صورت تابع خالص.
 * سرور از آن برای اعتبارسنجی و کلاینت برای نمایش آنی استفاده می‌کند.
 */
import type { IsoDate } from './date.ts';
import { isIsoDate } from './date.ts';
import type { Assignment, Dependency, DirectCostLine, Task } from './types.ts';

export interface TaskPatch {
  name?: string;
  duration?: number;
  weight?: number;
  percentComplete?: number;
  actualStart?: IsoDate | null;
  actualFinish?: IsoDate | null;
  dependencies?: Dependency[];
  /** تبدیل فعالیت به مایلستون یا برگشت به فعالیت (فقط بین این دو نوع) */
  isMilestone?: boolean;
  work?: number;
  assignments?: Assignment[];
  startNoEarlierThan?: IsoDate | null;
  deadline?: IsoDate | null;
  levelOfEffort?: boolean;
  directCosts?: DirectCostLine[];
  legacyActualCost?: number | null;
  costTracked?: boolean;
}

export type PatchIssueCode =
  | 'EMPTY_NAME'
  | 'INVALID_NUMBER'
  | 'DURATION_TOO_SMALL'
  | 'PERCENT_RANGE'
  | 'MILESTONE_DURATION'
  | 'UNKNOWN_PREDECESSOR'
  | 'SELF_DEPENDENCY'
  | 'INVALID_DEPENDENCY'
  | 'INVALID_DATE'
  | 'FINISH_BEFORE_START'
  | 'SUMMARY_FIELD'
  | 'INVALID_ASSIGNMENT'
  | 'DUPLICATE_RESOURCE'
  | 'INVALID_COST';

export interface PatchIssue {
  code: PatchIssueCode;
  field: keyof TaskPatch;
  message: string;
}

export interface FieldChange {
  field: string;
  from: unknown;
  to: unknown;
}

export interface PatchContext {
  /** شناسه‌ی همه‌ی فعالیت‌های پروژه (برای بررسی پیش‌نیازها) */
  taskIds: ReadonlySet<number>;
  /** شروع برنامه‌ای فعلی فعالیت؛ هنگام ثبت ۱۰۰٪ بدون شروع واقعی به‌عنوان شروع واقعی ثبت می‌شود */
  plannedStart?: IsoDate | null;
}

export type PatchResult = { ok: true; task: Task; changes: FieldChange[]; notes: string[] } | { ok: false; issues: PatchIssue[] };

const SUMMARY_FORBIDDEN: (keyof TaskPatch)[] = [
  'duration',
  'weight',
  'percentComplete',
  'actualStart',
  'actualFinish',
  'dependencies',
  'isMilestone',
  'work',
  'assignments',
  'startNoEarlierThan',
  'deadline',
  'levelOfEffort',
  'directCosts',
  'legacyActualCost',
  'costTracked',
];

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function applyTaskPatch(task: Task, patch: TaskPatch, ctx: PatchContext): PatchResult {
  const issues: PatchIssue[] = [];
  const bad = (code: PatchIssueCode, field: keyof TaskPatch, message: string): void => void issues.push({ code, field, message });
  const has = <K extends keyof TaskPatch>(k: K): boolean => Object.prototype.hasOwnProperty.call(patch, k) && patch[k] !== undefined;
  const notes: string[] = [];
  let next: Task = { ...task };

  if (task.kind === 'summary') {
    for (const k of SUMMARY_FORBIDDEN) if (has(k)) bad('SUMMARY_FIELD', k, 'این ویژگی برای فعالیت خلاصه (گروه) قابل تنظیم نیست؛ از زیرمجموعه‌ها مشتق می‌شود.');
  }

  if (has('name')) {
    const name = String(patch.name).trim();
    if (!name) bad('EMPTY_NAME', 'name', 'نام فعالیت نمی‌تواند خالی باشد.');
    else next.name = name;
  }
  if (has('weight')) {
    if (!finite(patch.weight) || patch.weight < 0) bad('INVALID_NUMBER', 'weight', 'وزن باید عددی نامنفی باشد.');
    else next.weight = patch.weight;
  }
  if (has('work')) {
    if (!finite(patch.work) || patch.work < 0) bad('INVALID_NUMBER', 'work', 'کار باید عددی نامنفی باشد.');
    else next.work = patch.work;
  }
  if (has('percentComplete')) {
    const p = patch.percentComplete;
    if (!finite(p) || p < 0) bad('INVALID_NUMBER', 'percentComplete', 'درصد پیشرفت نامعتبر است.');
    else if (p > 100) bad('PERCENT_RANGE', 'percentComplete', 'درصد پیشرفت نمی‌تواند بیشتر از ۱۰۰ باشد.');
    else next.percentComplete = p;
  }
  if (has('isMilestone') && task.kind !== 'summary') {
    if (patch.isMilestone) {
      next.kind = 'milestone';
      next.duration = 0;
    } else if (task.kind === 'milestone') {
      next.kind = 'task';
      if (!(next.duration > 0)) next.duration = 1;
    }
  }
  if (has('duration')) {
    const d = patch.duration;
    if (!finite(d) || !Number.isInteger(d) || d < 0) bad('INVALID_NUMBER', 'duration', 'مدت باید عدد صحیح نامنفی باشد.');
    else if (next.kind === 'milestone' && d > 0) bad('MILESTONE_DURATION', 'duration', 'مدت مایلستون باید صفر باشد.');
    else if (next.kind === 'task' && d < 1) bad('DURATION_TOO_SMALL', 'duration', 'مدت فعالیت باید حداقل ۱ روز باشد.');
    else next.duration = d;
  }
  for (const f of ['actualStart', 'actualFinish', 'startNoEarlierThan', 'deadline'] as const) {
    if (!has(f) && !(Object.prototype.hasOwnProperty.call(patch, f) && patch[f] === null)) continue;
    const v = patch[f];
    if (v === null) next[f] = null;
    else if (typeof v !== 'string' || !isIsoDate(v)) bad('INVALID_DATE', f, 'تاریخ نامعتبر است.');
    else next[f] = v;
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'startNoEarlierThan')) {
    next.startNoEarlierSource = next.startNoEarlierThan ? 'manual' : null;
  }
  if (has('levelOfEffort')) next.levelOfEffort = Boolean(patch.levelOfEffort);
  if (has('costTracked')) next.costTracked = Boolean(patch.costTracked);
  if (Object.prototype.hasOwnProperty.call(patch, 'legacyActualCost')) {
    const v = patch.legacyActualCost;
    if (v === null) next.legacyActualCost = null;
    else if (!finite(v) || v < 0) bad('INVALID_COST', 'legacyActualCost', 'هزینه‌ی واقعی باید عددی نامنفی باشد.');
    else next.legacyActualCost = v;
  }
  if (has('directCosts')) {
    const lines = patch.directCosts as DirectCostLine[];
    if (!Array.isArray(lines) || lines.some((l) => !finite(l.amount) || l.amount <= 0)) bad('INVALID_COST', 'directCosts', 'مبلغ هزینه‌ی مستقیم باید مثبت باشد.');
    else next.directCosts = lines.map((l) => ({ name: String(l.name ?? '').slice(0, 80), amount: l.amount }));
  }
  if (has('dependencies')) {
    const deps = patch.dependencies as Dependency[];
    let okDeps = true;
    for (const d of deps) {
      if (!['FS', 'SS', 'FF', 'SF'].includes(d.type) || !Number.isInteger(d.lag) || !Number.isInteger(d.predecessorId)) {
        bad('INVALID_DEPENDENCY', 'dependencies', 'نوع یا تأخیر وابستگی نامعتبر است.');
        okDeps = false;
      } else if (d.predecessorId === task.id) {
        bad('SELF_DEPENDENCY', 'dependencies', 'فعالیت نمی‌تواند پیش‌نیاز خودش باشد.');
        okDeps = false;
      } else if (!ctx.taskIds.has(d.predecessorId)) {
        bad('UNKNOWN_PREDECESSOR', 'dependencies', `کد پیش‌نیاز وجود ندارد: ${d.predecessorId}`);
        okDeps = false;
      }
    }
    if (okDeps) next.dependencies = deps.map((d) => ({ predecessorId: d.predecessorId, type: d.type, lag: d.lag }));
  }
  if (has('assignments')) {
    const list = patch.assignments as Assignment[];
    const seen = new Set<number>();
    let okA = true;
    for (const a of list) {
      if (!Number.isInteger(a.resourceId) || !finite(a.units) || a.units <= 0) {
        bad('INVALID_ASSIGNMENT', 'assignments', 'درصد تخصیص باید عددی مثبت باشد.');
        okA = false;
      } else if (seen.has(a.resourceId)) {
        bad('DUPLICATE_RESOURCE', 'assignments', 'یک منبع را نمی‌توان دو بار به یک فعالیت تخصیص داد.');
        okA = false;
      }
      seen.add(a.resourceId);
    }
    if (okA) next.assignments = list.map((a) => ({ resourceId: a.resourceId, units: a.units }));
  }

  if (issues.length) return { ok: false, issues };

  // قواعد وابسته به چند فیلد (مثل برنامه‌ی قبلی)
  if (next.kind === 'milestone' && next.duration > 0) {
    return { ok: false, issues: [{ code: 'MILESTONE_DURATION', field: 'duration', message: 'مدت مایلستون باید صفر باشد.' }] };
  }
  if (has('actualFinish') && next.actualFinish) next.percentComplete = 100;
  if (has('percentComplete') && next.percentComplete === 100 && !next.actualStart && ctx.plannedStart) {
    next.actualStart = ctx.plannedStart;
    notes.push('شروع واقعی برابر شروع برنامه‌ای ثبت شد.');
  }
  if (next.actualFinish && next.actualStart && next.actualFinish < next.actualStart) {
    return { ok: false, issues: [{ code: 'FINISH_BEFORE_START', field: 'actualFinish', message: 'پایان واقعی نمی‌تواند قبل از شروع واقعی باشد.' }] };
  }

  const changes: FieldChange[] = [];
  for (const key of Object.keys(next) as (keyof Task)[]) {
    if (JSON.stringify(task[key]) !== JSON.stringify(next[key])) changes.push({ field: key, from: task[key], to: next[key] });
  }
  return { ok: true, task: next, changes, notes };
}
