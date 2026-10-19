import { describe, expect, it } from 'vitest';
import { COST_TEMPLATE_HEADER, MAX_LEDGER_ROWS, csvCell, detectDelimiter, entriesToImport, newTask, parseCellAmount, parseCellDate, parseCsv, previewCostImport, toCsv } from '../src/index.ts';
import type { CostEntry, Task } from '../src/index.ts';

const tasks: Task[] = [
  { ...newTask(1, 1, 'summary', 'مهندسی') },
  { ...newTask(2, 2, 'task', 'طراحی') },
  { ...newTask(3, 2, 'task', 'ساخت') },
  { ...newTask(4, 1, 'task', 'ساخت') },
];
const H = [...COST_TEMPLATE_HEADER];

describe('CSV', () => {
  it('BOM، گیومه، خط جدید داخل سلول، ردیف خالی و جداکننده‌ی تشخیصی', () => {
    const t = '\uFEFFa;b;c\r\n"x;1";"y ""q""";"z\nw"\r\n\r\n1;2;3';
    expect(detectDelimiter(t.replace('\uFEFF', ''))).toBe(';');
    expect(parseCsv(t)).toEqual([
      ['a', 'b', 'c'],
      ['x;1', 'y "q"', 'z\nw'],
      ['1', '2', '3'],
    ]);
  });

  it('ارقام هزارگان‌دار در سلول بدون گیومه با جداکننده‌ی «؛» خراب نمی‌شود', () => {
    const r = parseCsv('تاریخ؛مبلغ\n1405/07/25؛1,500,000');
    expect(r[1]).toEqual(['1405/07/25', '1,500,000']);
  });

  it('خروجی: BOM، CRLF و محافظت از تزریق فرمول', () => {
    const out = toCsv([['=SUM(A1)', '+1', '-2', '@x', '\tz', 'ok', 5, -5, 'a,b', 'q"r', null]]);
    expect(out.startsWith('﻿')).toBe(true);
    expect(out.endsWith('\r\n')).toBe(true);
    expect(out).toBe("﻿'=SUM(A1),'+1,'-2,'@x,\"'\tz\",ok,5,-5,\"a,b\",\"q\"\"r\",\r\n");
    expect(csvCell(-5)).toBe('-5');
    expect(csvCell('-5')).toBe("'-5");
  });

  it('رفت‌وبرگشت', () => {
    const rows = [['الف', 'ب\nج', 'د"ه', '1,5']];
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });
});

describe('تاریخ و مبلغ سلول', () => {
  it('شمسی، میلادی، فشرده و شماره‌ی ترتیبی Excel', () => {
    expect(parseCellDate('1405/07/25')).toBe('2026-10-17');
    expect(parseCellDate('۱۴۰۵-۰۷-۲۵')).toBe('2026-10-17');
    expect(parseCellDate('2026-10-17')).toBe('2026-10-17');
    expect(parseCellDate(14050725)).toBe('2026-10-17');
    expect(parseCellDate('14050725')).toBe('2026-10-17');
    expect(parseCellDate(46312)).toBe('2026-10-17');
    expect(parseCellDate('1405/13/01')).toBeNull();
    expect(parseCellDate('2026-02-30')).toBeNull();
    expect(parseCellDate('')).toBeNull();
    expect(parseCellDate(5)).toBeNull();
  });
  it('مبلغ: هزارگان، ارقام فارسی، گرد‌کردن، رد صفر/منفی/متن', () => {
    expect(parseCellAmount('۱٬۵۰۰٬۰۰۰')).toBe(1500000);
    expect(parseCellAmount('1,500,000.4')).toBe(1500000);
    expect(parseCellAmount(2500.6)).toBe(2501);
    expect(parseCellAmount('0')).toBeNull();
    expect(parseCellAmount('-5')).toBeNull();
    expect(parseCellAmount('12 ریال')).toBeNull();
    expect(parseCellAmount('')).toBeNull();
  });
});

