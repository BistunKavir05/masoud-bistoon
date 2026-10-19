/**
 * مدیریت پروژه‌ها (پورتفولیو): جدول یکپارچه، هشدارها، جمع‌ها به‌تفکیک واحد پول، خروجی و ورود گروهی قرارداد از جدول.
 * همه‌چیز خالص است (بدون شبکه و بدون اثر جانبی)؛ فایل را رابط می‌خواند و اینجا فقط ردیف‌ها تحلیل می‌شود.
 *
 * قواعد ورود (سازگار با نسخه‌ی قبلی، docs/divergences.md):
 * - ردیف با «نام پروژه» (یا اگر نام نیامده، با «شماره قرارداد») به یک پروژه‌ی موجود وصل می‌شود؛ پروژه‌ی جدید ساخته نمی‌شود.
 * - فقط سلول‌های پر به‌روز می‌شوند؛ سلول خالی هیچ مقداری را پاک نمی‌کند.
 * - «تاریخ شروع» و ستون‌های محاسبه‌ای (پورسانت، واحد پول) نادیده گرفته می‌شوند؛ «تاریخ پایان» فقط برای پروژه‌ی بدون پایان ثبت می‌شود.
 * - مبلغ حسن انجام کار با ورود به‌صورت «مبلغ ثابت» ثبت می‌شود.
 * - مقدار نامعتبر یا بیش‌ازحد طولانی رد می‌شود (بریده نمی‌شود) و ردیف با هشدار می‌آید.
 */
import type { IsoDate } from './date.ts';
import type { Contract, SalesApproval } from './charter.ts';
import { SALES_APPROVAL_LABELS, commissionPayable, computeCommission, retentionAmount } from './charter.ts';
import { parseCellDate } from './costImport.ts';
import { formatJalali, normalizeDigits } from './jalali.ts';

export interface PortfolioCharter {
  client: string;
  location: string;
  subject: string;
  product: string;
  projectManager: string;
  salesOwner: string;
}

export interface PortfolioItem {
  id: number;
  name: string;
  start: IsoDate;
  status: IsoDate;
  contractEnd: IsoDate | null;
  archived: boolean;
  /** برچسب واحد پول پروژه */
  unit: string;
  charter: PortfolioCharter;
  contract: Contract;
}

export type PortfolioColType = 'text' | 'date' | 'money' | 'percent' | 'approval';

export interface PortfolioColumn {
  key: string;
  label: string;
  type: PortfolioColType;
  /** محاسبه‌ای یا فقط‌خواندنی: در ورود نادیده گرفته می‌شود */
  computed?: boolean;
}

export const PORTFOLIO_COLUMNS: readonly PortfolioColumn[] = [
  { key: 'unit', label: 'واحد پول', type: 'text', computed: true },
  { key: 'cno', label: 'شماره قرارداد', type: 'text' },
  { key: 'cdate', label: 'تاریخ انعقاد قرارداد', type: 'date' },
  { key: 'ctype', label: 'نوع قرارداد', type: 'text' },
  { key: 'client', label: 'نام مشتری (کارفرما)', type: 'text' },
  { key: 'loc', label: 'محل اجرای پروژه', type: 'text' },
  { key: 'subj', label: 'موضوع قرارداد', type: 'text' },
  { key: 'prod', label: 'نام محصول', type: 'text' },
  { key: 'valid', label: 'مدت اعتبار', type: 'text' },
  { key: 'amount', label: 'مبلغ قرارداد', type: 'money' },
  { key: 'sales', label: 'مسئول فروش', type: 'text' },
  { key: 'start', label: 'تاریخ شروع به کار', type: 'date', computed: true },
  { key: 'advDate', label: 'تاریخ واریز پیش‌پرداخت', type: 'date' },
  { key: 'end', label: 'تاریخ پایان قرارداد', type: 'date' },
  { key: 'advSerial', label: 'سریال ضمانت‌نامه‌ی پیش‌پرداخت', type: 'text' },
  { key: 'advAmt', label: 'مبلغ پیش‌پرداخت', type: 'money' },
  { key: 'invNos', label: 'شماره فاکتورها', type: 'text' },
  { key: 'invTotal', label: 'مبلغ کل فاکتورشده', type: 'money' },
  { key: 'paid', label: 'مبلغ کل وصول‌شده', type: 'money' },
  { key: 'perfSerial', label: 'سریال ضمانت انجام تعهدات', type: 'text' },
  { key: 'retAmt', label: 'حسن انجام کار', type: 'money' },
  { key: 'salesOK', label: 'تأییدیه فروش', type: 'approval' },
  { key: 'comPct', label: 'درصد پورسانت فروش', type: 'percent' },
  { key: 'comAmt', label: 'مبلغ پورسانت فروش', type: 'money', computed: true },
  { key: 'comRetPct', label: 'درصد پورسانت حسن انجام کار', type: 'percent' },
  { key: 'comRetAmt', label: 'مبلغ پورسانت حسن انجام کار', type: 'money', computed: true },
  { key: 'comTot', label: 'جمع پورسانت', type: 'money', computed: true },
];

