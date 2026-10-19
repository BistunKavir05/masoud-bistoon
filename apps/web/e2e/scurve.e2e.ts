import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
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

interface Snap {
  date: string;
  estimated: boolean;
  actual: number;
}
interface Bundle {
  project: { version: number };
  snapshots: Snap[];
  baseline: { id: number; label: string } | null;
  baselineHistory: { id: number; label: string }[];
  tasks: { id: number; version: number }[];
}
const model = (stack: Stack, pid: number): Promise<Bundle> => stack.admin.call<Bundle>('GET', `/projects/${pid}/model`);

async function setTask(stack: Stack, pid: number, id: number, patch: Record<string, unknown>): Promise<void> {
  const m = await model(stack, pid);
  const t = m.tasks.find((x) => x.id === id)!;
  await stack.admin.call('PATCH', `/projects/${pid}/tasks/${id}`, { version: t.version, patch });
}

describe('منحنی S و خط مبنا', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    // پیشرفت واقعی: مفهومی تمام، تفصیلی ۳۰٪ — تاریخ‌های واقعی برای بازسازی تخمینی
    await setTask(stack, seed.pid, seed.tasks['طراحی مفهومی']!, { actualStart: '2026-09-13', actualFinish: '2026-09-24', percentComplete: 100 });
    await setTask(stack, seed.pid, seed.tasks['طراحی تفصیلی']!, { actualStart: '2026-09-25', percentComplete: 30 });
    for (const [u, name, role] of [['pm5', 'مدیر پروژه پنج', 'pm'], ['mgr5', 'مدیریت پنج', 'management'], ['com5', 'بازرگانی پنج', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('نمودار و شاخص‌ها نمایش داده می‌شود؛ ثبت، بازسازی تخمینی و حذف گزارش', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/scurve`);
    await page.getByTestId('scurve-chart').waitFor();
    await page.getByTestId('sc-kpis').waitFor();
    // فقط ردیف «وضعیت فعلی»
    assert.equal(await page.locator('[data-testid^="sc-row-"]').count(), 1);
    assert.match(await page.getByTestId('sc-table').innerText(), /وضعیت فعلی/);
    await page.screenshot({ path: `${shotDir}/scurve.png`, fullPage: true });

    // نشانگر مقدار با کلید
    await page.getByTestId('scurve-chart').focus();
    await page.keyboard.press('End');
    assert.match(await page.getByTestId('sc-readout').innerText(), /برنامه‌ای ۱۰۰٪/);
    await page.keyboard.press('Escape');

    // بازسازی تخمینی
    await page.getByTestId('sc-estimate').click();
    await page.getByText(/گزارش تخمینی از تاریخ‌های واقعی ساخته شد/).first().waitFor();
    let m = await model(stack, seed.pid);
    const est = m.snapshots.filter((s) => s.estimated);
    assert.ok(est.length >= 2, `تخمینی‌ها ${est.length}`);
    assert.equal(await page.locator('[data-testid^="sc-row-"]').count(), est.length + 1);
    // بازسازی دوباره نیازمند تأیید است (جایگزینی)
    await page.getByTestId('sc-estimate').click();
    await page.getByRole('dialog').getByRole('button', { name: 'بازسازی شود' }).click();
    await page.getByText(/گزارش تخمینی از تاریخ‌های واقعی ساخته شد/).first().waitFor();

    // ثبت گزارش
    await page.getByTestId('sc-record').click();
    await page.getByTestId('sc-table').getByText('ثبت‌شده', { exact: true }).waitFor();
    m = await model(stack, seed.pid);
    const rec = m.snapshots.filter((s) => !s.estimated);
    assert.equal(rec.length, 1);
    assert.equal(rec[0]!.date, '2026-10-19');
    assert.equal(await page.getByText(/وضعیت فعلی \(هنوز ثبت نشده\)/).count(), 0);
    await page.setViewportSize({ width: 1360, height: 1900 });
    await page.screenshot({ path: `${shotDir}/scurve-recorded.png` });

    // ثبت دوباره در همان تاریخ: جایگزینی با تأیید
    await page.getByTestId('sc-record').click();
    await page.getByRole('dialog').getByRole('button', { name: 'جایگزین شود' }).click();
    await page.getByText('گزارش پیشرفت ثبت شد.').first().waitFor();
    assert.equal((await model(stack, seed.pid)).snapshots.filter((s) => !s.estimated).length, 1);

    // حذف یک گزارش تخمینی (با تأیید)
    const victim = est[0]!.date;
    await page.getByTestId(`sc-del-${victim}`).click();
    await page.getByRole('dialog').getByRole('button', { name: 'حذف شود' }).click();
    await page.getByTestId(`sc-row-${victim}`).waitFor({ state: 'detached' });
    assert.ok(!(await model(stack, seed.pid)).snapshots.some((s) => s.date === victim));
    assert.deepEqual(errors, []);
  });

  it('افت پیشرفت نسبت به گزارش قبلی علامت می‌خورد و «علت؟» فعالیت کم‌شده را نشان می‌دهد', async () => {
    // گزارش 2026-10-19 ثبت‌شده است؛ پیشرفت «طراحی مفهومی» کم و تاریخ وضعیت جلو می‌رود
    await setTask(stack, seed.pid, seed.tasks['طراحی مفهومی']!, { percentComplete: 50 });
    const m = await model(stack, seed.pid);
    await stack.admin.call('PATCH', `/projects/${seed.pid}`, { version: m.project.version, status: '2026-10-26' });
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/scurve`);
    const row = page.getByTestId('sc-row-2026-10-26');
    await row.waitFor();
    await row.getByText('کمتر از گزارش قبلی').waitFor();
    // ردیف‌های بدون افت علامت ندارند
    assert.equal(await page.getByText('کمتر از گزارش قبلی').count(), 1);
    await page.getByTestId('sc-why-2026-10-26').click();
    const explain = page.getByTestId('drop-explain');
    await explain.waitFor();
    const text = await explain.innerText();
    assert.match(text, /طراحی مفهومی/);
    assert.match(text, /۱۰۰٪/);
    assert.match(text, /۵۰٪/);
    await page.screenshot({ path: `${shotDir}/scurve-why.png` });
    await page.keyboard.press('Escape');
    // تغییر پس از ثبت: گزارش ۱۹ ثبت‌شده و وضعیت جلو رفته؛ پس «وضعیت فعلی» ردیف جدا دارد
    assert.match(await page.getByTestId('sc-table').innerText(), /وضعیت فعلی/);
    assert.deepEqual(errors, []);
  });

  it('تعریف خط مبنای جدید: پیش‌نمایش قبل/بعد، بایگانی خط مبنای قبلی و برچسب فعالیت‌های تازه', async () => {
    // فعالیتی بعد از خط مبنا افزوده می‌شود
    const m = await model(stack, seed.pid);
    const sv = (await stack.admin.call<{ project: { structureVersion: number } }>('GET', `/projects/${seed.pid}`)).project.structureVersion;
    await stack.admin.call('POST', `/projects/${seed.pid}/tasks`, { referenceId: seed.tasks['مونتاژ']!, asChild: false, kind: 'task', name: 'بازرسی نهایی', structureVersion: sv });
    assert.equal(m.baseline?.label, 'خط مبنای اولیه');

    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/scurve`);
    await page.getByTestId('sc-baseline-facts').waitFor();
    assert.match(await page.getByTestId('sc-baseline-facts').innerText(), /خط مبنای اولیه/);
    await page.getByText(/بعد از ثبت خط مبنا افزوده شده/).waitFor();
    assert.match(await page.getByText(/بعد از ثبت خط مبنا افزوده شده/).innerText(), /بازرسی نهایی/);

    await page.getByTestId('sc-baseline').click();
    const d = page.getByRole('dialog');
    await d.getByTestId('baseline-impact').waitFor();
    const impact = (await d.getByTestId('baseline-impact').innerText()).replace(/\s+/g, ' ');
    assert.match(impact, /خط مبنای فعلی/);
    assert.match(impact, /خط مبنای جدید/);
    assert.match(await d.innerText(), /یک فعالیت تازه|۱ فعالیت تازه/);
    assert.match(await d.innerText(), /برگشت‌پذیر نیست/);
    await page.screenshot({ path: `${shotDir}/baseline-dialog.png` });
    // انصراف چیزی را تغییر نمی‌دهد
    await d.getByRole('button', { name: 'انصراف' }).click();
    assert.equal((await model(stack, seed.pid)).baselineHistory.length, 0);

    await page.getByTestId('sc-baseline').click();
    await page.getByTestId('baseline-label').fill('پس از الحاقیه ۱');
    await page.getByTestId('baseline-submit').click();
    await page.getByText('خط مبنا ثبت شد.').first().waitFor();
    const after = await model(stack, seed.pid);
    assert.equal(after.baseline?.label, 'پس از الحاقیه ۱');
    assert.equal(after.baselineHistory.length, 1);
    assert.equal(after.baselineHistory[0]!.label, 'خط مبنای اولیه');
    await page.getByTestId('sc-history').waitFor();
    assert.match(await page.getByTestId('sc-history').innerText(), /خط مبنای اولیه/);
    assert.equal(await page.getByText(/بعد از ثبت خط مبنا افزوده شده/).count(), 0);
    assert.deepEqual(errors, []);
  });

  it('نقش‌ها: مدیر پروژه عملیات دارد، مدیریت فقط می‌بیند، بازرگانی تب را ندارد', async () => {
    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm5', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/scurve`);
    await pm.page.getByTestId('sc-record').waitFor();
    await pm.page.getByTestId('sc-baseline').waitFor();
    assert.deepEqual(pm.errors, []);

    const mg = await newSession(browser, stack.baseUrl);
    await loginAs(mg.page, 'mgr5', USER_PASSWORD);
    await mg.page.goto(`/#/p/${seed.pid}/scurve`);
    await mg.page.getByTestId('scurve-chart').waitFor();
    assert.equal(await mg.page.getByTestId('sc-record').count(), 0);
    assert.equal(await mg.page.getByTestId('sc-estimate').count(), 0);
    assert.equal(await mg.page.getByTestId('sc-baseline').count(), 0);
    assert.equal(await mg.page.locator('[data-testid^="sc-del-"]').count(), 0);
    assert.deepEqual(mg.errors, []);

    const cm = await newSession(browser, stack.baseUrl);
    await loginAs(cm.page, 'com5', USER_PASSWORD);
    await cm.page.goto(`/#/p/${seed.pid}/scurve`);
    await cm.page.getByText(/به بخش «منحنی S» دسترسی ندارد/).waitFor();
    assert.equal(await cm.page.getByTestId('scurve-chart').count(), 0);
    assert.deepEqual(cm.errors, []);
  });
});
