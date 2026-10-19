import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { defaultRecurrence } from '@bistoon/core';
import type { RecurrencePattern } from '@bistoon/core';
import { addTask, buildWorld, getModel, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env);
});
afterAll(async () => env.close());

const url = (p: string): string => `/api/projects/${w.pid}${p}`;
const sv = async (): Promise<number> => (await w.pm.get(url(''))).body.project.structureVersion;
const pattern = (over: Partial<RecurrencePattern> = {}): RecurrencePattern => ({ ...defaultRecurrence('2026-03-21'), name: 'جلسه‌ی هماهنگی', count: 4, ...over });
const create = async (p: RecurrencePattern, extra: Record<string, unknown> = {}) =>
  w.pm.post(url('/tasks/recurring'), { pattern: p, referenceId: null, asChild: false, structureVersion: await sv(), ...extra });
const update = async (id: number, p: RecurrencePattern) => w.pm.put(url(`/tasks/${id}/recurring`), { pattern: p, structureVersion: await sv() });
const ids = (tasks: { id: number }[]): number[] => tasks.map((t) => t.id);
const fails = async (p: Promise<unknown>): Promise<boolean> => {
  try {
    await p;
    return false;
  } catch {
    return true;
  }
};
const actions = async (): Promise<{ action: string; details: any; newValue: any }[]> => (await w.admin.get(url('/audit?limit=500'))).body.entries;

