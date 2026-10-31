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

describe('کنترل مدارک، صورت‌وضعیت، تدارکات و روند EVM', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    for (const [u, name, role] of [['fin5', 'مالی پنج', 'finance'], ['com5', 'بازرگانی پنج', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('مستندات: نامه‌ی بدون لینک با ارسال‌کننده، دریافت‌کننده، شماره و وضعیت ثبت و فیلتر می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/docs`);
    await page.getByTestId('doc-add').click();
    await page.getByTestId('doc-title').fill('نامه‌ی تأیید نقشه‌ها');
    const d = page.getByRole('dialog');
    await d.getByLabel('نوع', { exact: true }).selectOption('letter');
    await d.getByLabel('وضعیت گردش').selectOption('in_review');
    await page.getByTestId('doc-sender').fill('کارفرما');
    await page.getByTestId('doc-receiver').fill('پیمانکار');
    await page.getByTestId('doc-number').fill('ن-۱۲۰');
    await page.getByTestId('doc-revision').fill('B');
    await page.getByTestId('doc-save').click();
    await page.getByTestId('doc-table').getByText('نامه‌ی تأیید نقشه‌ها').waitFor();
    const row = page.locator('[data-testid^="doc-row-"]').first();
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /نامه/);
    assert.match(text, /کارفرما ← پیمانکار/);
    assert.match(text, /در حال بررسی/);
    assert.match(text, /Rev B/);
    assert.equal(await row.locator('a').count(), 0);
    // فیلتر وضعیت
    await page.getByLabel('وضعیت', { exact: true }).selectOption('approved');
    await page.getByText('سندی با این فیلتر پیدا نشد.').waitFor();
    await page.getByLabel('وضعیت', { exact: true }).selectOption('in_review');
    await row.waitFor();
    await page.setViewportSize({ width: 1360, height: 800 });
    await page.screenshot({ path: `${shotDir}/docs-control.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it('صورت‌وضعیت: مالی ثبت می‌کند؛ مانده‌ی مطالبات محاسبه می‌شود؛ بازرگانی تب را نمی‌بیند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'fin5', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/pay`);
    await page.getByText('هنوز صورت‌وضعیت ثبت نشده است').waitFor();
    await page.getByTestId('pay-add').click();
    await page.getByTestId('pay-number').fill('۱');
    const d = page.getByRole('dialog');
    await d.getByLabel('وضعیت').selectOption('approved');
    await d.getByLabel('مبلغ ارسالی').fill('۱۰۰۰۰۰۰۰۰');
    await d.getByLabel('مبلغ تأییدشده').fill('۹۰۰۰۰۰۰۰۰');
    await d.getByLabel('مبلغ دریافتی').fill('۴۰۰۰۰۰۰۰۰');
    await page.getByTestId('pay-save').click();
    await page.getByTestId('pay-table').waitFor();
    const totals = (await page.getByTestId('pay-totals').innerText()).replace(/\s+/g, ' ');
    assert.match(totals, /۹۰۰٬۰۰۰٬۰۰۰/);
    assert.match(totals, /۵۰۰٬۰۰۰٬۰۰۰/); // مانده = ۹۰۰ − ۴۰۰ میلیون
    assert.match((await page.getByTestId('pay-row-1').innerText()).replace(/\s+/g, ' '), /۵۰۰٬۰۰۰٬۰۰۰/);
    await page.setViewportSize({ width: 1360, height: 800 });
    await page.screenshot({ path: `${shotDir}/payments.png`, fullPage: true });
    assert.deepEqual(errors, []);

    const c = await newSession(browser, stack.baseUrl);
    await loginAs(c.page, 'com5', USER_PASSWORD);
    await c.page.goto(`/#/p/${seed.pid}/dash`);
    await c.page.getByTestId('user-menu').waitFor();
    assert.equal(await c.page.getByTestId('nav-pay').count(), 0);
    assert.equal(await c.page.getByTestId('nav-proc').count(), 0);
  });

  it('تدارکات: مدیر پروژه ثبت می‌کند؛ تأخیر خودکار حساب می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/proc`);
    await page.getByText('هنوز قلم تدارکات ثبت نشده است').waitFor();
    await page.getByTestId('proc-add').click();
    await page.getByTestId('proc-item').fill('ورق فولادی ST52');
    const d = page.getByRole('dialog');
    await d.getByLabel('فعالیت مرتبط').selectOption({ label: /تأمین مواد/ as never }).catch(async () => {
      const opt = await d.getByLabel('فعالیت مرتبط').locator('option', { hasText: 'تأمین مواد' }).first().getAttribute('value');
      await d.getByLabel('فعالیت مرتبط').selectOption(opt!);
    });
    await d.getByLabel('تأمین‌کننده').fill('فولاد البرز');
    await d.getByLabel('مبلغ').fill('۴۰۰۰۰۰۰۰');
    await d.getByLabel('وضعیت').selectOption('ordered');
    await page.getByTestId('proc-save').click();
    await page.getByTestId('proc-table').waitFor();
    // تحویل برنامه‌ای در گذشته (تاریخ وضعیت پروژه ۲۰۲۶-۱۰-۱۹): با API ثبت می‌کنیم
    const m = await stack.admin.call<{ procurement: { id: number; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    await stack.admin.call('PATCH', `/projects/${seed.pid}/procurement/${m.procurement[0]!.id}`, { version: m.procurement[0]!.version, plannedDelivery: '2026-10-09' });
    await page.reload();
    const row = page.getByTestId(`proc-row-${m.procurement[0]!.id}`);
    await row.waitFor();
    const text = (await row.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /فولاد البرز/);
    assert.match(text, /۱۰/); // ۱۰ روز تأخیر
    const totals = (await page.getByTestId('proc-totals').innerText()).replace(/\s+/g, ' ');
    assert.match(totals, /دارای تأخیر ۱/);
    await page.setViewportSize({ width: 1360, height: 800 });
    await page.screenshot({ path: `${shotDir}/procurement.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it('مالی: جدول روند EVM برای گزارش ثبت‌شده و وضعیت فعلی', async () => {
    const t = await stack.admin.call<{ tasks: { id: number; name: string; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const task = t.tasks.find((x) => x.name === 'طراحی مفهومی')!;
    await stack.admin.call('PATCH', `/projects/${seed.pid}/tasks/${task.id}`, { version: task.version, patch: { percentComplete: 60 } });
    await stack.admin.call('POST', `/projects/${seed.pid}/costs`, { date: '2026-10-10', taskId: task.id, description: 'هزینه', amount: 8_000_000 }, 201);
    await stack.admin.call('POST', `/projects/${seed.pid}/snapshots/estimate`, {}, 201).catch(() => stack.admin.call('POST', `/projects/${seed.pid}/snapshots/estimate`, {}));
    await stack.admin.call('POST', `/projects/${seed.pid}/snapshots`, {}, 201);
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/fin`);
    await page.getByTestId('evm-trend').waitFor();
    await page.getByTestId('evm-chart').waitFor();
    const rows = await page.locator('[data-testid^="evm-row-"]').count();
    assert.ok(rows >= 1, `ردیف‌ها ${rows}`);
    assert.ok(rows >= 2, `نمودار نیازمند دو نقطه است؛ ردیف‌ها ${rows}`);
    const last = (await page.locator('[data-testid^="evm-row-"]').last().innerText()).replace(/\s+/g, ' ');
    assert.match(last, /ثبت‌شده/);
    assert.match(last, /۸٬۰۰۰٬۰۰۰/); // AC ثبت‌شده
    const est = (await page.locator('[data-testid^="evm-row-"]').first().innerText()).replace(/\s+/g, ' ');
    assert.match(est, /تخمینی/);
    assert.match(est, /—/); // بدون AC، شاخص‌های هزینه‌ای خالی
    assert.match(await page.getByTestId('evm-trend-note').innerText(), /سربار/);
    await page.setViewportSize({ width: 1360, height: 1500 });
    await page.screenshot({ path: `${shotDir}/evm-trend.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });
});
