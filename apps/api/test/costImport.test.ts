import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTask, buildWorld, getModel, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
let phase = 0;
let leaf = 0;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env);
  phase = (await addTask(w.pm, w.pid, { name: 'فاز', kind: 'summary' })).id;
  leaf = (await addTask(w.pm, w.pid, { referenceId: phase, asChild: true, name: 'کار' })).id;
});
afterAll(async () => env.close());

const url = (p: string): string => `/api/projects/${w.pid}${p}`;
const e = (amount: number, taskId: number | null = leaf, extra: Record<string, unknown> = {}) => ({ date: '2026-04-05', taskId, description: 'خرید', document: 'D', amount, ...extra });

describe('ورود دسته‌ای هزینه', () => {
  it('همه‌ی ردیف‌ها در یک تراکنش ثبت می‌شوند و ممیزی خلاصه نوشته می‌شود', async () => {
    const r = await w.fin.post(url('/costs/import'), { entries: [e(1000), e(2500), e(700, null)] });
    expect(r.status).toBe(201);
    expect(r.body).toMatchObject({ created: 3, total: 4200 });
    expect(r.body.lastId - r.body.firstId).toBe(2);
    const m = await getModel(w.fin, w.pid);
    expect(m.costs.length).toBe(3);
    expect(m.costs.map((c: { amount: number }) => c.amount)).toEqual([1000, 2500, 700]);
    const audit = await w.admin.get(url('/audit'));
    expect(JSON.stringify(audit.body)).toContain('cost.import');
  });

  it('فعالیت ناموجود یا خلاصه کل درخواست را رد می‌کند و چیزی ثبت نمی‌شود', async () => {
    const before = (await getModel(w.fin, w.pid)).costs.length;
    const a = await w.fin.post(url('/costs/import'), { entries: [e(10), e(10, 99999)] });
    expect(a.status).toBe(400);
    expect(a.body.error.code).toBe('UNKNOWN_TASK');
    const b = await w.fin.post(url('/costs/import'), { entries: [e(10), e(10, phase)] });
    expect(b.status).toBe(400);
    expect(b.body.error.code).toBe('SUMMARY_TASK');
    expect((await getModel(w.fin, w.pid)).costs.length).toBe(before);
  });

  it('مبلغ نامعتبر، فهرست خالی و فیلد ناشناخته رد می‌شود', async () => {
    expect((await w.fin.post(url('/costs/import'), { entries: [e(0)] })).status).toBe(400);
    expect((await w.fin.post(url('/costs/import'), { entries: [] })).status).toBe(400);
    expect((await w.fin.post(url('/costs/import'), { entries: [e(5, leaf, { extra: 1 })] })).status).toBe(400);
  });

  it('فقط نقش‌های دارای costs.edit می‌توانند وارد کنند', async () => {
    expect((await w.exp.post(url('/costs/import'), { entries: [e(5)] })).status).toBe(403);
    expect((await w.com.post(url('/costs/import'), { entries: [e(5)] })).status).toBe(403);
    expect((await w.mgr.post(url('/costs/import'), { entries: [e(5)] })).status).toBe(403);
    expect((await w.pm.post(url('/costs/import'), { entries: [e(5)] })).status).toBe(201);
  });

  it('سقف ۵۰۰۰ ردیف دفتر: ۴۰۹ LEDGER_FULL و دفتر دست‌نخورده می‌ماند', async () => {
    const have = (await getModel(w.fin, w.pid)).costs.length;
    const batch = (n: number) => Array.from({ length: n }, (_, i) => e(i + 1, null, { document: `x${i}` }));
    for (let i = 0; i < 3; i += 1) expect((await w.fin.post(url('/costs/import'), { entries: batch(1600) })).status).toBe(201);
    // اکنون: have + 4800؛ ۲۰۱ ردیف دیگر جا نمی‌شود، ۲۰۰ می‌شود
    const left = 5000 - have - 4800;
    const over = await w.fin.post(url('/costs/import'), { entries: batch(left + 1) });
    expect(over.status).toBe(409);
    expect(over.body.error.code).toBe('LEDGER_FULL');
    expect((await w.fin.post(url('/costs/import'), { entries: batch(left) })).status).toBe(201);
    expect((await getModel(w.fin, w.pid)).costs.length).toBe(5000);
  });
});
