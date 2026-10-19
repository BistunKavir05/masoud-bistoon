/**
 * برنامه‌ی ورود فایل MS Project (پیش‌نمایش + اعمال) — منطق خالص و آزمون‌پذیر.
 *
 * دو مسیر:
 *  - `modelFromMsp`: ساخت پروژه‌ی جدید از فایل (شناسه‌ی فعالیت = UID فایل).
 *  - `planMspImport`: به‌روزرسانی پروژه‌ی موجود. هیچ‌چیز بی‌صدا از بین نمی‌رود؛ اثر ورود روی هر دسته از داده
 *    در `effects` نوشته می‌شود و هر چه ممکن است داده‌ی ثبت‌شده را خراب کند در `blockers` می‌آید (ورود غیرفعال).
 */
import { emptyCharter, emptyContract } from './charter.ts';
import type { IsoDate } from './date.ts';
import { defaultFinanceSettings } from './finance.ts';
import { formatJalali, toPersianDigits } from './jalali.ts';
import type { MspParsed, MspTask, MspWarning } from './msp.ts';
import type { ProjectModel } from './project.ts';
import { repairForStorage } from './repair.ts';
import type { RepairWarning } from './repair.ts';
import { computeSchedule } from './scheduling.ts';
import { estimateSnapshots } from './snapshots.ts';
import { wbsMap } from './structure.ts';
import type { Baseline, BaselineItem, Task } from './types.ts';

export type MspMapping = 'id' | 'name' | 'none';
export const MSP_MAPPING_LABELS: Record<MspMapping, string> = {
  id: 'هم‌شناسه (کد ردیف فایل = شناسه‌ی فعالیت)',
  name: 'هم‌نام (نام دقیق فعالیت؛ در تکراری‌ها شماره‌ی WBS هم دیده می‌شود)',
  none: 'بدون نگاشت (همه‌ی فعالیت‌های فعلی جایگزین می‌شوند)',
};

export const MSP_FIXED_COST_NAME = 'هزینه‌ی ثابت (MSP)';

export interface MspImportOptions {
  mapping: MspMapping;
  /** پیشرفت و تاریخ‌های واقعیِ فعلی فعالیت‌های تطبیق‌یافته حفظ شود (فقط برنامه از فایل بیاید) */
  keepProgress?: boolean;
  /** شروع پروژه تغییر نکند (پیش‌فرض: شروع فایل جایگزین می‌شود) */
  keepStart?: boolean;
  /** شناسه‌ی بعدی شمارنده‌ی فعالیت‌ها در پایگاه‌داده؛ شناسه‌های کوچک‌تر «قبلاً استفاده‌شده» حساب می‌شوند */
  idFloor?: number;
}

export interface MspEffect {
  area: string;
  text: string;
  level: 'info' | 'warn';
}

export interface MspBlocker {
  code: 'CYCLE' | 'REMOVED_HAS_COSTS' | 'REPAIR_FAILED' | 'ARCHIVED';
  message: string;
}

export interface MspRemoved {
  id: number;
  name: string;
  ledgerRows: number;
  ledgerAmount: number;
  documents: number;
  assignments: number;
  directCostAmount: number;
  hasProgress: boolean;
}

export interface MspMappingStats {
  matched: number;
  /** تطبیق‌یافته‌هایی که نامشان با فایل فرق دارد */
  renamed: number;
}

export type MspSchedulePreview = { ok: true; start: IsoDate; finish: IsoDate; criticalCount: number; workingDays: number } | { ok: false; cycleTaskNames: string[] };

export interface MspPlan {
  mapping: MspMapping;
  options: { keepProgress: boolean; keepStart: boolean };
  /** پروژه‌ی مقصد پس از ورود (فقط اجزایی که ورود تغییر می‌دهد معتبرند: tasks، baseline، start) */
  tasks: Task[];
  baseline: Baseline;
  /** آیا فایل خط مبنا داشت؟ فقط در این صورت خط مبنای فعلی بایگانی و جایگزین می‌شود */
  replaceBaseline: boolean;
  start: IsoDate;
  matched: number;
  added: number;
  removed: MspRemoved[];
  renamed: { id: number; from: string; to: string }[];
  /** تطبیق‌یافته‌هایی که نوعشان (فعالیت/خلاصه/مایلستون) عوض می‌شود */
  kindChanged: { id: number; name: string; from: Task['kind']; to: Task['kind'] }[];
  stats: Record<MspMapping, MspMappingStats>;
  schedule: MspSchedulePreview;
  warnings: (MspWarning | RepairWarning)[];
  effects: MspEffect[];
  blockers: MspBlocker[];
}

