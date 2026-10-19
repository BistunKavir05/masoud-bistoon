/**
 * ورود دسته‌ای هزینه‌ی واقعی از جدول (CSV/Excel): تبدیل به پیش‌نمایش طبقه‌بندی‌شده، بدون هیچ اثر جانبی.
 * قواعد مطابق xiLoad/xiApply نسخه‌ی قبلی با این تفاوت‌ها (docs/divergences.md):
 * تطابق با بیش از یک فعالیت «مبهم» است و وارد نمی‌شود؛ خطای تاریخ و مبلغ جدا گزارش می‌شود؛ جداکننده‌ی CSV از ردیف عنوان تشخیص داده می‌شود.
 */
import type { IsoDate } from './date.ts';
import { fromEpochDay, isIsoDate, toEpochDay } from './date.ts';
import { fromJalali, isValidJalali, normalizeDigits } from './jalali.ts';
import { wbsMap } from './structure.ts';
import type { CostEntry, Task } from './types.ts';

export const COST_TEMPLATE_HEADER = ['تاریخ', 'کد WBS', 'نام فعالیت', 'شرح هزینه', 'شماره سند', 'مبلغ'] as const;
export const COST_TEMPLATE_SAMPLE = ['1405/07/25', '1.2.1', '', 'نمونه: خرید مصالح', 'F-1001', '1500000'] as const;
/** سقف ردیف‌های یک فایل و سقف کل دفتر هزینه (حالت سازگاری با نسخه‌ی قبلی) */
export const MAX_IMPORT_ROWS = 3000;
export const MAX_LEDGER_ROWS = 5000;
export const MAX_COST_AMOUNT = 9e15;

export type CostRowStatus = 'ok' | 'overhead' | 'nomatch' | 'ambiguous' | 'dup' | 'bad-date' | 'bad-amount';

export const COST_STATUS_LABELS: Record<CostRowStatus, string> = {
  ok: 'معتبر',
  overhead: 'هزینه‌ی عمومی',
  nomatch: 'فعالیت پیدا نشد',
  ambiguous: 'با چند فعالیت مطابقت دارد',
  dup: 'تکراری',
  'bad-date': 'تاریخ نامعتبر',
  'bad-amount': 'مبلغ نامعتبر',
};

export interface CostImportRow {
  /** شماره‌ی ردیف در فایل (ردیف عنوان = ۱) */
  line: number;
  date: IsoDate | null;
  amount: number | null;
  taskId: number | null;
  description: string;
  document: string;
  /** WBS یا نام فعالیتی که در فایل آمده */
  ref: string;
  status: CostRowStatus;
  detail: string;
}

export interface CostImportPreview {
  rows: CostImportRow[];
  counts: Record<CostRowStatus, number>;
  /** ردیف‌های بعد از سقف نادیده گرفته شد */
  truncated: boolean;
}

export type CostImportResult = { ok: true; preview: CostImportPreview } | { ok: false; error: string };

type Cell = unknown;

const norm = (x: Cell): string =>
  normalizeDigits(String(x ?? ''))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌\s]+/g, ' ')
    .trim()
    .toLowerCase();

const EXCEL_EPOCH = toEpochDay('1899-12-30');

