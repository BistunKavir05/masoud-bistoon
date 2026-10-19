import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
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

describe('گزارش وضعیت', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  let empty = 0;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    const a = stack.admin;
    const m = await a.call<{ tasks: { id: number; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t = m.tasks.find((x) => x.id === seed.tasks['طراحی مفهومی'])!;
    await a.call('PATCH', `/projects/${seed.pid}/tasks/${t.id}`, { version: t.version, patch: { percentComplete: 40 } });
    await a.call('PATCH', `/projects/${seed.pid}/contract`, { version: 1, number: 'ق-۱۴۰۵-۱۲', amount: 1_000_000_000, invoicedTotal: 400_000_000, collectedTotal: 300_000_000, salesCommissionPercent: 2 });
    await a.call('PATCH', `/projects/${seed.pid}/charter`, { version: 1, client: 'شرکت نمونه گزارش', projectManager: 'مریم احمدی' });
    const rec = (p: string, body: unknown): Promise<unknown> => a.call('POST', `/projects/${seed.pid}/${p}`, body, 201);
    await rec('risks', { title: 'تأخیر تأمین ورق', probability: 5, impact: 5, owner: 'علی' });
    await rec('risks', { title: 'ریسک کم‌اهمیت', probability: 1, impact: 2 });
    await rec('risks', { title: 'ریسک بسته‌شده', probability: 5, impact: 5, status: 'closed' });
    await rec('issues', { title: 'مسئله‌ی باز فوری', priority: 'high', due: '2026-10-01', needsDecision: true });
    await rec('issues', { title: 'مسئله‌ی حل‌شده', priority: 'high', status: 'resolved' });
    await rec('decisions', { topic: 'انتخاب تأمین‌کننده', maker: 'مدیریت' });
    await rec('changes', { title: 'افزایش دامنه‌ی تحویل', requester: 'کارفرما', date: '2026-10-10' });
    const e = await a.call<{ project: { id: number } }>('POST', '/projects', { name: 'پروژه‌ی خالی', start: '2026-09-12', status: '2026-10-19' }, 201);
    empty = e.project.id;
    for (const [u, name, role] of [['pm8', 'مدیر پروژه هشت', 'pm'], ['com8', 'بازرگانی هشت', 'commerce'], ['exp8', 'کارشناس هشت', 'expert']] as const) {
      const id = await stack.createUser(u, name);
      await a.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('همه‌ی بخش‌های دارای داده؛ ریسک بسته و مسئله‌ی حل‌شده نمی‌آیند؛ یادداشت و گزینه‌ها', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl, { width: 1200, height: 900 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/rep`);
    const rep = page.getByTestId('report');
    await rep.waitFor();
    const text = await rep.innerText();
    for (const s of ['گزارش وضعیت پروژه', 'پروژه‌ی نمونه', 'شرکت نمونه گزارش', 'مریم احمدی', 'وضعیت مالی', 'قرارداد و وصول', 'منحنی S', 'ماتریس و ریسک‌های مهم', 'تأخیر تأمین ورق', 'مسائل باز', 'مسئله‌ی باز فوری', 'سررسیدگذشته', 'تصمیم‌های لازم', 'انتخاب تأمین‌کننده', 'درخواست‌های تغییر در انتظار', 'افزایش دامنه‌ی تحویل']) {
      assert.ok(text.includes(s), `در گزارش نیست: ${s}`);
    }
    assert.ok(!text.includes('ریسک بسته‌شده'));
    assert.ok(!text.includes('مسئله‌ی حل‌شده'));
    assert.equal(await page.getByTestId('rep-notes').count(), 0);
    await page.getByLabel(/یادداشت مدیر پروژه/).fill('طراحی مفهومی کندتر از برنامه است.');
    await page.getByTestId('rep-notes').getByText('طراحی مفهومی کندتر از برنامه است.').waitFor();
    await page.getByLabel('ریسک‌ها', { exact: true }).uncheck();
    assert.equal(await page.getByTestId('rep-risks').count(), 0);
    await page.getByLabel('مالی (EVM)').uncheck();
    assert.equal(await page.getByTestId('rep-finance').count(), 0);
    await page.getByLabel('ریسک‌ها', { exact: true }).check();
    await page.getByLabel('مالی (EVM)').check();
    await page.screenshot({ path: `${shotDir}/report.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it('PDF واقعی: چند صفحه، بدون منو و نوار بالا، متن فارسی قابل‌استخراج', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl, { width: 1200, height: 900 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/rep`);
    await page.getByTestId('report').waitFor();
    await page.getByTestId('rep-scurve').locator('svg').first().waitFor();
    await page.emulateMedia({ media: 'print' });
    const pdf = await page.pdf({ format: 'A4', printBackground: true, preferCSSPageSize: true });
    const file = `${shotDir}/report.pdf`;
    writeFileSync(file, pdf);
    const info = execFileSync('pdfinfo', [file], { encoding: 'utf8' });
    const pages = Number(/Pages:\s+(\d+)/.exec(info)?.[1]);
    assert.ok(pages >= 1 && pages <= 4, `تعداد صفحه: ${pages}`);
    const txt = execFileSync('pdftotext', ['-layout', file, '-'], { encoding: 'utf8' });
    const flat = txt.replace(/\s+/g, ' ');
    // متن واقعی (نه تصویر) است و ترتیب منطقی کلمات حفظ شده
    for (const w of ['گزارش', 'پروژه', 'شرکت', 'مریم', 'تأخیر', 'ریسک']) assert.ok(flat.includes(w), `در PDF نیست: ${w}\n${flat.slice(0, 600)}`);
    // رابط (منو و نوار بالا و کنترل‌ها) در PDF نیست
    for (const w of ['بخش‌های گزارش', 'چاپ / ذخیره', 'تغییر تاریخ وضعیت']) assert.ok(!flat.includes(w), `نباید در PDF باشد: ${w}`);
    assert.ok(!flat.includes('گفتگو'), 'منوی کناری در PDF آمده است');
    assert.deepEqual(errors, []);
  });

  it('پروژه‌ی خالی: بخش‌های فهرستی خالی نمایش داده نمی‌شوند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${empty}/rep`);
    const rep = page.getByTestId('report');
    await rep.waitFor();
    await rep.getByText('پروژه‌ی خالی', { exact: true }).waitFor();
    for (const id of ['rep-risks', 'rep-issues', 'rep-decisions', 'rep-changes', 'rep-milestones', 'rep-delayed']) assert.equal(await page.getByTestId(id).count(), 0, id);
    assert.deepEqual(errors, []);
  });

  it('نقش‌ها: بازرگانی فقط خلاصه و قرارداد/پورسانت؛ مدیر پروژه بدون پورسانت؛ کارشناس بدون مالی و قرارداد', async () => {
    const com = await newSession(browser, stack.baseUrl);
    await loginAs(com.page, 'com8', USER_PASSWORD);
    await com.page.goto(`/#/p/${seed.pid}/rep`);
    await com.page.getByTestId('report').waitFor();
    assert.equal(await com.page.getByTestId('rep-contract').count(), 1);
    for (const id of ['rep-finance', 'rep-scurve', 'rep-risks', 'rep-issues', 'rep-decisions', 'rep-changes', 'rep-milestones', 'rep-delayed']) assert.equal(await com.page.getByTestId(id).count(), 0, id);
    assert.match(await com.page.getByTestId('rep-contract').innerText(), /پورسانت قابل پرداخت/);
    await com.page.getByText('گزارش کامل در دسترس نیست').waitFor();
    assert.deepEqual(com.errors, []);

    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm8', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/rep`);
    await pm.page.getByTestId('report').waitFor();
    assert.equal(await pm.page.getByTestId('rep-finance').count(), 1);
    assert.equal(await pm.page.getByTestId('rep-contract').count(), 1);
    assert.ok(!(await pm.page.getByTestId('rep-contract').innerText()).includes('پورسانت'));
    assert.equal(await pm.page.getByTestId('rep-scurve').count(), 1);
    assert.equal(await pm.page.getByTestId('rep-risks').count(), 1);
    assert.deepEqual(pm.errors, []);

    const ex = await newSession(browser, stack.baseUrl);
    await loginAs(ex.page, 'exp8', USER_PASSWORD);
    await ex.page.goto(`/#/p/${seed.pid}/rep`);
    await ex.page.getByTestId('report').waitFor();
    assert.equal(await ex.page.getByTestId('rep-finance').count(), 0);
    assert.equal(await ex.page.getByTestId('rep-contract').count(), 0);
    assert.equal(await ex.page.getByTestId('rep-scurve').count(), 1);
    assert.equal(await ex.page.getByTestId('rep-risks').count(), 1);
    assert.deepEqual(ex.errors, []);
  });
});
