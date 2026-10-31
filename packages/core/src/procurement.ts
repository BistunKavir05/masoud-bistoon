/** تدارکات و سفارش‌ها: قلم/خدمت، تأمین‌کننده، مبلغ، تحویل برنامه‌ای و واقعی و تأخیر خودکار. */
import type { IsoDate } from './date.ts';
import { diffDays } from './date.ts';

export const PROCUREMENT_STATUSES = ['requested', 'inquiry', 'ordered', 'manufacturing', 'shipping', 'delivered'] as const;
export type ProcurementStatus = (typeof PROCUREMENT_STATUSES)[number];
export const PROCUREMENT_STATUS_LABELS: Record<ProcurementStatus, string> = {
  requested: 'درخواست خرید',
  inquiry: 'استعلام',
  ordered: 'سفارش‌گذاری',
  manufacturing: 'در حال ساخت',
  shipping: 'در حال حمل',
  delivered: 'تحویل‌شده',
};

export interface ProcurementItem {
  id: number;
  /** قلم یا خدمت */
  item: string;
  /** فعالیتی که این خرید برای آن است (اختیاری) */
  taskId: number | null;
  supplier: string;
  orderNumber: string;
  amount: number;
  orderDate: IsoDate | null;
  plannedDelivery: IsoDate | null;
  actualDelivery: IsoDate | null;
  status: ProcurementStatus;
  notes: string;
}

/**
 * تأخیر تحویل به روز تقویمی (نه روز کاری، مثل فایل اکسل). تحویل‌شده: فاصله‌ی تحویل واقعی از برنامه‌ای (اگر دیرتر بوده)؛
 * هنوز تحویل نشده: فاصله‌ی تاریخ وضعیت پروژه از تحویل برنامه‌ای (اگر گذشته باشد). بدون تاریخ تحویل برنامه‌ای: null.
 */
export function procurementDelayDays(p: Pick<ProcurementItem, 'plannedDelivery' | 'actualDelivery' | 'status'>, statusDate: IsoDate): number | null {
  if (!p.plannedDelivery) return null;
  if (p.actualDelivery) return Math.max(0, diffDays(p.actualDelivery, p.plannedDelivery));
  if (p.status === 'delivered') return 0;
  return Math.max(0, diffDays(statusDate, p.plannedDelivery));
}

/** هنوز تحویل نشده و از موعد گذشته */
export const isProcurementLate = (p: Pick<ProcurementItem, 'plannedDelivery' | 'actualDelivery' | 'status'>, statusDate: IsoDate): boolean =>
  p.status !== 'delivered' && !p.actualDelivery && (procurementDelayDays(p, statusDate) ?? 0) > 0;

export interface ProcurementTotals {
  count: number;
  amount: number;
  delivered: number;
  late: number;
}

export function procurementTotals(list: readonly ProcurementItem[], statusDate: IsoDate): ProcurementTotals {
  const t: ProcurementTotals = { count: list.length, amount: 0, delivered: 0, late: 0 };
  for (const p of list) {
    t.amount += p.amount;
    if (p.status === 'delivered' || p.actualDelivery) t.delivered += 1;
    if (isProcurementLate(p, statusDate)) t.late += 1;
  }
  return t;
}
