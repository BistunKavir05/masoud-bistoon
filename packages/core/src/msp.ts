/**
 * ورود از Microsoft Project XML (MSPDI) — قواعد مطابق «بخش ۱۱-۱» مشخصات و تابع مرجع `parseMSP`.
 *
 * تفاوت‌های آگاهانه با مرجع (ثبت در docs/divergences.md):
 *  - روزهای غیرکاری از «تقویم پروژه» (هفته‌ی کاری و تعطیلی‌ها) می‌آید، نه «جمعه‌ی ثابت» (DEF-26).
 *  - برای پروژه‌ی جدید می‌توان تقویم خودِ فایل را خواند؛ برای پروژه‌ی موجود تقویم آن پروژه حفظ می‌شود.
 *  - ساعت بدون دقیقه («PT8H») هم خوانده می‌شود (مرجع مقدار صفر می‌گرفت).
 *  - چیزی بی‌صدا حذف نمی‌شود: هر رد، اصلاح یا نادیده‌گرفتن در `warnings` می‌آید.
 */
import { DayAxis, buildWorkingDays, defaultCalendar, validateCalendar } from './calendar.ts';
import type { IsoDate } from './date.ts';
import { addDays, isIsoDate, weekday } from './date.ts';
import { XmlError, parseXml, xmlChildren, xmlDescendants, xmlText } from './xml.ts';
import type { XmlNode } from './xml.ts';
import type { DependencyType, TaskKind, WorkCalendar } from './types.ts';

export interface MspWarning {
  code: string;
  message: string;
  uid?: number;
}

export interface MspLink {
  predecessorUid: number;
  type: DependencyType;
  lag: number;
}

export interface MspTask {
  uid: number;
  wbs: string;
  level: number;
  kind: TaskKind;
  name: string;
  /** روز کاری؛ خلاصه و مایلستون صفر */
  duration: number;
  dependencies: MspLink[];
  actualStart: IsoDate | null;
  actualFinish: IsoDate | null;
  percentComplete: number;
  /** خط مبنای شماره‌ی صفر (فقط غیرخلاصه) */
  baseline: { start: IsoDate; finish: IsoDate; zeroDuration: boolean } | null;
  startNoEarlierThan: IsoDate | null;
  deadline: IsoDate | null;
  /** هزینه‌ی ثابت (FixedCost)؛ برای خلاصه همیشه صفر */
  fixedCost: number;
}

export interface MspCounts {
  rows: number;
  tasks: number;
  summaries: number;
  milestones: number;
  baselines: number;
}

export interface MspParsed {
  name: string;
  /** شروع پروژه (پس از اصلاح ساعت و روز غیرکاری) */
  start: IsoDate;
  /** تاریخ وضعیت فایل؛ فقط اطلاعاتی (پروژه‌ی موجود تغییر نمی‌کند) */
  status: IsoDate | null;
  minutesPerDay: number;
  hoursPerDay: number;
  /** تقویمی که برای تبدیل تاریخ‌ها به کار رفت */
  calendar: WorkCalendar;
  calendarFromFile: boolean;
  tasks: MspTask[];
  counts: MspCounts;
  warnings: MspWarning[];
}

export interface MspParseOptions {
  /** تقویم پروژه‌ی مقصد؛ پیش‌فرض: تقویم پیش‌فرض برنامه */
  calendar?: WorkCalendar;
  /** تقویم را از خود فایل بخوان (پروژه‌ی جدید) */
  useFileCalendar?: boolean;
  /** ساعت هر «روز» برای تبدیل مدت‌ها؛ پیش‌فرض MinutesPerDay فایل */
  hoursPerDay?: number;
}

export type MspParseResult = { ok: true; value: MspParsed } | { ok: false; error: string };

export const MSP_INVALID_FILE = 'فایل XML معتبر پروژه‌ی Microsoft Project نیست.';
export const MSP_LIMITS = { maxTasks: 20_000, maxLevel: 9 } as const;

const TYPE_BY_CODE: Record<string, DependencyType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' };

