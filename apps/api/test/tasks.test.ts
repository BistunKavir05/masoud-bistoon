import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { addTask, buildWorld, getModel, startEnv, taskOf } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env);
});
afterAll(async () => env.close());

const url = (p: string): string => `/api/projects/${w.pid}${p}`;

describe('ساختار فعالیت‌ها', () => {
  let phase = 0;
  let a = 0;
  let b = 0;
  let c = 0;

  it('درج خلاصه، زیرمجموعه و هم‌سطح؛ شماره‌ی ساختار با هر عملیات بالا می‌رود', async () => {
    const before = (await w.pm.get(url(''))).body.project.structureVersion;
    phase = (await addTask(w.pm, w.pid, { name: 'فاز ۱', kind: 'summary' })).id;
    a = (await addTask(w.pm, w.pid, { referenceId: phase, asChild: true, name: 'الف' })).id;
    b = (await addTask(w.pm, w.pid, { referenceId: a, asChild: false, name: 'ب' })).id;
    const last = await addTask(w.pm, w.pid, { referenceId: b, asChild: false, name: 'ج' });
    c = last.id;
    expect(last.tasks.map((t: { name: string }) => t.name)).toEqual(['فاز ۱', 'الف', 'ب', 'ج']);
    expect(last.tasks.map((t: { level: number }) => t.level)).toEqual([1, 2, 2, 2]);
    expect(last.tasks[0].kind).toBe('summary');
    expect(last.structureVersion).toBe(before + 4);
    expect(new Set([phase, a, b, c]).size).toBe(4);
  });

  it('نسخه‌ی کهنه‌ی ساختار رد می‌شود', async () => {
    const r = await w.pm.post(url('/tasks'), { referenceId: null, asChild: false, kind: 'task', name: 'x', structureVersion: 1 });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('STRUCTURE_CHANGED');
  });

  it('شناسه‌ی فعالیت حذف‌شده دوباره استفاده نمی‌شود', async () => {
    const t = await addTask(w.pm, w.pid, { referenceId: c, asChild: false, name: 'موقت' });
    const proj = (await w.pm.get(url(''))).body.project;
    expect((await w.pm.del(url(`/tasks/${t.id}`), { structureVersion: proj.structureVersion })).status).toBe(200);
    const again = await addTask(w.pm, w.pid, { referenceId: c, asChild: false, name: 'جایگزین' });
    expect(again.id).toBeGreaterThan(t.id);
  });

  it('جابه‌جایی، تورفتگی و بیرون‌زدگی', async () => {
    const sv = async () => (await w.pm.get(url(''))).body.project.structureVersion;
    const up = await w.pm.post(url(`/tasks/${c}/move`), { dir: -1, structureVersion: await sv() });
    expect(up.status).toBe(200);
    const names = up.body.tasks.map((t: { name: string }) => t.name);
    expect(names.indexOf('ج')).toBeLessThan(names.indexOf('ب'));
    // بیرون‌زدگی ج از فاز و برگشت
    const out = await w.pm.post(url(`/tasks/${c}/outdent`), { structureVersion: await sv() });
    expect(out.status).toBe(200);
    expect(out.body.tasks.find((t: { id: number }) => t.id === c).level).toBe(1);
    const inn = await w.pm.post(url(`/tasks/${c}/indent`), { structureVersion: await sv() });
    expect(inn.status).toBe(200);
    expect(inn.body.tasks.find((t: { id: number }) => t.id === c).level).toBe(2);
    const noop = await w.pm.post(url(`/tasks/${phase}/outdent`), { structureVersion: await sv() });
    expect(noop.status).toBe(400);
  });

  it('حذف خلاصه زیردرخت را برمی‌دارد و ارجاع پیش‌نیاز دیگران را پاک می‌کند', async () => {
    const g = await addTask(w.pm, w.pid, { name: 'فاز ۲', kind: 'summary' });
    const g1 = await addTask(w.pm, w.pid, { referenceId: g.id, asChild: true, name: 'درون فاز ۲' });
    const outside = await addTask(w.pm, w.pid, { referenceId: null, asChild: false, name: 'بیرونی' });
    const t = await taskOf(w.pm, w.pid, outside.id);
    const p = await w.pm.patch(url(`/tasks/${outside.id}`), { version: t.version, patch: { dependencies: [{ predecessorId: g1.id, type: 'FS', lag: 0 }] } });
    expect(p.status).toBe(200);
    const sv = (await w.pm.get(url(''))).body.project.structureVersion;
    const del = await w.pm.del(url(`/tasks/${g.id}`), { structureVersion: sv });
    expect(del.status).toBe(200);
    expect(del.body.removedIds.sort()).toEqual([g.id, g1.id].sort());
    const after = await taskOf(w.pm, w.pid, outside.id);
    expect(after.dependencies).toEqual([]);
    const m = await getModel(w.pm, w.pid);
    expect(m.tasks.find((x: { id: number }) => x.id === g1.id)).toBeUndefined();
  });

  it('فقط نقش دارای schedule.edit ساختار را تغییر می‌دهد', async () => {
    const sv = (await w.pm.get(url(''))).body.project.structureVersion;
    for (const who of [w.fin, w.com, w.exp, w.mgr]) {
      const r = await who.post(url('/tasks'), { referenceId: null, asChild: false, kind: 'task', name: 'نباید', structureVersion: sv });
      expect(r.status).toBe(403);
    }
  });
});