describe('پیش‌نمایش ورود هزینه', () => {
  const ledger: CostEntry[] = [{ id: 1, date: '2026-10-17', taskId: 2, description: 'x', document: 'F1', amount: 1000 }];

  it('طبقه‌بندی: معتبر، عمومی، یافت‌نشد، مبهم، تکراری، تاریخ/مبلغ نامعتبر', () => {
    const rows = [
      H,
      ['1405/07/25', '1.1', '', 'الف', 'D1', '500'], // ok (WBS 1.1 = طراحی)
      ['1405/07/25', '', '', 'سربار', '', '700'], // overhead
      ['1405/07/25', '9.9', '', 'ب', '', '10'], // nomatch
      ['1405/07/25', '', 'ساخت', 'پ', '', '10'], // ambiguous (دو فعالیت هم‌نام)
      ['1405/07/25', '1.1', '', 'ت', 'F1', '1000'], // dup با دفتر
      ['1405/07/25', '1.1', '', 'ث', 'D1', '500'], // dup داخل فایل
      ['نادرست', '1.1', '', 'ج', '', '10'], // تاریخ
      ['1405/07/25', '1.1', '', 'چ', '', '0'], // مبلغ
      ['1405/07/25', '1', '', 'ح', '', '10'], // WBS گروه است → یافت‌نشد
    ];
    const r = previewCostImport(rows, { tasks, ledger });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.preview.rows.map((x) => x.status)).toEqual(['ok', 'overhead', 'nomatch', 'ambiguous', 'dup', 'dup', 'bad-date', 'bad-amount', 'nomatch']);
    expect(r.preview.rows[0]).toMatchObject({ line: 2, taskId: 2, date: '2026-10-17', amount: 500 });
    expect(r.preview.counts.dup).toBe(2);
    // پیش‌فرض: فقط معتبر و عمومی؛ با انتخاب کاربر «یافت‌نشد» هم عمومی می‌شود؛ مبهم هرگز
    expect(entriesToImport(r.preview, { nomatchAsOverhead: false, ledgerSize: 1 }).entries.length).toBe(2);
    const withNo = entriesToImport(r.preview, { nomatchAsOverhead: true, ledgerSize: 1 });
    expect(withNo.entries.length).toBe(4);
    expect(withNo.entries.every((e) => e.amount > 0)).toBe(true);
  });

  it('عنوان ستون ناقص یا فایل خالی خطا می‌دهد', () => {
    expect(previewCostImport([H], { tasks, ledger }).ok).toBe(false);
    const r = previewCostImport([['الف', 'ب'], ['1', '2']], { tasks, ledger });
    expect(r.ok).toBe(false);
  });

  it('WBS بر نام اولویت دارد و ناهمخوانی نام هشدار می‌شود', () => {
    const r = previewCostImport([H, ['2026-10-17', '1.1', 'ساخت', 'ن', '', '5']], { tasks, ledger: [] });
    if (!r.ok) throw new Error('x');
    expect(r.preview.rows[0]).toMatchObject({ status: 'ok', taskId: 2 });
    expect(r.preview.rows[0]!.detail).toContain('WBS ملاک است');
  });

  it('سقف دفتر هزینه رعایت می‌شود', () => {
    const rows = [H, ...Array.from({ length: 10 }, (_, i) => ['2026-10-17', '', '', `s${i}`, `d${i}`, '5'])];
    const r = previewCostImport(rows, { tasks, ledger: [] });
    if (!r.ok) throw new Error('x');
    const e = entriesToImport(r.preview, { nomatchAsOverhead: false, ledgerSize: MAX_LEDGER_ROWS - 4 });
    expect(e.entries.length).toBe(4);
    expect(e.skippedForCapacity).toBe(6);
  });

  it('ردیف‌های بیش از سقف فایل حذف و علامت می‌خورد', () => {
    const rows = [H, ...Array.from({ length: 3005 }, (_, i) => ['2026-10-17', '', '', `s${i}`, `d${i}`, '5'])];
    const r = previewCostImport(rows, { tasks, ledger: [] });
    if (!r.ok) throw new Error('x');
    expect(r.preview.rows.length).toBe(3000);
    expect(r.preview.truncated).toBe(true);
  });
});