/** «PT293H20M0S» → ساعت. ساعت یا دقیقه می‌تواند نباشد. */
export function mspHours(value: string | null | undefined): number {
  if (!value) return 0;
  const m = /^P(?:\d+D)?T(?:(\d+(?:\.\d+)?)H)?(?:(\d+(?:\.\d+)?)M)?(?:(\d+(?:\.\d+)?)S)?$/.exec(value.trim());
  if (!m) return 0;
  return Number(m[1] ?? 0) + Number(m[2] ?? 0) / 60 + Number(m[3] ?? 0) / 3600;
}

const hhmmToMinutes = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

interface Stamp {
  date: IsoDate;
  /** دقیقه از نیمه‌شب؛ null اگر ساعت نداشت */
  minutes: number | null;
}

function parseStamp(value: string | null): Stamp | null {
  if (!value) return null;
  const m = /^(\d{4}-\d{2}-\d{2})(?:T(\d{2}):(\d{2}))?/.exec(value.trim());
  if (!m || !isIsoDate(m[1])) return null;
  return { date: m[1] as IsoDate, minutes: m[2] !== undefined ? Number(m[2]) * 60 + Number(m[3] ?? 0) : null };
}

/** تقویم خودِ فایل: هفته‌ی کاری (DayType ۱=یکشنبه … ۷=شنبه) و تعطیلی‌های DayWorking=0 */
export function readMspCalendar(root: XmlNode, warn: (code: string, message: string) => void): WorkCalendar | null {
  const cals = xmlDescendants(root, 'Calendar');
  if (cals.length === 0) return null;
  const wanted = xmlText(root, 'CalendarUID');
  const cal = cals.find((c) => xmlText(c, 'UID') === wanted) ?? cals.find((c) => xmlText(c, 'IsBaseCalendar') === '1') ?? cals[0]!;
  const base = defaultCalendar();
  const days = base.days.map((d) => ({ ...d }));
  const week = xmlChildren(cal, 'WeekDays')[0];
  let read = 0;
  if (week) {
    for (const wd of xmlChildren(week, 'WeekDay')) {
      const type = Number(xmlText(wd, 'DayType'));
      if (!Number.isInteger(type) || type < 1 || type > 7) continue;
      const idx = type - 1;
      const working = xmlText(wd, 'DayWorking') === '1';
      const times = xmlChildren(xmlChildren(wd, 'WorkingTimes')[0] ?? wd, 'WorkingTime');
      const from = xmlText(times[0] ?? wd, 'FromTime');
      const to = xmlText(times[times.length - 1] ?? wd, 'ToTime');
      const ok = (t: string | null): t is string => t !== null && /^\d{2}:\d{2}/.test(t);
      days[idx] = { working, from: working && ok(from) ? from.slice(0, 5) : days[idx]!.from, to: working && ok(to) ? to.slice(0, 5) : days[idx]!.to };
      read += 1;
    }
  }
  if (read < 7) warn('CALENDAR_PARTIAL', read === 0 ? 'هفته‌ی کاری فایل خوانده نشد؛ از تقویم پیش‌فرض (جمعه تعطیل) استفاده شد.' : `از هفت روز هفته فقط ${read} روز در فایل تعریف شده بود؛ بقیه از تقویم پیش‌فرض آمد.`);
  const holidays = new Map<IsoDate, string>();
  const exceptions = xmlChildren(cal, 'Exceptions')[0];
  if (exceptions) {
    for (const ex of xmlChildren(exceptions, 'Exception')) {
      if (xmlText(ex, 'DayWorking') !== '0') continue;
      const period = xmlChildren(ex, 'TimePeriod')[0];
      const from = parseStamp(period ? xmlText(period, 'FromDate') : null);
      const to = parseStamp(period ? xmlText(period, 'ToDate') : null) ?? from;
      if (!from || !to || to.date < from.date) continue;
      const title = (xmlText(ex, 'Name') ?? '').slice(0, 120);
      let d = from.date;
      for (let k = 0; k < 400 && d <= to.date && holidays.size < 3000; k += 1) {
        if (!holidays.has(d)) holidays.set(d, title);
        d = addDays(d, 1);
      }
    }
  }
  const out: WorkCalendar = { days, holidays: [...holidays].sort(([a], [b]) => (a < b ? -1 : 1)).map(([date, title]) => ({ date, title })) };
  if (validateCalendar(out).length > 0) {
    warn('CALENDAR_INVALID', 'تقویم فایل معتبر نبود؛ از تقویم پیش‌فرض استفاده شد.');
    return defaultCalendar();
  }
  return out;
}

