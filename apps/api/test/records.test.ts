import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTask, buildWorld, getModel, startEnv, taskOf } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env, 'رکوردها');
});
afterAll(async () => env.close());

const url = (p: string): string => `/api/projects/${w.pid}${p}`;

describe('منابع', () => {
  it('ایجاد، نام تکراری، نام نامعتبر، ویرایش و حذف', async () => {
    const r = await w.pm.post(url('/resources'), { name: 'جرثقیل', type: 'equipment', capacityPercent: 100, dailyRate: 5_000_000 });
    expect(r.status).toBe(201);
    expect((await w.pm.post(url('/resources'), { name: 'جرثقیل' })).status).toBe(409);
    expect((await w.pm.post(url('/resources'), { name: 'علی، رضا' })).status).toBe(400);
    expect((await w.pm.post(url('/resources'), { name: 'ب', capacityPercent: 0 })).status).toBe(400);
    const id = r.body.item.id;
    const up = await w.pm.patch(url(`/resources/${id}`), { dailyRate: 6_000_000 });
    expect(up.body.item.dailyRate).toBe(6_000_000);
    expect((await w.pm.del(url(`/resources/${id}`))).status).toBe(200);
    expect((await w.pm.del(url(`/resources/${id}`))).status).toBe(404);
  });

  it('منبع تخصیص‌یافته حذف نمی‌شود؛ پیوند به غیرعضو رد می‌شود؛ فقط schedule.edit', async () => {
    const t = (await addTask(w.pm, w.pid, { name: 'با منبع' })).id;
    const cur = await taskOf(w.pm, w.pid, t);
    expect((await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { assignments: [{ resourceId: w.expResourceId, units: 50 }] } })).status).toBe(200);
    const del = await w.pm.del(url(`/resources/${w.expResourceId}`));
    expect(del.status).toBe(409);
    expect(del.body.error.code).toBe('RESOURCE_IN_USE');
    const outsider = await env.pool.query("INSERT INTO users (username, display_name, password_hash) VALUES ('nomem', 'غیرعضو', 'x') RETURNING id");
    expect((await w.pm.post(url('/resources'), { name: 'پیوند', userId: Number(outsider.rows[0].id) })).body.error.code).toBe('NOT_A_MEMBER');
    expect((await w.fin.post(url('/resources'), { name: 'مالی' })).status).toBe(403);
    expect((await w.exp.post(url('/resources'), { name: 'کارشناس' })).status).toBe(403);
  });
});

