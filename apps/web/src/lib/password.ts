/** گذرواژه: بررسی هم‌سیاستِ سرور (فقط برای بازخورد سریع؛ مرجع نهایی سرور است) و تولید گذرواژه‌ی تصادفی. */

import { faInt } from './fmt.ts';

export const MIN_PASSWORD_LENGTH = 10;

export function passwordProblem(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `گذرواژه باید دست‌کم ${faInt(MIN_PASSWORD_LENGTH)} نویسه باشد.`;
  if (password.length > 200) return 'گذرواژه بیش از حد طولانی است.';
  if (username !== '' && password.toLowerCase() === username.toLowerCase()) return 'گذرواژه نباید برابر نام کاربری باشد.';
  if (new Set(password).size < 4) return 'گذرواژه باید تنوع نویسه‌ی بیشتری داشته باشد.';
  return null;
}

const UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const LOWER = 'abcdefghijkmnpqrstuvwxyz';
const DIGIT = '23456789';
const SYMBOL = '-_!@#%';

/** عدد صحیح تصادفی در [0, n) بدون اریب (نمونه‌گیری با ردّ مقادیر بالا) */
export function secureInt(n: number): number {
  const limit = Math.floor(0x1_0000_0000 / n) * n;
  const buf = new Uint32Array(1);
  for (;;) {
    crypto.getRandomValues(buf);
    if (buf[0]! < limit) return buf[0]! % n;
  }
}

/** گذرواژه‌ی تصادفی بدون نویسه‌های شبیه‌به‌هم (0/O، 1/l/I)؛ دست‌کم یکی از هر دسته. */
export function generatePassword(length = 14, rand: (n: number) => number = secureInt): string {
  const len = Math.max(MIN_PASSWORD_LENGTH + 2, length);
  const all = UPPER + LOWER + DIGIT + SYMBOL;
  const pick = (set: string): string => set[rand(set.length)]!;
  const chars = [pick(UPPER), pick(LOWER), pick(DIGIT), pick(SYMBOL)];
  while (chars.length < len) chars.push(pick(all));
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rand(i + 1);
    [chars[i], chars[j]] = [chars[j]!, chars[i]!];
  }
  return chars.join('');
}
