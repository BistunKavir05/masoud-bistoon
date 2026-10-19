import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import type { Pool } from 'pg';

const LOCK_KEY = 7391204;

export const defaultMigrationsDir = (): string => fileURLToPath(new URL('../../../db/migrations', import.meta.url));

const checksum = (sql: string): string => createHash('sha256').update(sql.replace(/\r\n/g, '\n')).digest('hex');

/**
 * migrationهای پوشه را به ترتیب نام اجرا می‌کند. هر فایل در یک تراکنش اجرا و با checksum ثبت می‌شود؛
 * تغییر فایلی که قبلاً اجرا شده خطا می‌دهد (برای تغییر طرح، فایل جدید بنویسید).
 * قفل مشورتی از اجرای هم‌زمان دو نمونه جلوگیری می‌کند. فهرست فایل‌های تازه‌اجراشده را برمی‌گرداند.
 */
export async function migrate(pool: Pool, dir: string = defaultMigrationsDir(), log: (msg: string) => void = () => {}): Promise<string[]> {
  const files = (await readdir(dir)).filter((f) => /^\d{4}_[\w-]+\.sql$/.test(f)).sort();
  const client = await pool.connect();
  const ran: string[] = [];
  try {
    await client.query('SELECT pg_advisory_lock($1)', [LOCK_KEY]);
    await client.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, checksum text NOT NULL, applied_at timestamptz NOT NULL DEFAULT now())`,
    );
    const done = new Map<string, string>();
    for (const r of (await client.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations')).rows) done.set(r.name, r.checksum);
    for (const f of files) {
      const sql = await readFile(`${dir}/${f}`, 'utf8');
      const sum = checksum(sql);
      const prev = done.get(f);
      if (prev !== undefined) {
        if (prev !== sum) throw new Error(`فایل migration «${f}» پس از اجرا تغییر کرده است؛ برای تغییر طرح فایل جدید بنویسید.`);
        continue;
      }
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [f, sum]);
        await client.query('COMMIT');
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw new Error(`اجرای ${f} ناموفق بود: ${e instanceof Error ? e.message : String(e)}`);
      }
      log(`applied ${f}`);
      ran.push(f);
    }
  } finally {
    await client.query('SELECT pg_advisory_unlock($1)', [LOCK_KEY]).catch(() => {});
    client.release();
  }
  return ran;
}
