/**
 * عملیات ساختاری روی فهرست فعالیت‌ها (درج، حذف، جابه‌جایی، زیرمجموعه‌کردن، بیرون‌آوردن).
 * همه‌ی توابع «خالص» هستند: آرایه‌ی ورودی را تغییر نمی‌دهند و آرایه‌ی تازه می‌دهند.
 * سلسله‌مراتب فقط با `level` و ترتیب ردیف‌ها بیان می‌شود؛ WBS مشتق است و ذخیره نمی‌شود.
 */
import { computeSchedule, type ScheduleInput } from './scheduling.ts';
import type { Task } from './types.ts';

/** اندیس اولین ردیف بعد از زیردرخت ردیف `i` */
export function subtreeEnd(tasks: readonly Task[], i: number): number {
  const lv = (tasks[i] as Task).level;
  let j = i + 1;
  while (j < tasks.length && (tasks[j] as Task).level > lv) j += 1;
  return j;
}

/** شماره‌ی WBS مشتق‌شده (`1.2.3`) برای هر شناسه */
export function wbsMap(tasks: readonly Task[]): Map<number, string> {
  const counters: number[] = [];
  const out = new Map<number, string>();
  for (const t of tasks) {
    const l = t.level;
    counters.length = l;
    counters[l - 1] = (counters[l - 1] ?? 0) + 1;
    for (let i = 0; i < l - 1; i += 1) counters[i] = counters[i] ?? 1;
    out.set(t.id, counters.slice(0, l).join('.'));
  }
  return out;
}

/** آیا فعالیت اطلاعاتی دارد که با تبدیل به «خلاصه» از بین می‌رود؟ */
export function hasDetails(t: Task): boolean {
  return (
    t.dependencies.length > 0 ||
    t.percentComplete > 0 ||
    t.actualStart !== null ||
    t.actualFinish !== null ||
    t.assignments.length > 0 ||
    t.work > 0 ||
    t.startNoEarlierThan !== null
  );
}

/** تبدیل به فعالیت خلاصه: همه‌ی ویژگی‌های مخصوص فعالیت پاک می‌شود. */
export function toSummary(t: Task): Task {
  return {
    ...t,
    kind: 'summary',
    duration: 0,
    dependencies: [],
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    assignments: [],
    work: 0,
    startNoEarlierThan: null,
    startNoEarlierSource: null,
    deadline: null,
    levelOfEffort: false,
    directCosts: [],
    legacyActualCost: null,
    weight: 0,
  };
}

export function nextTaskId(tasks: readonly Task[]): number {
  let max = 0;
  for (const t of tasks) if (t.id > max) max = t.id;
  return max + 1;
}

export function newTask(id: number, level: number, kind: Task['kind'], name: string): Task {
  return {
    id,
    name,
    level,
    kind,
    duration: kind === 'task' ? 1 : 0,
    dependencies: [],
    weight: kind === 'task' ? 1 : 0,
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    work: 0,
    assignments: [],
    startNoEarlierThan: null,
    startNoEarlierSource: null,
    deadline: null,
    levelOfEffort: false,
    directCosts: [],
    legacyActualCost: null,
    costTracked: false,
    recurrence: null,
  };
}

export type StructureError = 'NOT_FOUND' | 'NOTHING_TO_DO' | 'CYCLE' | 'MAX_LEVEL';

export type StructureResult<T = unknown> =
  | ({ ok: true; tasks: Task[] } & T)
  | { ok: false; error: StructureError; message: string };

const fail = (error: StructureError, message: string): { ok: false; error: StructureError; message: string } => ({ ok: false, error, message });

export interface InsertSpec {
  /** null = ابتدای فهرست */
  referenceId: number | null;
  /** true = زیرمجموعه‌ی مرجع (مرجع در صورت نیاز به خلاصه تبدیل می‌شود)؛ false = هم‌سطح، بعد از مرجع و زیردرختش */
  asChild: boolean;
  kind: Task['kind'];
  name: string;
  /**
   * شناسه‌ی فعالیت جدید. سرور آن را از شمارنده‌ی پروژه می‌گیرد تا شناسه‌ی فعالیت حذف‌شده هرگز دوباره استفاده نشود
   * (خط مبنا و گزارش تغییرات با شناسه به فعالیت ارجاع می‌دهند). پیش‌فرض: بزرگ‌ترین شناسه + ۱.
   */
  newId?: number;
}

