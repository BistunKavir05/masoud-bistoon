import { describe, expect, it } from 'vitest';
import { DASH, dateToInput, faDate, faMoney, faNum, faPct, isSafeUrl, parseDateInput, parseNumber } from '../src/lib/fmt.ts';

describe('نمایش اعداد و تاریخ', () => {
  it('ارقام فارسی و جداکننده‌ی هزارگان', () => {
    expect(faNum(1234567)).toBe('۱٬۲۳۴٬۵۶۷');
    expect(faNum(0)).toBe('۰');
    expect(faNum(12.345, 2)).toBe('۱۲٫۳۵');
  });
  it('مقدار نامعتبر هرگز NaN یا Infinity نشان نمی‌دهد', () => {
    expect(faNum(NaN)).toBe(DASH);
    expect(faNum(Infinity)).toBe(DASH);
    expect(faNum(null)).toBe(DASH);
    expect(faPct(undefined)).toBe(DASH);
    expect(faMoney(NaN)).toBe(DASH);
  });
  it('درصد و پول', () => {
    expect(faPct(45.5)).toBe('۴۵٫۵٪');
    expect(faMoney(1500000.4)).toBe('۱٬۵۰۰٬۰۰۰ ریال');
  });
  it('تاریخ شمسی نمایشی از ISO میلادی', () => {
    expect(faDate('2026-03-21')).toBe('۱۴۰۵/۰۱/۰۱');
    expect(faDate(null)).toBe(DASH);
    expect(dateToInput('2026-03-21')).toBe('۱۴۰۵/۰۱/۰۱');
  });
});

describe('ورودی کاربر', () => {
  it('عدد با ارقام فارسی و عربی و جداکننده', () => {
    expect(parseNumber('۱٬۲۳۴')).toBe(1234);
    expect(parseNumber('١٢٣')).toBe(123);
    expect(parseNumber('12,500.5')).toBe(12500.5);
    expect(parseNumber('−7')).toBe(-7);
  });
  it('ورودی نامعتبر null است', () => {
    expect(parseNumber('')).toBeNull();
    expect(parseNumber('abc')).toBeNull();
    expect(parseNumber('1e5')).toBeNull();
    expect(parseNumber('1.2.3')).toBeNull();
  });
  it('تاریخ شمسی، میلادی و خالی', () => {
    expect(parseDateInput('۱۴۰۵/۰۱/۰۱')).toBe('2026-03-21');
    expect(parseDateInput('1405-1-1')).toBe('2026-03-21');
    expect(parseDateInput('2026-03-21')).toBe('2026-03-21');
    expect(parseDateInput('   ')).toBeNull();
  });
  it('تاریخ غیرممکن نامعتبر است', () => {
    expect(parseDateInput('۱۴۰۵/۱۲/۳۰')).toBeUndefined(); // ۱۴۰۵ کبیسه نیست
    expect(parseDateInput('۱۴۰۵/۱۳/۰۱')).toBeUndefined();
    expect(parseDateInput('2026-02-30')).toBeUndefined();
    expect(parseDateInput('سلام')).toBeUndefined();
  });
  it('فقط لینک http و https امن است', () => {
    expect(isSafeUrl('https://example.com/a')).toBe(true);
    expect(isSafeUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeUrl('data:text/html,x')).toBe(false);
    expect(isSafeUrl('نه')).toBe(false);
  });
});
