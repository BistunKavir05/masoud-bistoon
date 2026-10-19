import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTask, buildWorld, getModel, insertUser, loggedIn, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env, 'مبدأ');
});
afterAll(async () => env.close());

const days = [1, 1, 1, 1, 1, 0, 1].map((x) => ({ w: x, f: '07:30', t: '15:00' }));

/** پشتیبان نمونه با قالب نسخه‌ی قدیمی؛ عمداً چند ناسازگاری دارد */
function legacyBackup(): Record<string, unknown> {
  return {
    ver: 34,
    name: 'پروژه‌ی قدیمی',
    start: '2026-03-21',
    status: '2026-04-10',
    end: '2026-08-01',
    cal: { days, hol: [{ d: '2026-04-02', n: 'تعطیل' }] },
    res: [
      { n: 'علی', t: 'انسانی', c: 100, rate: 2000000 },
      { n: 'جرثقیل', t: 'تجهیزات', c: 100, rate: 5000000 },
    ],
    tasks: [
      { id: 1, name: 'فاز ۱', lv: 1, sm: 1 },
      { id: 2, name: 'طراحی', lv: 2, dur: 5, w: 5, p: 100, as: '2026-03-21', af: '2026-03-27', res: 'علی:100' },
      { id: 3, name: 'ساخت', lv: 2, dur: 10, w: 10, p: 30, preds: '2', res: 'علی:50, جرثقیل:100', cs: [{ n: 'مصالح', a: 1000000 }], ac: 500000 },
      { id: 4, name: 'تحویل', lv: 1, ms: 1, dur: 0, preds: '3' },
      { id: 5, name: 'ناسازگار', lv: 3, dur: 2, w: 1, p: 50, as: '2026-04-05', af: '2026-04-01', preds: '99,5' },
    ],
    base: { 2: { ES: 0, D: 5, c: 10000000 }, 3: { ES: 5, D: 10, c: 25000000 } },
    snaps: [
      { d: '2026-04-01', a: 20, pl: 25, est: false, t: { 2: 100, 3: 0 } },
      { d: '2026-04-10', a: 40, pl: 45, est: false },
    ],
    costs: [{ id: 7, d: '2026-04-05', task: 3, n: 'خرید', doc: 'F1', a: 750000 }],
    ch: { client: 'کارفرمای قدیمی', cno: 'C-9', amount: 1000, invTotal: 600, paid: 500, comPct: 10, comRetPct: 50, retAmt: 100, salesOK: 'تأیید شده' },
    risks: [{ id: 3, title: 'ریسک', cat: 'فنی', prob: 9, impact: 2, status: 'باز' }],
    issues: [{ id: 1, title: 'مسئله', pri: 'بالا', dec: true }],
    docs: [{ id: 1, title: 'سند', url: 'example.com/a.pdf', type: 'قرارداد', task: 3 }],
    fin: { unit: 'ریال', budget: 90000000 },
    log: [
      { t: '1405/01/10 10:00', k: 'طراحی', f: 'p', o: '50', n: '100' },
      { t: '1405/01/11 11:00', k: 'ساخت', f: 'dur', o: '8', n: '10' },
    ],
    users: [
      { id: 'ali', role: 'user', res: 'علی' },
      { id: 'boss', role: 'admin', res: '' },
    ],
  };
}

