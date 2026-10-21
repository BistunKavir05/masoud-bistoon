import { describe, expect, it } from 'vitest';
import { actionLabel, auditSearchKey, faEntityId, fieldLabel, flatEntries, formatAuditValue, summarizeAuditValue } from '../src/lib/auditLabels.ts';

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
    expect(formatAuditValue(12.5)).toBe('۱۲٫۵');
    expect(formatAuditValue({ a: 1 })).toBe('{"a":1}');
    expect(formatAuditValue('x'.repeat(200), 10)).toBe('xxxxxxxxx…');
  });
  it('عددها: رقم فارسی و جداکننده‌ی هزارگان؛ شناسه‌ها بدون جداکننده؛ نویز ممیز شناور حذف می‌شود', () => {
    expect(formatAuditValue(1500000, 100, 'advanceAmount')).toBe('۱٬۵۰۰٬۰۰۰');
    expect(formatAuditValue(1500000)).toBe('۱٬۵۰۰٬۰۰۰');
    expect(formatAuditValue(0, 100, 'percentComplete')).toBe('۰');
    expect(formatAuditValue(-2500.5, 100, 'amount')).toBe('\u200E−۲٬۵۰۰٫۵');
    expect(formatAuditValue(0.1 + 0.2, 100, 'weight')).toBe('۰٫۳');
    expect(formatAuditValue(1234, 100, 'predecessorId')).toBe('۱۲۳۴');
    expect(formatAuditValue(1234, 100, 'id')).toBe('۱۲۳۴');
    expect(formatAuditValue(3, 100, 'version')).toBe('۳');
    // متن‌ها دست‌نخورده‌اند؛ تاریخ ISO شمسی می‌شود
    expect(formatAuditValue('INV-12')).toBe('INV-12');
    expect(formatAuditValue('2026-09-12')).toBe('۱۴۰۵/۰۶/۲۱');
    expect(summarizeAuditValue(2500000, 60, 'budget')).toBe('۲٬۵۰۰٬۰۰۰');
    expect(summarizeAuditValue(1234, 60, 'taskId')).toBe('۱۲۳۴');
    expect(faEntityId('1234')).toBe('۱۲۳۴');
    expect(faEntityId('a1b2')).toBe('a1b2');
  });
  it('کلید جست‌وجو: ارقام و جداکننده‌ها یکدست می‌شوند', () => {
    const shown = formatAuditValue(1500000, 100, 'advanceAmount');
    for (const typed of ['1500000', '۱۵۰۰۰۰۰', '1,500,000', '۱٬۵۰۰٬۰۰۰', '١٥٠٠٠٠٠']) expect(auditSearchKey(shown).includes(auditSearchKey(typed))).toBe(true);
    expect(auditSearchKey('۱۲٫۵').includes(auditSearchKey('12.5'))).toBe(true);
    // جداکننده فقط میان ارقام حذف می‌شود
    expect(auditSearchKey('الف، ب')).toBe('الف، ب');
    expect(auditSearchKey('  ABC ')).toBe('abc');
    expect(auditSearchKey('۱۴۰۵/۰۶/۲۱')).toBe('1405/06/21');
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