describe('ویرایش فعالیت', () => {
  let t1 = 0;
  let t2 = 0;
  beforeAll(async () => {
    t1 = (await addTask(w.pm, w.pid, { name: 'ویرایش ۱' })).id;
    t2 = (await addTask(w.pm, w.pid, { name: 'ویرایش ۲' })).id;
  });

  it('مدت و وابستگی را ثبت می‌کند، نسخه را بالا می‌برد و در ممیزی می‌آید', async () => {
    const cur = await taskOf(w.pm, w.pid, t2);
    const r = await w.pm.patch(url(`/tasks/${t2}`), { version: cur.version, patch: { duration: 5, dependencies: [{ predecessorId: t1, type: 'FS', lag: 2 }] } });
    expect(r.status).toBe(200);
    expect(r.body.task.version).toBe(cur.version + 1);
    expect(r.body.task.duration).toBe(5);
    expect(r.body.task.dependencies).toEqual([{ predecessorId: t1, type: 'FS', lag: 2 }]);
    const audit = await w.admin.get(url(`/audit?entity=task&entityId=${t2}&action=task.update`));
    expect(audit.body.entries.map((e: { field: string }) => e.field).sort()).toEqual(['dependencies', 'duration']);
    expect(audit.body.entries[0].actorName).toBe('کاربر pm1');
  });

  it('نسخه‌ی کهنه 409 با ردیف جاری می‌دهد', async () => {
    const cur = await taskOf(w.pm, w.pid, t1);
    expect((await w.pm.patch(url(`/tasks/${t1}`), { version: cur.version, patch: { name: 'نام جدید' } })).status).toBe(200);
    const stale = await w.pm.patch(url(`/tasks/${t1}`), { version: cur.version, patch: { name: 'نام دیگر' } });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('VERSION_CONFLICT');
    expect(stale.body.error.details.current.name).toBe('نام جدید');
  });

  it('ورودی‌های نامعتبر رد می‌شوند', async () => {
    const bad = async (patch: unknown) => w.pm.patch(url(`/tasks/${t1}`), { version: (await taskOf(w.pm, w.pid, t1)).version, patch });
    expect((await bad({ duration: 0 })).body.error.code).toBe('TASK_PATCH_INVALID');
    expect((await bad({ percentComplete: 101 })).body.error.code).toBe('TASK_PATCH_INVALID');
    expect((await bad({ name: '   ' })).body.error.code).toBe('TASK_PATCH_INVALID');
    expect((await bad({ dependencies: [{ predecessorId: 99999, type: 'FS', lag: 0 }] })).body.error.code).toBe('TASK_PATCH_INVALID');
    expect((await bad({ dependencies: [{ predecessorId: t1, type: 'FS', lag: 0 }] })).body.error.code).toBe('TASK_PATCH_INVALID');
    expect((await bad({ actualStart: '2026-13-40' })).body.error.code).toBe('VALIDATION');
    expect((await bad({ bogus: 1 })).body.error.code).toBe('VALIDATION');
    expect((await bad({})).body.error.code).toBe('EMPTY_PATCH');
    expect((await bad({ assignments: [{ resourceId: 987654, units: 100 }] })).body.error.code).toBe('UNKNOWN_RESOURCE');
  });

  it('وابستگی دایره‌ای ثبت نمی‌شود', async () => {
    const a = await taskOf(w.pm, w.pid, t1);
    // t2 بعد از t1 است؛ حالا t1 را بعد از t2 قرار می‌دهیم
    const r = await w.pm.patch(url(`/tasks/${t1}`), { version: a.version, patch: { dependencies: [{ predecessorId: t2, type: 'FS', lag: 0 }] } });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('CYCLE');
    expect((await taskOf(w.pm, w.pid, t1)).dependencies).toEqual([]);
  });

  it('۱۰۰٪ شروع واقعی را پر می‌کند و کاهش درصد پایان واقعی را پاک می‌کند', async () => {
    const t = (await addTask(w.pm, w.pid, { name: 'تمام‌شونده' })).id;
    let cur = await taskOf(w.pm, w.pid, t);
    const done = await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { percentComplete: 100, actualFinish: '2026-03-28' } });
    expect(done.status).toBe(200);
    expect(done.body.task).toMatchObject({ percentComplete: 100, actualFinish: '2026-03-28' });
    cur = done.body.task;
    const reopened = await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { percentComplete: 50 } });
    expect(reopened.status).toBe(200);
    expect(reopened.body.task).toMatchObject({ percentComplete: 50, actualFinish: null });
    expect(reopened.body.notes.length).toBe(1);
  });

  it('تبدیل به مایلستون و برگشت', async () => {
    const t = (await addTask(w.pm, w.pid, { name: 'نقطه' })).id;
    let cur = await taskOf(w.pm, w.pid, t);
    const ms = await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { isMilestone: true } });
    expect(ms.body.task).toMatchObject({ kind: 'milestone', duration: 0 });
    cur = ms.body.task;
    const back = await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { isMilestone: false } });
    expect(back.body.task).toMatchObject({ kind: 'task', duration: 1 });
  });

  it('فعالیت خلاصه فیلدهای مشتق را نمی‌پذیرد', async () => {
    const s = (await addTask(w.pm, w.pid, { name: 'گروه', kind: 'summary' })).id;
    const cur = await taskOf(w.pm, w.pid, s);
    const r = await w.pm.patch(url(`/tasks/${s}`), { version: cur.version, patch: { duration: 5 } });
    expect(r.status).toBe(400);
    expect(r.body.error.details.issues[0].code).toBe('SUMMARY_FIELD');
    expect((await w.pm.patch(url(`/tasks/${s}`), { version: cur.version, patch: { name: 'گروه جدید' } })).status).toBe(200);
  });

  it('فعالیت ناموجود 404 می‌دهد', async () => {
    expect((await w.pm.patch(url('/tasks/999999'), { version: 1, patch: { name: 'x' } })).status).toBe(404);
  });
});