const fa = (n: number): string => toPersianDigits(n);
const money = (n: number): string => toPersianDigits(Math.round(n).toLocaleString('en-US'));

function baseTask(m: MspTask, id: number, mapId: (uid: number) => number): Task {
  const summary = m.kind === 'summary';
  return {
    id,
    name: m.name,
    level: m.level,
    kind: m.kind,
    duration: m.kind === 'task' ? m.duration : 0,
    dependencies: m.dependencies.map((d) => ({ predecessorId: mapId(d.predecessorUid), type: d.type, lag: d.lag })),
    weight: m.kind === 'task' ? m.duration : 0,
    percentComplete: summary ? 0 : m.percentComplete,
    actualStart: summary ? null : m.actualStart,
    actualFinish: summary ? null : m.actualFinish,
    work: 0,
    assignments: [],
    startNoEarlierThan: m.startNoEarlierThan,
    startNoEarlierSource: m.startNoEarlierThan ? 'msp' : null,
    deadline: m.deadline,
    levelOfEffort: false,
    directCosts: m.fixedCost > 0 ? [{ name: MSP_FIXED_COST_NAME, amount: m.fixedCost }] : [],
    legacyActualCost: null,
    costTracked: false,
    recurrence: null,
  };
}

function baselineOf(parsed: MspParsed, idOf: (uid: number) => number | undefined): Baseline {
  const out: Record<number, BaselineItem> = {};
  for (const t of parsed.tasks) {
    const id = idOf(t.uid);
    if (id !== undefined && t.baseline) out[id] = { start: t.baseline.start, finish: t.baseline.finish, zeroDuration: t.baseline.zeroDuration, cost: null };
  }
  return out;
}

// ───────────────────────── پروژه‌ی جدید ─────────────────────────

export type NewMspProject = { ok: true; model: ProjectModel; warnings: (MspWarning | RepairWarning)[]; schedule: MspSchedulePreview } | { ok: false; error: string };

/** ساخت مدل پروژه‌ی جدید از فایل؛ `today` تاریخ وضعیت را وقتی فایل StatusDate ندارد می‌دهد. */
export function modelFromMsp(parsed: MspParsed, opts: { today: IsoDate; name?: string; unit?: string }): NewMspProject {
  const tasks = parsed.tasks.map((m) => baseTask(m, m.uid, (u) => u));
  const status = parsed.status ?? opts.today;
  const draft: ProjectModel = {
    name: (opts.name ?? parsed.name).trim(),
    start: parsed.start,
    status,
    contractEnd: null,
    calendar: parsed.calendar,
    tasks,
    resources: [],
    baseline: baselineOf(parsed, (u) => u),
    baselineHistory: [],
    snapshots: [],
    costs: [],
    finance: { ...defaultFinanceSettings(), ...(opts.unit ? { unit: opts.unit } : {}) },
    charter: emptyCharter(),
    contract: emptyContract(),
    risks: [],
    issues: [],
    changes: [],
    decisions: [],
    documents: [],
  };
  const repaired = repairForStorage(draft);
  if (!repaired.ok) return { ok: false, error: repaired.error };
  const model = repaired.model;
  const sched = computeSchedule({ start: model.start, status: model.status, calendar: model.calendar, tasks: model.tasks });
  if (!sched.ok) return { ok: false, error: 'وابستگی دایره‌ای در فایل وجود دارد؛ ورود ممکن نیست.' };
  model.snapshots = estimateSnapshots(model.tasks, sched);
  return { ok: true, model, warnings: [...parsed.warnings, ...repaired.warnings], schedule: schedulePreview(model.tasks, sched, model.start) };
}

function schedulePreview(tasks: readonly Task[], sched: Extract<ReturnType<typeof computeSchedule>, { ok: true }>, start: IsoDate): MspSchedulePreview {
  const last = Math.max(0, sched.projectFinish - 1);
  const finish = (sched.axis.dateAt(last) ?? start) as IsoDate;
  let critical = 0;
  for (const t of tasks) {
    const s = sched.byId.get(t.id);
    if (s && t.kind !== 'summary' && s.duration > 0 && s.critical) critical += 1;
  }
  return { ok: true, start, finish, criticalCount: critical, workingDays: sched.projectFinish };
}

