import { describe, expect, it } from 'vitest';
import { CALENDAR_TEMPLATES, defaultCalendar, validateCalendar, weeklyHours } from '../src/calendar.ts';
import { previewCalendarChange } from '../src/calendarImpact.ts';
import { dep, task } from './fixtures.ts';

const tasks = [task({ id: 1, name: 'الف', duration: 5 }), task({ id: 2, name: 'ب', duration: 5, dependencies: [dep(1)] })];
const model = { start: '2026-09-12', status: '2026-09-12', tasks, calendar: defaultCalendar() } as const;

describe('الگوهای تقویم', () => {
  it('همه‌ی الگوها معتبرند و ساعت هفتگی محاسبه می‌شود', () => {
    for (const t of CALENDAR_TEMPLATES) expect(validateCalendar({ days: t.days, holidays: [] })).toEqual([]);
    const def = CALENDAR_TEMPLATES.find((t) => t.key === 'default')!;
    expect(def.days).toEqual(defaultCalendar().days);
    expect(weeklyHours({ days: def.days, holidays: [] })).toBeCloseTo(6 * 7.5 - 1, 9); // پنجشنبه ۶٫۵ ساعت
    expect(weeklyHours({ days: CALENDAR_TEMPLATES.find((t) => t.key === 'sat-wed')!.days, holidays: [] })).toBe(40);
    expect(weeklyHours({ days: CALENDAR_TEMPLATES.find((t) => t.key === 'seven')!.days, holidays: [] })).toBe(56);
  });
});

describe('اثر تغییر تقویم', () => {
  it('بدون تغییر: هیچ‌چیز جابه‌جا نمی‌شود', () => {
    const r = previewCalendarChange(model, defaultCalendar());
    expect(r.computable).toBe(true);
    expect(r.moved).toBe(0);
    expect(r.finishShiftDays).toBe(0);
  });

  it('تعطیلی میانِ زنجیره پایان را جلو می‌برد و فعالیت‌های بعدی را جابه‌جا می‌کند', () => {
    const base = previewCalendarChange(model, defaultCalendar());
    const day = '2026-09-14'; // دومین روز کاری
    const r = previewCalendarChange(model, { days: defaultCalendar().days, holidays: [{ date: day, title: 'تست' }] });
    expect(r.finishBefore).toBe(base.finishBefore);
    expect(r.finishShiftDays).toBeGreaterThanOrEqual(1);
    expect(r.moved).toBeGreaterThanOrEqual(1);
  });

  it('تعطیلی بعد از پایان پروژه اثری ندارد', () => {
    const r = previewCalendarChange(model, { days: defaultCalendar().days, holidays: [{ date: '2030-01-01', title: 'دور' }] });
    expect(r.moved).toBe(0);
    expect(r.finishShiftDays).toBe(0);
  });

  it('هفته‌ی کاری کوتاه‌تر پایان را عقب می‌اندازد و ساعت هفتگی را گزارش می‌کند', () => {
    const r = previewCalendarChange(model, { days: CALENDAR_TEMPLATES.find((t) => t.key === 'sat-wed')!.days, holidays: [] });
    expect(r.finishShiftDays).toBeGreaterThan(0);
    expect(r.weeklyHoursAfter).toBe(40);
    expect(r.weeklyHoursBefore).toBeCloseTo(44, 9);
  });

  it('دور در وابستگی‌ها: محاسبه‌پذیر نیست و خطا نمی‌دهد', () => {
    const cyc = [task({ id: 1, duration: 1, dependencies: [dep(2)] }), task({ id: 2, duration: 1, dependencies: [dep(1)] })];
    const r = previewCalendarChange({ ...model, tasks: cyc }, defaultCalendar());
    expect(r.computable).toBe(false);
  });
});
