import { randomBytes, scrypt as scryptCb, timingSafeEqual } from 'node:crypto';

const N = 16384;
const R = 8;
const P = 1;
const KEYLEN = 32;

function derive(password: string, salt: Buffer, n: number, r: number, p: number, keylen: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scryptCb(password.normalize('NFKC'), salt, keylen, { N: n, r, p, maxmem: 128 * n * r * 2 }, (err, key) => {
      if (err) reject(err);
      else resolve(key);
    });
  });
}

/** قالب ذخیره: scrypt$N$r$p$salt(b64)$hash(b64) */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, N, R, P, KEYLEN);
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  if (![n, r, p].every((x) => Number.isInteger(x) && x > 0) || n > 1 << 20) return false;
  const salt = Buffer.from(parts[4] ?? '', 'base64');
  const expected = Buffer.from(parts[5] ?? '', 'base64');
  if (expected.length === 0) return false;
  const actual = await derive(password, salt, n, r, p, expected.length);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

let dummy: Promise<string> | null = null;
/** برای یکسان‌سازی زمان پاسخ وقتی کاربر وجود ندارد */
export async function burnPasswordCheck(password: string): Promise<void> {
  dummy ??= hashPassword('dummy-password-for-timing');
  await verifyPassword(password, await dummy);
}

export const MIN_PASSWORD_LENGTH = 10;

/** سیاست گذرواژه: حداقل ۱۰ نویسه، نه برابر نام کاربری، نه فقط یک نویسه‌ی تکراری. null یعنی معتبر. */
export function passwordPolicyError(password: string, username: string): string | null {
  if (password.length < MIN_PASSWORD_LENGTH) return `گذرواژه باید دست‌کم ${MIN_PASSWORD_LENGTH} نویسه باشد.`;
  if (password.length > 200) return 'گذرواژه بیش از حد طولانی است.';
  if (password.toLowerCase() === username.toLowerCase()) return 'گذرواژه نباید برابر نام کاربری باشد.';
  if (new Set(password).size < 4) return 'گذرواژه باید تنوع نویسه‌ی بیشتری داشته باشد.';
  return null;
}