// ───────────────────────── پروژه‌ی موجود ─────────────────────────

interface Match {
  /** uid فایل → فعالیت موجود */
  byUid: Map<number, Task>;
  notes: MspWarning[];
}

function matchTasks(model: ProjectModel, parsed: MspParsed, mapping: MspMapping): Match {
  const byUid = new Map<number, Task>();
  const notes: MspWarning[] = [];
  if (mapping === 'none') return { byUid, notes };
  if (mapping === 'id') {
    const existing = new Map(model.tasks.map((t) => [t.id, t]));
    for (const m of parsed.tasks) {
      const t = existing.get(m.uid);
      if (t) byUid.set(m.uid, t);
    }
    return { byUid, notes };
  }
  // هم‌نام: اول نام یکتا؛ برای نام‌های تکراری جفت (نام، WBS) یکتا
  const wbs = wbsMap(model.tasks);
  const index = (names: Map<string, number[]>, k: string, i: number): void => void names.set(k, [...(names.get(k) ?? []), i]);
  const exByName = new Map<string, number[]>();
  const exByKey = new Map<string, number[]>();
  model.tasks.forEach((t, i) => {
    index(exByName, t.name.trim(), i);
    index(exByKey, `${t.name.trim()}\u0001${wbs.get(t.id) ?? ''}`, i);
  });
  const fileByName = new Map<string, number[]>();
  const fileByKey = new Map<string, number[]>();
  parsed.tasks.forEach((m, i) => {
    index(fileByName, m.name.trim(), i);
    index(fileByKey, `${m.name.trim()}\u0001${m.wbs}`, i);
  });
  const used = new Set<number>();
  let ambiguous = 0;
  parsed.tasks.forEach((m) => {
    const name = m.name.trim();
    const e = exByName.get(name);
    const f = fileByName.get(name) ?? [];
    if (!e) return;
    if (e.length === 1 && f.length === 1) {
      byUid.set(m.uid, model.tasks[e[0] as number] as Task);
      used.add(e[0] as number);
      return;
    }
    const key = `${name}\u0001${m.wbs}`;
    const ek = exByKey.get(key);
    const fk = fileByKey.get(key);
    if (ek && fk && ek.length === 1 && fk.length === 1 && !used.has(ek[0] as number)) {
      byUid.set(m.uid, model.tasks[ek[0] as number] as Task);
      used.add(ek[0] as number);
    } else ambiguous += 1;
  });
  if (ambiguous > 0) notes.push({ code: 'MAPPING_AMBIGUOUS', message: `${ambiguous} فعالیت با نام تکراری به‌طور یکتا به فعالیت فعلی نگاشت نشد و جدید حساب شد.` });
  return { byUid, notes };
}

/** آمار نگاشت‌های سه‌گانه برای انتخاب آگاهانه‌ی کاربر */
export function mappingStats(model: ProjectModel, parsed: MspParsed): Record<MspMapping, MspMappingStats> {
  const stat = (mapping: MspMapping): MspMappingStats => {
    const { byUid } = matchTasks(model, parsed, mapping);
    let renamed = 0;
    for (const m of parsed.tasks) {
      const t = byUid.get(m.uid);
      if (t && t.name.trim() !== m.name.trim()) renamed += 1;
    }
    return { matched: byUid.size, renamed };
  };
  return { id: stat('id'), name: stat('name'), none: { matched: 0, renamed: 0 } };
}

/** نگاشت پیشنهادی: هم‌شناسه اگر نام‌ها هم‌خوان‌اند، وگرنه هم‌نام، وگرنه بدون نگاشت */
export function suggestMapping(model: ProjectModel, parsed: MspParsed): MspMapping {
  if (model.tasks.length === 0) return 'none';
  const s = mappingStats(model, parsed);
  if (s.id.matched > 0 && s.id.renamed <= s.id.matched * 0.2) return 'id';
  if (s.name.matched > 0) return 'name';
  return 'none';
}

const MSP_ARCHIVED = 'پروژه بایگانی شده است؛ ورود ممکن نیست.';

