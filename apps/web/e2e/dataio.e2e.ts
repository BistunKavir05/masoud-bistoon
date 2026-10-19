import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { Browser, Page } from 'playwright';
import { launch, newSession, shotDir } from './browser.ts';
import { ADMIN_PASSWORD, USER_PASSWORD, startStack } from './harness.ts';
import type { Stack } from './harness.ts';
import { seedProject } from './seed.ts';
import type { SeedIds } from './seed.ts';

async function loginAs(page: Page, user: string, pass: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-user').fill(user);
  await page.getByTestId('login-pass').fill(pass);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('user-menu').waitFor();
}

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
const xmlFor = (rows: Row[], name: string): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>${name}</Name><StartDate>2026-09-12T07:30:00</StartDate><MinutesPerDay>480</MinutesPerDay><Tasks><Task><UID>0</UID><Summary>1</Summary></Task>` +
  rows
    .map(
      (r) =>
        `<Task><UID>${r.uid}</UID><Name>${r.name}</Name><OutlineLevel>${r.level ?? 1}</OutlineLevel><Summary>${r.summary ? 1 : 0}</Summary><Milestone>${r.milestone ? 1 : 0}</Milestone><Duration>PT${(r.dur ?? 1) * 8}H0M0S</Duration>` +
        (r.preds ?? []).map((p) => `<PredecessorLink><PredecessorUID>${p}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>`).join('') +
        `${r.extra ?? ''}</Task>`,
    )
    .join('') +
  '</Tasks></Project>';

// ساختار پروژه‌ی نمونه‌ی seed با همان شناسه‌ها (۱ تا ۹)؛ مهندسی، طراحی مفهومی، طراحی تفصیلی، تأیید طراحی، ساخت، تأمین مواد، ساخت قطعات، مونتاژ، تحویل نهایی
const SAME: Row[] = [
  { uid: 1, name: 'مهندسی', summary: true },
  { uid: 2, name: 'طراحی مفهومی', level: 2, dur: 3 },
  { uid: 3, name: 'طراحی تفصیلی', level: 2, dur: 4, preds: [2] },
  { uid: 4, name: 'تأیید طراحی', level: 2, milestone: true, preds: [3] },
  { uid: 5, name: 'ساخت', summary: true },
  { uid: 6, name: 'تأمین مواد', level: 2, dur: 5 },
  { uid: 7, name: 'ساخت قطعات', level: 2, dur: 6, preds: [6] },
  { uid: 8, name: 'مونتاژ', level: 2, dur: 3, preds: [7] },
  { uid: 9, name: 'تحویل نهایی', level: 2, milestone: true, preds: [8] },
];
const EDITED: Row[] = [
  ...SAME.slice(0, 1),
  { uid: 2, name: 'طراحی مفهومی (بازنگری)', level: 2, dur: 3 },
  ...SAME.slice(2, 7),
  { uid: 9, name: 'تحویل نهایی', level: 2, milestone: true, preds: [7] },
  { uid: 20, name: 'بازرسی نهایی', level: 2, dur: 2, preds: [7] },
];

const legacyDoc = {
  ver: 34,
  name: 'پروژه‌ی قدیمی آزمون',
  start: '2026-03-21',
  status: '2026-04-10',
  cal: { days: [1, 1, 1, 1, 1, 0, 1].map((x) => ({ w: x, f: '07:30', t: '15:00' })), hol: [] },
  res: [{ n: 'علی', t: 'انسانی', c: 100, rate: 2000000 }],
  tasks: [
    { id: 1, name: 'فاز', lv: 1, sm: 1 },
    { id: 2, name: 'طراحی', lv: 2, dur: 5, w: 5, p: 100, as: '2026-03-21', af: '2026-03-27', res: 'علی:100' },
    { id: 3, name: 'ساخت', lv: 2, dur: 10, w: 10, p: 30, preds: '2' },
  ],
  users: [{ id: 'ali', role: 'user', res: 'علی' }],
};

const BOM = '﻿';

describe('خروجی و ورود داده', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  const dir = join(tmpdir(), `bistoon-dataio-${Date.now()}`);
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    mkdirSync(dir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    const a = stack.admin;
    // نام فعالیت با محافظ فرمول و یک ریسک
    const m = await a.call<{ tasks: { id: number; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t = m.tasks.find((x) => x.id === seed.tasks['مونتاژ'])!;
    await a.call('PATCH', `/projects/${seed.pid}/tasks/${t.id}`, { version: t.version, patch: { name: '=HYPERLINK("http://x","کلیک")' } });
    await a.call('POST', `/projects/${seed.pid}/risks`, { title: 'ریسک آزمون', probability: 3, impact: 4 }, 201);
    for (const [u, name, role] of [['pm9', 'مدیر پروژه نه', 'pm'], ['fin9', 'مالی نه', 'finance'], ['com9', 'بازرگانی نه', 'commerce'], ['exp9', 'کارشناس نه', 'expert']] as const) {
      const id = await stack.createUser(u, name);
      await a.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  const download = async (page: Page, trigger: () => Promise<void>, file: string): Promise<string> => {
    const [dl] = await Promise.all([page.waitForEvent('download'), trigger()]);
    const path = join(dir, file);
    await dl.saveAs(path);
    return path;
  };

  it('منوی خروجی: ادمین همه‌ی موارد؛ CSV فعالیت‌ها ۱۴ ستون با BOM و محافظ فرمول', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
    await page.getByTestId('export-menu').click();
    for (const id of ['export-backup', 'export-msp', 'export-csv-tasks', 'export-csv-risks', 'export-csv-issues', 'export-csv-changes', 'export-csv-decisions', 'export-csv-documents', 'export-csv-costs']) {
      assert.equal(await page.getByTestId(id).count(), 1, id);
    }
    // دسته‌ی بدون ردیف غیرفعال است
    assert.equal(await page.getByTestId('export-csv-documents').isDisabled(), true);
    assert.equal(await page.getByTestId('export-csv-risks').isDisabled(), false);
    await page.screenshot({ path: `${shotDir}/export-menu.png` });

    const file = await download(page, () => page.getByTestId('export-csv-tasks').click(), 'tasks.csv');
    const csv = readFileSync(file, 'utf8');
    assert.ok(csv.startsWith(BOM));
    assert.ok(csv.includes('\r\n'));
    const lines = csv.slice(1).trimEnd().split('\r\n');
    assert.equal(lines.length, 10); // عنوان + ۹ فعالیت
    assert.match(lines[0]!, /^ردیف,WBS,نام,نوع,/);
    assert.equal(lines[0]!.split(',').length, 14);
    assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""کلیک"")"`), 'محافظ تزریق فرمول');
    assert.ok(!csv.includes(',=HYPERLINK'));
    assert.match(lines[1]!, /^1,1,مهندسی,خلاصه,/);

    // ریسک‌ها
    await page.getByTestId('export-menu').click();
    const rf = await download(page, () => page.getByTestId('export-csv-risks').click(), 'risks.csv');
    const rcsv = readFileSync(rf, 'utf8');
    assert.ok(rcsv.includes('ریسک آزمون'));
    assert.ok(!rcsv.includes('امتیاز'));
    assert.deepEqual(errors, []);
  });

  it('پشتیبان JSON و فایل XML پروژه با توضیح آنچه منتقل نمی‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
    await page.getByTestId('export-menu').click();
    const bf = await download(page, () => page.getByTestId('export-backup').click(), 'backup.json');
    const doc = JSON.parse(readFileSync(bf, 'utf8'));
    assert.equal(doc.format, 'bistoon-project');
    assert.equal(doc.model.tasks.length, 9);

    await page.getByTestId('export-menu').click();
    await page.getByTestId('export-msp').click();
    const d = page.getByRole('dialog');
    const omits = await d.getByTestId('msp-export-omits').innerText();
    for (const s of ['منابع و تخصیص‌ها', 'هزینه‌ها و دفتر هزینه', 'وزن فعالیت‌ها']) assert.ok(omits.includes(s), s);
    assert.match(await d.innerText(), /مدت برنامه‌ریزی‌شده/);
    assert.match(await d.innerText(), /آزموده نشده است/);
    await page.screenshot({ path: `${shotDir}/export-msp-dialog.png` });
    const xf = await download(page, () => d.getByTestId('msp-export-download').click(), 'project.xml');
    const xml = readFileSync(xf, 'utf8');
    assert.ok(xml.startsWith('<?xml'));
    assert.ok(xml.includes('<Project'));
    assert.equal((xml.match(/<Task>/g) ?? []).length, 10); // ریشه + ۹
    assert.ok(xml.includes('تأمین مواد'));
    assert.deepEqual(errors, []);
  });

  it('منو بر اساس نقش: مدیر پروژه پشتیبان دارد، مالی فقط CSV (با هزینه)، کارشناس بدون هزینه، بازرگانی بدون منو', async () => {
    const check = async (user: string, expectIds: string[], absentIds: string[]): Promise<void> => {
      const { page, errors } = await newSession(browser, stack.baseUrl);
      await loginAs(page, user, USER_PASSWORD);
      await page.goto(`/#/p/${seed.pid}/dash`);
      await page.getByTestId('status-date').waitFor();
      if (expectIds.length === 0) {
        assert.equal(await page.getByTestId('export-menu').count(), 0, `${user}: منو نباید باشد`);
      } else {
        await page.getByTestId('export-menu').click();
        for (const id of expectIds) assert.equal(await page.getByTestId(id).count(), 1, `${user}: ${id}`);
        for (const id of absentIds) assert.equal(await page.getByTestId(id).count(), 0, `${user}: ${id} نباید باشد`);
      }
      assert.deepEqual(errors, []);
    };
    await check('pm9', ['export-backup', 'export-msp', 'export-csv-tasks', 'export-csv-costs'], []);
    await check('fin9', ['export-csv-tasks', 'export-csv-costs'], ['export-backup', 'export-msp']);
    await check('exp9', ['export-csv-tasks', 'export-csv-risks'], ['export-backup', 'export-msp', 'export-csv-costs']);
    await check('com9', [], []);
  });

  it('ورود MSP به پروژه‌ی موجود: پیش‌نمایش کامل، پشتیبان خودکار، تأیید صریح و اعمال', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl, { width: 1360, height: 1000 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
    // فقط ادمین دکمه را می‌بیند
    await page.getByTestId('msp-import').click();
    const d = page.getByRole('dialog');
    assert.equal(await d.getByTestId('msp-apply').isDisabled(), true);

    // فایل نامعتبر: خطای روشن، اعمال غیرفعال
    await d.getByTestId('msp-file').setInputFiles({ name: 'bad.xml', mimeType: 'text/xml', buffer: Buffer.from('<html><body>این پروژه نیست</body></html>') });
    await d.getByTestId('msp-preview-error').waitFor();
    assert.match(await d.getByTestId('msp-preview-error').innerText(), /Microsoft Project/);
    assert.equal(await d.getByTestId('msp-apply').isDisabled(), true);

    // فایل ویرایش‌شده
    await d.getByTestId('msp-file').setInputFiles({ name: 'edited.xml', mimeType: 'text/xml', buffer: Buffer.from(xmlFor(EDITED, 'ویرایش‌شده'), 'utf8') });
    await d.getByTestId('msp-preview').waitFor();
    const counts = (await d.getByTestId('msp-counts').innerText()).replace(/\s+/g, ' ');
    assert.match(counts, /به‌روز می‌شود ۸/);
    assert.match(counts, /جدید ۱/);
    assert.match(counts, /حذف می‌شود ۱/);
    assert.match(counts, /تغییر نام ۱/);
    assert.match(await d.getByTestId('msp-removed').innerText(), /HYPERLINK/); // «مونتاژ» که در آماده‌سازی نامش به فرمول تغییر کرده
    const effects = await d.getByTestId('msp-effects').innerText();
    for (const s of ['فعالیت‌ها', 'شروع پروژه', 'پیشرفت', 'خط مبنا', 'منابع و تخصیص‌ها', 'دفتر هزینه', 'مستندات', 'اسنپ‌شات‌ها', 'ریسک، مسئله، تغییر، تصمیم']) assert.ok(effects.includes(s), `اثر «${s}» نیامده`);
    assert.match(await d.getByTestId('msp-schedule').innerText(), /پیش‌بینی پایان/);
    assert.equal(await d.getByTestId('msp-blockers').count(), 0);
    await page.screenshot({ path: `${shotDir}/msp-import-preview.png` });

    // اعمال: ابتدا تأیید صریح؛ انصراف چیزی را تغییر نمی‌دهد
    await d.getByTestId('msp-apply').click();
    const confirm = page.getByRole('dialog').filter({ hasText: 'اعمال ورود از فایل MS Project' }).last();
    await confirm.getByRole('button', { name: 'انصراف' }).click();
    assert.equal(await page.getByTestId(`task-row-${seed.tasks['مونتاژ']}`).count(), 1);

    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      (async () => {
        await d.getByTestId('msp-apply').click();
        const c2 = page.getByRole('dialog').filter({ hasText: 'اعمال ورود از فایل MS Project' }).last();
        await c2.getByRole('button', { name: 'اعمال ورود', exact: true }).click();
      })(),
    ]);
    await dl.saveAs(join(dir, 'auto-backup.json'));
    const backup = JSON.parse(readFileSync(join(dir, 'auto-backup.json'), 'utf8'));
    assert.equal(backup.model.tasks.length, 9, 'پشتیبان قبل از ورود از وضعیت قبلی است');
    await page.getByTestId('msp-apply').waitFor({ state: 'detached' });

    // نتیجه
    await page.getByTestId('tasks-table').getByText('طراحی مفهومی (بازنگری)').waitFor();
    assert.equal(await page.getByTestId(`task-row-${seed.tasks['مونتاژ']}`).count(), 0);
    assert.equal(await page.getByTestId('tasks-table').getByText('بازرسی نهایی').count(), 1);
    const model = await stack.admin.call<{ tasks: { id: number; name: string }[] }>('GET', `/projects/${seed.pid}/model`);
    assert.equal(model.tasks.length, 9);
    assert.ok(model.tasks.some((t) => t.name === 'بازرسی نهایی' && t.id > 9), 'شناسه‌ی فعالیت تازه از شمارنده است');
    const audit = await stack.admin.call<{ entries: { action: string }[] }>('GET', `/projects/${seed.pid}/audit?limit=200`);
    assert.ok(audit.entries.some((e) => e.action === 'project.import.msp'));
    assert.deepEqual(errors, []);
  });

  it('ورود MSP: مانع هزینه‌ی ثبت‌شده روی فعالیت حذف‌شونده تأیید را غیرفعال می‌کند', async () => {
    await stack.admin.call('POST', '/import/msp', { xml: xmlFor(SAME, 'مانع') }, 201).then(async (r: { projectId: number }) => {
      await stack.admin.call('POST', `/projects/${r.projectId}/costs`, { date: '2026-10-01', taskId: 8, amount: 5_000_000, description: 'خرید' }, 201);
      const { page, errors } = await newSession(browser, stack.baseUrl);
      await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
      await page.goto(`/#/p/${r.projectId}/tasks`);
      await page.getByTestId('tasks-table').waitFor();
      await page.getByTestId('msp-import').click();
      const d = page.getByRole('dialog');
      await d.getByTestId('msp-file').setInputFiles({ name: 'less.xml', mimeType: 'text/xml', buffer: Buffer.from(xmlFor(SAME.filter((x) => x.uid !== 8).map((x) => (x.uid === 9 ? { ...x, preds: [7] } : x)), 'مانع'), 'utf8') });
      await d.getByTestId('msp-blockers').waitFor();
      assert.match(await d.getByTestId('msp-blockers').innerText(), /مونتاژ/);
      assert.equal(await d.getByTestId('msp-apply').isDisabled(), true);
      await page.screenshot({ path: `${shotDir}/msp-import-blocked.png` });
      assert.deepEqual(errors, []);
    });
  });

  it('پروژه‌ی جدید از فایل MS Project: پیش‌نمایش، نام پیشنهادی، ساخت و رفتن به پروژه', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/dash`);
    await page.getByTestId('new-project').click();
    const d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'از فایل MS Project' }).click();
    assert.equal(await d.getByTestId('np-msp-submit').isDisabled(), true);
    await d.getByTestId('np-msp-file').setInputFiles({ name: 'p.xml', mimeType: 'text/xml', buffer: Buffer.from(xmlFor(SAME, 'پروژه‌ی از فایل'), 'utf8') });
    await d.getByTestId('np-msp-preview').waitFor();
    assert.equal(await d.getByTestId('np-msp-name').inputValue(), 'پروژه‌ی از فایل');
    assert.match((await d.getByTestId('np-msp-preview').innerText()).replace(/\s+/g, ' '), /ردیف‌های فایل ۹/);
    await page.screenshot({ path: `${shotDir}/new-project-msp.png` });
    await d.getByTestId('np-msp-submit').click();
    await page.waitForURL(/#\/p\/\d+\/tasks/);
    await page.getByTestId('tasks-table').waitFor();
    assert.equal(await page.getByTestId('tasks-table').getByText('تأمین مواد').count(), 1);
    assert.equal(await page.getByTestId('project-select').locator('option', { hasText: 'پروژه‌ی از فایل' }).count(), 1);
    assert.deepEqual(errors, []);
  });

  it('بازیابی پشتیبان و ورود نسخه‌ی قدیمی: پیش‌نمایش با شمارش‌ها و ساخت پروژه‌ی جدید', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/dash`);
    await page.getByTestId('status-date').waitFor();
    const before = await page.getByTestId('project-select').locator('option').count();

    await page.getByTestId('new-project').click();
    let d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'بازیابی پشتیبان' }).click();
    await d.getByTestId('np-backup-file').setInputFiles(join(dir, 'auto-backup.json'));
    await d.getByTestId('np-backup-preview').waitFor();
    const text = (await d.getByTestId('np-backup-preview').innerText()).replace(/\s+/g, ' ');
    assert.match(text, /پروژه‌ی نمونه/);
    assert.match(text, /فعالیت‌ها ۹/);
    assert.match(await d.innerText(), /پروژه‌ی <?[^]*جدید/);
    // فایل نامعتبر
    await d.getByTestId('np-backup-file').setInputFiles({ name: 'x.json', mimeType: 'application/json', buffer: Buffer.from('{"hello":"world"}') });
    await d.getByTestId('np-preview-error').waitFor();
    assert.equal(await d.getByTestId('np-backup-submit').isDisabled(), true);
    await d.getByTestId('np-backup-file').setInputFiles(join(dir, 'auto-backup.json'));
    await d.getByTestId('np-backup-preview').waitFor();
    await page.screenshot({ path: `${shotDir}/restore-preview.png` });
    await d.getByTestId('np-backup-submit').click();
    await page.waitForFunction((n) => document.querySelectorAll('#project-select option').length === n, before + 1);
    await page.getByTestId('tasks-table').waitFor();
    assert.equal(await page.getByTestId('project-select').locator('option').count(), before + 1);

    // نسخه‌ی قدیمی
    await page.getByTestId('new-project').click();
    d = page.getByRole('dialog');
    await d.getByRole('button', { name: 'نسخه‌ی قدیمی' }).click();
    await d.getByTestId('np-legacy-file').setInputFiles({ name: 'legacy.json', mimeType: 'application/json', buffer: Buffer.from(JSON.stringify(legacyDoc)) });
    await d.getByTestId('np-legacy-preview').waitFor();
    assert.match((await d.getByTestId('np-legacy-preview').innerText()).replace(/\s+/g, ' '), /پروژه‌ی قدیمی آزمون/);
    assert.match(await d.getByTestId('np-legacy-preview').innerText(), /وارد نمی‌شوند/);
    await d.getByTestId('np-legacy-submit').click();
    await page.waitForFunction((n) => document.querySelectorAll('#project-select option').length === n, before + 2);
    await page.getByTestId('tasks-table').getByText('فاز').first().waitFor();
    assert.equal(await page.getByTestId('project-select').locator('option').count(), before + 2);
    assert.deepEqual(errors, []);
  });

  it('پروژه‌ی خالی همچنان با نام و تاریخ ساخته می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/dash`);
    await page.getByTestId('status-date').waitFor();
    await page.getByTestId('new-project').click();
    const d = page.getByRole('dialog');
    assert.equal(await d.getByTestId('np-submit').isDisabled(), true);
    await d.getByTestId('np-name').fill('پروژه‌ی خالی آزمون');
    await d.getByTestId('np-start').fill('۱۴۰۵/۰۷/۲۰');
    await d.getByTestId('np-submit').click();
    await page.getByTestId('add-task').waitFor(); // پروژه‌ی خالی جدول ندارد
    await page.getByTestId('project-select').locator('option', { hasText: 'پروژه‌ی خالی آزمون' }).waitFor({ state: 'attached' });
    assert.deepEqual(errors, []);
  });

  it('مدیر پروژه دکمه‌ی ورود MSP و ساخت پروژه را نمی‌بیند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'pm9', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
    assert.equal(await page.getByTestId('msp-import').count(), 0);
    assert.equal(await page.getByTestId('new-project').count(), 0);
    assert.deepEqual(errors, []);
  });
});