describe('دسترسی ویرایش فعالیت', () => {
  let own = 0;
  let other = 0;
  beforeAll(async () => {
    own = (await addTask(w.pm, w.pid, { name: 'فعالیت کارشناس' })).id;
    other = (await addTask(w.pm, w.pid, { name: 'فعالیت دیگران' })).id;
    const cur = await taskOf(w.pm, w.pid, own);
    const r = await w.pm.patch(url(`/tasks/${own}`), { version: cur.version, patch: { assignments: [{ resourceId: w.expResourceId, units: 100 }], duration: 4 } });
    expect(r.status).toBe(200);
  });

  it('کارشناس پیشرفت فعالیت خودش را ثبت می‌کند و نه چیز دیگری', async () => {
    let cur = await taskOf(w.exp, w.pid, own);
    const ok = await w.exp.patch(url(`/tasks/${own}`), { version: cur.version, patch: { percentComplete: 40 } });
    expect(ok.status).toBe(200);
    cur = ok.body.task;
    const rename = await w.exp.patch(url(`/tasks/${own}`), { version: cur.version, patch: { name: 'تغییر نام' } });
    expect(rename.status).toBe(403);
    const mixed = await w.exp.patch(url(`/tasks/${own}`), { version: cur.version, patch: { percentComplete: 50, duration: 1 } });
    expect(mixed.status).toBe(403);
    const t = await taskOf(w.exp, w.pid, other);
    const notMine = await w.exp.patch(url(`/tasks/${other}`), { version: t.version, patch: { percentComplete: 10 } });
    expect(notMine.status).toBe(403);
    expect(notMine.body.error.code).toBe('NOT_YOUR_TASK');
  });

  it('مالی، بازرگانی و مدیریت فعالیت را ویرایش نمی‌کنند', async () => {
    const t = await taskOf(w.pm, w.pid, other);
    for (const who of [w.fin, w.com, w.mgr]) {
      const r = await who.patch(url(`/tasks/${other}`), { version: t.version, patch: { percentComplete: 10 } });
      expect(r.status).toBe(403);
    }
  });
});

