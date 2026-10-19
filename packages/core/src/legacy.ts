/**
 * ورود داده‌ی نسخه‌ی قدیمی برنامه (بک‌آپ JSON تک‌فایل) به مدل جدید.
 * همان پاک‌سازی تابع `fix` برنامه‌ی قدیمی اعمال می‌شود تا ورودی نامعتبر نتیجه‌ی غیرمنتظره ندهد؛
 * هر جا چیزی حذف یا تغییر کند، در `warnings` گزارش می‌شود (بی‌صدا از دست نمی‌رود).
 */
import { buildWorkingDays } from './calendar.ts';
import type { Charter, Contract } from './charter.ts';
import { emptyContract } from './charter.ts';
import type { IsoDate } from './date.ts';
import { isIsoDate } from './date.ts';
import { parseDependencies } from './dependencies.ts';
import { defaultCalendar } from './calendar.ts';
import { normalizeDigits } from './jalali.ts';
import { defaultFinanceSettings } from './finance.ts';
import type { BaselineVersion, DocumentType, ProjectDocument, ProjectModel } from './project.ts';
import { DOCUMENT_TYPE_LABELS } from './project.ts';
import type { ChangeRequest, ChangeStatus, Decision, DecisionStatus, Issue, IssuePriority, IssueStatus, Risk, RiskCategory, RiskStatus, RiskStrategy } from './records.ts';
import { CHANGE_STATUS_LABELS, DECISION_STATUS_LABELS, ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS, RISK_CATEGORY_LABELS, RISK_STATUS_LABELS, RISK_STRATEGY_LABELS } from './records.ts';
import type { RecurrencePattern, RecurrenceType } from './recurrence.ts';
import { validateRecurrence } from './recurrence.ts';
import type { Assignment, Baseline, BaselineItem, CostEntry, Resource, ResourceType, Snapshot, Task, WorkCalendar } from './types.ts';

export interface LegacyWarning {
  code: string;
  message: string;
  taskId?: number;
}

export interface LegacyLogEntry {
  at: string;
  subject: string;
  field: string;
  oldValue: string;
  newValue: string;
}

export interface LegacyUser {
  id: string;
  role: 'admin' | 'pm' | 'user' | 'fin';
  resourceNames: string;
}

export interface LegacyImport {
  model: ProjectModel;
  warnings: LegacyWarning[];
  log: LegacyLogEntry[];
  users: LegacyUser[];
  /** شناسه‌ی داخلی نسخه‌ی قدیمی داده (`ver`) */
  legacyVersion: number;
}

export interface LegacyImportOptions {
  /** تاریخ امروز برای وقتی که تاریخ وضعیت در فایل نبود */
  today: IsoDate;
}

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v);
const num = (v: unknown, d = 0): number => (Number.isFinite(+(v as number)) ? +(v as number) : d);
const dt = (v: unknown): IsoDate | null => (typeof v === 'string' && /^\d{4}-\d\d-\d\d$/.test(v) && isIsoDate(v) ? v : null);
const str = (v: unknown, max = 100000): string => String(v ?? '').slice(0, max);

const RESOURCE_TYPES: Record<string, ResourceType> = { 'انسانی': 'human', 'تجهیزات': 'equipment', 'مالی': 'financial', 'سایر': 'other' };

function invert<K extends string>(labels: Record<K, string>): Map<string, K> {
  return new Map((Object.keys(labels) as K[]).map((k) => [labels[k], k]));
}

const RISK_CAT = invert(RISK_CATEGORY_LABELS);
const RISK_STR = invert(RISK_STRATEGY_LABELS);
const RISK_ST = invert(RISK_STATUS_LABELS);
const ISSUE_PRI = invert(ISSUE_PRIORITY_LABELS);
const ISSUE_ST = invert(ISSUE_STATUS_LABELS);
const CHANGE_ST = invert(CHANGE_STATUS_LABELS);
const DECISION_ST = invert(DECISION_STATUS_LABELS);
const DOC_TYPE = invert(DOCUMENT_TYPE_LABELS);