/** مقدار خام یک ستون برای نمایش و خروجی (تاریخ به‌صورت ISO، مبلغ و درصد عدد) */
export function portfolioCell(item: PortfolioItem, key: string): string | number | null {
  const c = item.contract;
  const ch = item.charter;
  switch (key) {
    case 'unit':
      return item.unit;
    case 'cno':
      return c.number;
    case 'cdate':
      return c.date;
    case 'ctype':
      return c.type;
    case 'client':
      return ch.client;
    case 'loc':
      return ch.location;
    case 'subj':
      return ch.subject;
    case 'prod':
      return ch.product;
    case 'valid':
      return c.validity;
    case 'amount':
      return c.amount;
    case 'sales':
      return ch.salesOwner;
    case 'start':
      return item.start;
    case 'advDate':
      return c.advanceDate;
    case 'end':
      return item.contractEnd;
    case 'advSerial':
      return c.advanceGuaranteeSerial;
    case 'advAmt':
      return c.advanceAmount;
    case 'invNos':
      return c.invoiceNumbers;
    case 'invTotal':
      return c.invoicedTotal;
    case 'paid':
      return c.collectedTotal;
    case 'perfSerial':
      return c.performanceGuaranteeSerial;
    case 'retAmt':
      return retentionAmount(c);
    case 'salesOK':
      return c.salesApproval ? SALES_APPROVAL_LABELS[c.salesApproval] : '';
    case 'comPct':
      return c.salesCommissionPercent;
    case 'comAmt':
      return computeCommission(c).sales;
    case 'comRetPct':
      return c.retentionCommissionPercent;
    case 'comRetAmt':
      return computeCommission(c).retention;
    case 'comTot':
      return computeCommission(c).total;
    default:
      return null;
  }
}

const norm = (x: unknown): string =>
  normalizeDigits(String(x ?? ''))
    .replace(/ي/g, 'ی')
    .replace(/ك/g, 'ک')
    .replace(/[‌\s]+/g, ' ')
    .trim()
    .toLowerCase();

/** برای سنجش «شماره قرارداد» و نام: بدون فاصله و نیم‌فاصله */
const squash = (x: unknown): string => norm(x).replace(/\s/g, '');

export function filterPortfolio(items: readonly PortfolioItem[], query: string): PortfolioItem[] {
  const q = norm(query);
  if (!q) return [...items];
  return items.filter((it) => [it.name, it.charter.client, it.contract.number, it.charter.location, it.charter.subject, it.charter.product, it.charter.salesOwner].some((x) => norm(x).includes(q)));
}

export interface PortfolioTotals {
  unit: string;
  count: number;
  amount: number;
  advance: number;
  invoiced: number;
  collected: number;
  /** فاکتورشده‌ی هنوز وصول‌نشده */
  uncollected: number;
  retention: number;
  commissionSales: number;
  commissionRetention: number;
  commission: number;
  /** پورسانت قابل پرداخت بر مبنای وصول */
  payable: number;
}