export function planMspImport(model: ProjectModel, parsed: MspParsed, options: MspImportOptions, archived = false): MspPlan {
  const keepProgress = Boolean(options.keepProgress);
  const keepStart = Boolean(options.keepStart);
  const mapping = options.mapping;
  const { byUid, notes } = matchTasks(model, parsed, mapping);
  const stats = mappingStats(model, parsed);

  // شناسه‌ها: تطبیق‌یافته‌ها شناسه‌ی خودشان را نگه می‌دارند؛ جدیدها همیشه شناسه‌ی تازه (بالاتر از هر شناسه‌ی استفاده‌شده) می‌گیرند
  const matchedIds = new Set([...byUid.values()].map((t) => t.id));
  let next = Math.max(options.idFloor ?? 1, model.tasks.reduce((m, t) => Math.max(m, t.id), 0) + 1);
  const idByUid = new Map<number, number>();
  for (const m of parsed.tasks) {
    const t = byUid.get(m.uid);
    idByUid.set(m.uid, t ? t.id : next++);
  }
  const mapId = (uid: number): number => idByUid.get(uid) as number;

  const renamed: MspPlan['renamed'] = [];
  const kindChanged: MspPlan['kindChanged'] = [];
  const tasks: Task[] = parsed.tasks.map((m) => {
    const fresh = baseTask(m, mapId(m.uid), mapId);
    const old = byUid.get(m.uid);
    if (!old) return fresh;
    if (old.name.trim() !== m.name.trim()) renamed.push({ id: old.id, from: old.name, to: m.name });
    if (old.kind !== m.kind) kindChanged.push({ id: old.id, name: m.name, from: old.kind, to: m.kind });
    const keepLines = old.directCosts.filter((c) => c.name !== MSP_FIXED_COST_NAME);
    const fixed = m.fixedCost > 0 ? [{ name: MSP_FIXED_COST_NAME, amount: m.fixedCost }] : old.directCosts.filter((c) => c.name === MSP_FIXED_COST_NAME);
    return {
      ...fresh,
      // ستون‌هایی که XML نمی‌برد از فعالیت موجود می‌ماند
      weight: m.kind === 'summary' ? 0 : old.kind !== m.kind ? fresh.weight : old.weight,
      work: old.work,
      assignments: old.assignments.map((a) => ({ ...a })),
      levelOfEffort: old.levelOfEffort,
      directCosts: [...keepLines, ...fixed],
      legacyActualCost: old.legacyActualCost,
      costTracked: old.costTracked,
      ...(keepProgress && m.kind !== 'summary' ? { percentComplete: old.percentComplete, actualStart: old.actualStart, actualFinish: old.actualFinish } : {}),
    };
  });

  const start = keepStart ? model.start : parsed.start;
  const replaceBaseline = parsed.counts.baselines > 0;
  const baseline = replaceBaseline ? baselineOf(parsed, (u) => idByUid.get(u)) : model.baseline;

  // بررسی و یکدست‌سازی با همان قواعد ذخیره‌سازی (سطح‌ها، خلاصه، تخصیص…)؛ داده‌ی دیگر مدل دست‌نخورده می‌ماند
  const blockers: MspBlocker[] = [];
  const draft: ProjectModel = { ...model, start, tasks, baseline };
  const repaired = repairForStorage(draft);
  let finalTasks = tasks;
  let repairWarnings: RepairWarning[] = [];
  if (repaired.ok) {
    finalTasks = repaired.model.tasks;
    // هشدارهای مربوط به داده‌ای که ورود تغییر نمی‌دهد (دفتر هزینه/سند به فعالیت حذف‌شده) جداگانه و دقیق‌تر گزارش می‌شوند
    repairWarnings = repaired.warnings.filter((w) => w.taskId !== undefined || w.code === 'TASK_NAME_EMPTY' || w.code === 'LEVEL_ADJUSTED');
  } else blockers.push({ code: 'REPAIR_FAILED', message: repaired.error });
  if (archived) blockers.push({ code: 'ARCHIVED', message: MSP_ARCHIVED });

  // فعالیت‌های حذف‌شونده و داده‌ی وابسته
  const removed: MspRemoved[] = [];
  for (const t of model.tasks) {
    if (matchedIds.has(t.id)) continue;
    const rows = model.costs.filter((c) => c.taskId === t.id);
    removed.push({
      id: t.id,
      name: t.name,
      ledgerRows: rows.length,
      ledgerAmount: rows.reduce((s, c) => s + c.amount, 0),
      documents: model.documents.filter((d) => d.taskId === t.id).length,
      assignments: t.assignments.length,
      directCostAmount: t.directCosts.reduce((s, c) => s + c.amount, 0),
      hasProgress: t.percentComplete > 0 || t.actualStart !== null || t.actualFinish !== null,
    });
  }
  const withCosts = removed.filter((r) => r.ledgerRows > 0);
  if (withCosts.length > 0) {
    const sample = withCosts.slice(0, 3).map((r) => `«${r.name}»`).join('، ');
    blockers.push({
      code: 'REMOVED_HAS_COSTS',
      message: `${fa(withCosts.length)} فعالیت که در فایل نیست (مثل ${sample}) هزینه‌ی ثبت‌شده دارد (${money(withCosts.reduce((s, r) => s + r.ledgerAmount, 0))} ${model.finance.unit}). برای حفظ دفتر هزینه ابتدا آن هزینه‌ها را در تب «مالی» به فعالیت دیگری منتقل کنید یا نگاشت دیگری برگزینید.`,
    });
  }

  // زمان‌بندی آزمایشی با تقویم و تاریخ وضعیت جاری
  const sched = computeSchedule({ start, status: model.status, calendar: model.calendar, tasks: finalTasks });
  let schedule: MspSchedulePreview;
  if (sched.ok) schedule = schedulePreview(finalTasks, sched, start);
  else {
    const names = sched.taskIds.map((id) => finalTasks.find((t) => t.id === id)?.name ?? String(id));
    schedule = { ok: false, cycleTaskNames: names.slice(0, 8) };
    blockers.push({ code: 'CYCLE', message: `وابستگی دایره‌ای در فایل وجود دارد (${names.slice(0, 4).map((n) => `«${n}»`).join('، ')}…)؛ ورود ممکن نیست. فایل را در MS Project اصلاح کنید.` });
  }

  // ───── اثر ورود بر هر دسته از داده ─────
  const effects: MspEffect[] = [];
  const add = (area: string, text: string, level: MspEffect['level'] = 'info'): void => void effects.push({ area, text, level });
  const added = tasks.length - byUid.size;
  add('فعالیت‌ها', `${fa(tasks.length)} ردیف از فایل جایگزین ${fa(model.tasks.length)} ردیف فعلی می‌شود: ${fa(byUid.size)} تطبیق‌یافته، ${fa(added)} جدید، ${fa(removed.length)} حذف.`);
  if (renamed.length > 0) add('فعالیت‌ها', `نام ${fa(renamed.length)} فعالیت تطبیق‌یافته با فایل فرق دارد و تغییر می‌کند.`, renamed.length > byUid.size * 0.2 ? 'warn' : 'info');
  if (kindChanged.length > 0) {
    const losing = kindChanged.filter((k) => k.to === 'summary').map((k) => model.tasks.find((t) => t.id === k.id) as Task).filter((t) => t.assignments.length > 0 || t.directCosts.length > 0);
    add('فعالیت‌ها', `نوع ${fa(kindChanged.length)} فعالیت عوض می‌شود (فعالیت/خلاصه/مایلستون).${losing.length ? ` ${fa(losing.length)} مورد که خلاصه می‌شود تخصیص یا هزینه‌ی مستقیم دارد و آن‌ها حذف می‌شود.` : ''}`, 'warn');
  }
  const recurring = model.tasks.filter((t) => t.recurrence !== null);
  if (recurring.length > 0) add('فعالیت‌ها', `الگوی تکرار ${fa(recurring.length)} گروه تکرارشونده (${recurring.slice(0, 3).map((t) => `«${t.name}»`).join('، ')}${recurring.length > 3 ? '…' : ''}) پاک می‌شود؛ رخدادهایشان فعالیت عادی می‌مانند.`, 'warn');
  if (start !== model.start) add('شروع پروژه', `شروع پروژه از ${formatJalali(model.start)} به ${formatJalali(start)} تغییر می‌کند.`, 'warn');
  else add('شروع پروژه', 'شروع پروژه تغییر نمی‌کند.');
  if (keepStart && parsed.start !== model.start) add('شروع پروژه', `شروع فایل ${formatJalali(parsed.start)} است ولی طبق انتخاب شما نادیده گرفته می‌شود؛ تاریخ‌های محاسبه‌شده ممکن است با فایل فرق کنند.`, 'warn');
  if (schedule.ok) add('زمان‌بندی', `پایان پیش‌بینی ${formatJalali(schedule.finish)}، ${fa(schedule.criticalCount)} فعالیت بحرانی (با تقویم و تاریخ وضعیت فعلی پروژه).`);
  add('پیشرفت', keepProgress ? 'درصد پیشرفت و تاریخ‌های واقعی فعالیت‌های تطبیق‌یافته همان‌طور که هست می‌ماند؛ فعالیت‌های جدید از فایل می‌آیند.' : 'درصد پیشرفت و تاریخ‌های واقعی فعالیت‌ها از فایل می‌آید و مقدار فعلی را عوض می‌کند.', keepProgress ? 'info' : 'warn');
  const progressed = removed.filter((r) => r.hasProgress);
  if (progressed.length > 0) add('پیشرفت', `${fa(progressed.length)} فعالیت حذف‌شونده پیشرفت یا تاریخ واقعی ثبت‌شده دارد که از بین می‌رود.`, 'warn');
  const oldCon = [...byUid.values()].filter((t) => t.startNoEarlierThan && !parsed.tasks.find((m) => idByUid.get(m.uid) === t.id)?.startNoEarlierThan);
  if (oldCon.length > 0) add('قیدها', `قید «شروع نه زودتر» ${fa(oldCon.length)} فعالیت (دستی یا حاصل تسطیح) در فایل نیست و حذف می‌شود.`, 'warn');
  const oldDl = [...byUid.values()].filter((t) => t.deadline && !parsed.tasks.find((m) => idByUid.get(m.uid) === t.id)?.deadline);
  if (oldDl.length > 0) add('قیدها', `ضرب‌الاجل ${fa(oldDl.length)} فعالیت در فایل نیست و حذف می‌شود.`, 'warn');
  if (replaceBaseline) {
    const has = Object.keys(model.baseline).length > 0;
    add('خط مبنا', `${fa(parsed.counts.baselines)} فعالیت در فایل خط مبنا دارند و خط مبنای جاری می‌شوند${has ? '؛ خط مبنای فعلی در تاریخچه‌ی خط مبناها بایگانی می‌شود' : ''}.`);
  } else add('خط مبنا', 'فایل خط مبنا ندارد؛ خط مبنای فعلی بدون تغییر می‌ماند.');
  const lost = removed.reduce((s, r) => s + r.assignments, 0);
  add('منابع و تخصیص‌ها', `فهرست منابع تغییر نمی‌کند؛ فایل منبع و تخصیص نمی‌آورد و تخصیص فعالیت‌های تطبیق‌یافته می‌ماند.${lost ? ` تخصیص ${fa(lost)} مورد از فعالیت‌های حذف‌شونده از بین می‌رود.` : ''}`, lost ? 'warn' : 'info');
  const docsLost = removed.reduce((s, r) => s + r.documents, 0);
  add('دفتر هزینه', `${fa(model.costs.length)} ردیف دفتر هزینه دست‌نخورده می‌ماند${withCosts.length ? ' (ولی ورود به‌خاطر هزینه‌ی فعالیت‌های حذف‌شونده مسدود است)' : ''}.`, withCosts.length ? 'warn' : 'info');
  add('مستندات', `${fa(model.documents.length)} سند حفظ می‌شود${docsLost ? `؛ اتصال ${fa(docsLost)} سند به فعالیت‌های حذف‌شونده برداشته می‌شود (سند می‌ماند)` : ''}.`, docsLost ? 'warn' : 'info');
  add('اسنپ‌شات‌ها', `${fa(model.snapshots.length)} اسنپ‌شات (ثبت‌شده و تخمینی) حفظ می‌شود${mapping === 'id' && removed.length === 0 ? '' : '؛ جزئیات پیشرفت هر فعالیت در آن‌ها با شناسه‌های قبلی است'}.`);
  add('ریسک، مسئله، تغییر، تصمیم', 'بدون تغییر.');
  add('تقویم، تاریخ وضعیت، پایان قرارداد، منشور و قرارداد', 'بدون تغییر.');

  return {
    mapping,
    options: { keepProgress, keepStart },
    tasks: finalTasks,
    baseline,
    replaceBaseline,
    start,
    matched: byUid.size,
    added,
    removed,
    renamed,
    kindChanged,
    stats,
    schedule,
    warnings: [...parsed.warnings, ...notes, ...repairWarnings],
    effects,
    blockers,
  };
}
