/**
 * زیرساخت آزمون انتها‌به‌انتها: یک پایگاه‌داده‌ی موقت می‌سازد، سرور واقعی API را با رابط ساخته‌شده بالا می‌آورد
 * و یک مرورگر واقعی (Chromium) را به آن وصل می‌کند. همه‌ی کارها از طریق HTTP و رابط واقعی انجام می‌شود.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { createServer } from 'node:net';
import type { AddressInfo } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import { setTimeout as sleep } from 'node:timers/promises';
import pg from 'pg';

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '..', '..', '..');

export const ADMIN_PASSWORD = 'Admin-pass-12345';
export const USER_PASSWORD = 'User-pass-67890x';

export class ApiSession {
  cookie = '';
  csrf = '';
  readonly base: string;
  constructor(base: string) {
    this.base = base;
  }
  async call<T = any>(method: string, path: string, body?: unknown, expect = 200): Promise<T> {
    const res = await fetch(`${this.base}/api${path}`, {
      method,
      headers: { 'content-type': 'application/json', origin: this.base, cookie: this.cookie, ...(this.csrf ? { 'x-csrf-token': this.csrf } : {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    const data = text ? JSON.parse(text) : null;
    if (res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (انتظار ${expect}) ${text.slice(0, 300)}`);
    const set = res.headers.getSetCookie();
    if (set.length) this.cookie = set.map((c) => c.split(';')[0]).join('; ');
    return data as T;
  }
  async login(username: string, password: string): Promise<void> {
    const r = await this.call<{ csrfToken: string }>('POST', '/auth/login', { username, password });
    this.csrf = r.csrfToken;
  }
}

export interface Stack {
  baseUrl: string;
  admin: ApiSession;
  /** کاربر می‌سازد (گذرواژه‌ی ثابت USER_PASSWORD، بدون اجبار تغییر) و شناسه را برمی‌گرداند */
  createUser(username: string, displayName: string): Promise<number>;
  stop(): Promise<void>;
}

function run(cmd: string, args: string[], env: NodeJS.ProcessEnv, cwd: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { env, cwd, stdio: ['ignore', 'inherit', 'inherit'] });
    p.on('exit', (c) => (c === 0 ? resolve() : reject(new Error(`${cmd} ${args.join(' ')} → ${c}`))));
  });
}

/** پورت آزاد را از سیستم‌عامل می‌گیرد (پورت تصادفی ثابت ممکن است با فرایند دیگری تداخل کند) */
function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const s = createServer();
    s.once('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const port = (s.address() as AddressInfo).port;
      s.close(() => resolve(port));
    });
  });
}

export async function startStack(): Promise<Stack> {
  const adminUrl = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres@127.0.0.1:55432/postgres';
  const dbName = `bistoon_e2e_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const dropDb = async (): Promise<void> => {
    await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`).catch(() => undefined);
    await admin.end().catch(() => undefined);
  };
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const port = await freePort();
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(), PORT: String(port), HOST: '127.0.0.1', WEB_DIST: join(here, '..', 'dist'), LOG_REQUESTS: 'false', ADMIN_PASSWORD };
  const apiDir = join(repoRoot, 'apps', 'api');
  let server: ChildProcess | null = null;
  // هر شکستی در راه‌اندازی باید سرور و پایگاه‌داده را جمع کند؛ وگرنه فرایند آزمون برای همیشه باز می‌ماند (قفل‌شدن CI)
  const cleanup = async (): Promise<void> => {
    if (server && server.exitCode === null && server.signalCode === null) server.kill('SIGKILL');
    await dropDb();
  };
  try {
    await run('node', ['src/cli.ts', 'create-admin', '--username', 'admin', '--name', 'مدیر سیستم', '--password', ADMIN_PASSWORD], env, apiDir);
    const child: ChildProcess = spawn('node', ['src/server.ts'], { env, cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'] });
    server = child;
    const baseUrl = `http://127.0.0.1:${port}`;
    let up = false;
    for (let i = 0; i < 120 && !up && child.exitCode === null && child.signalCode === null; i++) {
      await sleep(250);
      try {
        up = (await fetch(`${baseUrl}/api/health`, { signal: AbortSignal.timeout(2000) })).ok;
      } catch {
        /* هنوز بالا نیامده */
      }
    }
    if (!up) throw new Error(child.exitCode !== null || child.signalCode !== null ? `سرور API بالا نیامد (خارج شد؛ کد ${child.exitCode ?? child.signalCode}، پورت ${port})` : `سرور API روی پورت ${port} پاسخ نداد`);
    const adminApi = new ApiSession(baseUrl);
    await adminApi.login('admin', ADMIN_PASSWORD);
    // ادمین باید اول گذرواژه را عوض کند؛ در آزمون‌ها همان مسیر رابط را جدا امتحان می‌کنیم، پس این‌جا مستقیم عوض می‌کنیم.
    await adminApi.call('POST', '/auth/change-password', { currentPassword: ADMIN_PASSWORD, newPassword: `${ADMIN_PASSWORD}-x` });
    return {
      baseUrl,
      admin: adminApi,
      async createUser(username, displayName) {
        const r = await adminApi.call<{ user: { id: number } }>('POST', '/users', { username, displayName, password: USER_PASSWORD, mustChangePassword: false }, 201);
        return r.user.id;
      },
      async stop() {
        if (child.exitCode === null && child.signalCode === null) {
          const exited = new Promise<void>((resolve) => child.once('exit', () => resolve()));
          child.kill('SIGTERM');
          // خاموشی مؤدبانه تا ۵ ثانیه؛ بعد اجباری
          await Promise.race([exited, sleep(5000, undefined, { ref: false }).then(() => child.kill('SIGKILL'))]);
        }
        await dropDb();
      },
    };
  } catch (e) {
    await cleanup();
    throw e;
  }
}