describe('هزینه‌ها', () => {
  let task = 0;
  let summary = 0;
  beforeAll(async () => {
    summary = (await addTask(w.pm, w.pid, { name: 'گروه هزینه', kind: 'summary' })).id;
    task = (await addTask(w.pm, w.pid, { referenceId: summary, asChild: true, name: 'خرید' })).id;
  });

  it('مالی ثبت می‌کند؛ کارشناس، بازرگانی و مدیریت نمی‌توانند', async () => {
    const ok = await w.fin.post(url('/costs'), { date: '2026-04-01', taskId: task, description: 'خرید تجهیزات', document: 'F-12', amount: 1_500_000 });
    expect(ok.status).toBe(201);
    expect(ok.body.item).toMatchObject({ taskId: task, amount: 1_500_000, version: 1 });
    for (const who of [w.exp, w.com, w.mgr]) expect((await who.post(url('/costs'), { date: '2026-04-01', amount: 1 })).status).toBe(403);
    const over = await w.pm.post(url('/costs'), { date: '2026-04-02', amount: 200_000, description: 'سربار' });
    expect(over.status).toBe(201);
    expect(over.body.item.taskId).toBeNull();
  });

  it('اعتبارسنجی: مبلغ مثبت، فعالیت موجود و غیرخلاصه', async () => {
    expect((await w.fin.post(url('/costs'), { date: '2026-04-01', amount: 0 })).status).toBe(400);
    expect((await w.fin.post(url('/costs'), { date: '2026-04-01', amount: -5 })).status).toBe(400);
    expect((await w.fin.post(url('/costs'), { date: '2026-04-01', amount: 5, taskId: 424242 })).body.error.code).toBe('UNKNOWN_TASK');
    expect((await w.fin.post(url('/costs'), { date: '2026-04-01', amount: 5, taskId: summary })).body.error.code).toBe('SUMMARY_TASK');
    expect((await w.fin.post(url('/costs'), { date: '2026-02-30', amount: 5 })).status).toBe(400);
  });

  it('ویرایش با نسخه و حذف؛ فعالیت دارای هزینه حذف نمی‌شود', async () => {
    const created = (await w.fin.post(url('/costs'), { date: '2026-04-03', taskId: task, amount: 10 })).body.item;
    const up = await w.fin.patch(url(`/costs/${created.id}`), { version: created.version, amount: 20 });
    expect(up.body.item).toMatchObject({ amount: 20, version: created.version + 1 });
    const stale = await w.fin.patch(url(`/costs/${created.id}`), { version: created.version, amount: 30 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    const sv = (await w.pm.get(url(''))).body.project.structureVersion;
    const blocked = await w.pm.del(url(`/tasks/${task}`), { structureVersion: sv });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error.code).toBe('TASK_HAS_COSTS');
    expect((await w.fin.del(url(`/costs/${created.id}`))).status).toBe(200);
  });

  it('مدل: مالی و مدیریت هزینه می‌بینند، بازرگانی و کارشناس نه؛ شاخص‌ها محاسبه می‌شوند', async () => {
    expect((await getModel(w.fin, w.pid)).costs.length).toBeGreaterThanOrEqual(2);
    expect((await getModel(w.mgr, w.pid)).costs.length).toBeGreaterThanOrEqual(2);
    expect((await getModel(w.com, w.pid)).costs).toBeUndefined();
    expect((await getModel(w.exp, w.pid)).costs).toBeUndefined();
  });
});

describe('تقویم', () => {
  it('هفته‌ی کاری و تعطیلات', async () => {
    const m0 = await getModel(w.pm, w.pid);
    const days = m0.calendar.days.map((d: { working: boolean; from: string; to: string }) => ({ ...d }));
    days[6].working = false;
    const up = await w.pm.put(url('/calendar/days'), { days });
    expect(up.status).toBe(200);
    expect(up.body.calendar.days[6].working).toBe(false);
    expect(up.body.calendar.days[0].from).toBe('07:30');
    expect((await w.pm.put(url('/calendar/days'), { days: days.map((d: object) => ({ ...d, working: false })) })).body.error.code).toBe('CALENDAR_INVALID');
    expect((await w.pm.put(url('/calendar/days'), { days: days.slice(0, 6) })).status).toBe(400);
    expect((await w.pm.put(url('/calendar/days'), { days: days.map((d: object) => ({ ...d, from: '25:00' })) })).status).toBe(400);
    const h = await w.pm.put(url('/calendar/holidays/2026-04-02'), { title: 'تعطیل آزمون' });
    expect(h.body.calendar.holidays).toEqual([{ date: '2026-04-02', title: 'تعطیل آزمون' }]);
    expect((await w.pm.put(url('/calendar/holidays/2026-04-02'), { title: 'نام نو' })).body.calendar.holidays[0].title).toBe('نام نو');
    expect((await w.pm.put(url('/calendar/holidays/not-a-date'), { title: 'x' })).status).toBe(400);
    const bulk = await w.pm.post(url('/calendar/holidays'), { holidays: [{ date: '2026-04-03', title: 'ب' }, { date: '2026-04-04' }], replace: true });
    expect(bulk.body.calendar.holidays.map((x: { date: string }) => x.date)).toEqual(['2026-04-03', '2026-04-04']);
    expect((await w.pm.del(url('/calendar/holidays/2026-04-03'))).body.calendar.holidays.length).toBe(1);
    expect((await w.exp.put(url('/calendar/holidays/2026-05-01'), { title: 'x' })).status).toBe(403);
  });
});

describe('خط مبنا و اسنپ‌شات', () => {
  it('خط مبنای جدید قبلی را بایگانی می‌کند', async () => {
    const first = await w.pm.post(url('/baseline'), { label: 'نسخه‌ی ۱' });
    expect(first.status).toBe(201);
    expect(first.body.baseline.label).toBe('نسخه‌ی ۱');
    const taskIds = (await getModel(w.pm, w.pid)).tasks.map((t: { id: number }) => t.id);
    expect(Object.keys(first.body.baseline.items).map(Number).sort((a, b) => a - b)).toEqual([...taskIds].sort((a: number, b: number) => a - b));
    expect(first.body.baselineHistory).toEqual([]);
    const second = await w.pm.post(url('/baseline'), { label: 'نسخه‌ی ۲' });
    expect(second.body.baseline.label).toBe('نسخه‌ی ۲');
    expect(second.body.baselineHistory.length).toBe(1);
    expect(second.body.baselineHistory[0]).toMatchObject({ label: 'نسخه‌ی ۱', archivedOn: '2026-04-10' });
    const m = await getModel(w.pm, w.pid);
    expect(m.baseline.label).toBe('نسخه‌ی ۲');
    expect(m.baselineHistory.length).toBe(1);
    expect((await w.exp.post(url('/baseline'), { label: 'نه' })).status).toBe(403);
  });

  it('هزینه‌ی خط مبنا برای نقش بدون هزینه پنهان است', async () => {
    const asPm = await getModel(w.pm, w.pid);
    const asExp = await getModel(w.exp, w.pid);
    expect(Object.values(asExp.baseline.items).every((i: any) => i.cost === null)).toBe(true);
    expect(Object.values(asPm.baseline.items).some((i: any) => i.cost !== null)).toBe(true);
  });

  it('اسنپ‌شات در تاریخ وضعیت ثبت و جایگزین می‌شود و تخمین بازسازی می‌شود', async () => {
    const s1 = await w.pm.post(url('/snapshots'));
    expect(s1.status).toBe(201);
    expect(s1.body.snapshots.filter((s: { date: string; estimated: boolean }) => s.date === '2026-04-10' && !s.estimated).length).toBe(1);
    const s2 = await w.pm.post(url('/snapshots'));
    expect(s2.body.snapshots.filter((s: { date: string }) => s.date === '2026-04-10').length).toBe(1);
    const est = await w.pm.post(url('/snapshots/estimate'));
    expect(est.status).toBe(200);
    expect(est.body.snapshots.some((s: { estimated: boolean }) => !s.estimated)).toBe(true);
    expect((await w.pm.del(url('/snapshots/2026-04-10'))).status).toBe(200);
    expect((await w.pm.del(url('/snapshots/2026-04-10'))).status).toBe(404);
    const m = await getModel(w.exp, w.pid);
    expect(m.snapshots.every((s: any) => s.actualCost === undefined)).toBe(true);
  });
});

describe('منشور و قرارداد', () => {
  it('منشور با نسخه ویرایش می‌شود و فقط مدیر پروژه/ادمین', async () => {
    const m = await getModel(w.pm, w.pid);
    const r = await w.pm.patch(url('/charter'), { version: m.charter.version, client: 'شرکت الف', goals: 'هدف' });
    expect(r.status).toBe(200);
    expect(r.body.item).toMatchObject({ client: 'شرکت الف', goals: 'هدف', version: m.charter.version + 1 });
    expect((await w.pm.patch(url('/charter'), { version: m.charter.version, client: 'دوباره' })).status).toBe(409);
    expect((await w.fin.patch(url('/charter'), { version: r.body.item.version, client: 'مالی' })).status).toBe(403);
    expect((await w.com.get(url('/model'))).body.charter).toBeUndefined();
  });

  it('هر گروه از فیلدهای قرارداد قابلیت خودش را می‌خواهد', async () => {
    let v = (await getModel(w.fin, w.pid)).contract.version;
    // مدیر پروژه: اطلاعات عمومی بله، وصول نه
    const pm1 = await w.pm.patch(url('/contract'), { version: v, number: 'C-1', amount: 1000, retentionMode: 'percent', retentionValue: 10 });
    expect(pm1.status).toBe(200);
    v = pm1.body.item.version;
    expect(pm1.body.item.salesCommissionPercent).toBeUndefined();
    expect(pm1.body.commission).toBeUndefined();
    const pm2 = await w.pm.patch(url('/contract'), { version: v, collectedTotal: 500 });
    expect(pm2.status).toBe(403);
    expect(pm2.body.error.details.fields).toEqual(['collectedTotal']);
    // مالی: وصول و درصد پورسانت
    const fin = await w.fin.patch(url('/contract'), { version: v, invoicedTotal: 600, collectedTotal: 500, salesCommissionPercent: 10, retentionCommissionPercent: 50 });
    expect(fin.status).toBe(200);
    v = fin.body.item.version;
    // مبلغ ۱۰۰۰، حسن انجام کار ۱۰٪ = ۱۰۰؛ پورسانت فروش ۱۰٪ = ۱۰۰، حسن انجام ۵۰٪ از ۱۰۰ = ۵۰
    expect(fin.body.commission).toMatchObject({ sales: 100, retention: 50, total: 150, payableSales: 50, payableRetention: 0, payable: 50, pending: 100 });
    // تأیید پورسانت: فقط مدیریت/ادمین
    expect((await w.fin.patch(url('/contract'), { version: v, salesApproval: 'approved' })).status).toBe(403);
    const mgr = await w.mgr.patch(url('/contract'), { version: v, salesApproval: 'approved' });
    expect(mgr.status).toBe(200);
    expect(mgr.body.item.salesApproval).toBe('approved');
    v = mgr.body.item.version;
    // بازرگانی همه را می‌بیند و هیچ را نمی‌تواند عوض کند
    const com = await getModel(w.com, w.pid);
    expect(com.contract).toMatchObject({ amount: 1000, invoicedTotal: 600, collectedTotal: 500, salesCommissionPercent: 10, salesApproval: 'approved' });
    expect(com.commission.payable).toBe(50);
    expect((await w.com.patch(url('/contract'), { version: v, amount: 1 })).status).toBe(403);
    // مدیر پروژه پورسانت را نمی‌بیند
    const pm = await getModel(w.pm, w.pid);
    expect(pm.commission).toBeUndefined();
    expect(pm.contract.collectedTotal).toBe(500);
    // کارشناس به قرارداد دسترسی ندارد
    expect((await w.exp.get(url('/model'))).body.contract).toBeUndefined();
    expect((await w.exp.patch(url('/contract'), { version: v, number: 'x' })).status).toBe(403);
  });

  it('وصول بیش از مبلغ و اعداد نامعتبر', async () => {
    const v = (await getModel(w.fin, w.pid)).contract.version;
    expect((await w.fin.patch(url('/contract'), { version: v, collectedTotal: -1 })).status).toBe(400);
    expect((await w.fin.patch(url('/contract'), { version: v, collectedTotal: 1.5 })).status).toBe(400);
    expect((await w.fin.patch(url('/contract'), { version: v, salesCommissionPercent: 120 })).status).toBe(400);
    const over = await w.fin.patch(url('/contract'), { version: v, collectedTotal: 900, invoicedTotal: 700 });
    expect(over.status).toBe(200);
    expect(over.body.warnings.map((x: { code: string }) => x.code)).toContain('COLLECTED_OVER_INVOICED');
  });
});

describe('ریسک، مسئله، تغییر و تصمیم', () => {
  it('ریسک: ایجاد، نسخه، حذف، اعتبارسنجی و دسترسی', async () => {
    const r = await w.pm.post(url('/risks'), { title: 'تأخیر تأمین', category: 'procurement', probability: 4, impact: 5, owner: 'علی', status: 'open' });
    expect(r.status).toBe(201);
    const item = r.body.item;
    expect(item).toMatchObject({ probability: 4, impact: 5, version: 1 });
    expect((await w.pm.patch(url(`/risks/${item.id}`), { version: 1, probability: 6 })).status).toBe(400);
    const up = await w.pm.patch(url(`/risks/${item.id}`), { version: 1, status: 'closed' });
    expect(up.body.item).toMatchObject({ status: 'closed', version: 2 });
    expect((await w.pm.patch(url(`/risks/${item.id}`), { version: 1, status: 'open' })).status).toBe(409);
    expect((await w.exp.post(url('/risks'), { title: 'x' })).status).toBe(403);
    expect((await w.com.get(url('/model'))).body.risks).toBeUndefined();
    expect((await getModel(w.exp, w.pid)).risks.length).toBeGreaterThan(0);
    expect((await w.pm.del(url(`/risks/${item.id}`))).status).toBe(200);
    expect((await w.pm.del(url(`/risks/${item.id}`))).status).toBe(404);
  });

  it('مسئله', async () => {
    const r = await w.pm.post(url('/issues'), { title: 'نشت', priority: 'high', needsDecision: true });
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ priority: 'high', needsDecision: true, status: 'open' });
    expect((await w.pm.post(url('/issues'), { title: 'x', priority: 'urgent' })).status).toBe(400);
  });

  it('درخواست تغییر: تأیید فقط توسط مدیریت/ادمین', async () => {
    const r = await w.pm.post(url('/changes'), { title: 'افزایش دامنه', requester: 'کارفرما', previousFinish: '2026-06-01', newFinish: '2026-06-20' });
    expect(r.status).toBe(201);
    expect(r.body.item.status).toBe('pending');
    const id = r.body.item.id;
    expect((await w.pm.post(url('/changes'), { title: 'x', status: 'approved' })).status).toBe(403);
    expect((await w.pm.patch(url(`/changes/${id}`), { version: 1, status: 'approved', approvedBy: 'خودم' })).status).toBe(403);
    expect((await w.pm.patch(url(`/changes/${id}`), { version: 1, reason: 'به‌دلیل الف' })).status).toBe(200);
    const ok = await w.mgr.patch(url(`/changes/${id}`), { version: 2, status: 'approved', approvedBy: 'مدیرعامل', approvedOn: '2026-04-11' });
    expect(ok.status).toBe(200);
    expect(ok.body.item).toMatchObject({ status: 'approved', approvedBy: 'مدیرعامل' });
  });

  it('تصمیم: مدیریت می‌تواند ثبت کند', async () => {
    const r = await w.mgr.post(url('/decisions'), { topic: 'انتخاب پیمانکار', text: 'پیمانکار الف', maker: 'مدیرعامل', status: 'decided' });
    expect(r.status).toBe(201);
    expect(r.body.item.text).toBe('پیمانکار الف');
    expect((await w.fin.post(url('/decisions'), { topic: 'x' })).status).toBe(403);
  });
});

