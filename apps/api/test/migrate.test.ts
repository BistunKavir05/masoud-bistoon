import { cp, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Pool } from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { migrate, defaultMigrationsDir } from '../src/migrate.ts';

const BASE = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';
const name = `bistoon_m_${Math.random().toString(16).slice(2, 10)}`;
let admin: Pool;
let pool: Pool;
// DROP DATABASE ... WITH (FORCE) پیوندهای باقی‌مانده را می‌بندد؛ خطای ۵۷P01 روی یک کلاینتِ بیکار نباید «استثنای مدیریت‌نشده» شود
const ignoreTermination = (): void => undefined;

beforeAll(async () => {
  admin = new Pool({ connectionString: BASE, max: 1 });
  admin.on('error', ignoreTermination);
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(BASE);
  u.pathname = `/${name}`;
  pool = new Pool({ connectionString: u.toString(), max: 3 });
  pool.on('error', ignoreTermination);
});
afterAll(async () => {
  await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
  await admin.end();
});

describe('اجرای migration', () => {
  it('بار اول همه را اجرا می‌کند و بار دوم چیزی اجرا نمی‌کند', async () => {
    const first = await migrate(pool);
    expect(first.length).toBeGreaterThan(0);
    expect(await migrate(pool)).toEqual([]);
    const r = await pool.query('SELECT count(*)::int AS n FROM schema_migrations');
    expect(r.rows[0].n).toBe(first.length);
  });

  it('اجرای هم‌زمان دو نمونه امن است', async () => {
    const u = new URL(BASE);
    u.pathname = `/${name}`;
    const other = new Pool({ connectionString: u.toString(), max: 2 });
    other.on('error', ignoreTermination);
    const results = await Promise.all([migrate(pool), migrate(other)]);
    expect(results.flat()).toEqual([]);
    await other.end();
  });

  it('تغییر فایلِ قبلاً اجراشده خطا می‌دهد', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await cp(defaultMigrationsDir(), dir, { recursive: true });
    const files = (await (await import('node:fs/promises')).readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
    const first = join(dir, files[0]!);
    await writeFile(first, `${await readFile(first, 'utf8')}\n-- تغییر\n`);
    await expect(migrate(pool, dir)).rejects.toThrow(/تغییر کرده/);
  });

  it('migration ناموفق برگردانده می‌شود و ثبت نمی‌شود', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mig-'));
    await cp(defaultMigrationsDir(), dir, { recursive: true });
    await writeFile(join(dir, '9999_bad.sql'), 'CREATE TABLE t_ok (a int); SELECT 1/0;');
    await expect(migrate(pool, dir)).rejects.toThrow(/9999_bad/);
    const t = await pool.query("SELECT to_regclass('public.t_ok') AS t");
    expect(t.rows[0].t).toBeNull();
    const n = await pool.query("SELECT count(*)::int AS n FROM schema_migrations WHERE name = '9999_bad.sql'");
    expect(n.rows[0].n).toBe(0);
  });
});
