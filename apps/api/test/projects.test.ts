import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { capabilitiesOf } from '@bistoon/core';
import { Client, insertUser, loggedIn, startEnv } from './helpers.ts';
import type { TestEnv } from './helpers.ts';

let env: TestEnv;
let admin: Client;
const ids: Record<string, number> = {};

beforeAll(async () => {
  env = await startEnv();
  await insertUser(env.pool, 'admin', { admin: true });
  for (const u of ['pm1', 'fin1', 'com1', 'exp1', 'outsider']) ids[u] = await insertUser(env.pool, u);
  admin = await loggedIn(env, 'admin');
});
afterAll(async () => env.close());

async function createProject(name = 'پروژه‌ی آزمون'): Promise<number> {
  const r = await admin.post('/api/projects', {
    name,
    start: '2026-03-21',
    members: [
      { userId: ids['pm1'], roles: ['pm'] },
      { userId: ids['fin1'], roles: ['finance'] },
      { userId: ids['com1'], roles: ['commerce'] },
      { userId: ids['exp1'], roles: ['expert'] },
    ],
  });
  expect(r.status).toBe(201);
  return r.body.project.id;
}

describe('کاربران', () => {
  it('فقط ادمین سیستم کاربر می‌سازد و گذرواژه‌ی ضعیف رد می‌شود', async () => {
    const pm = await loggedIn(env, 'pm1');
    expect((await pm.post('/api/users', { username: 'x1x', displayName: 'ایکس', password: 'Strong-Pass-123' })).status).toBe(403);
    expect((await admin.post('/api/users', { username: 'x1x', displayName: 'ایکس', password: 'weak' })).body.error.code).toBe('WEAK_PASSWORD');
    const ok = await admin.post('/api/users', { username: 'x1x', displayName: 'ایکس', password: 'Strong-Pass-123' });
    expect(ok.status).toBe(201);
    expect(ok.body.user.mustChangePassword).toBe(true);
    expect(JSON.stringify(ok.body)).not.toMatch(/hash/i);
    expect((await admin.post('/api/users', { username: 'X1X', displayName: 'تکراری', password: 'Strong-Pass-123' })).status).toBe(409);
  });

  it('ادمین نمی‌تواند خودش را قفل کند و آخرین ادمین فعال نمی‌ماند حذف شود', async () => {
    const me = (await admin.get('/api/auth/me')).body.user.id;
    const r = await admin.patch(`/api/users/${me}`, { isActive: false });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('SELF_LOCKOUT');
  });

  it('بازنشانی گذرواژه نشست‌ها را می‌بندد و تغییر اجباری می‌خواهد', async () => {
    const id = await insertUser(env.pool, 'resetme');
    const u = await loggedIn(env, 'resetme');
    expect((await admin.post(`/api/users/${id}/reset-password`, { password: 'Temp-Pass-12345' })).status).toBe(200);
    expect((await u.get('/api/auth/me')).status).toBe(401);
    const again = await new Client(env).login('resetme', 'Temp-Pass-12345');
    expect(again.status).toBe(200);
    expect(again.body.user.mustChangePassword).toBe(true);
  });

  it('فهرست راهنما فقط برای ادمین سیستم یا ادمین پروژه', async () => {
    expect((await (await loggedIn(env, 'outsider')).get('/api/directory')).status).toBe(403);
    const r = await admin.get('/api/directory');
    expect(r.status).toBe(200);
    expect(r.body.users.length).toBeGreaterThan(3);
  });
});

