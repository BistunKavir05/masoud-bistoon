import { describe, expect, it } from 'vitest';
import { actionLabel, fieldLabel, flatEntries, formatAuditValue, summarizeAuditValue } from '../src/lib/auditLabels.ts';

describe('برچسب‌های گزارش تغییرات', () => {
  it('رخدادهای شناخته‌شده و فعل‌های عمومی', () => {
    expect(actionLabel('baseline.set')).toBe('ثبت خط مبنا');
    expect(actionLabel('login.failed')).toBe('ورود ناموفق');
    expect(actionLabel('task.update', 'task')).toBe('ویرایش فعالیت');
    expect(actionLabel('risk.create', 'risk')).toBe('ایجاد ریسک');
    expect(actionLabel('decision.delete')).toBe('حذف تصمیم');
    expect(actionLabel('task.recurring.create')).toBe('ساخت فعالیت تکرارشونده');
    expect(actionLabel('task.recurring.update')).toBe('ویرایش الگوی فعالیت تکرارشونده');
  });
  it('ناشناخته بدون تغییر نمایش داده می‌شود', () => {
    expect(actionLabel('something.else')).toBe('something.else');
    expect(actionLabel('x.update', 'nope')).toBe('x.update');
  });
  it('فیلد و مقدار', () => {
    expect(fieldLabel('percentComplete')).toBe('درصد پیشرفت');
    expect(fieldLabel('unknownField')).toBe('unknownField');
    // فیلدهای منشور و قرارداد برچسب فارسی دارند (نه نام انگلیسی خام)
    expect(fieldLabel('client')).toBe('کارفرما');
    expect(fieldLabel('collectedTotal')).toBe('جمع وصول‌شده');
    expect(fieldLabel('salesCommissionPercent')).toBe('درصد پورسانت فروش');
    expect(formatAuditValue(null)).toBe('—');
    expect(formatAuditValue('')).toBe('—');
    expect(formatAuditValue(true)).toBe('بله');
    expect(formatAuditValue(12.5)).toBe('12.5');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    expect(formatAuditValue('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
  it('خلاصه‌ی شیء و آرایه برای جدول', () => {
    expect(summarizeAuditValue({ id: 2, title: 'نقشه' })).toBe('نقشه');
    expect(summarizeAuditValue({ a: 1, b: 2 })).toBe('۲ فیلد');
    expect(summarizeAuditValue([1, 2, 3])).toBe('۳ مورد');
    expect(summarizeAuditValue('متن')).toBe('متن');
    expect(summarizeAuditValue(null)).toBe('—');
  });
  it('شیء تخت', () => {
    expect(flatEntries({ a: 1, b: 'x', c: null })?.length).toBe(3);
    expect(flatEntries({ a: [1] })).toBe(null);
    expect(flatEntries([1])).toBe(null);
    expect(flatEntries('x')).toBe(null);
  });
});
