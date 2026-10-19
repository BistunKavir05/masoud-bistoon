import { describe, expect, it } from 'vitest';
import { emptyContract } from '../src/charter.ts';
import type { Contract } from '../src/charter.ts';
import { filterPortfolio, portfolioChecks, portfolioExportRows, portfolioImportUpdates, portfolioTemplateRows, portfolioTotals, previewPortfolioImport } from '../src/portfolio.ts';
import type { PortfolioItem } from '../src/portfolio.ts';

function item(id: number, name: string, o: { unit?: string; client?: string; contract?: Partial<Contract>; end?: string | null; archived?: boolean } = {}): PortfolioItem {
  return {
    id,
    name,
    start: '2026-03-21',
    status: '2026-10-01',
    contractEnd: (o.end ?? null) as PortfolioItem['contractEnd'],
    archived: o.archived ?? false,
    unit: o.unit ?? 'ریال',
    charter: { client: o.client ?? '', location: '', subject: '', product: '', projectManager: '', salesOwner: '' },
    contract: { ...emptyContract(), ...(o.contract ?? {}) },
  };
}

const HEAD = ['پروژه', 'شماره قرارداد', 'نام مشتری (کارفرما)', 'مبلغ قرارداد (ریال)', 'مبلغ کل وصول‌شده', 'تاریخ پایان قرارداد', 'تأییدیه فروش', 'حسن انجام کار', 'درصد پورسانت فروش', 'تاریخ شروع به کار', 'جمع پورسانت'];

describe('پورتفولیو: خروجی، جمع، بررسی', () => {
  const a = item(1, 'الف', { client: 'ک۱', contract: { number: 'C-1', amount: 1000, collectedTotal: 300, invoicedTotal: 500, salesCommissionPercent: 2, date: '2026-10-16' } });
  const b = item(2, 'ب', { unit: 'تومان', contract: { number: 'c-1', amount: 50 } });
  const c = item(3, 'ج', { client: 'ک', archived: true });

  it('ردیف‌های خروجی: عنوان، تاریخ شمسی لاتین، صفر خالی', () => {
    const rows = portfolioExportRows([a, b]);
    expect(rows[0]![0]).toBe('ردیف');
    expect(rows[0]![1]).toBe('پروژه');
    const h = rows[0]!;
    const ix = (label: string): number => h.indexOf(label);
    expect(rows[1]![ix('تاریخ انعقاد قرارداد')]).toBe('1405/07/24');
    expect(rows[1]![ix('مبلغ قرارداد')]).toBe(1000);
    expect(rows[2]![ix('مبلغ کل وصول‌شده')]).toBe('');
    expect(rows[1]![ix('مبلغ پورسانت فروش')]).toBe(20);
    expect(rows[1]![ix('واحد پول')]).toBe('ریال');
  });

  it('جمع‌ها به‌تفکیک واحد پول و پورسانت قابل پرداخت', () => {
    const t = portfolioTotals([a, b]);
    expect(t.length).toBe(2);
    expect(t[0]!.unit).toBe('ریال');
    expect(t[0]!.amount).toBe(1000);
    expect(t[0]!.uncollected).toBe(200);
    expect(t[0]!.commission).toBe(20);
    expect(t[0]!.payable).toBe(6);
    expect(t[1]!.unit).toBe('تومان');
    expect(t[1]!.amount).toBe(50);
  });

  it('هشدار نبود کارفرما/شماره قرارداد، تکراری، واحدها؛ بایگانی در «ناقص» نمی‌آید', () => {
    const k = portfolioChecks([a, b, c]);
    expect(k.missing.map((x) => x.id)).toEqual([2]);
    expect(k.duplicateNumbers).toEqual(['C-1']);
    expect(k.units).toEqual(['ریال', 'تومان']);
  });

  it('جست‌وجو در نام، کارفرما و شماره قرارداد', () => {
    expect(filterPortfolio([a, b], 'ک۱').map((x) => x.id)).toEqual([1]);
    expect(filterPortfolio([a, b], 'C-1').length).toBe(2);
    expect(filterPortfolio([a, b], '').length).toBe(2);
    expect(filterPortfolio([a, b], 'نیست').length).toBe(0);
  });

  it('قالب: عنوان‌ها قابل‌ورودند و ردیف نمونه هم‌طول است', () => {
    const t = portfolioTemplateRows();
    expect(t[0]!.length).toBe(t[1]!.length);
    expect(t[0]!.indexOf('جمع پورسانت')).toBe(-1);
    expect(t[0]!.indexOf('شماره قرارداد') > 0).toBe(true);
  });
});

