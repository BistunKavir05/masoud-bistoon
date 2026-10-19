/**
 * زیرساخت آزمون انتها‌به‌انتها: یک پایگاه‌داده‌ی موقت می‌سازد، سرور واقعی API را با رابط ساخته‌شده بالا می‌آورد
 * و یک مرورگر واقعی (Chromium) را به آن وصل می‌کند. همه‌ی کارها از طریق HTTP و رابط واقعی انجام می‌شود.
 */
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

export async function startStack(): Promise<Stack> {
  const adminUrl = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres@127.0.0.1:55432/postgres';
  const dbName = `bistoon_e2e_${randomBytes(5).toString('hex')}`;
  const admin = new pg.Client({ connectionString: adminUrl });
  await admin.connect();
  await admin.query(`CREATE DATABASE ${dbName}`);
  const url = new URL(adminUrl);
  url.pathname = `/${dbName}`;
  const port = 3700 + Math.floor(Math.random() * 600);
  const env: NodeJS.ProcessEnv = { ...process.env, DATABASE_URL: url.toString(), PORT: String(port), HOST: '127.0.0.1', WEB_DIST: join(here, '..', 'dist'), LOG_REQUESTS: 'false', ADMIN_PASSWORD };
  const apiDir = join(repoRoot, 'apps', 'api');
  await run('node', ['src/cli.ts', 'create-admin', '--username', 'admin', '--name', 'مدیر سیستم', '--password', ADMIN_PASSWORD], env, apiDir);
  const server: ChildProcess = spawn('node', ['src/server.ts'], { env, cwd: apiDir, stdio: ['ignore', 'inherit', 'inherit'] });
  const baseUrl = `http://127.0.0.1:${port}`;
  let up = false;
  for (let i = 0; i < 80 && !up; i++) {
    await sleep(250);
    try {
      up = (await fetch(`${baseUrl}/api/health`)).ok;
    } catch {
      /* هنوز بالا نیامده */
    }
  }
  if (!up) throw new Error('سرور API بالا نیامد');
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
      server.kill('SIGTERM');
      await sleep(300);
      await admin.query(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
      await admin.end();
    },
  };
}