describe('اسناد', () => {
  it('نشانی باید http/https باشد؛ پیوند به فعالیت اختیاری', async () => {
    const t = (await addTask(w.pm, w.pid, { name: 'برای سند' })).id;
    expect((await w.pm.post(url('/documents'), { title: 'نقشه', url: 'javascript:alert(1)' })).status).toBe(400);
    expect((await w.pm.post(url('/documents'), { title: 'نقشه', url: 'ftp://x/y' })).status).toBe(400);
    expect((await w.pm.post(url('/documents'), { title: 'نقشه', url: 'https://example.com/a.pdf', taskId: 99999 })).body.error.code).toBe('UNKNOWN_TASK');
    const r = await w.pm.post(url('/documents'), { title: 'نقشه', type: 'drawing', url: 'https://example.com/a.pdf', taskId: t, date: '2026-04-01' });
    expect(r.status).toBe(201);
    expect(r.body.item).toMatchObject({ type: 'drawing', taskId: t, addedBy: 'کاربر pm1' });
    const up = await w.pm.patch(url(`/documents/${r.body.item.id}`), { title: 'نقشه‌ی نهایی' });
    expect(up.body.item.title).toBe('نقشه‌ی نهایی');
    expect((await w.exp.post(url('/documents'), { title: 'x', url: 'https://a.b' })).status).toBe(403);
    expect((await getModel(w.exp, w.pid)).documents.length).toBe(1);
    expect((await getModel(w.com, w.pid)).documents).toBeUndefined();
    expect((await w.pm.del(url(`/documents/${r.body.item.id}`))).status).toBe(200);
  });
});