describe('ورود از نسخه‌ی قدیمی', () => {
  let pid = 0;
  let body: any;

  it('فقط ادمین سیستم وارد می‌کند؛ ساختار نامعتبر رد می‌شود', async () => {
    expect((await w.pm.post('/api/import/legacy', legacyBackup())).status).toBe(403);
    const bad = await w.admin.post('/api/import/legacy', { hello: 'world' });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('LEGACY_INVALID');
    const empty = await w.admin.req('POST', '/api/import/legacy', undefined);
    expect(empty.status).toBe(400);
  });

  it('dryRun: همان اعتبارسنجی و هشدارها را می‌دهد ولی پروژه نمی‌سازد', async () => {
    const count = async (): Promise<number> => Number((await env.pool.query('SELECT count(*)::int AS n FROM projects')).rows[0].n);
    const before = await count();
    expect((await w.pm.req('POST', '/api/import/legacy?dryRun=1', legacyBackup())).status).toBe(403);
    const r = await w.admin.req('POST', '/api/import/legacy?dryRun=1', legacyBackup());
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.name).toBe('پروژه‌ی قدیمی');
    expect(r.body.summary).toMatchObject({ tasks: 5, resources: 2, costs: 1, risks: 1, snapshots: 2, baselineItems: 2, legacyLog: 2 });
    expect(r.body.warnings.map((x: { code: string }) => x.code)).toContain('LEVEL_ADJUSTED');
    expect(r.body.legacyUsers.length).toBe(2);
    expect((await w.admin.req('POST', '/api/import/legacy?dryRun=1', { hello: 'world' })).status).toBe(400);
    expect(await count()).toBe(before);
  });

  it('پروژه با شناسه‌های اصلی، اصلاح‌ها و هشدارها ساخته می‌شود', async () => {
    const r = await w.admin.post('/api/import/legacy', legacyBackup());
    expect(r.status).toBe(201);
    body = r.body;
    pid = r.body.projectId;
    expect(r.body.summary).toMatchObject({ tasks: 5, resources: 2, costs: 1, risks: 1, snapshots: 2, baselineItems: 2, legacyLog: 2 });
    const codes: string[] = r.body.warnings.map((x: { code: string }) => x.code);
    for (const c of ['LEVEL_ADJUSTED', 'FINISH_BEFORE_START', 'UNKNOWN_PREDECESSOR_DROPPED', 'SELF_DEPENDENCY_DROPPED', 'RISK_SCALE_ADJUSTED']) expect(codes).toContain(c);
    expect(r.body.legacyUsers).toEqual([
      { id: 'ali', role: 'user', resourceNames: 'علی', suggestedRole: 'expert' },
      { id: 'boss', role: 'admin', resourceNames: '', suggestedRole: 'admin' },
    ]);
  });

  it('مدل وارد‌شده: فعالیت‌ها، وابستگی‌ها، منابع، خط مبنا، قرارداد و پورسانت', async () => {
    const m = await getModel(w.admin, pid);
    expect(m.project.name).toBe('پروژه‌ی قدیمی');
    expect(m.tasks.map((t: { id: number }) => t.id)).toEqual([1, 2, 3, 4, 5]);
    expect(m.tasks.map((t: { level: number }) => t.level)).toEqual([1, 2, 2, 1, 1]);
    const t3 = m.tasks.find((t: { id: number }) => t.id === 3);
    expect(t3.dependencies).toEqual([{ predecessorId: 2, type: 'FS', lag: 0 }]);
    expect(t3.assignments).toEqual([
      { resourceId: 1, units: 50 },
      { resourceId: 2, units: 100 },
    ]);
    expect(t3.directCosts).toEqual([{ name: 'مصالح', amount: 1000000 }]);
    expect(t3.legacyActualCost).toBe(500000);
    const t5 = m.tasks.find((t: { id: number }) => t.id === 5);
    expect(t5).toMatchObject({ actualFinish: null, actualStart: '2026-04-05', dependencies: [] });
    expect(m.resources.map((r: { name: string }) => r.name)).toEqual(['علی', 'جرثقیل']);
    expect(m.calendar.holidays).toEqual([{ date: '2026-04-02', title: 'تعطیل' }]);
    expect(Object.keys(m.baseline.items).sort()).toEqual(['2', '3']);
    expect(m.baseline.items['2']).toMatchObject({ start: '2026-03-21', cost: 10000000 });
    expect(m.snapshots.map((s: { date: string }) => s.date)).toEqual(['2026-04-01', '2026-04-10']);
    expect(m.snapshots[0].tasks).toEqual({ 2: 100, 3: 0 });
    expect(m.costs).toEqual([{ id: 7, date: '2026-04-05', taskId: 3, description: 'خرید', document: 'F1', amount: 750000, version: 1 }]);
    expect(m.contract).toMatchObject({ number: 'C-9', amount: 1000, invoicedTotal: 600, collectedTotal: 500, salesApproval: 'approved', retentionValue: 100 });
    expect(m.commission).toMatchObject({ sales: 100, retention: 50, payable: 50 });
    expect(m.risks[0]).toMatchObject({ id: 3, probability: 5, impact: 2, category: 'technical' });
    expect(m.issues[0]).toMatchObject({ priority: 'high', needsDecision: true });
    expect(m.documents[0]).toMatchObject({ type: 'contract', taskId: 3, url: 'https://example.com/a.pdf' });
    expect(m.summary.scheduleError).toBeNull();
    expect(body.warnings.length).toBeGreaterThan(4);
  });

  it('شمارنده‌ها بعد از شناسه‌های واردشده ادامه می‌یابند', async () => {
    const t = await addTask(w.admin, pid, { referenceId: 4, asChild: false, name: 'تازه' });
    expect(t.id).toBe(6);
    const cost = await w.admin.post(`/api/projects/${pid}/costs`, { date: '2026-04-11', amount: 5 });
    expect(cost.body.item.id).toBe(8);
    const risk = await w.admin.post(`/api/projects/${pid}/risks`, { title: 'جدید' });
    expect(risk.body.item.id).toBe(4);
  });

  it('سابقه‌ی نسخه‌ی قدیمی و اصل فایل نگه داشته می‌شود', async () => {
    const audit = await w.admin.get(`/api/projects/${pid}/audit?limit=500`);
    const actions = audit.body.entries.map((e: { action: string }) => e.action);
    expect(actions).toContain('project.import.legacy');
    expect(actions.filter((a: string) => a === 'legacy.change').length).toBe(2);
    const row = await env.pool.query('SELECT source_sha256, original->>\'name\' AS name, jsonb_array_length(warnings) AS w FROM legacy_imports WHERE project_id = $1', [pid]);
    expect(row.rows[0].name).toBe('پروژه‌ی قدیمی');
    expect(row.rows[0].source_sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(Number(row.rows[0].w)).toBe(body.warnings.length);
  });
});