/** تاریخ سلول: شمسی `1405/07/25`، میلادی `2026-10-17`، عدد فشرده‌ی شمسی `14050725` یا شماره‌ی ترتیبی Excel */
export function parseCellDate(v: Cell): IsoDate | null {
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    if (Number.isInteger(v) && v >= 13000101 && v <= 15001231) return fromJalaliParts(Math.floor(v / 10000), Math.floor(v / 100) % 100, v % 100);
    if (v > 20000 && v < 80000) {
      const iso = fromEpochDay(EXCEL_EPOCH + Math.floor(v));
      return isIsoDate(iso) ? iso : null;
    }
    return null;
  }
  const t = normalizeDigits(String(v ?? '')).trim();
  if (/^\d{8}$/.test(t)) return parseCellDate(Number(t));
  const m = /^(\d{4})[/\-.](\d{1,2})[/\-.](\d{1,2})$/.exec(t);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  if (y >= 1700) {
    const iso = `${m[1]}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
    return isIsoDate(iso) ? iso : null;
  }
  return fromJalaliParts(y, mo, d);
}

function fromJalaliParts(jy: number, jm: number, jd: number): IsoDate | null {
  if (!isValidJalali(jy, jm, jd)) return null;
  const iso = fromJalali(jy, jm, jd);
  return isIsoDate(iso) ? iso : null;
}

/** مبلغ سلول: عدد، یا متن با جداکننده‌ی هزارگان؛ گردشده به عدد صحیح و مثبت */
export function parseCellAmount(v: Cell): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const t = normalizeDigits(String(v ?? '')).replace(/[,\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    n = Number(t);
  }
  if (!Number.isFinite(n)) return null;
  const r = Math.round(n);
  return r > 0 && r <= MAX_COST_AMOUNT ? r : null;
}

interface Columns {
  date: number;
  wbs: number;
  task: number;
  desc: number;
  doc: number;
  amount: number;
}

function findColumns(header: readonly Cell[]): Columns {
  const h = header.map(norm);
  const ix = (...keys: string[]): number => {
    for (const k of keys) {
      const j = h.findIndex((x) => x.includes(k));
      if (j >= 0) return j;
    }
    return -1;
  };
  return {
    date: ix('تاریخ', 'date'),
    wbs: ix('wbs', 'کد'),
    task: ix('نام فعالیت', 'فعالیت', 'activity'),
    desc: ix('شرح', 'عنوان', 'توضیح'),
    doc: ix('سند', 'فاکتور', 'doc'),
    amount: ix('مبلغ', 'amount', 'ریال'),
  };
}

const emptyCounts = (): Record<CostRowStatus, number> => ({ ok: 0, overhead: 0, nomatch: 0, ambiguous: 0, dup: 0, 'bad-date': 0, 'bad-amount': 0 });

/**
 * @param rows سطرهای جدول؛ سطر اول عنوان ستون‌هاست
 */
export function previewCostImport(rows: readonly (readonly Cell[])[], ctx: { tasks: readonly Task[]; ledger: readonly CostEntry[] }): CostImportResult {
  const data = rows.filter((r) => r.some((c) => String(c ?? '').trim() !== ''));
  if (data.length < 2) return { ok: false, error: 'فایل خالی است یا فقط ردیف عنوان دارد.' };
  const col = findColumns(data[0] as readonly Cell[]);
  if (col.date < 0 || col.amount < 0) return { ok: false, error: 'ستون‌های «تاریخ» و «مبلغ» در ردیف عنوان پیدا نشد. از «دانلود قالب» استفاده کنید.' };

  const wbs = wbsMap(ctx.tasks);
  const leaves = ctx.tasks.filter((t) => t.kind !== 'summary');
  const byWbs = new Map<string, Task[]>();
  const byName = new Map<string, Task[]>();
  for (const t of leaves) {
    const w = norm(wbs.get(t.id));
    byWbs.set(w, [...(byWbs.get(w) ?? []), t]);
    const n = norm(t.name);
    byName.set(n, [...(byName.get(n) ?? []), t]);
  }
  const keyOf = (date: string, taskId: number | null, amount: number, doc: string): string => [date, taskId ?? 0, amount, doc].join('|');
  const existing = new Set(ctx.ledger.map((c) => keyOf(c.date, c.taskId, Math.round(c.amount), c.document.trim())));
  const seen = new Set<string>();

  const body = data.slice(1);
  const truncated = body.length > MAX_IMPORT_ROWS;
  const out: CostImportRow[] = [];
  const counts = emptyCounts();
  body.slice(0, MAX_IMPORT_ROWS).forEach((r, i) => {
    const g = (k: number): Cell => (k < 0 ? '' : r[k]);
    const date = parseCellDate(g(col.date));
    const amount = parseCellAmount(g(col.amount));
    const w = norm(g(col.wbs));
    const tn = norm(g(col.task));
    const ref = String(g(col.wbs) ?? '').trim() || String(g(col.task) ?? '').trim();
    const document = String(g(col.doc) ?? '').trim().slice(0, 60);
    const description = String(g(col.desc) ?? '').trim().slice(0, 120) || 'هزینه';
    let status: CostRowStatus = 'ok';
    let detail = '';
    let taskId: number | null = null;

    if (date === null) {
      status = 'bad-date';
      detail = 'تاریخ را به شکل ۱۴۰۵/۰۷/۲۵ یا ۲۰۲۶-۱۰-۱۷ بنویسید.';
    } else if (amount === null) {
      status = 'bad-amount';
      detail = 'مبلغ باید عددی مثبت باشد.';
    } else if (w || tn) {
      const found = w ? (byWbs.get(w) ?? []) : (byName.get(tn) ?? []);
      if (found.length === 1) {
        taskId = (found[0] as Task).id;
        if (w && tn && norm((found[0] as Task).name) !== tn) detail = `نام فعالیت فایل با «${(found[0] as Task).name}» یکسان نیست؛ WBS ملاک است.`;
      } else if (found.length === 0) {
        status = 'nomatch';
        detail = w ? 'WBS در فعالیت‌های پروژه نیست (یا گروه است).' : 'نام فعالیت دقیقاً در پروژه نیست.';
      } else {
        status = 'ambiguous';
        detail = 'بیش از یک فعالیت مطابقت دارد؛ WBS را بنویسید.';
      }
    } else status = 'overhead';

    if ((status === 'ok' || status === 'overhead') && date !== null && amount !== null) {
      const k = keyOf(date, taskId, amount, document);
      if (existing.has(k) || seen.has(k)) {
        status = 'dup';
        detail = existing.has(k) ? 'همین ردیف قبلاً در دفتر هزینه ثبت شده است.' : 'در همین فایل تکرار شده است.';
      }
      seen.add(k);
    }
    counts[status] += 1;
    out.push({ line: i + 2, date, amount, taskId, description, document, ref, status, detail });
  });
  return { ok: true, preview: { rows: out, counts, truncated } };
}

export interface CostEntryInput {
  date: IsoDate;
  taskId: number | null;
  description: string;
  document: string;
  amount: number;
}

/**
 * ردیف‌هایی که باید وارد شوند: معتبر و عمومی؛ «فعالیت پیدا نشد» فقط با انتخاب صریح کاربر به‌صورت هزینه‌ی عمومی.
 * مبهم، تکراری و نامعتبر هرگز وارد نمی‌شود. سقف دفتر هزینه رعایت می‌شود.
 */
export function entriesToImport(preview: CostImportPreview, opts: { nomatchAsOverhead: boolean; ledgerSize: number }): { entries: CostEntryInput[]; skippedForCapacity: number } {
  const all: CostEntryInput[] = [];
  for (const r of preview.rows) {
    if (r.date === null || r.amount === null) continue;
    if (r.status === 'ok' || r.status === 'overhead') all.push({ date: r.date, taskId: r.taskId, description: r.description, document: r.document, amount: r.amount });
    else if (r.status === 'nomatch' && opts.nomatchAsOverhead) all.push({ date: r.date, taskId: null, description: r.description, document: r.document, amount: r.amount });
  }
  const room = Math.max(0, MAX_LEDGER_ROWS - opts.ledgerSize);
  return { entries: all.slice(0, room), skippedForCapacity: Math.max(0, all.length - room) };
}