/** جمع‌ها به‌تفکیک واحد پول (جمع واحدهای مختلف بی‌معناست و هرگز با هم جمع نمی‌شود) */
export function portfolioTotals(items: readonly PortfolioItem[]): PortfolioTotals[] {
  const out = new Map<string, PortfolioTotals>();
  for (const it of items) {
    const t =
      out.get(it.unit) ??
      ({ unit: it.unit, count: 0, amount: 0, advance: 0, invoiced: 0, collected: 0, uncollected: 0, retention: 0, commissionSales: 0, commissionRetention: 0, commission: 0, payable: 0 } satisfies PortfolioTotals);
    const c = it.contract;
    const com = commissionPayable(c);
    t.count += 1;
    t.amount += c.amount;
    t.advance += c.advanceAmount;
    t.invoiced += c.invoicedTotal;
    t.collected += c.collectedTotal;
    t.retention += retentionAmount(c);
    t.commissionSales += com.sales;
    t.commissionRetention += com.retention;
    t.commission += com.total;
    t.payable += com.payable;
    out.set(it.unit, t);
  }
  for (const t of out.values()) t.uncollected = Math.max(0, t.invoiced - t.collected);
  return [...out.values()];
}

export interface PortfolioChecks {
  /** پروژه‌های فعال بدون نام کارفرما یا شماره قرارداد */
  missing: PortfolioItem[];
  /** شماره قراردادهای تکراری (به‌همان شکل ثبت‌شده‌ی نخستین مورد) */
  duplicateNumbers: string[];
  /** واحدهای پولی که در پروژه‌ها به‌کار رفته */
  units: string[];
}

export function portfolioChecks(items: readonly PortfolioItem[]): PortfolioChecks {
  const missing = items.filter((it) => !it.archived && (it.charter.client.trim() === '' || it.contract.number.trim() === ''));
  const seen = new Map<string, { label: string; n: number }>();
  for (const it of items) {
    const k = squash(it.contract.number);
    if (!k) continue;
    const e = seen.get(k) ?? { label: it.contract.number.trim(), n: 0 };
    e.n += 1;
    seen.set(k, e);
  }
  const units = [...new Set(items.map((it) => it.unit))];
  return { missing, duplicateNumbers: [...seen.values()].filter((e) => e.n > 1).map((e) => e.label), units };
}

// ───────────────────────── خروجی و قالب ─────────────────────────

const exportDate = (iso: string | null): string => (iso ? formatJalali(iso as IsoDate, { persianDigits: false }) : '');

/** ردیف‌های خروجی CSV/Excel: ردیف عنوان + یک ردیف برای هر پروژه (تاریخ شمسی با ارقام لاتین؛ مبلغ صفر خالی) */
export function portfolioExportRows(items: readonly PortfolioItem[]): (string | number)[][] {
  const header: (string | number)[] = ['ردیف', 'پروژه', ...PORTFOLIO_COLUMNS.map((c) => c.label)];
  const rows = items.map((it, i) => [
    i + 1,
    it.name,
    ...PORTFOLIO_COLUMNS.map((c): string | number => {
      const v = portfolioCell(it, c.key);
      if (v === null || v === '') return '';
      if (c.type === 'date') return exportDate(String(v));
      if ((c.type === 'money' || c.type === 'percent') && v === 0) return '';
      return v;
    }),
  ]);
  return [header, ...rows];
}

const isImportable = (c: PortfolioColumn): boolean => !c.computed;

/** قالب ورود: عنوان ستون‌های قابل ورود + یک ردیف نمونه */
export function portfolioTemplateRows(): string[][] {
  const cols = PORTFOLIO_COLUMNS.filter(isImportable);
  const sample: Record<string, string> = {
    cno: 'QA-1',
    cdate: '1405/07/10',
    ctype: 'فروش و نصب',
    client: 'شرکت الف',
    loc: 'یاسوج',
    subj: 'موضوع قرارداد',
    prod: 'نام محصول',
    valid: '۱۲ ماه',
    amount: '1000000000',
    sales: 'رضا',
    advDate: '1405/07/12',
    end: '(فقط اگر پایان خالی باشد)',
    advAmt: '200000000',
    invNos: 'F1',
    invTotal: '500000000',
    paid: '300000000',
    retAmt: '100000000',
    salesOK: 'تأییدشده',
    comPct: '2',
    comRetPct: '1',
  };
  return [['پروژه', ...cols.map((c) => c.label)], ['نام دقیق پروژه‌ی موجود', ...cols.map((c) => sample[c.key] ?? '')]];
}