describe('پشتیبان و بازیابی', () => {
  let src = 0;
  beforeAll(async () => {
    const r = await w.admin.post('/api/import/legacy', legacyBackup());
    src = r.body.projectId;
  });

  it('خروجی فقط برای نقش دارای data.export و با پیوست دانلود', async () => {
    expect((await w.fin.get(`/api/projects/${src}/export`)).status).toBe(404); // عضو آن پروژه نیست
    expect((await w.fin.get(`/api/projects/${w.pid}/export`)).status).toBe(403);
    const ok = await w.admin.get(`/api/projects/${src}/export`);
    expect(ok.status).toBe(200);
    expect(ok.headers.get('content-disposition')).toMatch(/attachment; filename="bistoon-/);
    expect(ok.body.format).toBe('bistoon-project');
    expect(ok.body.model.tasks.length).toBe(5);
  });

  it('رفت‌وبرگشت: خروجی ادمین دوباره وارد می‌شود و مدل یکسان است', async () => {
    const exp = (await w.admin.get(`/api/projects/${src}/export`)).body;
    const imp = await w.admin.post('/api/import/project', exp);
    expect(imp.status).toBe(201);
    const a = await getModel(w.admin, src);
    const b = await getModel(w.admin, imp.body.projectId);
    const strip = (m: any) => ({
      tasks: m.tasks.map(({ version: _v, ...t }: any) => t),
      resources: m.resources.map(({ userId: _u, ...r }: any) => r),
      calendar: m.calendar,
      baseline: m.baseline?.items,
      snapshots: m.snapshots,
      costs: m.costs,
      contract: { ...m.contract, version: 0 },
      risks: m.risks.map(({ version: _v, ...x }: any) => x),
      issues: m.issues.map(({ version: _v, ...x }: any) => x),
      charter: { ...m.charter, version: 0 },
      commission: m.commission,
      summary: { ...m.summary },
    });
    expect(strip(b)).toEqual(strip(a));
  });

  it('خروجی مدیر پروژه پورسانت ندارد', async () => {
    // مدیر پروژه‌ی یک پروژه‌ی دیگر را عضو می‌کنیم
    const pmId = w.ids['pm1']!;
    expect((await w.admin.put(`/api/projects/${src}/members/${pmId}`, { roles: ['pm'] })).status).toBe(200);
    const exp = await w.pm.get(`/api/projects/${src}/export`);
    expect(exp.status).toBe(200);
    expect(exp.body.model.contract).toMatchObject({ amount: 1000, salesCommissionPercent: 0, retentionCommissionPercent: 0, salesApproval: null });
  });

  it('فایل نامعتبر بازیابی نمی‌شود و فقط ادمین سیستم', async () => {
    const exp = (await w.admin.get(`/api/projects/${src}/export`)).body;
    expect((await w.pm.post('/api/import/project', exp)).status).toBe(403);
    expect((await w.admin.post('/api/import/project', { ...exp, version: 99 })).status).toBe(400);
    const broken = structuredClone(exp);
    broken.model.tasks[0].kind = 'weird';
    expect((await w.admin.post('/api/import/project', broken)).body.error.code).toBe('VALIDATION');
    const other = await insertUser(env.pool, 'late');
    expect(other).toBeGreaterThan(0);
    expect((await (await loggedIn(env, 'late')).post('/api/import/project', exp)).status).toBe(403);
  });
});
