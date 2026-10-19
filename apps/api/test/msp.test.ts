import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { buildMspXml } from '@bistoon/core';
import { addTask, buildWorld, getModel, startEnv } from './helpers.ts';
import type { Client, TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env, 'پروژه‌ی میزبان');
});
afterAll(async () => env.close());

interface Row {
  uid: number;
  name: string;
  level?: number;
  summary?: boolean;
  milestone?: boolean;
  dur?: number;
  preds?: number[];
  extra?: string;
}

/** فایل کوچک MSPDI؛ UID ۰ ردیف خلاصه‌ی پروژه است */
const xmlFor = (rows: Row[], name = 'فایل آزمون'): string =>
  `<Project xmlns="http://schemas.microsoft.com/project"><Name>${name}</Name><StartDate>2026-09-01T07:30:00</StartDate><MinutesPerDay>480</MinutesPerDay><Tasks><Task><UID>0</UID><Summary>1</Summary></Task>` +
  rows
    .map(
      (r) =>
        `<Task><UID>${r.uid}</UID><Name>${r.name}</Name><OutlineLevel>${r.level ?? 1}</OutlineLevel><Summary>${r.summary ? 1 : 0}</Summary><Milestone>${r.milestone ? 1 : 0}</Milestone><Duration>PT${(r.dur ?? 1) * 8}H0M0S</Duration>` +
        (r.preds ?? []).map((p) => `<PredecessorLink><PredecessorUID>${p}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>`).join('') +
        `${r.extra ?? ''}</Task>`,
    )
    .join('') +
  '</Tasks></Project>';

const BASE_ROWS: Row[] = [
  { uid: 1, name: 'گروه', summary: true },
  { uid: 2, name: 'الف', level: 2, dur: 2 },
  { uid: 3, name: 'ب', level: 2, dur: 3, preds: [2] },
  { uid: 4, name: 'پ', level: 2, milestone: true, preds: [3] },
];
const BASE = xmlFor(BASE_ROWS);

const ids = (m: any): number[] => m.tasks.map((t: { id: number }) => t.id);
const names = (m: any): string[] => m.tasks.map((t: { name: string }) => t.name);
const codes = (xs: { code: string }[]): string[] => xs.map((x) => x.code);

async function projectCount(): Promise<number> {
  return Number((await env.pool.query('SELECT count(*)::int AS n FROM projects')).rows[0].n);
}
async function auditActions(c: Client, pid: number): Promise<string[]> {
  const a = await c.get(`/api/projects/${pid}/audit?limit=500`);
  return a.body.entries.map((e: { action: string }) => e.action);
}