describe('ساخت گروه تکرارشونده', () => {
  let group = 0;
  let kids: number[] = [];
  let tail = 0;

  it('گروه و رخدادها با قید «شروع نه زودتر از»، الگو روی گروه و ثبت در سابقه', async () => {
    const r = await create(pattern({ weighted: true, resource: { resourceId: w.expResourceId, units: 50 } }));
    expect(r.status).toBe(200);
    group = r.body.summaryId;
    kids = r.body.addedIds;
    expect(r.body.tasks).toHaveLength(5);
    expect(r.body.tasks[0]).toMatchObject({ id: group, kind: 'summary', level: 1, name: 'جلسه‌ی هماهنگی' });
    expect(r.body.tasks[0].recurrence).toMatchObject({ type: 'weekly', count: 4, weighted: true });
    expect(r.body.dates).toHaveLength(4);
    expect(kids).toHaveLength(4);
    r.body.tasks.slice(1).forEach((t: any, k: number) => {
      expect(t).toMatchObject({ level: 2, kind: 'task', name: `جلسه‌ی هماهنگی ${k + 1}`, startNoEarlierThan: r.body.dates[k], startNoEarlierSource: 'manual', weight: 1, recurrence: null });
      expect(t.assignments).toEqual([{ resourceId: w.expResourceId, units: 50 }]);
    });
    const m = await getModel(w.pm, w.pid);
    expect(m.tasks.find((t: any) => t.id === group).recurrence.name).toBe('جلسه‌ی هماهنگی');
    const entry = (await actions()).find((e) => e.action === 'task.recurring.create')!;
    expect(entry.newValue).toMatchObject({ occurrences: 4, first: r.body.dates[0], last: r.body.dates[3] });
  });

  it('شمارنده‌ی شناسه جلو می‌رود و فعالیت بعدی شناسه‌ی تازه می‌گیرد', async () => {
    const next = await addTask(w.pm, w.pid, { referenceId: group, asChild: false, name: 'بعد از گروه' });
    tail = next.id;
    expect(next.id).toBeGreaterThan(Math.max(...kids));
    const order = ids(next.tasks);
    expect(order.slice(0, 6)).toEqual([group, ...kids, next.id]);
  });

  it('درج گروه دوم در جای دیگر: زیر یک گروه موجود', async () => {
    const r = await create(pattern({ name: 'گزارش ماهانه', type: 'monthly', monthMode: 'day', monthDay: 5, count: 2 }), { referenceId: group, asChild: true });
    expect(r.status).toBe(200);
    expect(r.body.tasks.find((t: any) => t.id === r.body.summaryId)).toMatchObject({ level: 2, kind: 'summary' });
    const kidLevels = r.body.addedIds.map((id: number) => r.body.tasks.find((t: any) => t.id === id).level);
    expect(kidLevels).toEqual([3, 3]);
    // پاک‌کردن دوباره برای ادامه‌ی آزمون‌ها
    const del = await w.pm.del(url(`/tasks/${r.body.summaryId}`), { structureVersion: await sv() });
    expect(del.status).toBe(200);
  });

  it('فقط ادمین و مدیر پروژه؛ سایر نقش‌ها 403', async () => {
    const body = { pattern: pattern(), referenceId: null, asChild: false, structureVersion: await sv() };
    for (const c of [w.fin, w.com, w.exp, w.mgr]) expect((await c.post(url('/tasks/recurring'), body)).status).toBe(403);
    expect((await w.exp.put(url(`/tasks/${group}/recurring`), { pattern: pattern(), structureVersion: await sv() })).status).toBe(403);
    expect((await w.admin.post(url('/tasks/recurring'), body)).status).toBe(200);
    // رخدادهای گروه مدیر ادمین برای ادامه حذف می‌شوند
    const m = await getModel(w.pm, w.pid);
    const extra = m.tasks.find((t: any) => t.recurrence && t.id !== group);
    expect((await w.pm.del(url(`/tasks/${extra.id}`), { structureVersion: await sv() })).status).toBe(200);
  });

  it('الگوی نامعتبر، بدون رخداد، منبع ناموجود و نسخه‌ی کهنه', async () => {
    const bad = await create(pattern({ weekdays: [] }));
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('RECURRENCE_INVALID');
    expect(bad.body.error.message).toBe('حداقل یک روز هفته را انتخاب کنید.');
    const none = await create(pattern({ type: 'daily', start: '2040-01-01' }));
    expect(none.status).toBe(400);
    expect(none.body.error.code).toBe('RECURRENCE_NO_DATES');
    expect(none.body.error.message).toBe('با این الگو هیچ رخدادی ساخته نشد؛ بازه‌ی زمانی و تقویم را بررسی کنید.');
    const res = await create(pattern({ resource: { resourceId: 999, units: 100 } }));
    expect(res.body.error.code).toBe('UNKNOWN_RESOURCE');
    const stale = await w.pm.post(url('/tasks/recurring'), { pattern: pattern(), referenceId: null, asChild: false, structureVersion: 1 });
    expect(stale.status).toBe(409);
    expect(stale.body.error.code).toBe('STRUCTURE_CHANGED');
    expect((await create(pattern(), { referenceId: 99999 })).body.error.code).toBe('RECURRENCE_NOT_FOUND');
    // شکل نادرست بدنه (ردیابی با zod)
    expect((await w.pm.post(url('/tasks/recurring'), { pattern: { name: 'x' }, referenceId: null, asChild: false, structureVersion: await sv() })).status).toBe(400);
  });

  it('هیچ‌یک از درخواست‌های ناموفق چیزی ننوشت', async () => {
    const m = await getModel(w.pm, w.pid);
    expect(m.tasks.filter((t: any) => t.recurrence)).toHaveLength(1);
    expect(m.tasks.map((t: any) => t.name)).toEqual(['جلسه‌ی هماهنگی', ...[1, 2, 3, 4].map((k) => `جلسه‌ی هماهنگی ${k}`), 'بعد از گروه']);
  });

  describe('ویرایش الگو', () => {
    it('پیشرفت و پیش‌نیاز رخداد حفظ می‌شود؛ نام و مدت عوض می‌شود', async () => {
      const m0 = await getModel(w.pm, w.pid);
      const second = m0.tasks.find((t: any) => t.id === kids[1]);
      const prog = await w.pm.patch(url(`/tasks/${kids[1]}`), { version: second.version, patch: { percentComplete: 40, actualStart: '2026-03-25' } });
      expect(prog.status).toBe(200);
      const third = m0.tasks.find((t: any) => t.id === kids[2]);
      expect((await w.pm.patch(url(`/tasks/${kids[2]}`), { version: third.version, patch: { dependencies: [{ predecessorId: kids[0], type: 'FS', lag: 0 }] } })).status).toBe(200);

      const r = await update(group, pattern({ name: 'جلسه‌ی هفتگی', duration: 2, count: 4 }));
      expect(r.status).toBe(200);
      expect(r.body.keptIds).toEqual(kids);
      expect(r.body.addedIds).toEqual([]);
      expect(r.body.removedIds).toEqual([]);
      const t2 = r.body.tasks.find((t: any) => t.id === kids[1]);
      expect(t2).toMatchObject({ name: 'جلسه‌ی هفتگی 2', duration: 2, percentComplete: 40, actualStart: '2026-03-25', startNoEarlierThan: null });
      expect(r.body.tasks.find((t: any) => t.id === kids[2]).dependencies).toEqual([{ predecessorId: kids[0], type: 'FS', lag: 0 }]);
      expect(r.body.tasks.find((t: any) => t.id === group).name).toBe('جلسه‌ی هفتگی');
      const entry = (await actions()).find((e) => e.action === 'task.recurring.update')!;
      expect(entry.details).toEqual({ added: 0, removed: 0, kept: 4 });
      expect(entry.newValue).toMatchObject({ name: 'جلسه‌ی هفتگی', occurrences: 4 });
    });

    it('افزایش تعداد: شناسه‌های تازه از شمارنده؛ کاهش: رخدادهای آخر حذف', async () => {
      const up = await update(group, pattern({ name: 'جلسه‌ی هفتگی', duration: 2, count: 6 }));
      expect(up.status).toBe(200);
      expect(up.body.addedIds).toHaveLength(2);
      expect(Math.min(...up.body.addedIds)).toBeGreaterThan(Math.max(...kids));
      expect(ids(up.body.tasks).slice(0, 7)).toEqual([group, ...kids, ...up.body.addedIds]);
      const afterAdd = await addTask(w.pm, w.pid, { referenceId: tail, asChild: false, name: 'تازه' });
      expect(afterAdd.id).toBeGreaterThan(Math.max(...up.body.addedIds));

      const down = await update(group, pattern({ name: 'جلسه‌ی هفتگی', duration: 2, count: 3 }));
      expect(down.status).toBe(200);
      expect(down.body.removedIds).toEqual([kids[3], ...up.body.addedIds]);
      expect(down.body.keptIds).toEqual(kids.slice(0, 3));
      expect(ids(down.body.tasks).slice(0, 4)).toEqual([group, ...kids.slice(0, 3)]);
      const rows = await env.pool.query('SELECT count(*)::int AS n FROM tasks WHERE project_id = $1 AND recurrence IS NOT NULL', [w.pid]);
      expect(rows.rows[0].n).toBe(1);
    });

    it('رخدادی که هزینه دارد حذف نمی‌شود و چیزی تغییر نمی‌کند', async () => {
      const cost = await w.pm.post(url('/costs'), { date: '2026-04-02', taskId: kids[2], amount: 5000, description: 'پذیرایی' });
      expect(cost.status).toBe(201);
      const before = await getModel(w.pm, w.pid);
      const r = await update(group, pattern({ name: 'جلسه‌ی هفتگی', duration: 2, count: 2 }));
      expect(r.status).toBe(409);
      expect(r.body.error.code).toBe('TASK_HAS_COSTS');
      expect(await getModel(w.pm, w.pid)).toEqual(before);
    });

    it('فعالیت عادی یا ناموجود: خطای روشن؛ الگوی نامعتبر', async () => {
      const normal = (await getModel(w.pm, w.pid)).tasks.find((t: any) => t.name === 'بعد از گروه');
      expect((await update(normal.id, pattern())).body.error.code).toBe('RECURRENCE_NOT_RECURRING');
      expect((await update(98765, pattern())).body.error.code).toBe('RECURRENCE_NOT_FOUND');
      expect((await update(group, pattern({ duration: 0 }))).body.error.code).toBe('RECURRENCE_INVALID');
    });
  });
});