export function insertTask(tasks: readonly Task[], spec: InsertSpec): StructureResult<{ newId: number; convertedId: number | null }> {
  const list = tasks.slice();
  let idx = 0;
  let level = 1;
  let convertedId: number | null = null;
  if (spec.referenceId !== null) {
    const ri = list.findIndex((t) => t.id === spec.referenceId);
    if (ri < 0) return fail('NOT_FOUND', 'فعالیت مرجع پیدا نشد.');
    const ref = list[ri] as Task;
    idx = subtreeEnd(list, ri);
    level = spec.asChild ? ref.level + 1 : ref.level;
    if (level > 9) return fail('MAX_LEVEL', 'حداکثر عمق سلسله‌مراتب ۹ سطح است.');
    if (spec.asChild && ref.kind !== 'summary') {
      list[ri] = toSummary(ref);
      convertedId = ref.id;
    }
  }
  const id = spec.newId ?? nextTaskId(list);
  if (list.some((t) => t.id === id)) return fail('NOTHING_TO_DO', 'شناسه‌ی فعالیت جدید تکراری است.');
  list.splice(idx, 0, newTask(id, level, spec.kind, spec.name.trim() || 'فعالیت جدید'));
  return { ok: true, tasks: list, newId: id, convertedId };
}

/** حذف فعالیت و زیردرختش؛ ارجاع به شناسه‌های حذف‌شده از پیش‌نیازها پاک می‌شود. */
export function deleteSubtree(tasks: readonly Task[], id: number): StructureResult<{ removedIds: number[] }> {
  const i = tasks.findIndex((t) => t.id === id);
  if (i < 0) return fail('NOT_FOUND', 'فعالیت پیدا نشد.');
  const e = subtreeEnd(tasks, i);
  const removed = tasks.slice(i, e).map((t) => t.id);
  const gone = new Set(removed);
  const rest = [...tasks.slice(0, i), ...tasks.slice(e)].map((t) =>
    t.dependencies.some((d) => gone.has(d.predecessorId)) ? { ...t, dependencies: t.dependencies.filter((d) => !gone.has(d.predecessorId)) } : t,
  );
  return { ok: true, tasks: rest, removedIds: removed };
}

/** جابه‌جایی بین هم‌سطح‌ها: dir = −1 بالا، +1 پایین */
export function moveTask(tasks: readonly Task[], id: number, dir: -1 | 1): StructureResult {
  const T = tasks.slice();
  const i = T.findIndex((t) => t.id === id);
  if (i < 0) return fail('NOT_FOUND', 'فعالیت پیدا نشد.');
  const lv = (T[i] as Task).level;
  const e = subtreeEnd(T, i);
  if (dir < 0) {
    let j = i - 1;
    while (j >= 0 && (T[j] as Task).level > lv) j -= 1;
    if (j < 0 || (T[j] as Task).level < lv) return fail('NOTHING_TO_DO', 'بالاتر از این نمی‌رود.');
    const block = T.splice(i, e - i);
    T.splice(j, 0, ...block);
  } else {
    if (!T[e] || (T[e] as Task).level !== lv) return fail('NOTHING_TO_DO', 'پایین‌تر از این نمی‌رود.');
    const e2 = subtreeEnd(T, e);
    const block = T.splice(i, e - i);
    T.splice(e2 - block.length, 0, ...block);
  }
  return { ok: true, tasks: T };
}