function normalizeUrl(u: unknown): string {
  let s = String(u ?? '').trim();
  if (!s) return '';
  if (!/^[a-z][a-z0-9+.\-]*:/i.test(s)) s = `https://${s}`;
  try {
    const x = new URL(s);
    return x.protocol === 'http:' || x.protocol === 'https:' ? x.href : '';
  } catch {
    return '';
  }
}

/** `name:units, name2` ← رشته‌ی منابع قدیمی */
const LEGACY_REC_TYPES: Record<string, RecurrenceType> = { d: 'daily', w: 'weekly', m: 'monthly', y: 'yearly' };

/** الگوی تکرار نسخه‌ی قدیمی (`rec` روی فعالیت خلاصه) به الگوی جدید */
function legacyRecurrence(rec: Obj, groupName: string, resourceIdFor: (name: string) => number): { ok: true; pattern: RecurrencePattern } | { ok: false; error: string } {
  const type = LEGACY_REC_TYPES[String(rec['type'] ?? '')];
  if (!type) return { ok: false, error: 'نوع الگو نامشخص است.' };
  const start = dt(rec['st']);
  if (!start) return { ok: false, error: 'تاریخ شروع بازه نامعتبر است.' };
  const wdays = (Array.isArray(rec['wd']) ? rec['wd'] : []).map((d) => Math.trunc(num(d, NaN))).filter((d) => Number.isInteger(d) && d >= 0 && d <= 6);
  const res = parseLegacyResources(String(rec['res'] ?? ''))[0];
  const endMode = rec['em'] === 'd' ? 'date' : 'count';
  const pattern: RecurrencePattern = {
    name: str(rec['nm'], 300).trim() || groupName.trim() || 'فعالیت تکرارشونده',
    duration: Math.trunc(num(rec['dur'], 1)),
    type,
    every: Math.trunc(num(rec['every'], 1)),
    weekdays: [...new Set(wdays)],
    monthMode: rec['md'] === 'ord' ? 'ordinal' : 'day',
    monthDay: Math.trunc(num(rec['mday'], 1)),
    monthOrdinal: Math.trunc(num(rec['mord'], 1)),
    monthWeekday: Math.trunc(num(rec['mwd'], 6)),
    yearMonth: Math.trunc(num(rec['ym'], 1)),
    yearDay: Math.trunc(num(rec['yd'], 1)),
    start,
    endMode,
    count: Math.trunc(num(rec['cnt'], 10)),
    endDate: dt(rec['end']),
    resource: res && res.name && res.units > 0 ? { resourceId: resourceIdFor(res.name), units: res.units } : null,
    weighted: Boolean(rec['wt']),
    levelOfEffort: Boolean(rec['loe']),
  };
  const bad = validateRecurrence(pattern);
  return bad ? { ok: false, error: bad } : { ok: true, pattern };
}

function parseLegacyResources(s: string): { name: string; units: number }[] {
  return s
    .split(/[,،]/)
    .map((x) => x.trim())
    .filter(Boolean)
    .map((x) => {
      const [n, u] = x.split(':');
      return { name: (n ?? '').trim(), units: +normalizeDigits(u || '100') };
    });
}

