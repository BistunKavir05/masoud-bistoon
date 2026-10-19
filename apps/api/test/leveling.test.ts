import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { levelResources } from '@bistoon/core';
import { addTask, buildWorld, getModel, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
let a = 0;
let b = 0;
let manual = 0;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env);
});
afterAll(async () => env.close());

const url = (p: string): string => `/api/projects/${w.pid}${p}`;

async function patch(id: number, p: Record<string, unknown>): Promise<void> {
  const m = await getModel(w.pm, w.pid);
  const t = m.tasks.find((x: { id: number }) => x.id === id);
  const r = await w.pm.patch(url(`/tasks/${id}`), { version: t.version, patch: p });
  if (r.status !== 200) throw new Error(`patch failed ${JSON.stringify(r.body)}`);
}

/** همان پیشنهادی که کلاینت از روی بسته‌ی مدل می‌سازد */
async function suggestion(): Promise<{ taskId: number; startNoEarlierThan: string }[]> {
  const m = await getModel(w.pm, w.pid);
  const r = levelResources({ start: m.project.start, status: m.project.status, calendar: m.calendar, tasks: m.tasks }, m.resources);
  return (r?.suggestions ?? []).map((s) => ({ taskId: s.taskId, startNoEarlierThan: s.startNoEarlierThan }));
}

describe('تسطیح منابع', () => {
  it('دو فعالیت هم‌زمان با یک منبع بیش‌تخصیص می‌دهند و پیشنهاد یکی را عقب می‌برد', async () => {
    a = (await addTask(w.pm, w.pid, { name: 'الف' })).id;
    b = (await addTask(w.pm, w.pid, { name: 'ب' })).id;
    manual = (await addTask(w.pm, w.pid, { name: 'دستی' })).id;
    for (const id of [a, b]) await patch(id, { duration: 5, assignments: [{ resourceId: w.expResourceId, units: 100 }] });
    const s = await suggestion();
    expect(s.length).toBe(1);
  });

  it('پیشنهاد نامطابق (کهنه) رد می‌شود و چیزی تغییر نمی‌کند', async () => {
    const s = await suggestion();
    const r = await w.pm.post(url('/leveling/apply'), { moves: [{ taskId: s[0]!.taskId, startNoEarlierThan: '2030-01-01' }] });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('LEVELING_STALE');
    const m = await getModel(w.pm, w.pid);
    expect(m.tasks.every((t: { startNoEarlierThan: string | null }) => t.startNoEarlierThan === null)).toBe(true);
  });

  it('کارشناس و بازرگانی نمی‌توانند اعمال کنند', async () => {
    const s = await suggestion();
    expect((await w.exp.post(url('/leveling/apply'), { moves: s })).status).toBe(403);
    expect((await w.com.post(url('/leveling/clear'), {})).status).toBe(403);
  });

  it('اعمال پیشنهاد: قید با منشأ تسطیح ثبت می‌شود و دیگر بیش‌تخصیصی نیست', async () => {
    const s = await suggestion();
    const r = await w.pm.post(url('/leveling/apply'), { moves: s });
    expect(r.status).toBe(200);
    expect(r.body.applied).toBe(1);
    const moved = r.body.tasks.find((t: { id: number }) => t.id === s[0]!.taskId);
    expect(moved.startNoEarlierThan).toBe(s[0]!.startNoEarlierThan);
    expect(moved.startNoEarlierSource).toBe('leveling');
    expect((await suggestion()).length).toBe(0);
    const audit = await w.admin.get(url('/audit'));
    expect(audit.status).toBe(200);
    expect(JSON.stringify(audit.body)).toContain('startNoEarlierThan');
  });

  it('پاک‌کردن فقط قیدهای تسطیح را برمی‌دارد و قید دستی می‌ماند', async () => {
    await patch(manual, { startNoEarlierThan: '2026-06-01' });
    const r = await w.pm.post(url('/leveling/clear'), {});
    expect(r.status).toBe(200);
    expect(r.body.cleared).toBe(1);
    const byId = new Map(r.body.tasks.map((t: { id: number }) => [t.id, t]));
    expect((byId.get(manual) as { startNoEarlierThan: string; startNoEarlierSource: string }).startNoEarlierSource).toBe('manual');
    expect((byId.get(manual) as { startNoEarlierThan: string }).startNoEarlierThan).toBe('2026-06-01');
    expect(r.body.tasks.some((t: { startNoEarlierSource: string | null }) => t.startNoEarlierSource === 'leveling')).toBe(false);
    // بار دوم چیزی برای پاک‌کردن نیست
    expect((await w.pm.post(url('/leveling/clear'), {})).body.cleared).toBe(0);
  });
});
