import { describe, expect, it } from 'vitest';
import { parseHolidayText } from '../src/lib/holidays.ts';

describe('تجزیه‌ی تعطیلات', () => {
  it('تاریخ شمسی و میلادی، ارقام فارسی و جداکننده‌های گوناگون', () => {
    const r = parseHolidayText('۱۴۰۶/۰۱/۰۱ نوروز\n1406/01/02,عید\n2026-03-23;دوشنبه\n۱۴۰۶-۰۱-۰۴\tبدون‌ویرگول\n۱۴۰۶/۱/۵', new Set());
    expect(r.errors).toEqual([]);
    expect(r.rows).toEqual([
      { date: '2026-03-23', title: 'دوشنبه' },
      { date: '2027-03-21', title: 'نوروز' },
      { date: '2027-03-22', title: 'عید' },
      { date: '2027-03-24', title: 'بدون‌ویرگول' },
      { date: '2027-03-25', title: '' },
    ]);
  });

  it('خط نامعتبر شماره‌ی خط و علت دارد و بقیه ادامه می‌یابند؛ خط خالی نادیده است', () => {
    const r = parseHolidayText('\n۱۴۰۶/۰۱/۰۱ نوروز\nسلام\n۱۴۰۶/۱۳/۰۱ ماه نامعتبر\n', new Set());
    expect(r.rows).toHaveLength(1);
    expect(r.errors.map((e) => e.line)).toEqual([3, 4]);
    expect(r.errors[0]!.reason.length).toBeGreaterThan(5);
  });

  it('تکراری داخل متن (آخری می‌ماند) و جایگزینیِ تاریخ موجود شمرده می‌شود', () => {
    const r = parseHolidayText('۱۴۰۶/۰۱/۰۱ الف\n۱۴۰۶/۰۱/۰۱ ب\n۱۴۰۶/۰۱/۰۲ ج', new Set(['2027-03-22']));
    expect(r.duplicates).toBe(1);
    expect(r.rows[0]).toEqual({ date: '2027-03-21', title: 'ب' });
    expect(r.overwrites).toBe(1);
  });

  it('عنوان گیومه‌دار CSV و BOM', () => {
    const r = parseHolidayText('﻿۱۴۰۶/۰۱/۰۱,"نوروز, روز اول"', new Set());
    expect(r.rows).toEqual([{ date: '2027-03-21', title: 'نوروز, روز اول' }]);
  });
});