describe('ورود MSP به‌عنوان پروژه‌ی جدید', () => {
  it('فقط ادمین سیستم؛ فایل نامعتبر با کد روشن رد می‌شود', async () => {
    expect((await w.pm.post('/api/import/msp', { xml: BASE })).status).toBe(403);
    expect((await w.admin.post('/api/import/msp', { xml: '<html><body>این پروژه نیست</body></html>' })).body.error.code).toBe('MSP_INVALID');
    const doctype = await w.admin.post('/api/import/msp', { xml: '<!DOCTYPE x [<!ENTITY a "b">]><Project><Name>x</Name></Project>' });
    expect(doctype.status).toBe(400);
    expect(doctype.body.error.code).toBe('MSP_INVALID');
    expect((await w.admin.post('/api/import/msp', { xml: 'کوتاه' })).status).toBe(400);
  });

  it('dryRun: خلاصه و هشدار برمی‌گرداند و هیچ پروژه‌ای نمی‌سازد', async () => {
    const before = await projectCount();
    const r = await w.admin.post('/api/import/msp', { xml: BASE, dryRun: true });
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.name).toBe('فایل آزمون');
    expect(r.body.summary.rows).toBe(4);
    expect(r.body.summary.schedule.ok).toBe(true);
    expect(await projectCount()).toBe(before);
  });

  it('ساخت پروژه: شناسه = UID فایل، نام دلخواه، ممیزی و شمارنده', async () => {
    const r = await w.admin.post('/api/import/msp', { xml: BASE, name: 'پروژه‌ی واردشده', unit: 'ریال' });
    expect(r.status).toBe(201);
    const pid: number = r.body.projectId;
    const m = await getModel(w.admin, pid);
    expect(m.project.name).toBe('پروژه‌ی واردشده');
    expect(ids(m)).toEqual([1, 2, 3, 4]);
    expect(m.tasks.map((t: { kind: string }) => t.kind)).toEqual(['summary', 'task', 'task', 'milestone']);
    expect(m.tasks[2].dependencies).toEqual([{ predecessorId: 2, type: 'FS', lag: 0 }]);
    expect(m.summary.scheduleError).toBeNull();
    expect(await auditActions(w.admin, pid)).toContain('project.import.msp');
    // فعالیت بعدی از شناسه‌ی ۵ ادامه می‌یابد
    expect((await addTask(w.admin, pid, { referenceId: 4, name: 'تازه' })).id).toBe(5);
  });

  it('نام پروژه از فایل می‌آید و بدون نام در فایل، نام لازم است', async () => {
    const r = await w.admin.post('/api/import/msp', { xml: BASE });
    expect(r.status).toBe(201);
    expect((await getModel(w.admin, r.body.projectId)).project.name).toBe('فایل آزمون');
    const noName = BASE.replace('<Name>فایل آزمون</Name>', '');
    const bad = await w.admin.post('/api/import/msp', { xml: noName });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe('NAME_REQUIRED');
    expect((await w.admin.post('/api/import/msp', { xml: noName, name: 'با نام' })).status).toBe(201);
  });

  it('رفت‌وبرگشت: خروجی XML پروژه دوباره وارد می‌شود با همان ساختار', async () => {
    const src = (await w.admin.post('/api/import/msp', { xml: BASE, name: 'مبدأ' })).body.projectId;
    const exp = (await w.admin.get(`/api/projects/${src}/export`)).body;
    const out = buildMspXml(exp.model);
    if (!out.ok) throw new Error(out.error);
    const back = await w.admin.post('/api/import/msp', { xml: out.xml, name: 'برگشت' });
    expect(back.status).toBe(201);
    const a = await getModel(w.admin, src);
    const b = await getModel(w.admin, back.body.projectId);
    expect(names(b)).toEqual(names(a));
    expect(b.tasks.map((t: { duration: number }) => t.duration)).toEqual(a.tasks.map((t: { duration: number }) => t.duration));
    expect(b.tasks.map((t: { dependencies: unknown }) => t.dependencies)).toEqual(a.tasks.map((t: { dependencies: unknown }) => t.dependencies));
  });
});