export function parseMspXml(xml: string, options: MspParseOptions = {}): MspParseResult {
  let root: XmlNode;
  try {
    root = parseXml(xml);
  } catch (e) {
    if (e instanceof XmlError) return { ok: false, error: MSP_INVALID_FILE };
    throw e;
  }
  if (root.name !== 'Project') return { ok: false, error: MSP_INVALID_FILE };
  const taskNodes = xmlDescendants(root, 'Task');
  if (taskNodes.length === 0) return { ok: false, error: MSP_INVALID_FILE };
  if (taskNodes.length > MSP_LIMITS.maxTasks) return { ok: false, error: `تعداد ردیف‌های فایل (${taskNodes.length}) از سقف مجاز ${MSP_LIMITS.maxTasks} بیشتر است.` };
  const startStamp = parseStamp(xmlText(root, 'StartDate'));
  if (!startStamp) return { ok: false, error: MSP_INVALID_FILE };

  const warnings: MspWarning[] = [];
  const warn = (code: string, message: string, uid?: number): void => void warnings.push(uid === undefined ? { code, message } : { code, message, uid });

  let calendar = options.calendar ?? defaultCalendar();
  let calendarFromFile = false;
  if (options.useFileCalendar) {
    const fromFile = readMspCalendar(root, warn);
    if (fromFile) {
      calendar = fromFile;
      calendarFromFile = true;
    }
  }

  const minutesPerDay = Number(xmlText(root, 'MinutesPerDay')) > 0 ? Number(xmlText(root, 'MinutesPerDay')) : 480;
  const override = options.hoursPerDay;
  const hoursPerDay = override !== undefined && override > 0 && override <= 24 ? override : minutesPerDay / 60;

  // ───── تبدیل تاریخ: ساعت و روزِ غیرکاری ─────
  const holidays = new Set(calendar.holidays.map((h) => h.date));
  const isWorking = (iso: IsoDate): boolean => Boolean(calendar.days[weekday(iso)]?.working) && !holidays.has(iso);
  let shifted = 0;
  const skip = (iso: IsoDate, dir: 1 | -1): IsoDate => {
    let d = iso;
    for (let k = 0; k < 4000 && !isWorking(d); k += 1) d = addDays(d, dir);
    if (d !== iso) shifted += 1;
    return d;
  };
  const dayMinutes = (iso: IsoDate): { from: number; to: number } => {
    const day = calendar.days[weekday(iso)];
    const ref = day?.working ? day : defaultCalendar().days[1]!;
    return { from: hhmmToMinutes(ref.from), to: hhmmToMinutes(ref.to) };
  };
  /** شروع: ساعتِ پایان روز کاری یا بعد از آن ← روز بعد؛ سپس رد روز غیرکاری به جلو */
  const xSd = (s: Stamp, milestone: boolean): IsoDate => {
    let d = s.date;
    if (!milestone && s.minutes !== null && s.minutes >= dayMinutes(d).to) d = addDays(d, 1);
    return skip(d, 1);
  };
  /** پایان: ساعتِ نزدیکِ آغاز روز (تا ۹۰ دقیقه بعد از شروع روز کاری) ← روز قبل؛ سپس رد روز غیرکاری به عقب */
  const xFd = (s: Stamp, milestone: boolean): IsoDate => {
    let d = s.date;
    if (!milestone && s.minutes !== null && s.minutes < dayMinutes(d).from + 90) d = addDays(d, -1);
    return skip(d, -1);
  };

  const start = xSd(startStamp, false);
  shifted = 0;
  const axis = new DayAxis(buildWorkingDays(start, calendar));
  const lastIdx = axis.length - 1;
  const statusStamp = parseStamp(xmlText(root, 'StatusDate'));

  // ───── ردیف‌ها ─────
  const tasks: MspTask[] = [];
  const ids = new Set<number>();
  const counts: MspCounts = { rows: 0, tasks: 0, summaries: 0, milestones: 0, baselines: 0 };
  let summaryActualsIgnored = 0;
  let baselineBeforeStart = 0;
  let invalidDates = 0;

  for (const t of taskNodes) {
    const uidText = xmlText(t, 'UID');
    const uid = Number(uidText);
    if (uidText === null || uidText === '' || !Number.isFinite(uid) || uid === 0) continue;
    if (!Number.isInteger(uid) || uid < 0 || uid > 2_000_000_000) {
      warn('INVALID_UID', `کد ردیف «${String(uidText)}» معتبر نیست؛ ردیف نادیده گرفته شد.`);
      continue;
    }
    if (ids.has(uid)) {
      warn('DUPLICATE_UID', `کد تکراری ${uid} نادیده گرفته شد.`, uid);
      continue;
    }
    ids.add(uid);
    const name = (xmlText(t, 'Name') || '(بدون نام)').slice(0, 300);
    const isSummary = xmlText(t, 'Summary') === '1';
    const isMilestone = xmlText(t, 'Milestone') === '1';
    const kind: TaskKind = isSummary ? 'summary' : isMilestone ? 'milestone' : 'task';
    const ms = isMilestone && !isSummary;

    // پیش‌نیازها
    const dependencies: MspLink[] = [];
    for (const p of xmlChildren(t, 'PredecessorLink')) {
      const pu = Number(xmlText(p, 'PredecessorUID'));
      const lagRaw = Number(xmlText(p, 'LinkLag'));
      const lag = Math.round((Number.isFinite(lagRaw) ? lagRaw : 0) / (hoursPerDay * 600));
      dependencies.push({ predecessorUid: pu, type: TYPE_BY_CODE[xmlText(p, 'Type') ?? ''] ?? 'FS', lag });
    }

    // تاریخ‌های واقعی
    const asStamp = parseStamp(xmlText(t, 'ActualStart'));
    const afStamp = parseStamp(xmlText(t, 'ActualFinish'));
    if ((xmlText(t, 'ActualStart') && !asStamp) || (xmlText(t, 'ActualFinish') && !afStamp)) invalidDates += 1;
    let actualStart: IsoDate | null = asStamp ? xSd(asStamp, ms) : null;
    let actualFinish: IsoDate | null = afStamp ? xFd(afStamp, ms) : null;
    if (actualFinish && !actualStart) actualStart = actualFinish;
    if (actualStart && actualFinish && actualFinish < actualStart) {
      warn('ACTUAL_DATES_FIXED', `تاریخ واقعی نامعتبر در «${name}» اصلاح شد.`, uid);
      actualFinish = actualStart;
    }

    // خط مبنا (فقط شماره‌ی ۰ و فقط غیرخلاصه)
    let baseline: MspTask['baseline'] = null;
    if (!isSummary) {
      for (const b of xmlChildren(t, 'Baseline')) {
        if (xmlText(b, 'Number') !== '0') continue;
        const hours = mspHours(xmlText(b, 'Duration'));
        const bStart = parseStamp(xmlText(b, 'Start'));
        if (!bStart || !(hours > 0 || ms)) continue;
        const raw = xSd(bStart, ms);
        const es = axis.onOrAfter(raw);
        if (raw < (axis.days[0] as IsoDate)) baselineBeforeStart += 1;
        const d = ms ? 0 : Math.max(1, Math.round(hours / hoursPerDay));
        const s = axis.dateAt(es) as IsoDate;
        const f = d === 0 ? s : (axis.dateAt(Math.min(es + d - 1, lastIdx)) as IsoDate);
        baseline = { start: s, finish: f, zeroDuration: d === 0 };
        counts.baselines += 1;
      }
    }

    // قید و ضرب‌الاجل
    const ct = xmlText(t, 'ConstraintType');
    const cdt = parseStamp(xmlText(t, 'ConstraintDate'));
    const dle = parseStamp(xmlText(t, 'Deadline'));
    let snet: IsoDate | null = null;
    let deadline: IsoDate | null = null;
    if (!isSummary && !actualStart && (ct === '4' || ct === '2') && cdt) snet = xSd(cdt, ms);
    if (!isSummary && !actualFinish) {
      if ((ct === '7' || ct === '3') && cdt) deadline = xFd(cdt, ms);
      if (dle) deadline = xFd(dle, ms);
    }

    const fixedCostRaw = Number(xmlText(t, 'FixedCost'));
    const fixedCost = !isSummary && Number.isFinite(fixedCostRaw) && fixedCostRaw > 0 ? fixedCostRaw : 0;
    const duration = isSummary || isMilestone ? 0 : Math.max(1, Math.round(mspHours(xmlText(t, 'Duration')) / hoursPerDay));
    const level = Math.min(MSP_LIMITS.maxLevel, Math.max(1, Math.trunc(Number(xmlText(t, 'OutlineLevel'))) || 1));

    if (isSummary) {
      counts.summaries += 1;
      if (actualStart || actualFinish) summaryActualsIgnored += 1;
      if (dependencies.length > 0) {
        warn('SUMMARY_PREDECESSORS_DROPPED', `فعالیت خلاصه‌ی «${name}» در این برنامه پیش‌نیاز ندارد؛ ${dependencies.length} پیوند آن نادیده گرفته شد.`, uid);
        dependencies.length = 0;
      }
    } else if (isMilestone) counts.milestones += 1;
    else counts.tasks += 1;
    counts.rows += 1;

    const pct = Number(xmlText(t, 'PercentComplete'));
    tasks.push({
      uid,
      wbs: xmlText(t, 'WBS') ?? '',
      level,
      kind,
      name,
      duration,
      dependencies,
      actualStart: isSummary ? null : actualStart,
      actualFinish: isSummary ? null : actualFinish,
      percentComplete: isSummary ? 0 : Math.min(100, Math.max(0, Number.isFinite(pct) ? pct : 0)),
      baseline,
      startNoEarlierThan: snet,
      deadline,
      fixedCost,
    });
  }

  // پیش‌نیازِ ناموجود (یا خودِ ردیف) حذف و گزارش می‌شود
  for (const t of tasks) {
    t.dependencies = t.dependencies.filter((p) => {
      if (p.predecessorUid === t.uid) {
        warn('SELF_PREDECESSOR', `پیش‌نیاز «${t.name}» خودش بود و حذف شد.`, t.uid);
        return false;
      }
      if (!ids.has(p.predecessorUid)) {
        warn('MISSING_PREDECESSOR', `پیش‌نیاز ناموجود ${Number.isFinite(p.predecessorUid) ? p.predecessorUid : '؟'} برای «${t.name}» حذف شد.`, t.uid);
        return false;
      }
      return true;
    });
  }

  if (tasks.length === 0) return { ok: false, error: 'فایل هیچ فعالیتی (به‌جز ردیف ریشه) ندارد.' };
  if (summaryActualsIgnored > 0) warn('SUMMARY_ACTUALS_IGNORED', `تاریخ واقعی ${summaryActualsIgnored} فعالیت خلاصه نادیده گرفته شد (از فرزندان مشتق می‌شود).`);
  if (baselineBeforeStart > 0) warn('BASELINE_BEFORE_START', `شروع خط مبنای ${baselineBeforeStart} فعالیت پیش از شروع پروژه بود و به روز اول برنامه منتقل شد.`);
  if (invalidDates > 0) warn('INVALID_DATES', `تاریخ واقعی ${invalidDates} ردیف قالب معتبر نداشت و نادیده گرفته شد.`);
  if (shifted > 0) warn('DATES_SHIFTED', `${shifted} تاریخ فایل روی روز غیرکاری تقویم افتاده بود و به نزدیک‌ترین روز کاری منتقل شد.`);

  // چیزهایی که این برنامه از فایل نمی‌خواند
  const resources = xmlChildren(xmlChildren(root, 'Resources')[0] ?? root, 'Resource').filter((r) => (xmlText(r, 'UID') ?? '0') !== '0');
  const assignments = xmlChildren(xmlChildren(root, 'Assignments')[0] ?? root, 'Assignment');
  if (resources.length > 0 || assignments.length > 0) warn('RESOURCES_NOT_IMPORTED', `فایل ${resources.length} منبع و ${assignments.length} تخصیص دارد؛ منابع و تخصیص‌ها وارد نمی‌شوند.`);

  return {
    ok: true,
    value: {
      name: (xmlText(root, 'Name') ?? '').slice(0, 200),
      start,
      status: statusStamp?.date ?? null,
      minutesPerDay,
      hoursPerDay,
      calendar,
      calendarFromFile,
      tasks,
      counts,
      warnings,
    },
  };
}