/** زیرمجموعه‌کردن: فعالیت (با زیردرختش) یک سطح پایین‌تر می‌رود و ردیف بالایی در صورت نیاز خلاصه می‌شود. */
export function indentTask(tasks: readonly Task[], id: number): StructureResult<{ convertedId: number | null }> {
  const T = tasks.slice();
  const i = T.findIndex((t) => t.id === id);
  if (i < 0) return fail('NOT_FOUND', 'فعالیت پیدا نشد.');
  if (i === 0) return fail('NOTHING_TO_DO', 'برای زیرمجموعه‌کردن باید ردیفی بالاتر وجود داشته باشد.');
  const cur = T[i] as Task;
  const prev = T[i - 1] as Task;
  if (cur.level > prev.level) return fail('NOTHING_TO_DO', 'این فعالیت همین حالا زیرمجموعه‌ی ردیف بالایی است.');
  const e = subtreeEnd(T, i);
  for (let k = i; k < e; k += 1) if ((T[k] as Task).level + 1 > 9) return fail('MAX_LEVEL', 'حداکثر عمق سلسله‌مراتب ۹ سطح است.');
  let convertedId: number | null = null;
  if (prev.level === cur.level && prev.kind !== 'summary') {
    T[i - 1] = toSummary(prev);
    convertedId = prev.id;
  }
  for (let k = i; k < e; k += 1) T[k] = { ...(T[k] as Task), level: (T[k] as Task).level + 1 };
  return { ok: true, tasks: T, convertedId };
}

/** بیرون‌آوردن: فعالیت (با زیردرختش) یک سطح بالا می‌آید و بعد از زیردرخت والد قبلی قرار می‌گیرد. */
export function outdentTask(tasks: readonly Task[], id: number): StructureResult {
  const T = tasks.slice();
  const i = T.findIndex((t) => t.id === id);
  if (i < 0) return fail('NOT_FOUND', 'فعالیت پیدا نشد.');
  const lv = (T[i] as Task).level;
  if (lv <= 1) return fail('NOTHING_TO_DO', 'این فعالیت در بالاترین سطح است.');
  const e = subtreeEnd(T, i);
  const block = T.splice(i, e - i);
  let pi = i - 1;
  while (pi >= 0 && (T[pi] as Task).level >= lv) pi -= 1;
  if (pi < 0) return fail('NOTHING_TO_DO', 'والدی برای بیرون‌آوردن پیدا نشد.');
  const pe = subtreeEnd(T, pi);
  T.splice(pe, 0, ...block.map((t) => ({ ...t, level: t.level - 1 })));
  return { ok: true, tasks: T };
}

/**
 * پس از هر عملیات ساختاری باید مطمئن شد وابستگی دایره‌ای ایجاد نشده (فرزند←خلاصه یال‌های تازه می‌سازد).
 */
export function guardCycle<T extends { tasks: Task[] }>(result: ({ ok: true } & T) | { ok: false; error: StructureError; message: string }, ctx: Omit<ScheduleInput, 'tasks'>):
  | ({ ok: true } & T)
  | { ok: false; error: StructureError; message: string } {
  if (!result.ok) return result;
  const s = computeSchedule({ ...ctx, tasks: result.tasks });
  if (!s.ok) return fail('CYCLE', 'این تغییر ساختار با وابستگی‌ها تعارض (چرخه) ایجاد می‌کند و انجام نشد.');
  return result;
}

/** اعتبارسنجی ساختار سلسله‌مراتب: سطح اول ۱، پرش بیش از یک سطح ممنوع، فرزند فقط زیر خلاصه */
export interface HierarchyIssue {
  taskId: number;
  message: string;
}

export function validateHierarchy(tasks: readonly Task[]): HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  tasks.forEach((t, i) => {
    const prev = tasks[i - 1];
    if (i === 0 && t.level !== 1) issues.push({ taskId: t.id, message: 'سطح اولین ردیف باید ۱ باشد.' });
    if (prev && t.level > prev.level + 1) issues.push({ taskId: t.id, message: 'سطح بیش از یک پله از ردیف بالایی عمیق‌تر است.' });
    if (prev && t.level > prev.level && prev.kind !== 'summary') issues.push({ taskId: t.id, message: 'زیرمجموعه فقط زیر فعالیت خلاصه (گروه) مجاز است.' });
  });
  return issues;
}