describe('ورود MSP به پروژه‌ی موجود', () => {
  let pid = 0;
  const post = (c: Client, path: string, body: unknown) => c.post(`/api/projects/${pid}/import/msp${path}`, body);

  beforeAll(async () => {
    pid = (await w.admin.post('/api/import/msp', { xml: BASE, name: 'پروژه‌ی هدف' })).body.projectId;
    await w.admin.put(`/api/projects/${pid}/members/${w.ids['pm1']}`, { roles: ['pm'] });
    await w.admin.put(`/api/projects/${pid}/members/${w.ids['fin1']}`, { roles: ['finance'] });
  });

  it('فقط نقش دارای data.import (ادمین)؛ مدیر پروژه و مالی ۴۰۳', async () => {
    expect((await post(w.pm, '/preview', { xml: BASE })).status).toBe(403);
    expect((await post(w.fin, '/preview', { xml: BASE })).status).toBe(403);
    expect((await post(w.pm, '', { xml: BASE, token: 'a'.repeat(32), confirm: true })).status).toBe(403);
    expect((await post(w.exp, '/preview', { xml: BASE })).status).toBe(404); // عضو پروژه نیست
  });

  it('پیش‌نمایش همان فایل: نگاشت پیشنهادی بر پایه‌ی شناسه، بدون تغییر، با توکن و اثرها', async () => {
    const r = await post(w.admin, '/preview', { xml: BASE });
    expect(r.status).toBe(200);
    expect(r.body.mapping.suggested).toBe('id');
    expect(r.body.mapping.used).toBe('id');
    expect(r.body.result).toMatchObject({ rows: 4, matched: 4, added: 0 });
    expect(r.body.result.removed.count).toBe(0);
    expect(r.body.blockers).toEqual([]);
    expect(r.body.token.length).toBe(32);
    expect(r.body.effects.length).toBeGreaterThan(3);
    // پیش‌نمایش چیزی را عوض نکرد
    expect(names(await getModel(w.admin, pid))).toEqual(['گروه', 'الف', 'ب', 'پ']);
    expect(await auditActions(w.admin, pid)).not.toContain('project.import.msp.preview');
  });

  it('توکن یا تأیید نادرست: اعمال رد می‌شود و پروژه دست‌نخورده می‌ماند', async () => {
    const noConfirm = await post(w.admin, '', { xml: BASE, token: 'a'.repeat(32) });
    expect(noConfirm.status).toBe(400);
    const prev = await post(w.admin, '/preview', { xml: BASE });
    const wrong = await post(w.admin, '', { xml: BASE, token: 'b'.repeat(32), confirm: true });
    expect(wrong.status).toBe(409);
    expect(wrong.body.error.code).toBe('PLAN_CHANGED');
    // توکن مال فایل دیگری است
    const other = xmlFor(BASE_ROWS.map((r) => (r.uid === 3 ? { ...r, name: 'ب۲' } : r)));
    const wrong2 = await post(w.admin, '', { xml: other, token: prev.body.token, confirm: true });
    expect(wrong2.body.error.code).toBe('PLAN_CHANGED');
    expect(names(await getModel(w.admin, pid))).toEqual(['گروه', 'الف', 'ب', 'پ']);
  });

  it('فایل نامعتبر در اعمال: ۴۰۰ و بدون تغییر', async () => {
    const r = await post(w.admin, '', { xml: '<Project><Tasks></Project>', token: 'a'.repeat(32), confirm: true });
    expect(r.status).toBe(400);
    expect(r.body.error.code).toBe('MSP_INVALID');
  });

  it('اعمال: تغییر نام، فعالیت تازه با شناسه‌ی تازه، حذف بدون هزینه، ممیزی و افزایش نسخه‌ی ساختار', async () => {
    const edited = xmlFor([
      { uid: 1, name: 'گروه', summary: true },
      { uid: 2, name: 'الف (بازنگری)', level: 2, dur: 4 },
      { uid: 3, name: 'ب', level: 2, dur: 3, preds: [2] },
      { uid: 9, name: 'تازه', level: 2, dur: 2, preds: [3] },
    ]);
    const before = (await w.admin.get(`/api/projects/${pid}`)).body.project;
    // یک نام از سه نام عوض شده؛ نگاشت پیشنهادی در این حالت «هم‌نام» است و کاربر صریحاً «هم‌شناسه» را برمی‌گزیند
    expect((await post(w.admin, '/preview', { xml: edited })).body.mapping.suggested).toBe('name');
    const prev = await post(w.admin, '/preview', { xml: edited, mapping: 'id' });
    expect(prev.body.mapping.used).toBe('id');
    expect(prev.body.result).toMatchObject({ rows: 4, matched: 3, added: 1 });
    expect(prev.body.result.removed.items.map((x: { id: number }) => x.id)).toEqual([4]);
    expect(prev.body.result.renamed.count).toBe(1);
    expect(prev.body.blockers).toEqual([]);

    const r = await post(w.admin, '', { xml: edited, mapping: 'id', token: prev.body.token, confirm: true });
    expect(r.status).toBe(200);
    expect(r.body.result).toMatchObject({ rows: 4, matched: 3, added: 1, removed: 1 });

    const m = await getModel(w.admin, pid);
    expect(names(m)).toEqual(['گروه', 'الف (بازنگری)', 'ب', 'تازه']);
    // شناسه‌ی فعالیت تازه از شمارنده است (نه UID فایل) و شناسه‌ی حذف‌شده دوباره به کار نمی‌رود
    expect(ids(m)).toEqual([1, 2, 3, 5]);
    expect(m.tasks[3].dependencies).toEqual([{ predecessorId: 3, type: 'FS', lag: 0 }]);
    expect(m.tasks[1].duration).toBe(4);
    expect((await addTask(w.admin, pid, { referenceId: 5, name: 'بعدی' })).id).toBe(6);

    const after = (await w.admin.get(`/api/projects/${pid}`)).body.project;
    expect(after.structureVersion).toBeGreaterThan(before.structureVersion);
    const audit = await w.admin.get(`/api/projects/${pid}/audit?limit=500`);
    const imp = audit.body.entries.find((e: { action: string }) => e.action === 'project.import.msp');
    expect(imp).toBeTruthy();
    expect(imp.newValue).toMatchObject({ rows: 4, matched: 3, added: 1, removed: 1, mapping: 'id' });
    expect(imp.details.removed).toEqual([{ id: 4, name: 'پ' }]);
    expect(imp.details.renamed).toEqual([{ id: 2, from: 'الف', to: 'الف (بازنگری)' }]);
  });

  it('خط مبنای فایل جایگزین خط مبنای فعلی می‌شود و قبلی بایگانی می‌ماند', async () => {
    const bl = (s: string): string => `<Baseline><Number>0</Number><Start>${s}T07:30:00</Start><Finish>${s}T15:00:00</Finish><Duration>PT8H0M0S</Duration></Baseline>`;
    const withBase = xmlFor([
      { uid: 1, name: 'گروه', summary: true },
      { uid: 2, name: 'الف (بازنگری)', level: 2, dur: 4, extra: bl('2026-09-01') },
      { uid: 3, name: 'ب', level: 2, dur: 3, preds: [2], extra: bl('2026-09-06') },
    ]);
    const prev = await post(w.admin, '/preview', { xml: withBase });
    expect(prev.body.result.replaceBaseline).toBe(true);
    expect(prev.body.result.removed.items.map((x: { id: number }) => x.id)).toEqual([5, 6]);
    const ok = await post(w.admin, '', { xml: withBase, token: prev.body.token, confirm: true });
    expect(ok.status).toBe(200);
    const m = await getModel(w.admin, pid);
    expect(Object.keys(m.baseline.items).sort()).toEqual(['2', '3']);
    expect(m.baseline.label).toBe('ورود از فایل MS Project');
    // دوباره همان فایل: خط مبنای قبلی بایگانی شده و خط مبنای تازه‌ی فعلی است
    const again = await post(w.admin, '/preview', { xml: withBase });
    await post(w.admin, '', { xml: withBase, token: again.body.token, confirm: true });
    const m2 = await getModel(w.admin, pid);
    expect(m2.baselineHistory.length).toBe(1);
    expect(m2.baselineHistory[0].label).toBe('ورود از فایل MS Project');
  });

  it('حذف فعالیت دارای هزینه‌ی ثبت‌شده: مانع در پیش‌نمایش و ۴۰۹ در اعمال؛ داده‌ی مالی می‌ماند', async () => {
    const cost = await w.admin.post(`/api/projects/${pid}/costs`, { date: '2026-09-05', taskId: 3, amount: 5_000_000, description: 'خرید' });
    expect(cost.status).toBe(201);
    const without3 = xmlFor([
      { uid: 1, name: 'گروه', summary: true },
      { uid: 2, name: 'الف (بازنگری)', level: 2, dur: 4 },
    ]);
    const prev = await post(w.admin, '/preview', { xml: without3 });
    expect(prev.status).toBe(200);
    expect(codes(prev.body.blockers)).toEqual(['REMOVED_HAS_COSTS']);
    const removed3 = prev.body.result.removed.items.find((x: { id: number }) => x.id === 3);
    expect(removed3).toMatchObject({ ledgerRows: 1, ledgerAmount: 5_000_000 });
    const r = await post(w.admin, '', { xml: without3, token: prev.body.token, confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('MSP_BLOCKED');
    expect(codes(r.body.error.details.blockers)).toEqual(['REMOVED_HAS_COSTS']);
    const m = await getModel(w.admin, pid);
    expect(m.costs.length).toBe(1);
    expect(ids(m)).toEqual([1, 2, 3]);
  });

  it('چرخه‌ی وابستگی: مانع CYCLE', async () => {
    const cyc = xmlFor([
      { uid: 1, name: 'گروه', summary: true },
      { uid: 2, name: 'الف (بازنگری)', level: 2, preds: [3] },
      { uid: 3, name: 'ب', level: 2, preds: [2] },
    ]);
    const prev = await post(w.admin, '/preview', { xml: cyc });
    expect(codes(prev.body.blockers)).toContain('CYCLE');
    const r = await post(w.admin, '', { xml: cyc, token: prev.body.token, confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('MSP_BLOCKED');
  });

  it('نگاشت «هیچ»: همه‌ی فعالیت‌ها حذف و تازه ساخته می‌شود؛ مانع هزینه همچنان برقرار است', async () => {
    const prev = await post(w.admin, '/preview', { xml: BASE, mapping: 'none' });
    expect(prev.body.mapping.used).toBe('none');
    expect(prev.body.result.matched).toBe(0);
    expect(prev.body.result.added).toBe(4);
    expect(codes(prev.body.blockers)).toEqual(['REMOVED_HAS_COSTS']);
  });

  it('پروژه‌ی بدون هزینه با نگاشت «هیچ»: شناسه‌های تازه و بدون استفاده‌ی دوباره از شناسه‌های قدیمی', async () => {
    const p2 = (await w.admin.post('/api/import/msp', { xml: BASE, name: 'پروژه‌ی دوم' })).body.projectId;
    const prev = await w.admin.post(`/api/projects/${p2}/import/msp/preview`, { xml: BASE, mapping: 'none' });
    expect(prev.body.blockers).toEqual([]);
    const ok = await w.admin.post(`/api/projects/${p2}/import/msp`, { xml: BASE, mapping: 'none', token: prev.body.token, confirm: true });
    expect(ok.status).toBe(200);
    expect(ids(await getModel(w.admin, p2))).toEqual([5, 6, 7, 8]);
  });

  it('حفظ پیشرفت: گزینه‌ی keepProgress و keepStart در پیش‌نمایش منعکس می‌شود', async () => {
    const r = await post(w.admin, '/preview', { xml: BASE, keepProgress: true, keepStart: true });
    expect(r.body.options).toEqual({ keepProgress: true, keepStart: true });
    expect(r.body.result.start).toBe((await getModel(w.admin, pid)).project.start);
    const effects: string = r.body.effects.map((e: { text: string }) => e.text).join('\n');
    expect(effects.includes('شروع پروژه')).toBe(true);
  });

  it('پروژه‌ی بایگانی‌شده: پیش‌نمایش مانع ARCHIVED دارد و اعمال ۴۰۹ می‌شود', async () => {
    const p3 = (await w.admin.post('/api/import/msp', { xml: BASE, name: 'بایگانی' })).body.projectId;
    const version = (await w.admin.get(`/api/projects/${p3}`)).body.project.version;
    expect((await w.admin.patch(`/api/projects/${p3}`, { archived: true, version })).status).toBe(200);
    const prev = await w.admin.post(`/api/projects/${p3}/import/msp/preview`, { xml: BASE });
    expect(prev.status).toBe(200);
    expect(codes(prev.body.blockers)).toContain('ARCHIVED');
    const r = await w.admin.post(`/api/projects/${p3}/import/msp`, { xml: BASE, token: prev.body.token, confirm: true });
    expect(r.status).toBe(409);
    expect(r.body.error.code).toBe('ARCHIVED');
  });

  it('ورودی‌های ناسالم: اندازه و مقدار ساعت', async () => {
    expect((await post(w.admin, '/preview', { xml: BASE, hoursPerDay: 0 })).status).toBe(400);
    expect((await post(w.admin, '/preview', { xml: BASE, hoursPerDay: 30 })).status).toBe(400);
    expect((await post(w.admin, '/preview', { xml: BASE, mapping: 'weird' })).status).toBe(400);
    expect((await post(w.admin, '/preview', {})).status).toBe(400);
  });
});

describe('پیش‌نمایش ورود نسخه‌ی قدیمی و بازیابی پشتیبان', () => {
  it('بازیابی پشتیبان با dryRun: خلاصه و نسخه‌ی قالب را می‌دهد و پروژه نمی‌سازد', async () => {
    const src = (await w.admin.post('/api/import/msp', { xml: BASE, name: 'برای پشتیبان' })).body.projectId;
    const exp = (await w.admin.get(`/api/projects/${src}/export`)).body;
    const before = await projectCount();
    const r = await w.admin.req('POST', '/api/import/project?dryRun=1', exp);
    expect(r.status).toBe(200);
    expect(r.body.dryRun).toBe(true);
    expect(r.body.name).toBe('برای پشتیبان');
    expect(r.body.schemaVersion).toBe(1);
    expect(r.body.summary.tasks).toBe(4);
    expect(await projectCount()).toBe(before);
    // مدیر پروژه حتی پیش‌نمایش را هم نمی‌بیند
    expect((await w.pm.req('POST', '/api/import/project?dryRun=1', exp)).status).toBe(403);
    // فایل خراب در پیش‌نمایش هم رد می‌شود
    expect((await w.admin.req('POST', '/api/import/project?dryRun=1', { ...exp, version: 99 })).status).toBe(400);
    // اعمال واقعی پروژه‌ی تازه می‌سازد
    const real = await w.admin.post('/api/import/project', exp);
    expect(real.status).toBe(201);
    expect(real.body.summary.tasks).toBe(4);
    expect(await projectCount()).toBe(before + 1);
  });
});
