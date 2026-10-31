import { describe, expect, it } from 'vitest';
import { isProcurementLate, procurementDelayDays, procurementTotals } from '../src/procurement.ts';
import type { ProcurementItem } from '../src/procurement.ts';

const item = (p: Partial<ProcurementItem>): ProcurementItem => ({
  id: 1,
  item: 'پمپ',
  taskId: null,
  supplier: '',
  orderNumber: '',
  amount: 0,
  orderDate: null,
  plannedDelivery: null,
  actualDelivery: null,
  status: 'ordered',
  notes: '',
  ...p,
});
const STATUS = '2026-09-20';

describe('تأخیر تدارکات', () => {
  it('بدون تحویل برنامه‌ای تأخیر تعریف نمی‌شود', () => {
    expect(procurementDelayDays(item({}), STATUS)).toBeNull();
    expect(isProcurementLate(item({}), STATUS)).toBe(false);
  });

  it('تحویل‌نشده: فاصله‌ی تاریخ وضعیت از موعد، اگر گذشته باشد', () => {
    expect(procurementDelayDays(item({ plannedDelivery: '2026-09-10' }), STATUS)).toBe(10);
    expect(procurementDelayDays(item({ plannedDelivery: '2026-09-20' }), STATUS)).toBe(0);
    expect(procurementDelayDays(item({ plannedDelivery: '2026-10-01' }), STATUS)).toBe(0);
    expect(isProcurementLate(item({ plannedDelivery: '2026-09-10' }), STATUS)).toBe(true);
    expect(isProcurementLate(item({ plannedDelivery: '2026-10-01' }), STATUS)).toBe(false);
  });

  it('تحویل‌شده: فاصله‌ی تحویل واقعی از برنامه‌ای؛ زودتر صفر؛ تحویل‌شده بدون تاریخ واقعی صفر', () => {
    expect(procurementDelayDays(item({ plannedDelivery: '2026-09-01', actualDelivery: '2026-09-05', status: 'delivered' }), STATUS)).toBe(4);
    expect(procurementDelayDays(item({ plannedDelivery: '2026-09-10', actualDelivery: '2026-09-05', status: 'delivered' }), STATUS)).toBe(0);
    expect(procurementDelayDays(item({ plannedDelivery: '2026-09-01', status: 'delivered' }), STATUS)).toBe(0);
    expect(isProcurementLate(item({ plannedDelivery: '2026-09-01', actualDelivery: '2026-09-05', status: 'delivered' }), STATUS)).toBe(false);
  });

  it('جمع‌ها', () => {
    const list = [
      item({ id: 1, amount: 100, plannedDelivery: '2026-09-01' }),
      item({ id: 2, amount: 200, plannedDelivery: '2026-09-01', actualDelivery: '2026-09-03', status: 'delivered' }),
      item({ id: 3, amount: 300, plannedDelivery: '2026-12-01' }),
    ];
    expect(procurementTotals(list, STATUS)).toEqual({ count: 3, amount: 600, delivered: 1, late: 1 });
  });
});
