import { describe, expect, it } from 'vitest';
import { commissionPayable, computeCommission, contractWarnings, emptyContract, retentionAmount } from '../src/charter.ts';
import type { Contract } from '../src/charter.ts';
import { openRisks, riskLevel, riskScore, topRisks } from '../src/records.ts';
import type { Risk } from '../src/records.ts';

const contract = (p: Partial<Contract> = {}): Contract => ({
  ...emptyContract(),
  amount: 1_000_000,
  retentionMode: 'fixed',
  retentionValue: 100_000,
  salesCommissionPercent: 3,
  retentionCommissionPercent: 5,
  ...p,
});

describe('حسن انجام کار', () => {
  it('مبلغ ثابت', () => expect(retentionAmount(contract())).toBe(100_000));
  it('درصدی از مبلغ قرارداد', () => expect(retentionAmount(contract({ amount: 2_000_000, retentionMode: 'percent', retentionValue: 10 }))).toBe(200_000));
});

describe('استحقاق پورسانت (فرمول نسخه‌ی قبلی)', () => {
  it('فروش + حسن انجام کار', () => {
    expect(computeCommission(contract())).toEqual({ sales: 30_000, retention: 5_000, total: 35_000 });
  });
  it('گرد کردن مثل Math.round', () => {
    expect(computeCommission(contract({ amount: 1_000_001 })).sales).toBe(30_000);
    expect(computeCommission(contract({ amount: 1_000_020 })).sales).toBe(30_001);
  });
  it('قرارداد خالی صفر است', () => {
    expect(computeCommission(emptyContract())).toEqual({ sales: 0, retention: 0, total: 0 });
  });
  it('حسن انجام کار درصدی', () => {
    const c = contract({ retentionMode: 'percent', retentionValue: 10 });
    expect(computeCommission(c).retention).toBe(5_000);
  });
});

describe('پورسانت قابل پرداخت بر مبنای وصول', () => {
  it('بدون وصول چیزی قابل پرداخت نیست', () => {
    const p = commissionPayable(contract());
    expect([p.payable, p.pending, p.collectedRatio]).toEqual([0, 35_000, 0]);
  });
  it('وصول جزئی: فقط پورسانت فروش متناسب', () => {
    const p = commissionPayable(contract({ collectedTotal: 450_000 }));
    expect(p.payableSales).toBe(13_500);
    expect(p.payableRetention).toBe(0);
    expect(p.pending).toBe(35_000 - 13_500);
  });
  it('وصول بخشی از حسن انجام کار', () => {
    const p = commissionPayable(contract({ collectedTotal: 950_000 }));
    expect(p.payableSales).toBe(28_500);
    expect(p.payableRetention).toBe(2_500);
    expect(p.payable).toBe(31_000);
  });
  it('وصول کامل و بیشتر از قرارداد', () => {
    const p = commissionPayable(contract({ collectedTotal: 5_000_000 }));
    expect(p.payable).toBe(35_000);
    expect(p.pending).toBe(0);
    expect(p.collectedRatio).toBe(1);
  });
  it('مبلغ قرارداد صفر: بدون تقسیم بر صفر', () => {
    const p = commissionPayable(contract({ amount: 0, collectedTotal: 10 }));
    expect(p.payable).toBe(0);
    expect(p.collectedRatio).toBe(0);
  });
  it('وصولی منفی نادیده گرفته می‌شود', () => {
    expect(commissionPayable(contract({ collectedTotal: -5 })).payable).toBe(0);
  });
});

describe('هشدارهای قرارداد', () => {
  it('هشدارهای ناسازگاری', () => {
    const w = contractWarnings(
      contract({ date: '2026-10-01', advanceDate: '2026-09-01', advanceAmount: 2_000_000, invoicedTotal: 1_500_000, collectedTotal: 1_600_000, retentionValue: 2_000_000 }),
      '2026-09-15',
    ).map((x) => x.code);
    expect(w.sort()).toEqual(['ADVANCE_BEFORE_CONTRACT', 'ADVANCE_OVER_AMOUNT', 'COLLECTED_OVER_INVOICED', 'CONTRACT_AFTER_START', 'INVOICED_OVER_AMOUNT', 'RETENTION_OVER_AMOUNT']);
  });
  it('قرارداد سالم هشدار ندارد', () => {
    expect(contractWarnings(contract({ invoicedTotal: 500_000, collectedTotal: 400_000 }), null)).toEqual([]);
  });
});

describe('ریسک', () => {
  const r = (id: number, probability: number, impact: number, status: Risk['status'] = 'open'): Risk => ({
    id,
    title: `R${id}`,
    category: null,
    probability,
    impact,
    owner: '',
    strategy: null,
    response: '',
    due: null,
    status,
  });
  it('سطح‌ها در مرزها', () => {
    expect([4, 5, 9, 10, 14, 15, 25].map(riskLevel)).toEqual(['low', 'medium', 'medium', 'high', 'high', 'critical', 'critical']);
    expect(riskScore(r(1, 3, 4))).toBe(12);
  });
  it('ریسک بسته یا خارج از مقیاس حذف می‌شود', () => {
    expect(openRisks([r(1, 3, 3), r(2, 3, 3, 'closed'), r(3, 0, 3), r(4, 6, 1), r(5, 2.5, 2), r(6, 1, 1, 'in_progress')]).map((x) => x.id)).toEqual([1, 6]);
  });
  it('برترین‌ها: امتیاز نزولی و شناسه‌ی صعودی در تساوی', () => {
    expect(topRisks([r(5, 3, 3), r(2, 3, 3), r(9, 5, 5), r(1, 1, 1)], 3).map((x) => x.id)).toEqual([9, 2, 5]);
  });
});