export function importLegacyProject(raw: unknown, opts: LegacyImportOptions): LegacyImport | { error: string } {
  if (!isObj(raw) || !Array.isArray(raw.tasks)) return { error: 'ساختار فایل پروژه نامعتبر است (آرایه‌ی فعالیت‌ها یافت نشد).' };
  const r = raw;
  const warnings: LegacyWarning[] = [];
  const warn = (code: string, message: string, taskId?: number): void => void warnings.push(taskId === undefined ? { code, message } : { code, message, taskId });

  // تقویم
  let calendar: WorkCalendar = defaultCalendar();
  if (isObj(r.cal) && Array.isArray(r.cal.days) && r.cal.days.length === 7) {
    const hh = (v: unknown): v is string => typeof v === 'string' && /^\d\d:\d\d$/.test(v);
    calendar = {
      days: r.cal.days.map((d) => {
        const o = isObj(d) ? d : {};
        return { working: Boolean(o.w), from: hh(o.f) ? o.f : '07:30', to: hh(o.t) ? o.t : '15:00' };
      }),
      holidays: (Array.isArray(r.cal.hol) ? r.cal.hol : []).filter((x): x is Obj => isObj(x) && dt(x.d) !== null).map((x) => ({ date: x.d as IsoDate, title: str(x.n) })),
    };
    if (!calendar.days.some((d) => d.working)) calendar = { ...calendar, days: defaultCalendar().days };
  }
  const start = dt(r.start) ?? ('2026-09-01' as IsoDate);
  const status = dt(r.status) ?? opts.today;
  const axisDays = buildWorkingDays(start, calendar);

  // منابع
  const resources: Resource[] = [];
  const resByName = new Map<string, Resource>();
  (Array.isArray(r.res) ? r.res : []).forEach((x) => {
    if (!isObj(x) || !x.n) return;
    const name = String(x.n).replace(/[,،:]/g, ' ');
    if (resByName.has(name)) {
      warn('DUPLICATE_RESOURCE', `منبع تکراری «${name}» نادیده گرفته شد.`);
      return;
    }
    const cap = num(x.c, 100);
    const rate = num(x.rate, 0);
    const res: Resource = {
      id: resources.length + 1,
      name,
      type: RESOURCE_TYPES[String(x.t ?? 'انسانی')] ?? 'other',
      capacityPercent: cap > 0 ? cap : 100,
      dailyRate: rate > 0 ? rate : 0,
    };
    resources.push(res);
    resByName.set(name, res);
  });
  const resourceFor = (name: string): Resource => {
    let res = resByName.get(name);
    if (!res) {
      res = { id: resources.length + 1, name, type: 'human', capacityPercent: 100, dailyRate: 0 };
      resources.push(res);
      resByName.set(name, res);
      warn('IMPLICIT_RESOURCE', `منبع «${name}» در فهرست منابع نبود و با ظرفیت ۱۰۰٪ و نرخ صفر ساخته شد.`);
    }
    return res;
  };

  // فعالیت‌ها
  const tasks: Task[] = [];
  const seen = new Set<number>();
  for (const t of r.tasks as unknown[]) {
    if (!isObj(t)) continue;
    const id = Math.trunc(num(t.id, NaN));
    if (!Number.isFinite(id) || seen.has(id)) {
      if (Number.isFinite(id)) warn('DUPLICATE_TASK_ID', `شناسه‌ی فعالیت تکراری ${id}؛ ردیف دوم حذف شد.`, id);
      continue;
    }
    seen.add(id);
    const isSummary = Boolean(t.sm);
    const kind = isSummary ? 'summary' : t.ms ? 'milestone' : 'task';
    const predText = String(t.preds ?? '').replace(/[^0-9۰-۹A-Za-z,،+\-\s]/g, '');
    const parsed = isSummary ? { dependencies: [], invalid: [] as string[] } : parseDependencies(predText);
    if (isSummary && predText.trim()) warn('SUMMARY_PREDECESSORS_DROPPED', 'فعالیت خلاصه پیش‌نیاز ندارد؛ پیش‌نیازهای ثبت‌شده حذف شد.', id);
    for (const bad of parsed.invalid) warn('INVALID_PREDECESSOR', `پیش‌نیاز نامعتبر «${bad}» حذف شد.`, id);
    const assignments: Assignment[] = [];
    if (!isSummary) {
      for (const a of parseLegacyResources(String(t.res ?? ''))) {
        if (!a.name || !(a.units > 0) || !Number.isFinite(a.units)) {
          warn('INVALID_ASSIGNMENT', `تخصیص نامعتبر منبع «${a.name}» حذف شد.`, id);
          continue;
        }
        assignments.push({ resourceId: resourceFor(a.name).id, units: a.units });
      }
    }
    if (isSummary && (t.as || t.af)) warn('SUMMARY_ACTUALS_DROPPED', 'تاریخ واقعی فعالیت خلاصه از فرزندان مشتق می‌شود؛ مقدار ثبت‌شده نادیده گرفته شد.', id);
    const cs = (Array.isArray(t.cs) ? t.cs : [])
      .slice(0, 40)
      .filter((l): l is Obj => isObj(l) && Number.isFinite(+(l.a as number)) && +(l.a as number) > 0)
      .map((l) => ({ name: str(l.n, 80), amount: +(l.a as number) }));
    const ac = t.ac == null || t.ac === '' ? null : Number.isFinite(+(t.ac as number)) && +(t.ac as number) >= 0 ? +(t.ac as number) : null;
    let recurrence: RecurrencePattern | null = null;
    if (isSummary && isObj(t.rec) && !t.rec['imp']) {
      const conv = legacyRecurrence(t.rec, String(t.name ?? ''), (n) => resourceFor(n).id);
      if (conv.ok) recurrence = conv.pattern;
      else warn('RECURRENCE_DROPPED', `الگوی تکرار نامعتبر بود و حذف شد (رخدادها فعالیت عادی می‌مانند): ${conv.error}`, id);
    }
    tasks.push({
      id,
      name: String(t.name ?? ''),
      level: Math.min(9, Math.max(1, Math.trunc(num(t.lv, 1)))),
      kind,
      duration: kind === 'task' ? Math.max(1, Math.round(num(t.dur, 1))) : 0,
      dependencies: parsed.dependencies,
      weight: isSummary ? 0 : Math.max(0, num(t.w)),
      percentComplete: isSummary ? 0 : Math.min(100, Math.max(0, num(t.p))),
      actualStart: isSummary ? null : dt(t.as),
      actualFinish: isSummary ? null : dt(t.af),
      work: isSummary ? 0 : Math.max(0, num(t.wk)),
      assignments,
      startNoEarlierThan: isSummary ? null : dt(t.snet),
      startNoEarlierSource: !isSummary && dt(t.snet) ? 'manual' : null,
      deadline: isSummary ? null : dt(t.dl),
      levelOfEffort: !isSummary && Boolean(t.loe),
      directCosts: isSummary ? [] : cs,
      legacyActualCost: isSummary ? null : ac,
      costTracked: !isSummary && Boolean(t.cb),
      recurrence,
    });
  }

  // خط مبنا: اندیس‌ها به تاریخ تبدیل می‌شوند
  const toBaseline = (src: unknown): Baseline => {
    const out: Record<number, BaselineItem> = {};
    if (!isObj(src)) return out;
    const last = axisDays.length - 1;
    for (const k of Object.keys(src)) {
      const b = src[k];
      const id = Number(k);
      if (!isObj(b) || !seen.has(id) || !Number.isFinite(+(b.ES as number)) || !Number.isFinite(+(b.D as number))) continue;
      const es = Math.max(0, Math.trunc(+(b.ES as number)));
      const d = Math.max(0, Math.trunc(+(b.D as number)));
      const cost = Number.isFinite(+(b.c as number)) && b.c !== undefined && b.c !== null ? +(b.c as number) : null;
      if (es > last || (d > 0 && es + d - 1 > last)) warn('BASELINE_BEYOND_HORIZON', 'تاریخ خط مبنا از افق محاسبه بیرون بود و به آخرین روز کاری محدود شد.', id);
      const sIdx = Math.min(es, last);
      const start = axisDays[sIdx] as IsoDate;
      const finish = d === 0 ? start : (axisDays[Math.min(es + d - 1, last)] as IsoDate);
      out[id] = { start, finish, zeroDuration: d === 0, cost };
    }
    return out;
  };
  const baseline = toBaseline(r.base);
  const baselineHistory: BaselineVersion[] = (Array.isArray(r.bh) ? r.bh : [])
    .filter((b): b is Obj => isObj(b) && isObj(b.base))
    .slice(-10)
    .map((b) => ({ id: Number.isFinite(+(b.id as number)) ? +(b.id as number) : 0, archivedOn: dt(b.d) ?? status, items: toBaseline(b.base) }));

  // اسنپ‌شات‌ها
  const snapshots: Snapshot[] = (Array.isArray(r.snaps) ? r.snaps : [])
    .filter((s): s is Obj => isObj(s) && dt(s.d) !== null && Number.isFinite(+(s.a as number)))
    .map((s) => {
      const snap: Snapshot = { date: s.d as IsoDate, actual: +(s.a as number), estimated: Boolean(s.est) };
      if (Number.isFinite(+(s.pl as number)) && s.pl !== undefined && s.pl !== null) snap.planned = Math.min(100, Math.max(0, +(s.pl as number)));
      if (Number.isFinite(+(s.ac as number)) && s.ac !== undefined && s.ac !== null) snap.actualCost = +(s.ac as number);
      if (isObj(s.t)) {
        const per: Record<number, number> = {};
        for (const [k, v] of Object.entries(s.t)) if (/^\d+$/.test(k) && Number.isFinite(+(v as number))) per[Number(k)] = Math.min(100, Math.max(0, +(v as number)));
        snap.tasks = per;
      }
      return snap;
    });

  // دفتر هزینه
  const costs: CostEntry[] = [];
  const costIds = new Set<number>();
  (Array.isArray(r.costs) ? r.costs : []).slice(0, 5000).forEach((c) => {
    if (!isObj(c) || !(+(c.a as number) > 0) || dt(c.d) === null) return;
    let id = Math.trunc(+(c.id as number));
    if (!Number.isFinite(id) || id < 1 || costIds.has(id)) id = Math.max(0, ...costIds) + 1;
    costIds.add(id);
    const tk = Math.trunc(+(c.task as number));
    costs.push({ id, date: c.d as IsoDate, taskId: seen.has(tk) ? tk : null, description: str(c.n, 120), document: str(c.doc, 60), amount: +(c.a as number) });
  });

  // منشور و قرارداد
  const ch = isObj(r.ch) ? r.ch : {};
  const text = (k: string, max = 200): string => (ch[k] == null || ch[k] === '' ? '' : String(ch[k]).slice(0, max));
  const numeric = (k: string, percent = false): number => {
    const v = ch[k];
    if (v == null || v === '') return 0;
    const n = +(v as number);
    return Number.isFinite(n) && n >= 0 && !(percent && n > 100) ? n : 0;
  };
  const charter: Charter = {
    client: text('client'),
    location: text('loc'),
    subject: text('subj'),
    product: text('prod'),
    projectManager: text('pmgr'),
    salesOwner: text('sales'),
    goals: text('goal', 2000),
    scope: text('scope', 2000),
    assumptions: text('assum', 2000),
    stakeholders: text('stake', 2000),
  };
  const approval = String(ch.salesOK ?? '');
  const contract: Contract = {
    ...emptyContract(),
    number: text('cno'),
    date: dt(ch.cdate),
    type: text('ctype'),
    validity: text('valid'),
    amount: numeric('amount'),
    advanceDate: dt(ch.advDate),
    advanceGuaranteeSerial: text('advSerial'),
    advanceAmount: numeric('advAmt'),
    invoiceNumbers: text('invNos'),
    invoicedTotal: numeric('invTotal'),
    collectedTotal: numeric('paid'),
    performanceGuaranteeSerial: text('perfSerial'),
    retentionMode: 'fixed',
    retentionValue: numeric('retAmt'),
    salesApproval: approval === 'در انتظار' ? 'pending' : approval === 'تأیید شده' ? 'approved' : approval === 'رد شده' ? 'rejected' : null,
    salesCommissionPercent: numeric('comPct', true),
    retentionCommissionPercent: numeric('comRetPct', true),
  };

  // رکوردها
  const col = (k: string): Obj[] => (Array.isArray(r[k]) ? (r[k] as unknown[]) : []).filter((x): x is Obj => isObj(x) && Number.isFinite(+(x.id as number)));
  const pick = <T extends string>(m: Map<string, T>, v: unknown, d: T): T => m.get(String(v ?? '')) ?? d;
  const risks: Risk[] = col('risks').map((x) => ({
    id: +(x.id as number),
    title: str(x.title),
    category: (RISK_CAT.get(String(x.cat ?? '')) ?? null) as RiskCategory | null,
    probability: num(x.prob, 3),
    impact: num(x.impact, 3),
    owner: str(x.owner),
    strategy: (RISK_STR.get(String(x.str ?? '')) ?? null) as RiskStrategy | null,
    response: str(x.resp),
    due: dt(x.due),
    status: pick<RiskStatus>(RISK_ST, x.status, 'open'),
  }));
  const issues: Issue[] = col('issues').map((x) => ({
    id: +(x.id as number),
    title: str(x.title),
    owner: str(x.owner),
    priority: pick<IssuePriority>(ISSUE_PRI, x.pri, 'medium'),
    due: dt(x.due),
    impact: str(x.impact),
    action: str(x.act),
    needsDecision: Boolean(x.dec),
    status: pick<IssueStatus>(ISSUE_ST, x.status, 'open'),
  }));
  const changes: ChangeRequest[] = col('changes').map((x) => ({
    id: +(x.id as number),
    title: str(x.title),
    requester: str(x.req),
    date: dt(x.date),
    reason: str(x.reason),
    impact: str(x.impact),
    previousFinish: dt(x.of),
    newFinish: dt(x.nf),
    status: pick<ChangeStatus>(CHANGE_ST, x.status, 'pending'),
    approvedBy: str(x.by),
    approvedOn: dt(x.ad),
  }));
  const decisions: Decision[] = col('decisions').map((x) => ({
    id: +(x.id as number),
    topic: str(x.topic),
    text: str(x.text),
    maker: str(x.maker),
    date: dt(x.date),
    status: pick<DecisionStatus>(DECISION_ST, x.status, 'pending'),
  }));
  const documents: ProjectDocument[] = (Array.isArray(r.docs) ? (r.docs as unknown[]) : [])
    .filter((d): d is Obj => isObj(d) && Number.isFinite(+(d.id as number)) && normalizeUrl(d.url) !== '' && String(d.title ?? '').trim() !== '')
    .map((d) => ({
      id: +(d.id as number),
      title: String(d.title).slice(0, 200),
      type: pick<DocumentType>(DOC_TYPE, d.type, 'other'),
      url: normalizeUrl(d.url),
      taskId: seen.has(+(d.task as number)) ? +(d.task as number) : null,
      date: dt(d.date),
      addedBy: String(d.by ?? '').replace(/[^\w\-:.]/g, '').slice(0, 80),
    }));

  const fin = isObj(r.fin) ? r.fin : {};
  const finance = {
    ...defaultFinanceSettings(),
    unit: String(fin.unit ?? 'ریال').slice(0, 24) || 'ریال',
    budget: Number.isFinite(+(fin.budget as number)) && +(fin.budget as number) > 0 ? +(fin.budget as number) : 0,
    // نسخه‌ی قدیمی همیشه با روش «باقی‌مانده» محاسبه می‌کرد، هرچه ذخیره شده بود؛ همان حفظ می‌شود.
    eacMethod: 'remaining' as const,
  };

  const log: LegacyLogEntry[] = (Array.isArray(r.log) ? r.log : [])
    .slice(0, 300)
    .filter(isObj)
    .map((l) => ({ at: str(l.t), subject: str(l.k), field: str(l.f), oldValue: str(l.o), newValue: str(l.n) }));
  const users: LegacyUser[] = (Array.isArray(r.users) ? r.users : [])
    .filter((u): u is Obj => isObj(u) && /^[\w\-:.]{1,80}$/.test(String(u.id)) && ['admin', 'pm', 'user', 'fin'].includes(String(u.role)))
    .map((u) => ({ id: String(u.id), role: u.role as LegacyUser['role'], resourceNames: String(u.res ?? '').replace(/[,،:]/g, ' ') }));

  return {
    model: {
      name: String(r.name ?? ''),
      start,
      status,
      contractEnd: dt(r.end),
      calendar,
      tasks,
      resources,
      baseline,
      baselineHistory,
      snapshots,
      costs,
      finance,
      charter,
      contract,
      risks,
      issues,
      changes,
      decisions,
      documents,
    },
    warnings,
    log,
    users,
    legacyVersion: Math.max(0, Math.trunc(num(r.ver))),
  };
}