describe('مدل و پالایش بر اساس نقش', () => {
  it('هر نقش فقط بخش‌های مجاز خودش را می‌گیرد', async () => {
    const pm = await getModel(w.pm, w.pid);
    expect(pm.tasks.length).toBeGreaterThan(3);
    expect(pm.commission).toBeUndefined();
    expect(pm.contract.salesCommissionPercent).toBeUndefined();
    expect(pm.contract.amount).toBe(0);
    expect(pm.costs).toBeUndefined();

    const fin = await getModel(w.fin, w.pid);
    expect(fin.costs).toEqual([]);
    expect(fin.commission).toBeTruthy();
    expect(fin.contract.salesCommissionPercent).toBe(0);
    expect(fin.risks).toEqual([]);
    expect(fin.charter).toBeTruthy();

    const com = await getModel(w.com, w.pid);
    expect(Object.keys(com).sort()).toEqual(['commission', 'contract', 'me', 'project', 'summary']);
    expect(com.summary.stages.length).toBeGreaterThan(0);
    expect(com.me.capabilities.sort()).toEqual(['chat.use', 'commission.view', 'contract.view', 'summary.view']);

    const exp = await getModel(w.exp, w.pid);
    expect(exp.tasks.length).toBe(pm.tasks.length);
    expect(exp.contract).toBeUndefined();
    expect(exp.commission).toBeUndefined();
    expect(exp.costs).toBeUndefined();
    expect(exp.resources[0].dailyRate).toBe(0);
    expect(pm.resources[0].dailyRate).toBe(1_000_000);
  });

  it('خلاصه‌ی وضعیت: درصد، مراحل و شمارش فعالیت‌ها', async () => {
    const m = await getModel(w.com, w.pid);
    const s = m.summary;
    expect(s.scheduleError).toBeNull();
    expect(s.counts.total).toBeGreaterThan(0);
    expect(s.counts.done + s.counts.inProgress + s.counts.notStarted).toBeLessThanOrEqual(s.counts.total);
    expect(s.actual).toBeGreaterThanOrEqual(0);
    expect(s.actual).toBeLessThanOrEqual(100);
    expect(['ok', 'watch', 'late', 'unknown']).toContain(s.health);
    expect(s.stages[0].wbs).toBe('1');
  });

  it('هزینه‌ی مستقیم برای نقش بدون دسترسی به هزینه پنهان است', async () => {
    const t = (await addTask(w.pm, w.pid, { name: 'با هزینه' })).id;
    const cur = await taskOf(w.pm, w.pid, t);
    const r = await w.pm.patch(url(`/tasks/${t}`), { version: cur.version, patch: { directCosts: [{ name: 'خرید', amount: 5000 }], legacyActualCost: 700 } });
    expect(r.status).toBe(200);
    expect((await taskOf(w.pm, w.pid, t)).directCosts).toEqual([{ name: 'خرید', amount: 5000 }]);
    const asExpert = await taskOf(w.exp, w.pid, t);
    expect(asExpert.directCosts).toEqual([]);
    expect(asExpert.legacyActualCost).toBeNull();
  });

  it('سازگاری: شناسه‌های فعالیت در سه نقش یکسان است', async () => {
    const ids = async (c: typeof w.pm) => (await getModel(c, w.pid)).tasks.map((t: { id: number }) => t.id);
    expect(await ids(w.exp)).toEqual(await ids(w.pm));
    expect(await ids(w.mgr)).toEqual(await ids(w.pm));
  });
});

describe('پروژه‌ی بایگانی‌شده', () => {
  it('همه‌ی نوشتن‌ها رد می‌شوند و خواندن ممکن است', async () => {
    const w2 = await buildWorld(env, 'بایگانی دوم');
    const t = await addTask(w2.pm, w2.pid, { name: 'یک' });
    const proj = (await w2.pm.get(`/api/projects/${w2.pid}`)).body.project;
    expect((await w2.pm.patch(`/api/projects/${w2.pid}`, { archived: true, version: proj.version })).status).toBe(200);
    const sv = (await w2.pm.get(`/api/projects/${w2.pid}`)).body.project.structureVersion;
    const r = await w2.pm.post(`/api/projects/${w2.pid}/tasks`, { referenceId: null, asChild: false, kind: 'task', name: 'نه', structureVersion: sv });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ARCHIVED');
    expect((await w2.pm.get(`/api/projects/${w2.pid}/model`)).status).toBe(200);
    expect(t.id).toBeGreaterThan(0);
  });
});