// ───────────────────────── ورود گروهی ─────────────────────────

export const MAX_PORTFOLIO_IMPORT_ROWS = 1000;
const MAX_MONEY = 9e15;

/** حداکثر طول فیلدهای متنی (برابر با سقف سرور؛ مقدار بلندتر رد می‌شود، نه بریده) */
const TEXT_MAX: Record<string, number> = { cno: 100, ctype: 100, client: 300, loc: 300, subj: 500, prod: 300, valid: 200, sales: 200, advSerial: 100, invNos: 500, perfSerial: 100 };

export interface PortfolioUpdate {
  projectId: number;
  charter: Partial<Pick<PortfolioCharter, 'client' | 'location' | 'subject' | 'product' | 'salesOwner'>>;
  contract: Partial<Contract>;
  /** فقط برای پروژه‌ای که هنوز پایان قرارداد ندارد */
  contractEnd?: IsoDate;
}

export type PortfolioRowStatus = 'ok' | 'warn' | 'empty' | 'nomatch' | 'ambiguous' | 'dup' | 'archived';

export const PORTFOLIO_STATUS_LABELS: Record<PortfolioRowStatus, string> = {
  ok: 'قابل ورود',
  warn: 'قابل ورود (برخی سلول‌ها نامعتبر و نادیده)',
  empty: 'سلول پری برای ورود ندارد',
  nomatch: 'پروژه پیدا نشد',
  ambiguous: 'با چند پروژه‌ی هم‌نام مطابقت دارد',
  dup: 'پروژه در ردیف قبلی هم آمده',
  archived: 'پروژه بایگانی شده است',
};

export interface PortfolioImportRow {
  /** شماره‌ی ردیف در فایل (ردیف عنوان = ۱) */
  line: number;
  name: string;
  projectId: number | null;
  projectName: string;
  status: PortfolioRowStatus;
  /** تعداد سلول‌هایی که به‌روز می‌شود */
  fieldCount: number;
  /** نام ستون‌هایی که مقدار نامعتبر داشتند */
  bad: string[];
  notes: string[];
  update: PortfolioUpdate | null;
}

export interface PortfolioImportPreview {
  rows: PortfolioImportRow[];
  counts: Record<PortfolioRowStatus, number>;
  /** عنوان ستون‌هایی که شناخته نشد و نادیده گرفته شد */
  ignoredColumns: string[];
  truncated: boolean;
}

export type PortfolioImportResult = { ok: true; preview: PortfolioImportPreview } | { ok: false; error: string };

const HEADER_UNIT = /\((ریال|تومان|rial|irr|toman)\)/g;
const headerKey = (h: unknown): string => norm(h).replace(HEADER_UNIT, '').replace(/\s+/g, ' ').trim();
const COLUMN_BY_LABEL = new Map(PORTFOLIO_COLUMNS.map((c) => [headerKey(c.label), c]));

const APPROVAL_ALIASES: Record<string, SalesApproval> = {
  pending: 'pending',
  درانتظار: 'pending',
  درانتظارتایید: 'pending',
  approved: 'approved',
  تایید: 'approved',
  تاییدشده: 'approved',
  rejected: 'rejected',
  رد: 'rejected',
  ردشده: 'rejected',
};
const looseApproval = (v: unknown): SalesApproval | null => {
  const k = squash(v).replace(/[أإآ]/g, 'ا').replace(/ئ/g, 'ی').replace(/تأ/g, 'تا');
  return APPROVAL_ALIASES[k] ?? null;
};

const isBlank = (v: unknown): boolean => v === null || v === undefined || String(v).trim() === '';

