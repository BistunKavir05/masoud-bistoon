import { randomBytes } from 'node:crypto';
import { loadConfig } from './config.ts';
import { hashPassword, passwordPolicyError } from './auth/password.ts';
import { createPool } from './db.ts';
import { defaultMigrationsDir, migrate } from './migrate.ts';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const cmd = process.argv[2];
const config = loadConfig();
const pool = createPool(config.databaseUrl, 2);

try {
  if (cmd === 'migrate') {
    const ran = await migrate(pool, config.migrationsDir ?? defaultMigrationsDir(), (m) => console.log(m));
    console.log(ran.length ? `${ran.length} migration اجرا شد.` : 'پایگاه‌داده به‌روز است.');
  } else if (cmd === 'create-admin') {
    const username = arg('username') ?? 'admin';
    const displayName = arg('name') ?? 'مدیر سیستم';
    const given = arg('password') ?? process.env['ADMIN_PASSWORD'];
    const password = given ?? randomBytes(12).toString('base64url');
    const policy = passwordPolicyError(password, username);
    if (policy) throw new Error(policy);
    await migrate(pool, config.migrationsDir ?? defaultMigrationsDir());
    const hash = await hashPassword(password);
    const r = await pool.query(
      `INSERT INTO users (username, display_name, password_hash, is_system_admin, must_change_password)
       VALUES ($1, $2, $3, true, true)
       ON CONFLICT (lower(username)) DO NOTHING RETURNING id`,
      [username, displayName, hash],
    );
    if (r.rowCount === 0) throw new Error(`کاربری با نام «${username}» از قبل وجود دارد.`);
    console.log(`ادمین سیستم ساخته شد: ${username}`);
    if (!given) console.log(`گذرواژه‌ی موقت (فقط همین یک بار نمایش داده می‌شود و در اولین ورود باید عوض شود): ${password}`);
  } else {
    console.log('استفاده: node src/cli.ts <migrate | create-admin [--username u] [--name n] [--password p]>');
    process.exitCode = 2;
  }
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exitCode = 1;
} finally {
  await pool.end();
}