describe('گفتگو', () => {
  it('همه‌ی نقش‌ها می‌نویسند؛ حذف نرم؛ پیام حذف‌شده بی‌محتوا می‌شود', async () => {
    const m1 = await w.com.post(url('/chat'), { body: '  سلام از بازرگانی  ' });
    expect(m1.status).toBe(201);
    expect(m1.body.item).toMatchObject({ body: 'سلام از بازرگانی', userName: 'کاربر com1', deleted: false });
    const m2 = await w.exp.post(url('/chat'), { body: 'پیام کارشناس' });
    expect((await w.com.post(url('/chat'), { body: '   ' })).status).toBe(400);
    expect((await w.com.post(url('/chat'), { body: 'x'.repeat(4001) })).status).toBe(400);
    const list = await w.mgr.get(url('/chat'));
    expect(list.body.messages.map((m: { body: string }) => m.body)).toEqual(['سلام از بازرگانی', 'پیام کارشناس']);
    const after = await w.mgr.get(url(`/chat?after=${m1.body.item.id}`));
    expect(after.body.messages.length).toBe(1);
    // دیگران پیام را نمی‌توانند حذف کنند، مدیر پروژه (chat.moderate) می‌تواند
    expect((await w.fin.del(url(`/chat/${m2.body.item.id}`))).status).toBe(403);
    expect((await w.exp.del(url(`/chat/${m2.body.item.id}`))).status).toBe(200);
    expect((await w.pm.del(url(`/chat/${m1.body.item.id}`))).status).toBe(200);
    const final = await w.mgr.get(url('/chat'));
    expect(final.body.messages.every((m: { deleted: boolean; body: string }) => m.deleted && m.body === '')).toBe(true);
  });
});

