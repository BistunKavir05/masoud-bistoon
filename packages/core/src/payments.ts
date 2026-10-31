/**
 * صورت‌وضعیت‌ها و دریافتی‌ها. هر ردیف یک صورت‌وضعیت (یا پیش‌پرداخت) است؛ مانده‌ی مطالبات از خودِ ردیف‌ها محاسبه می‌شود.
 * جمع‌های «مبلغ فاکتورشده/وصول‌شده» در قرارداد (برای پورسانت) جدا و دستی می‌مانند و با این ردیف‌ها خودکار هم‌گام نمی‌شوند.
 */
import type { IsoDate } from './date.ts';

export const PAYMENT_STATUSES = ['preparing', 'sent', 'approved', 'paid'] as const;
export type PaymentStatus = (typeof PAYMENT_STATUSES)[number];
export const PAYMENT_STATUS_LABELS: Record<PaymentStatus, string> = {
  preparing: 'در حال تهیه',
  sent: 'ارسال‌شده',
  approved: 'تأییدشده',
  paid: 'پرداخت‌شده',
};

export interface Payment {
  id: number;
  /** شماره‌ی صورت‌وضعیت (مثلاً «۱» یا «پیش‌پرداخت») */
  number: string;
  title: string;
  sentDate: IsoDate | null;
  /** مبلغ ارسالی به کارفرما */
  sentAmount: number;
  /** مبلغ تأییدشده توسط کارفرما/مشاور؛ null = هنوز تأیید نشده */
  approvedAmount: number | null;
  receivedAmount: number;
  receivedDate: IsoDate | null;
  status: PaymentStatus;
  notes: string;
}

/**
 * مانده‌ی مطالبات یک ردیف = (مبلغ تأییدشده، وگرنه ارسالی) − دریافتی.
 * صورت‌وضعیتِ «در حال تهیه» هنوز مطالبه نشده و در مطالبات نمی‌آید (اختلاف عمدی با فایل اکسل که آن را هم می‌شمارد).
 * منفی = بیش از مطالبه دریافت شده (مثلاً پیش‌پرداخت که هنوز کسر نشده).
 */
export function paymentReceivable(p: Pick<Payment, 'status' | 'sentAmount' | 'approvedAmount' | 'receivedAmount'>): number {
  if (p.status === 'preparing') return 0;
  return (p.approvedAmount ?? p.sentAmount) - p.receivedAmount;
}

export interface PaymentTotals {
  count: number;
  /** جمع مبلغ ارسالی (همه‌ی ردیف‌های غیر «در حال تهیه») */
  sent: number;
  /** جمع مبلغ تأییدشده (ردیف‌هایی که تأییدشده‌اند) */
  approved: number;
  received: number;
  receivable: number;
}

export function paymentTotals(list: readonly Payment[]): PaymentTotals {
  const t: PaymentTotals = { count: list.length, sent: 0, approved: 0, received: 0, receivable: 0 };
  for (const p of list) {
    if (p.status !== 'preparing') t.sent += p.sentAmount;
    if (p.approvedAmount !== null) t.approved += p.approvedAmount;
    t.received += p.receivedAmount;
    t.receivable += paymentReceivable(p);
  }
  return t;
}
