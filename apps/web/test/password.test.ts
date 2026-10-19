import { describe, expect, it } from 'vitest';
import { generatePassword, passwordProblem } from '../src/lib/password.ts';

describe('گذرواژه', () => {
  it('سیاست مانند سرور', () => {
    expect(passwordProblem('short', 'ali')).toBe('گذرواژه باید دست‌کم ۱۰ نویسه باشد.');
    expect(passwordProblem('Ali-Ali-Ali', 'ali-ali-ali')).toBe('گذرواژه نباید برابر نام کاربری باشد.');
    expect(passwordProblem('aaaaaaaaaaaa', 'x')).toBe('گذرواژه باید تنوع نویسه‌ی بیشتری داشته باشد.');
    expect(passwordProblem('x'.repeat(201), 'x')).toBe('گذرواژه بیش از حد طولانی است.');
    expect(passwordProblem('Good-pass-123', 'ali')).toBe(null);
  });
  it('تولید گذرواژه همیشه سیاست را رعایت می‌کند و از همه‌ی دسته‌ها دارد', () => {
    for (let i = 0; i < 200; i++) {
      const p = generatePassword();
      expect(p.length).toBe(14);
      expect(passwordProblem(p, 'user')).toBe(null);
      expect(/[A-Z]/.test(p)).toBe(true);
      expect(/[a-z]/.test(p)).toBe(true);
      expect(/[0-9]/.test(p)).toBe(true);
      expect(/[-_!@#%]/.test(p)).toBe(true);
      expect(/[0OlI1]/.test(p)).toBe(false);
    }
  });
  it('دو تولید پشت‌سرهم یکسان نیستند و طول کمینه رعایت می‌شود', () => {
    expect(generatePassword() === generatePassword()).toBe(false);
    expect(generatePassword(3).length).toBe(12);
  });
});
