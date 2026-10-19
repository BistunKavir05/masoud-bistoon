import { describe, expect, it } from 'vitest';
import { CAPABILITIES, PERMISSION_MATRIX, ROLES, can, capabilitiesOf, isMutation, isReadOnly } from '../src/index.ts';

describe('ماتریس دسترسی', () => {
  it('هر قابلیت دست‌کم یک نقش دارد و نقش ناشناخته در جدول نیست', () => {
    for (const c of CAPABILITIES) {
      expect(PERMISSION_MATRIX[c].length).toBeGreaterThan(0);
      for (const r of PERMISSION_MATRIX[c]) expect(ROLES).toContain(r);
    }
  });

  it('بازرگانی فقط مشاهده می‌کند: وضعیت، مبلغ قرارداد/فاکتور/وصول و پورسانت', () => {
    expect(isReadOnly(['commerce'])).toBe(true);
    expect(capabilitiesOf(['commerce']).sort()).toEqual(
      ['chat.use', 'commission.view', 'contract.view', 'summary.view'].sort(),
    );
    expect(can(['commerce'], 'schedule.view')).toBe(false);
    expect(can(['commerce'], 'costs.view')).toBe(false);
    expect(can(['commerce'], 'commission.edit')).toBe(false);
  });

  it('کارشناس مبلغ قرارداد و پورسانت را نمی‌بیند و فقط پیشرفت فعالیت خودش را ثبت می‌کند', () => {
    expect(can(['expert'], 'contract.view')).toBe(false);
    expect(can(['expert'], 'commission.view')).toBe(false);
    expect(can(['expert'], 'costs.view')).toBe(false);
    expect(can(['expert'], 'progress.update')).toBe(false);
    expect(can(['expert'], 'progress.update.own')).toBe(true);
    expect(can(['expert'], 'schedule.edit')).toBe(false);
  });

  it('مدیر پروژه پورسانت را نمی‌بیند ولی برنامه را ویرایش می‌کند', () => {
    expect(can(['pm'], 'commission.view')).toBe(false);
    expect(can(['pm'], 'schedule.edit')).toBe(true);
    expect(can(['pm'], 'members.manage')).toBe(false);
  });

  it('نقش‌های چندگانه اجتماع می‌شوند', () => {
    expect(can(['expert', 'finance'], 'costs.edit')).toBe(true);
    expect(can(['expert', 'finance'], 'progress.update.own')).toBe(true);
    expect(can(['expert', 'finance'], 'schedule.edit')).toBe(false);
  });

  it('ادمین سیستم همه‌ی قابلیت‌ها را دارد و بدون نقش هیچ‌چیز ندارد', () => {
    expect(capabilitiesOf([], { systemAdmin: true })).toHaveLength(CAPABILITIES.length);
    expect(capabilitiesOf([])).toEqual([]);
  });

  it('مدیریت فقط می‌بیند و تأیید می‌کند، برنامه را ویرایش نمی‌کند', () => {
    expect(can(['management'], 'schedule.view')).toBe(true);
    expect(can(['management'], 'schedule.edit')).toBe(false);
    expect(can(['management'], 'commission.approve')).toBe(true);
    expect(isMutation('commission.approve')).toBe(true);
  });
});
