import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { Client, PASSWORD, insertUser, loggedIn, startEnv } from './helpers.ts';
import type { TestEnv } from './helpers.ts';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
  await insertUser(env.pool, 'admin', { admin: true });
  await insertUser(env.pool, 'sara');
});
afterAll(async () => env.close());

describe('ورود و نشست', () => {
  it('سلامت سرویس بدون ورود در دسترس است', async () => {
    const r = await new Client(env).get('/api/health');
    expect(r.status).toBe(200);
    expect(r.body.ok).toBe(true);
  });

  it('بدون نشست، مسیرهای محافظت‌شده 401 می‌دهند', async () => {
    const c = new Client(env);
    expect((await c.get('/api/auth/me')).status).toBe(401);
    expect((await c.get('/api/projects')).status).toBe(401);
  });

  it('گذرواژه‌ی غلط و کاربر ناموجود پیام یکسان می‌دهند', async () => {
    const a = await new Client(env).login('admin', 'wrong-password-123');
    const b = await new Client(env).login('nobody', 'wrong-password-123');
    expect(a.status).toBe(401);
    expect(b.status).toBe(401);
    expect(a.body.error.code).toBe('BAD_CREDENTIALS');
    expect(a.body.error.message).toBe(b.body.error.message);
  });

  it('ورود موفق کوکی HttpOnly و SameSite=Strict می‌گذارد و نشانه‌ی CSRF می‌دهد', async () => {
    const c = new Client(env);
    const r = await c.login('Admin');
    expect(r.status).toBe(200);
    const sc = r.headers.getSetCookie().find((x) => x.startsWith('bistoon_sid='))!;
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/SameSite=Strict/i);
    expect(r.body.csrfToken).toBeTruthy();
    expect(r.body.user.isSystemAdmin).toBe(true);
    expect(JSON.stringify(r.body)).not.toContain('password');
    const me = await c.get('/api/auth/me');
    expect(me.status).toBe(200);
    expect(me.body.user.username).toBe('admin');
  });

  it('درخواست تغییردهنده بدون نشانه‌ی CSRF رد می‌شود', async () => {
    const c = await loggedIn(env, 'sara');
    const noToken = await c.raw('POST', '/api/auth/logout', {});
    expect(noToken.status).toBe(403);
    expect(noToken.body.error.code).toBe('CSRF');
    const wrong = await c.req('POST', '/api/auth/logout', {}, { 'x-csrf-token': 'x'.repeat(43) });
    expect(wrong.status).toBe(403);
    const ok = await c.post('/api/auth/logout');
    expect(ok.status).toBe(200);
    expect((await c.get('/api/auth/me')).status).toBe(401);
  });

  it('مبدأ بیگانه در درخواست تغییردهنده رد می‌شود', async () => {
    const c = await loggedIn(env, 'sara');
    const r = await c.req('POST', '/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Another-Pass-77' }, { origin: 'https://evil.example' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('BAD_ORIGIN');
  });

  it('بعد از ۵ تلاش ناموفق حساب موقتاً قفل می‌شود، حتی با گذرواژه‌ی درست', async () => {
    await insertUser(env.pool, 'lockme');
    for (let i = 0; i < 5; i++) expect((await new Client(env).login('lockme', 'bad-password-xyz')).status).toBe(401);
    const r = await new Client(env).login('lockme');
    expect(r.status).toBe(429);
    expect(r.body.error.code).toBe('ACCOUNT_LOCKED');
  });

  it('تلاش‌ها در گزارش تغییرات ثبت می‌شوند', async () => {
    const r = await env.pool.query("SELECT action FROM audit_log WHERE action IN ('login','login.failed') ORDER BY id");
    const actions = r.rows.map((x) => x.action);
    expect(actions).toContain('login');
    expect(actions).toContain('login.failed');
  });

  it('کاربر غیرفعال نمی‌تواند وارد شود و نشست‌هایش بی‌اعتبار می‌شود', async () => {
    const admin = await loggedIn(env, 'admin');
    const id = await insertUser(env.pool, 'leaver');
    const leaver = await loggedIn(env, 'leaver');
    expect((await leaver.get('/api/auth/me')).status).toBe(200);
    const off = await admin.patch(`/api/users/${id}`, { isActive: false });
    expect(off.status).toBe(200);
    expect((await leaver.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(env).login('leaver')).status).toBe(401);
  });
});

describe('تغییر گذرواژه', () => {
  it('گذرواژه‌ی فعلی غلط، ضعیف یا مشابه رد می‌شود و موفق آن نشست‌های دیگر را می‌بندد', async () => {
    await insertUser(env.pool, 'pwuser');
    const a = await loggedIn(env, 'pwuser');
    const b = await loggedIn(env, 'pwuser');
    expect((await a.post('/api/auth/change-password', { currentPassword: 'nope-nope-nope', newPassword: 'Brand-New-Pass-1' })).body.error.code).toBe('BAD_CURRENT_PASSWORD');
    expect((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'short' })).body.error.code).toBe('WEAK_PASSWORD');
    expect((await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: PASSWORD })).body.error.code).toBe('SAME_PASSWORD');
    const ok = await a.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Brand-New-Pass-1' });
    expect(ok.status).toBe(200);
    expect((await a.get('/api/auth/me')).status).toBe(200);
    expect((await b.get('/api/auth/me')).status).toBe(401);
    expect((await new Client(env).login('pwuser', PASSWORD)).status).toBe(401);
    expect((await new Client(env).login('pwuser', 'Brand-New-Pass-1')).status).toBe(200);
  });

  it('کاربری که باید گذرواژه را عوض کند تا آن موقع به چیز دیگری دسترسی ندارد', async () => {
    await insertUser(env.pool, 'fresh', { mustChange: true });
    const c = await loggedIn(env, 'fresh');
    const blocked = await c.get('/api/projects');
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe('PASSWORD_CHANGE_REQUIRED');
    expect((await c.get('/api/auth/me')).status).toBe(200);
    expect((await c.post('/api/auth/change-password', { currentPassword: PASSWORD, newPassword: 'Fresh-New-Pass-2' })).status).toBe(200);
    expect((await c.get('/api/projects')).status).toBe(200);
  });
});