describe('گزارش تغییرات', () => {
  it('فقط ادمین و مدیریت می‌بینند و فیلتر دارد', async () => {
    expect((await w.pm.get(url('/audit'))).status).toBe(403);
    expect((await w.fin.get(url('/audit'))).status).toBe(403);
    const all = await w.mgr.get(url('/audit?limit=500'));
    expect(all.status).toBe(200);
    const actions = new Set(all.body.entries.map((e: { action: string }) => e.action));
    for (const a of ['project.create', 'resource.create', 'task.insert', 'cost.create', 'baseline.set', 'contract.update', 'risk.create', 'chat.delete']) expect(actions).toContain(a);
    const costOnly = await w.admin.get(url('/audit?entity=cost'));
    expect(costOnly.body.entries.every((e: { entity: string }) => e.entity === 'cost')).toBe(true);
    const page1 = await w.admin.get(url('/audit?limit=5'));
    expect(page1.body.entries.length).toBe(5);
    expect(page1.body.nextBefore).toBeTruthy();
    const page2 = await w.admin.get(url(`/audit?limit=5&before=${page1.body.nextBefore}`));
    expect(page2.body.entries[0].id).toBeLessThan(page1.body.entries[4].id);
  });

  it('ممیزی از پایگاه‌داده قابل تغییر نیست', async () => {
    await expect(env.pool.query('UPDATE audit_log SET actor_name = $1', ['x'])).rejects.toThrow(/append-only/);
    await expect(env.pool.query('DELETE FROM audit_log')).rejects.toThrow(/append-only/);
  });
});
