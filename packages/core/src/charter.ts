/** منشور پروژه، قرارداد و پورسانت. همه‌ی مبالغ به واحد پولی پروژه (پیش‌فرض ریال) و اعداد صحیح‌اند. */
import type { IsoDate } from './date.ts';

export interface Charter {
  client: string;
  location: string;
  subject: string;
  product: string;
  projectManager: string;
  salesOwner: string;
  goals: string;
  scope: string;
  assumptions: string;
  stakeholders: string;
}

export function emptyCharter(): Charter {
  return { client: '', location: '', subject: '', product: '', projectManager: '', salesOwner: '', goals: '', scope: '', assumptions: '', stakeholders: '' };
}

export type SalesApproval = 'pending' | 'approved' | 'rejected';
export const SALES_APPROVAL_LABELS: Record<SalesApproval, string> = { pending: 'در انتظار تأیید', approved: 'تأییدشده', rejected: 'ردشده' };
export type RetentionMode = 'fixed' | 'percent';

export interface Contract {
  number: string;
  date: IsoDate | null;
  type: string;
  validity: string;
  amount: number;
  advanceDate: IsoDate | null;
  advanceGuaranteeSerial: string;
  advanceAmount: number;
  invoiceNumbers: string;
  /** جمع مبلغ فاکتورشده */
  invoicedTotal: number;
  /** جمع مبلغ وصول‌شده */
  collectedTotal: number;
  performanceGuaranteeSerial: string;
  /** حسن انجام کار: مبلغ ثابت یا درصدی از مبلغ قرارداد (به ازای هر قرارداد) */
  retentionMode: RetentionMode;
  /** مبلغ (حالت fixed) یا درصد ۰ تا ۱۰۰ (حالت percent) */
  retentionValue: number;
  salesApproval: SalesApproval | null;
  /** درصد پورسانت فروش (از مبلغ قرارداد) */
  salesCommissionPercent: number;
  /** درصد پورسانت حسن انجام کار (از مبلغ حسن انجام کار) */
  retentionCommissionPercent: number;
}

export function emptyContract(): Contract {
  return {
    number: '',
    date: null,
    type: '',
    validity: '',
    amount: 0,
    advanceDate: null,
    advanceGuaranteeSerial: '',
    advanceAmount: 0,
    invoiceNumbers: '',
    invoicedTotal: 0,
    collectedTotal: 0,
    performanceGuaranteeSerial: '',
    retentionMode: 'fixed',
    retentionValue: 0,
    salesApproval: null,
    salesCommissionPercent: 0,
    retentionCommissionPercent: 0,
  };
}

/** مبلغ حسن انجام کار */
export function retentionAmount(c: Pick<Contract, 'amount' | 'retentionMode' | 'retentionValue'>): number {
  return c.retentionMode === 'percent' ? Math.round((c.amount * c.retentionValue) / 100) : Math.round(c.retentionValue);
}

export interface Commission {
  /** پورسانت فروش = درصد × مبلغ قرارداد */
  sales: number;
  /** پورسانت حسن انجام کار = درصد × مبلغ حسن انجام کار */
  retention: number;
  total: number;
}

/** کل استحقاق پورسانت (مستقل از وصول) — همان فرمول نسخه‌ی قبلی */
export function computeCommission(c: Contract): Commission {
  const sales = Math.round((c.amount * c.salesCommissionPercent) / 100);
  const retention = Math.round((retentionAmount(c) * c.retentionCommissionPercent) / 100);
  return { sales, retention, total: sales + retention };
}

export interface CommissionPayable extends Commission {
  /** نسبت وصول‌شده به مبلغ قرارداد (۰ تا ۱) */
  collectedRatio: number;
  /** سهم قابل پرداخت از پورسانت فروش (متناسب با وصولی) */
  payableSales: number;
  /** سهم قابل پرداخت از پورسانت حسن انجام کار (فقط پس از وصول حسن انجام کار) */
  payableRetention: number;
  payable: number;
  /** باقی‌مانده‌ی استحقاق که هنوز قابل پرداخت نشده است */
  pending: number;
}

/**
 * پورسانت قابل پرداخت بر مبنای وصول (تصمیم کارفرما: پورسانت با وصول مطالبات قابل پرداخت می‌شود).
 * - فروش: متناسب با نسبت وصولی به مبلغ قرارداد.
 * - حسن انجام کار: وصولی ابتدا مبلغ بدون حسن انجام کار را می‌پوشاند؛ مازاد آن وصول حسن انجام کار حساب می‌شود.
 */
export function commissionPayable(c: Contract): CommissionPayable {
  const base = computeCommission(c);
  if (!(c.amount > 0)) return { ...base, collectedRatio: 0, payableSales: 0, payableRetention: 0, payable: 0, pending: base.total };
  const ret = retentionAmount(c);
  const collected = Math.max(0, c.collectedTotal);
  const ratio = c.amount > 0 ? Math.min(1, collected / c.amount) : 0;
  const retCollected = ret > 0 ? Math.min(ret, Math.max(0, collected - Math.max(0, c.amount - ret))) : 0;
  const payableSales = Math.round(base.sales * ratio);
  const payableRetention = ret > 0 ? Math.round((base.retention * retCollected) / ret) : 0;
  const payable = payableSales + payableRetention;
  return { ...base, collectedRatio: ratio, payableSales, payableRetention, payable, pending: base.total - payable };
}

export interface ContractWarning {
  code: string;
  message: string;
}

/** هشدارهای سازگاری داده‌ی قرارداد (منع‌کننده نیستند) */
export function contractWarnings(c: Contract, projectStart: IsoDate | null): ContractWarning[] {
  const w: ContractWarning[] = [];
  const add = (code: string, message: string): void => void w.push({ code, message });
  if (c.date && projectStart && c.date > projectStart) add('CONTRACT_AFTER_START', 'تاریخ انعقاد قرارداد بعد از تاریخ شروع به کار است.');
  if (c.advanceDate && c.date && c.advanceDate < c.date) add('ADVANCE_BEFORE_CONTRACT', 'تاریخ واریز پیش‌پرداخت قبل از تاریخ انعقاد قرارداد است.');
  if (c.amount) {
    if (c.advanceAmount > c.amount) add('ADVANCE_OVER_AMOUNT', 'مبلغ پیش‌پرداخت از مبلغ قرارداد بیشتر است.');
    if (retentionAmount(c) > c.amount) add('RETENTION_OVER_AMOUNT', 'مبلغ حسن انجام کار از مبلغ قرارداد بیشتر است.');
    if (c.invoicedTotal > c.amount) add('INVOICED_OVER_AMOUNT', 'مبلغ فاکتورشده از مبلغ قرارداد بیشتر است (در صورت الحاقیه، مبلغ قرارداد را اصلاح کنید).');
  }
  if (c.collectedTotal > c.invoicedTotal) add('COLLECTED_OVER_INVOICED', 'مبلغ وصول‌شده از مبلغ فاکتورشده بیشتر است (مگر پیش‌پرداخت بدون فاکتور).');
  return w;
}
