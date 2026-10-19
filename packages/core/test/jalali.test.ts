import { describe, expect, it } from 'vitest';
import { addDays, diffDays, isIsoDate, weekday } from '../src/date.ts';
import { formatJalali, fromJalali, normalizeDigits, parseJalali, toJalali, toPersianDigits } from '../src/jalali.ts';

describe('date', () => {
  it('اعتبارسنجی ISO', () => {
    expect(isIsoDate('2026-10-18')).toBe(true);
    expect(isIsoDate('2026-02-30')).toBe(false);
    expect(isIsoDate('2024-02-29')).toBe(true);
    expect(isIsoDate('2026-13-01')).toBe(false);
    expect(isIsoDate('26-10-18')).toBe(false);
    expect(isIsoDate(20261018)).toBe(false);
  });
  it('جمع و تفریق روز و روز هفته', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(diffDays('2026-09-10', '2026-09-01')).toBe(9);
    expect(weekday('2026-10-16')).toBe(5); // جمعه
    expect(weekday('2026-10-17')).toBe(6); // شنبه
    expect(weekday('1970-01-01')).toBe(4); // پنجشنبه
  });
});

describe('jalali', () => {
  it('نقاط شناخته‌شده', () => {
    expect(toJalali('2026-03-21')).toEqual({ jy: 1405, jm: 1, jd: 1 });
    expect(toJalali('2026-10-18')).toEqual({ jy: 1405, jm: 7, jd: 26 });
    expect(fromJalali(1405, 7, 24)).toBe('2026-10-16');
    expect(fromJalali(1403, 12, 30)).toBe('2025-03-20'); // ۱۴۰۳ کبیسه بود
    expect(toJalali('2025-03-21')).toEqual({ jy: 1404, jm: 1, jd: 1 });
  });
  it('رفت‌وبرگشت روی بازه‌ی ۱۲۰۰ تا ۱۵۹۹ شمسی', () => {
    const start = fromJalali(1200, 1, 1);
    const end = fromJalali(1599, 12, 29);
    let n = 0;
    for (let d = start; d <= end; d = addDays(d, 1)) {
      const { jy, jm, jd } = toJalali(d);
      expect(fromJalali(jy, jm, jd)).toBe(d);
      n += 1;
    }
    expect(n).toBeGreaterThan(145_000);
  });
  it('قالب و تجزیه با ارقام مختلف', () => {
    expect(formatJalali('2026-10-16')).toBe('۱۴۰۵/۰۷/۲۴');
    expect(formatJalali('2026-10-16', { persianDigits: false, sep: '-' })).toBe('1405-07-24');
    expect(parseJalali('۱۴۰۵/۰۷/۲۴')).toBe('2026-10-16');
    expect(parseJalali('١٤٠٥-٧-٢٤')).toBe('2026-10-16');
    expect(parseJalali('1405.07.24')).toBe('2026-10-16');
    expect(parseJalali('1405/12/30')).toBeNull(); // ۱۴۰۵ کبیسه نیست
    expect(parseJalali('1403/12/30')).toBe('2025-03-20');
    expect(parseJalali('1405/13/01')).toBeNull();
    expect(parseJalali('05/07/24')).toBeNull();
  });
  it('ارقام', () => {
    expect(normalizeDigits('۱۲۳٬۴۵۶٫۷')).toBe('123,456.7');
    expect(toPersianDigits('2026-10')).toBe('۲۰۲۶-۱۰');
  });
});