function parseMoney(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const t = normalizeDigits(String(v)).replace(/[,٬،\s]/g, '');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    n = Number(t);
  }
  if (!Number.isFinite(n) || n < 0) return null;
  const r = Math.round(n);
  return r <= MAX_MONEY ? r : null;
}

function parsePercent(v: unknown): number | null {
  let n: number;
  if (typeof v === 'number') n = v;
  else {
    const t = normalizeDigits(String(v)).replace(/[%٪\s]/g, '').replace(/٫/g, '.');
    if (!/^\d+(\.\d+)?$/.test(t)) return null;
    n = Number(t);
  }
  return Number.isFinite(n) && n >= 0 && n <= 100 ? Math.round(n * 100) / 100 : null;
}

const emptyCounts = (): Record<PortfolioRowStatus, number> => ({ ok: 0, warn: 0, empty: 0, nomatch: 0, ambiguous: 0, dup: 0, archived: 0 });

/** ردیف‌های فایل را با پروژه‌های موجود تطبیق می‌دهد و پیش‌نمایش می‌سازد؛ هیچ‌چیزی ثبت نمی‌شود. */
export function previewPortfolioImport(rows: readonly (readonly unknown[])[], items: readonly PortfolioItem[]): PortfolioImportResult {
  const lines = rows.map((r, i) => ({ r, line: i + 1 })).filter((x) => x.r.some((c) => !isBlank(c)));
  if (lines.length < 2) return { ok: false, error: 'فایل خالی است یا فقط ردیف عنوان دارد.' };
  const header = lines[0]!;
  let nameCol = -1;
  const cols = new Map<string, number>();
  const ignored: string[] = [];
  for (let j = 0; j < header.r.length; j++) {
    const raw = header.r[j];
    if (isBlank(raw)) continue;
    const k = headerKey(raw);
    if (k === 'پروژه' || k === 'نام پروژه') {
      if (nameCol >= 0) return { ok: false, error: 'ستون «پروژه» دو بار آمده است.' };
      nameCol = j;
      continue;
    }
    if (k === 'ردیف') continue;
    const col = COLUMN_BY_LABEL.get(k);
    if (!col || col.computed) {
      if (!col) ignored.push(String(raw).trim());
      continue;
    }
    if (cols.has(col.key)) return { ok: false, error: `ستون «${col.label}» دو بار آمده است؛ یکی را حذف کنید.` };
    cols.set(col.key, j);
  }
  if (nameCol < 0 && !cols.has('cno')) return { ok: false, error: 'ستون «پروژه» یا «شماره قرارداد» در ردیف عنوان پیدا نشد. از «دانلود قالب» یا «خروجی» استفاده کنید.' };
  if (cols.size === 0) return { ok: false, error: 'هیچ ستون قابل ورودی (مثل شماره قرارداد یا مبلغ) در فایل پیدا نشد.' };

  const data = lines.slice(1);
  const truncated = data.length > MAX_PORTFOLIO_IMPORT_ROWS;
  const seen = new Set<number>();
  const out: PortfolioImportRow[] = [];
  for (const { r, line } of data.slice(0, MAX_PORTFOLIO_IMPORT_ROWS)) {
    const bad: string[] = [];
    const notes: string[] = [];
    const charter: PortfolioUpdate['charter'] = {};
    const contract: Partial<Contract> = {};
    let contractEnd: IsoDate | undefined;
    let endGiven = false;
    let count = 0;
    const name = nameCol >= 0 && !isBlank(r[nameCol]) ? String(r[nameCol]).trim() : '';
    const label = (key: string): string => PORTFOLIO_COLUMNS.find((c) => c.key === key)!.label;

    for (const [key, j] of cols) {
      const v = r[j];
      if (isBlank(v)) continue;
      const col = PORTFOLIO_COLUMNS.find((c) => c.key === key)!;
      let ok = true;
      switch (col.type) {
        case 'text': {
          const s = String(v).trim();
          if (s.length > (TEXT_MAX[key] ?? 200)) {
            ok = false;
            break;
          }
          if (key === 'cno') contract.number = s;
          else if (key === 'ctype') contract.type = s;
          else if (key === 'valid') contract.validity = s;
          else if (key === 'advSerial') contract.advanceGuaranteeSerial = s;
          else if (key === 'invNos') contract.invoiceNumbers = s;
          else if (key === 'perfSerial') contract.performanceGuaranteeSerial = s;
          else if (key === 'client') charter.client = s;
          else if (key === 'loc') charter.location = s;
          else if (key === 'subj') charter.subject = s;
          else if (key === 'prod') charter.product = s;
          else if (key === 'sales') charter.salesOwner = s;
          break;
        }
        case 'date': {
          const d = parseCellDate(v);
          if (!d) {
            ok = false;
            break;
          }
          if (key === 'cdate') contract.date = d;
          else if (key === 'advDate') contract.advanceDate = d;
          else if (key === 'end') {
            endGiven = true;
            contractEnd = d;
          }
          break;
        }
        case 'money': {
          const n = parseMoney(v);
          if (n === null) {
            ok = false;
            break;
          }
          if (key === 'amount') contract.amount = n;
          else if (key === 'advAmt') contract.advanceAmount = n;
          else if (key === 'invTotal') contract.invoicedTotal = n;
          else if (key === 'paid') contract.collectedTotal = n;
          else if (key === 'retAmt') {
            contract.retentionMode = 'fixed';
            contract.retentionValue = n;
          }
          break;
        }
        case 'percent': {
          const n = parsePercent(v);
          if (n === null) {
            ok = false;
            break;
          }
          if (key === 'comPct') contract.salesCommissionPercent = n;
          else if (key === 'comRetPct') contract.retentionCommissionPercent = n;
          break;
        }
        case 'approval': {
          const a = looseApproval(v);
          if (!a) {
            ok = false;
            break;
          }
          contract.salesApproval = a;
          break;
        }
      }
      if (ok) count += 1;
      else bad.push(label(key));
    }

    const cnoKey = cols.has('cno') && !isBlank(r[cols.get('cno')!]) ? squash(r[cols.get('cno')!]) : '';
    let matches: PortfolioItem[] = [];
    if (name) matches = items.filter((it) => squash(it.name) === squash(name));
    else if (cnoKey) matches = items.filter((it) => squash(it.contract.number) === cnoKey);

    let status: PortfolioRowStatus;
    let target: PortfolioItem | null = null;
    if (matches.length === 0) status = 'nomatch';
    else if (matches.length > 1) status = 'ambiguous';
    else {
      target = matches[0]!;
      if (target.archived) status = 'archived';
      else if (seen.has(target.id)) status = 'dup';
      else {
        if (endGiven && contractEnd !== undefined && target.contractEnd !== null) {
          notes.push('پایان قرارداد قبلاً ثبت شده و تغییر نمی‌کند.');
          contractEnd = undefined;
          count -= 1;
        }
        if (contract.retentionMode === 'fixed' && target.contract.retentionMode === 'percent') notes.push('حسن انجام کار از «درصدی» به «مبلغ ثابت» تغییر می‌کند.');
        status = count === 0 ? 'empty' : bad.length > 0 ? 'warn' : 'ok';
        if (status === 'ok' || status === 'warn') seen.add(target.id);
      }
    }
    const importable = status === 'ok' || status === 'warn';
    out.push({
      line,
      name: name || (cnoKey ? `(شماره قرارداد ${String(r[cols.get('cno')!]).trim()})` : ''),
      projectId: target ? target.id : null,
      projectName: target ? target.name : '',
      status,
      fieldCount: importable ? count : 0,
      bad,
      notes,
      update: importable && target ? { projectId: target.id, charter, contract, ...(contractEnd ? { contractEnd } : {}) } : null,
    });
  }
  const counts = emptyCounts();
  for (const r of out) counts[r.status] += 1;
  return { ok: true, preview: { rows: out, counts, ignoredColumns: ignored, truncated } };
}

/** بدنه‌ی درخواست ورود: فقط ردیف‌های قابل ورود */
export function portfolioImportUpdates(preview: PortfolioImportPreview): PortfolioUpdate[] {
  return preview.rows.flatMap((r) => (r.update ? [r.update] : []));
}
