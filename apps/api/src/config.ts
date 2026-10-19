import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .transform((v) => v === 'true' || v === '1');

const schema = z.object({
  DATABASE_URL: z.string().min(1, 'DATABASE_URL لازم است'),
  PORT: z.coerce.number().int().min(0).max(65535).default(3000),
  HOST: z.string().default('127.0.0.1'),
  /** عمر مطلق نشست به ساعت */
  SESSION_TTL_HOURS: z.coerce.number().min(1).max(24 * 30).default(12),
  /** پشت HTTPS حتماً true شود تا کوکی فقط روی HTTPS ارسال شود */
  COOKIE_SECURE: bool.default('false'),
  /** مقدار trust proxy اکسپرس؛ پشت nginx روی همان سرور: loopback */
  TRUST_PROXY: z.string().default(''),
  BODY_LIMIT: z.string().default('16mb'),
  /** پوشه‌ی خروجی ساخته‌شده‌ی رابط کاربری برای سرو از همین سرور */
  WEB_DIST: z.string().optional(),
  /** مبداهای اضافی مجاز برای درخواست‌های تغییردهنده (جداشده با ویرگول) */
  ALLOWED_ORIGINS: z.string().default(''),
  MIGRATIONS_DIR: z.string().optional(),
  LOG_REQUESTS: bool.default('true'),
});

export interface Config {
  databaseUrl: string;
  port: number;
  host: string;
  sessionTtlHours: number;
  cookieSecure: boolean;
  trustProxy: string;
  bodyLimit: string;
  webDist: string | null;
  allowedOrigins: string[];
  migrationsDir: string | null;
  logRequests: boolean;
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const parsed = schema.safeParse(env);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`پیکربندی نامعتبر است:\n${msg}`);
  }
  const e = parsed.data;
  return {
    databaseUrl: e.DATABASE_URL,
    port: e.PORT,
    host: e.HOST,
    sessionTtlHours: e.SESSION_TTL_HOURS,
    cookieSecure: e.COOKIE_SECURE,
    trustProxy: e.TRUST_PROXY,
    bodyLimit: e.BODY_LIMIT,
    webDist: e.WEB_DIST ?? null,
    allowedOrigins: e.ALLOWED_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean),
    migrationsDir: e.MIGRATIONS_DIR ?? null,
    logRequests: e.LOG_REQUESTS,
  };
}