describe('پورتفولیو: پیش‌نمایش ورود', () => {
  const items = [
    item(1, 'پروژه الف', { contract: { number: 'A-1', retentionMode: 'percent', retentionValue: 10, amount: 100 } }),
    item(2, 'پروژه ب', { end: '2027-01-01', contract: { number: 'B-1' } }),
    item(3, 'هم‌نام'),
    item(4, 'هم نام'),
    item(5, 'بایگانی', { archived: true }),
  ];

  it('تطبیق با نام؛ فقط سلول‌های پر؛ شروع و محاسبه‌ای نادیده؛ پایان فقط اگر خالی', () => {
    const r = previewPortfolioImport(
      [
        HEAD,
        ['پروژه الف', 'N-9', 'شرکت ن', '۲٬۰۰۰٬۰۰۰', '', '1405/12/29', 'تأیید شده', '۵۰', '2', '1400/01/01', '999'],
        ['پروژه ب', '', '', '', '', '1405/12/29', '', '', '', '', ''],
      ],
      items,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const [x, y] = r.preview.rows;
    expect(x!.status).toBe('ok');
    expect(x!.projectId).toBe(1);
    expect(x!.update!.contract.number).toBe('N-9');
    expect(x!.update!.contract.amount).toBe(2000000);
    expect(x!.update!.contract.collectedTotal).toBe(undefined);
    expect(x!.update!.contract.salesApproval).toBe('approved');
    expect(x!.update!.contract.retentionMode).toBe('fixed');
    expect(x!.update!.contract.retentionValue).toBe(50);
    expect(x!.update!.contract.salesCommissionPercent).toBe(2);
    expect(x!.update!.charter.client).toBe('شرکت ن');
    expect(x!.update!.contractEnd).toBe('2027-03-20');
    expect(x!.fieldCount).toBe(7);
    expect(x!.notes.length).toBe(1);
    // پروژه ب: پایان ثبت‌شده است و تنها سلول پر همان است
    expect(y!.status).toBe('empty');
    expect(y!.update).toBe(null);
    expect(y!.notes[0]).toBe('پایان قرارداد قبلاً ثبت شده و تغییر نمی‌کند.');
    expect(r.preview.ignoredColumns).toEqual([]);
    expect(portfolioImportUpdates(r.preview).length).toBe(1);
  });

  it('مقدار نامعتبر رد می‌شود و ردیف «هشدار» می‌گیرد؛ متن بلند بریده نمی‌شود', () => {
    const r = previewPortfolioImport([HEAD, ['پروژه الف', 'x'.repeat(101), 'ک', 'abc', '-5', '99/99/99', 'شاید', '', '150', '', ''], ['پروژه الف', 'A-2', '', '', '', '', '', '', '', '', '']], items);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const x = r.preview.rows[0]!;
    expect(x.status).toBe('warn');
    expect(x.bad).toEqual(['شماره قرارداد', 'مبلغ قرارداد', 'مبلغ کل وصول‌شده', 'تاریخ پایان قرارداد', 'تأییدیه فروش', 'درصد پورسانت فروش']);
    expect(x.update!.charter.client).toBe('ک');
    expect(x.fieldCount).toBe(1);
    // ردیف دوم همان پروژه: تکراری، وارد نمی‌شود
    expect(r.preview.rows[1]!.status).toBe('dup');
    expect(r.preview.rows[1]!.update).toBe(null);
    expect(r.preview.counts.warn).toBe(1);
    expect(r.preview.counts.dup).toBe(1);
  });

  it('پیدا نشد، مبهم، بایگانی؛ بدون ستون نام با شماره قرارداد تطبیق می‌خورد', () => {
    const r = previewPortfolioImport(
      [
        HEAD,
        ['ناشناس', 'z', '', '', '', '', '', '', '', '', ''],
        ['هم‌نام', 'z', '', '', '', '', '', '', '', '', ''],
        ['بایگانی', 'z', '', '', '', '', '', '', '', '', ''],
      ],
      items,
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.rows.map((x) => x.status)).toEqual(['nomatch', 'ambiguous', 'archived']);
    const byNo = previewPortfolioImport([['شماره قرارداد', 'مبلغ قرارداد'], ['b-1', '۷۷']], items);
    expect(byNo.ok).toBe(true);
    if (!byNo.ok) return;
    expect(byNo.preview.rows[0]!.projectId).toBe(2);
    expect(byNo.preview.rows[0]!.update!.contract.amount).toBe(77);
  });

  it('عدد و شماره‌ی ترتیبی Excel، ستون ناشناس فهرست می‌شود', () => {
    const r = previewPortfolioImport([['پروژه', 'مبلغ قرارداد', 'تاریخ انعقاد قرارداد', 'توضیحات ناشناخته'], ['پروژه الف', 1234.6, 46311, 'x']], items);
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const u = r.preview.rows[0]!.update!;
    expect(u.contract.amount).toBe(1235);
    expect(u.contract.date).toBe('2026-10-16');
    expect(r.preview.ignoredColumns).toEqual(['توضیحات ناشناخته']);
  });

  it('خطاهای ساختاری فایل', () => {
    expect(previewPortfolioImport([], items).ok).toBe(false);
    expect(previewPortfolioImport([['پروژه', 'مبلغ قرارداد']], items).ok).toBe(false);
    expect(previewPortfolioImport([['مبلغ قرارداد'], ['5']], items).ok).toBe(false);
    expect(previewPortfolioImport([['پروژه', 'مبلغ قرارداد', 'مبلغ قرارداد (ریال)'], ['الف', '5', '6']], items).ok).toBe(false);
    expect(previewPortfolioImport([['پروژه', 'جمع پورسانت'], ['پروژه الف', '5']], items).ok).toBe(false);
  });
});
