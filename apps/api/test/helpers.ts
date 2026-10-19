import { randomBytes } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import { Pool } from 'pg';
import { createApp } from '../src/app.ts';
import { hashPassword } from '../src/auth/password.ts';
import { loadConfig } from '../src/config.ts';
import type { Config } from '../src/config.ts';
import { createPool } from '../src/db.ts';
import { migrate } from '../src/migrate.ts';

const BASE_URL = process.env['TEST_DATABASE_URL'] ?? 'postgres://postgres:postgres@127.0.0.1:5432/postgres';

export const PASSWORD = 'Correct-Horse-9';

export interface TestEnv {
  pool: Pool;
  baseUrl: string;
  config: Config;
  close(): Promise<void>;
}

/** پایگاه‌داده‌ی موقت با نام تصادفی؛ فایل‌های آزمون با هم تداخل نمی‌کنند. */
export async function startEnv(overrides: Record<string, string> = {}): Promise<TestEnv> {
  const name = `bistoon_t_${randomBytes(5).toString('hex')}`;
  const admin = new Pool({ connectionString: BASE_URL, max: 1 });
  await admin.query(`CREATE DATABASE ${name}`);
  const u = new URL(BASE_URL);
  u.pathname = `/${name}`;
  const config = loadConfig({ DATABASE_URL: u.toString(), LOG_REQUESTS: 'false', ...overrides });
  const pool = createPool(config.databaseUrl, 5);
  await migrate(pool);
  const app = createApp({ pool, config, log: () => {} });
  const server: Server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const port = (server.address() as AddressInfo).port;
  return {
    pool,
    config,
    baseUrl: `http://127.0.0.1:${port}`,
    async close() {
      await new Promise<void>((r) => server.close(() => r()));
      await pool.end();
      await admin.query(`DROP DATABASE IF EXISTS ${name} WITH (FORCE)`);
      await admin.end();
    },
  };
}

export async function insertUser(
  pool: Pool,
  username: string,
  opts: { admin?: boolean; password?: string; mustChange?: boolean; displayName?: string } = {},
): Promise<number> {
  const r = await pool.query<{ id: number }>(
    `INSERT INTO users (username, display_name, password_hash, is_system_admin, must_change_password)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [username, opts.displayName ?? `کاربر ${username}`, await hashPassword(opts.password ?? PASSWORD), opts.admin ?? false, opts.mustChange ?? false],
  );
  return Number(r.rows[0]!.id);
}

export interface Reply<T = any> {
  status: number;
  body: T;
  headers: Headers;
}

/** کلاینت آزمون با کوکی و نشانه‌ی CSRF */
export class Client {
  cookie = '';
  csrf = '';
  readonly env: TestEnv;
  constructor(env: TestEnv) {
    this.env = env;
  }

  async raw(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const h: Record<string, string> = { ...headers };
    if (this.cookie) h['cookie'] = this.cookie;
    if (body !== undefined) h['content-type'] = 'application/json';
    const res = await fetch(this.env.baseUrl + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
    const text = await res.text();
    let parsed: unknown = null;
    try {
      parsed = text ? JSON.parse(text) : null;
    } catch {
      parsed = text;
    }
    return { status: res.status, body: parsed, headers: res.headers };
  }

  async req(method: string, path: string, body?: unknown, headers: Record<string, string> = {}): Promise<Reply> {
    const h = { ...headers };
    if (this.csrf && !('x-csrf-token' in h)) h['x-csrf-token'] = this.csrf;
    return this.raw(method, path, body, h);
  }

  get = (path: string) => this.req('GET', path);
  post = (path: string, body?: unknown) => this.req('POST', path, body ?? {});
  put = (path: string, body?: unknown) => this.req('PUT', path, body ?? {});
  patch = (path: string, body?: unknown) => this.req('PATCH', path, body ?? {});
  del = (path: string, body?: unknown) => this.req('DELETE', path, body);

  async login(username: string, password = PASSWORD): Promise<Reply> {
    const r = await this.raw('POST', '/api/auth/login', { username, password });
    if (r.status === 200) {
      const sc = r.headers.getSetCookie().find((c) => c.startsWith('bistoon_sid='));
      this.cookie = sc ? sc.split(';')[0]! : '';
      this.csrf = r.body.csrfToken;
    }
    return r;
  }
}

export async function loggedIn(env: TestEnv, username: string, password = PASSWORD): Promise<Client> {
  const c = new Client(env);
  const r = await c.login(username, password);
  if (r.status !== 200) throw new Error(`login failed for ${username}: ${r.status} ${JSON.stringify(r.body)}`);
  return c;
}
