import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildWorld, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
let other = 0;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env, 'پورتفولیو الف');
  const r = await w.admin.post('/api/projects', { name: 'پورتفولیو ب', start: '2026-03-21', status: '2026-04-10' });
  other = r.body.project.id;
});
afterAll(async () => env.close());

const item = async (pid: number): Promise<any> => (await w.admin.get('/api/portfolio')).body.items.find((x: any) => x.id === pid);
const auditOf = async (pid: number): Promise<any[]> => (await w.admin.get(`/api/projects/${pid}/audit?limit=200`)).body.entries;

describe('پورتفولیو: دسترسی و فهرست', () => {
  it('فقط ادمین سیستم', async () => {
    expect((await w.pm.get('/api/portfolio')).status).toBe(403);
    expect((await w.com.get('/api/portfolio')).status).toBe(403);
    expect((await w.pm.post('/api/portfolio/import', { updates: [{ projectId: w.pid, contract: { number: 'x' } }] })).status).toBe(403);
    const r = await w.admin.get('/api/portfolio');
    expect(r.status).toBe(200);
    const mine = r.body.items.find((x: any) => x.id === w.pid);
    expect(mine.name).toBe('پورتفولیو الف');
    expect(mine.unit).toBeTruthy();
    expect(mine.archived).toBe(false);
    expect(mine.contract.amount).toBe(0);
    expect(mine.contractEnd).toBe(null);
    expect(mine.charter.client).toBe('');
    expect(mine.charter.goals).toBe(undefined);
  });
});

describe('پورتفولیو: ورود گروهی', () => {
  it('فقط فیلدهای داده‌شده نوشته می‌شود، ثبت در لاگ با منبع ورود', async () => {
    const r = await w.admin.post('/api/portfolio/import', {
      updates: [{ projectId: w.pid, charter: { client: 'شرکت الف', salesOwner: 'رضا' }, contract: { number: 'QA-1', amount: 1_000_000_000, retentionMode: 'fixed', retentionValue: 100_000_000 }, contractEnd: '2027-03-20' }],
    });
    expect(r.status).toBe(200);
    expect(r.body.results).toEqual([{ projectId: w.pid, changed: 6, contractEndSkipped: false }]);
    const it = await item(w.pid);
    expect(it.charter.client).toBe('شرکت الف');
    expect(it.charter.location).toBe('');
    expect(it.contract.number).toBe('QA-1');
    expect(it.contract.collectedTotal).toBe(0);
    expect(it.contractEnd).toBe('2027-03-20');
    const log = await auditOf(w.pid);
    const mine = log.filter((e) => e.details && e.details.source === 'portfolio.import');
    expect(mine.length).toBe(6);
    expect(mine.some((e) => e.action === 'contract.update' && e.field === 'amount' && e.newValue === 1_000_000_000)).toBe(true);
    expect(mine.some((e) => e.action === 'project.update' && e.field === 'contractEnd')).toBe(true);
  });

  it('ورود مجدد همان مقادیر اثری ندارد؛ پایان قرارداد ثبت‌شده تغییر نمی‌کند', async () => {
    const before = (await auditOf(w.pid)).length;
    const same = await w.admin.post('/api/portfolio/import', { updates: [{ projectId: w.pid, charter: { client: 'شرکت الف' }, contract: { number: 'QA-1' }, contractEnd: '2027-03-20' }] });
    expect(same.body.results[0]).toEqual({ projectId: w.pid, changed: 0, contractEndSkipped: false });
    const diffEnd = await w.admin.post('/api/portfolio/import', { updates: [{ projectId: w.pid, contractEnd: '2028-01-01' }] });
    expect(diffEnd.body.results[0]).toEqual({ projectId: w.pid, changed: 0, contractEndSkipped: true });
    expect((await item(w.pid)).contractEnd).toBe('2027-03-20');
    expect((await auditOf(w.pid)).length).toBe(before);
  });

  it('اعتبارسنجی: بدنه‌ی نامعتبر، کلید ناشناخته، درصد، پروژه‌ی تکراری و ناموجود', async () => {
    const post = (updates: unknown) => w.admin.post('/api/portfolio/import', { updates });
    expect((await post([])).status).toBe(400);
    expect((await post([{ projectId: w.pid, contract: { amount: -1 } }])).status).toBe(400);
    expect((await post([{ projectId: w.pid, contract: { salesCommissionPercent: 150 } }])).status).toBe(400);
    expect((await post([{ projectId: w.pid, contract: { hacked: 1 } }])).status).toBe(400);
    expect((await post([{ projectId: w.pid, contractEnd: 'نه' }])).status).toBe(400);
    expect((await post([{ projectId: w.pid, extra: 1 }])).status).toBe(400);
    const dup = await post([{ projectId: w.pid, contract: { number: 'a' } }, { projectId: w.pid, contract: { number: 'b' } }]);
    expect(dup.status).toBe(400);
    expect(dup.body.error.code).toBe('DUPLICATE_PROJECT');
    expect((await post([{ projectId: 999999, contract: { number: 'a' } }])).status).toBe(404);
    expect((await w.admin.post('/api/portfolio/import', { updates: [{ projectId: w.pid }], x: 1 })).status).toBe(400);
  });

  it('اتمیک است: ردشدن یک پروژه چیزی را ننویسد', async () => {
    const r = await w.admin.post('/api/portfolio/import', { updates: [{ projectId: other, charter: { client: 'نباید نوشته شود' } }, { projectId: 999999, contract: { number: 'z' } }] });
    expect(r.status).toBe(404);
    expect((await item(other)).charter.client).toBe('');
  });

  it('پروژه‌ی بایگانی‌شده رد می‌شود و هیچ پروژه‌ی دیگری هم نوشته نمی‌شود', async () => {
    const cur = (await w.admin.get(`/api/projects/${other}`)).body.project;
    expect((await w.admin.patch(`/api/projects/${other}`, { version: cur.version, archived: true })).status).toBe(200);
    const r = await w.admin.post('/api/portfolio/import', { updates: [{ projectId: w.pid, charter: { location: 'یاسوج' } }, { projectId: other, charter: { location: 'اهواز' } }] });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('ARCHIVED');
    expect((await item(w.pid)).charter.location).toBe('');
    expect((await item(other)).archived).toBe(true);
  });

  it('رکورد خلاصه‌ی ورود در لاگ سیستم ثبت می‌شود', async () => {
    const q = await env.pool.query("SELECT details FROM audit_log WHERE action = 'portfolio.import' ORDER BY id");
    expect(q.rowCount).toBe(3);
    expect(q.rows[0].details.fields).toBe(6);
  });
});