describe('ذخیره و بازیابی', () => {
  it('پشتیبان JSON الگو را نگه می‌دارد و بازیابی همان را می‌سازد', async () => {
    const exp = await w.admin.get(url('/export'));
    expect(exp.status).toBe(200);
    const group = exp.body.model.tasks.find((t: any) => t.recurrence);
    expect(group.recurrence.name).toBe('جلسه‌ی هفتگی');
    const imp = await w.admin.post('/api/import/project', exp.body);
    expect(imp.status).toBe(201);
    expect(imp.body.warnings.filter((x: any) => String(x.code).startsWith('RECURRENCE'))).toEqual([]);
    const m = await getModel(w.admin, imp.body.projectId);
    expect(m.tasks.find((t: any) => t.id === group.id).recurrence).toEqual(group.recurrence);
  });

  it('پشتیبان بدون فیلد recurrence (نسخه‌ی پیشین) وارد می‌شود', async () => {
    const exp = await w.admin.get(url('/export'));
    for (const t of exp.body.model.tasks) delete t.recurrence;
    const imp = await w.admin.post('/api/import/project', exp.body);
    expect(imp.status).toBe(201);
    expect((await getModel(w.admin, imp.body.projectId)).tasks.every((t: any) => t.recurrence === null)).toBe(true);
  });

  it('الگوی ناسالم در پشتیبان با هشدار حذف می‌شود، نه با شکست کل ورود', async () => {
    const exp = await w.admin.get(url('/export'));
    const g = exp.body.model.tasks.find((t: any) => t.recurrence);
    g.recurrence.every = 0;
    const imp = await w.admin.post('/api/import/project', exp.body);
    expect(imp.status).toBe(201);
    expect(imp.body.warnings.map((x: any) => x.code)).toContain('RECURRENCE_DROPPED');
    expect((await getModel(w.admin, imp.body.projectId)).tasks.find((t: any) => t.id === g.id).recurrence).toBeNull();
  });

  it('ورود از نسخه‌ی قدیمی: الگوی rec به الگوی جدید تبدیل و ذخیره می‌شود؛ الگوی خراب با هشدار می‌افتد', async () => {
    const rec = { nm: 'جلسه', dur: 2, type: 'w', every: 1, wd: [6], md: 'day', mday: 1, mord: 1, mwd: 6, ym: 1, yd: 1, st: '2026-03-21', em: 'n', cnt: 3, end: '', res: '', wt: false, loe: false };
    const doc = {
      ver: 34,
      name: 'قدیمی با تکرار',
      start: '2026-03-21',
      status: '2026-04-10',
      res: [],
      tasks: [
        { id: 1, name: 'جلسه', lv: 1, sm: 1, rec },
        { id: 2, name: 'جلسه 1', lv: 2, dur: 2 },
        { id: 3, name: 'جلسه 2', lv: 2, dur: 2 },
        { id: 4, name: 'خراب', lv: 1, sm: 1, rec: { ...rec, st: 'نامعتبر' } },
        { id: 5, name: 'زیر خراب', lv: 2, dur: 1 },
      ],
      users: [],
    };
    const imp = await w.admin.post('/api/import/legacy', doc);
    expect(imp.status).toBe(201);
    const m = await getModel(w.admin, imp.body.projectId);
    const good = m.tasks.find((t: any) => t.id === 1);
    expect(good.recurrence).toMatchObject({ name: 'جلسه', duration: 2, type: 'weekly', weekdays: [6], count: 3, start: '2026-03-21' });
    expect(m.tasks.find((t: any) => t.id === 4).recurrence).toBeNull();
    expect(imp.body.warnings.map((x: any) => x.code)).toContain('RECURRENCE_DROPPED');
    // الگوی واردشده قابل ویرایش است
    const sv2 = (await w.admin.get(`/api/projects/${imp.body.projectId}`)).body.project.structureVersion;
    const up = await w.admin.put(`/api/projects/${imp.body.projectId}/tasks/1/recurring`, { pattern: { ...good.recurrence, count: 4 }, structureVersion: sv2 });
    expect(up.status).toBe(200);
    expect(up.body.addedIds).toHaveLength(2);
  });

  it('پایگاه‌داده الگو را فقط روی فعالیت خلاصه می‌پذیرد', async () => {
    expect(await fails(env.pool.query(`UPDATE tasks SET recurrence = '{}'::jsonb WHERE project_id = $1 AND kind = 'task'`, [w.pid]))).toBe(true);
    expect(await fails(env.pool.query(`UPDATE tasks SET recurrence = '[]'::jsonb WHERE project_id = $1 AND kind = 'summary'`, [w.pid]))).toBe(true);
  });

  it('ویرایش عادی فعالیت نمی‌تواند الگو را تغییر دهد', async () => {
    const m = await getModel(w.pm, w.pid);
    const g = m.tasks.find((t: any) => t.recurrence);
    const r = await w.pm.patch(url(`/tasks/${g.id}`), { version: g.version, patch: { recurrence: null } });
    expect(r.status).toBe(400);
  });
});