describe('پروژه و دسترسی', () => {
  it('عضو پروژه را با نقش و قابلیت‌هایش می‌بیند و غیرعضو 404 می‌گیرد', async () => {
    const pid = await createProject();
    const pm = await loggedIn(env, 'pm1');
    const mine = await pm.get('/api/projects');
    expect(mine.body.projects.map((p: { id: number }) => p.id)).toContain(pid);
    const one = await pm.get(`/api/projects/${pid}`);
    expect(one.status).toBe(200);
    expect(one.body.me.roles).toEqual(['pm']);
    expect(one.body.me.capabilities).toEqual(capabilitiesOf(['pm']));
    expect(one.body.project.finance.unit).toBe('ریال');
    const out = await loggedIn(env, 'outsider');
    expect((await out.get(`/api/projects/${pid}`)).status).toBe(404);
    expect((await out.get('/api/projects')).body.projects).toEqual([]);
  });

  it('بازرگانی فقط مشاهده می‌کند: قابلیت ویرایشی ندارد و تنظیمات را نمی‌تواند عوض کند', async () => {
    const pid = await createProject('بازرگانی');
    const com = await loggedIn(env, 'com1');
    const me = (await com.get(`/api/projects/${pid}`)).body;
    expect(me.me.capabilities.sort()).toEqual(['chat.use', 'commission.view', 'contract.view', 'summary.view']);
    const v = me.project.version;
    const r = await com.patch(`/api/projects/${pid}`, { name: 'نام جدید', version: v });
    expect(r.status).toBe(403);
    expect((await com.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: ['admin'] })).status).toBe(403);
  });

  it('ویرایش تنظیمات با شماره‌ی نسخه: نسخه‌ی کهنه 409 و موفق آن نسخه را بالا می‌برد', async () => {
    const pid = await createProject('نسخه');
    const pm = await loggedIn(env, 'pm1');
    const cur = (await pm.get(`/api/projects/${pid}`)).body.project;
    const a = await pm.patch(`/api/projects/${pid}`, { name: 'نام ۱', version: cur.version });
    expect(a.status).toBe(200);
    expect(a.body.project.version).toBe(cur.version + 1);
    const stale = await pm.patch(`/api/projects/${pid}`, { name: 'نام ۲', version: cur.version });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.current.name).toBe('نام ۱');
    expect((await pm.patch(`/api/projects/${pid}`, { start: '2026-02-30', version: cur.version + 1 })).status).toBe(400);
    expect((await pm.patch(`/api/projects/${pid}`, { hacker: true, version: cur.version + 1 })).status).toBe(400);
  });

  it('تغییر نقش‌ها فقط با دسترسی members.manage؛ چند نقش و حذف عضو', async () => {
    const pid = await createProject('اعضا');
    const pm = await loggedIn(env, 'pm1');
    expect((await pm.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: ['pm'] })).status).toBe(403);
    const set = await admin.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: ['expert', 'finance'] });
    expect(set.status).toBe(200);
    const exp = await loggedIn(env, 'exp1');
    expect((await exp.get(`/api/projects/${pid}`)).body.me.roles.sort()).toEqual(['expert', 'finance']);
    expect((await admin.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: [] })).status).toBe(200);
    expect((await exp.get(`/api/projects/${pid}`)).status).toBe(404);
    expect((await admin.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: ['superuser'] })).status).toBe(400);
    const list = await admin.get(`/api/projects/${pid}/members`);
    expect(list.body.members.map((m: { userId: number }) => m.userId)).not.toContain(ids['exp1']);
  });

  it('پروژه‌ی بایگانی‌شده فقط‌خواندنی است و بازگشت از بایگانی ممکن است', async () => {
    const pid = await createProject('بایگانی');
    const pm = await loggedIn(env, 'pm1');
    let v = (await pm.get(`/api/projects/${pid}`)).body.project.version;
    const arch = await pm.patch(`/api/projects/${pid}`, { archived: true, version: v });
    expect(arch.status).toBe(200);
    v = arch.body.project.version;
    expect(arch.body.project.archived).toBe(true);
    const blocked = await pm.patch(`/api/projects/${pid}`, { name: 'x', version: v });
    expect(blocked.status).toBe(400);
    expect((await admin.put(`/api/projects/${pid}/members/${ids['exp1']}`, { roles: ['expert'] })).status).toBe(409);
    const back = await pm.patch(`/api/projects/${pid}`, { archived: false, version: v });
    expect(back.status).toBe(200);
    expect(back.body.project.archived).toBe(false);
  });

  it('حذف پروژه فقط برای ادمین سیستم و با تأیید نام؛ ممیزی می‌ماند', async () => {
    const pid = await createProject('حذف‌شدنی');
    const pm = await loggedIn(env, 'pm1');
    expect((await pm.del(`/api/projects/${pid}`, { confirmName: 'حذف‌شدنی' })).status).toBe(403);
    expect((await admin.del(`/api/projects/${pid}`, { confirmName: 'اشتباه' })).body.error.code).toBe('NAME_MISMATCH');
    expect((await admin.del(`/api/projects/${pid}`, { confirmName: 'حذف‌شدنی' })).status).toBe(200);
    expect((await admin.get(`/api/projects/${pid}`)).status).toBe(404);
    const a = await env.pool.query("SELECT action FROM audit_log WHERE project_id = $1 ORDER BY id", [pid]);
    expect(a.rows.map((x) => x.action)).toEqual(expect.arrayContaining(['project.create', 'project.delete']));
  });

  it('ایجاد پروژه شمارنده، تقویم پیش‌فرض، منشور و قرارداد را می‌سازد', async () => {
    const pid = await createProject('اولیه');
    const cal = await env.pool.query('SELECT weekday, working FROM project_workdays WHERE project_id = $1 ORDER BY weekday', [pid]);
    expect(cal.rows.map((r) => r.working)).toEqual([true, true, true, true, true, false, true]);
    expect((await env.pool.query('SELECT 1 FROM project_charter WHERE project_id = $1', [pid])).rowCount).toBe(1);
    expect((await env.pool.query('SELECT 1 FROM project_contract WHERE project_id = $1', [pid])).rowCount).toBe(1);
  });
});
