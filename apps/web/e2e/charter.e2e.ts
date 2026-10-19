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

async function eventually(read: () => Promise<string>, re: RegExp, ms = 10_000): Promise<void> {
  const end = Date.now() + ms;
  let last = '';
  while (Date.now() < end) {
    last = await read();
    if (re.test(last)) return;
    await new Promise((r) => setTimeout(r, 100));
  }
  assert.match(last, re);
}

const latin = (s: string): string => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,\s]/g, '');

describe('منشور، قرارداد و پورسانت', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    for (const [u, name, role] of [['pm3', 'مدیر پروژه سه', 'pm'], ['fin3', 'مالی سه', 'finance'], ['com3', 'بازرگانی سه', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('ادمین منشور و قرارداد را پر می‌کند و پورسانت قابل پرداخت بر مبنای وصول محاسبه می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/chr`);
    await page.getByRole('heading', { name: 'منشور پروژه' }).waitFor();
    // منشور
    await page.getByTestId('charter-edit').click();
    await page.getByTestId('charter-client').fill('شرکت نمونه');
    await page.getByTestId('charter-save').click();
    await page.getByText('شرکت نمونه').waitFor();
    // قرارداد
    await page.getByTestId('contract-edit').click();
    const d = page.getByRole('dialog');
    await d.getByLabel('شماره‌ی قرارداد').fill('ق-۱۴۰۵-۱');
    await d.getByLabel('مبلغ قرارداد', { exact: true }).fill('۱۰۰۰۰۰۰۰۰۰');
    await d.getByLabel('حسن انجام کار', { exact: true }).selectOption('percent');
    await d.getByLabel('مقدار حسن انجام کار').fill('۱۰');
    await page.getByTestId('contract-save').click();
    await page.getByText('ق-۱۴۰۵-۱').waitFor();
    // فاکتور و وصول
    await page.getByTestId('collection-edit').click();
    await d.getByLabel('جمع مبلغ فاکتورشده').fill('۴۰۰۰۰۰۰۰۰');
    await d.getByLabel('جمع مبلغ وصول‌شده').fill('۳۰۰۰۰۰۰۰۰');
    await page.getByTestId('collection-save').click();
    // درصد پورسانت
    await page.getByTestId('commission-edit').click();
    await d.getByLabel(/پورسانت فروش/).fill('۲');
    await d.getByLabel(/پورسانت حسن انجام کار/).fill('۵');
    await page.getByTestId('commission-save').click();
    const table = page.getByTestId('commission-table');
    await table.waitFor();
    // فروش: ۲٪ × ۱ میلیارد = ۲۰ میلیون؛ وصول ۳۰٪ → قابل پرداخت ۶ میلیون؛ حسن انجام کار هنوز وصول نشده
    const read = async (): Promise<string> => latin(await table.innerText());
    await eventually(read, /20000000/);
    await eventually(read, /6000000/);
    await eventually(read, /5000000/);
    await eventually(read, /25000000/);
    // وصول بیش از فاکتور هشدار می‌دهد (ثبت را منع نمی‌کند)
    assert.equal(await page.getByTestId('contract-warnings').count(), 0);
    await page.getByTestId('collection-edit').click();
    await d.getByLabel('جمع مبلغ وصول‌شده').fill('۵۰۰۰۰۰۰۰۰');
    await page.getByTestId('collection-save').click();
    await page.getByText('مبلغ وصول‌شده از مبلغ فاکتورشده بیشتر است').waitFor();
    await page.screenshot({ path: `${shotDir}/charter.png`, fullPage: true });
    // تأیید پورسانت
    await page.getByTestId('approval-edit').click();
    await d.getByLabel('وضعیت تأیید').selectOption('approved');
    await page.getByTestId('approval-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.getByText('تأییدشده').first().waitFor();
    assert.deepEqual(errors, []);
  });

  it('مدیر پروژه منشور و قرارداد را می‌بیند ولی پورسانت و ثبت وصول ندارد', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'pm3', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/chr`);
    await page.getByRole('heading', { name: 'منشور پروژه' }).waitFor();
    assert.equal(await page.getByTestId('charter-edit').count(), 1);
    assert.equal(await page.getByTestId('contract-edit').count(), 1);
    assert.equal(await page.getByTestId('collection-edit').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'پورسانت' }).count(), 0);
    assert.deepEqual(errors, []);
  });

  it('مالی وصول را ثبت می‌کند؛ بازرگانی فقط می‌بیند', async () => {
    const fin = await newSession(browser, stack.baseUrl);
    await loginAs(fin.page, 'fin3', USER_PASSWORD);
    await fin.page.goto(`/#/p/${seed.pid}/chr`);
    await fin.page.getByRole('heading', { name: 'قرارداد', exact: true }).waitFor();
    assert.equal(await fin.page.getByTestId('collection-edit').count(), 1);
    assert.equal(await fin.page.getByTestId('charter-edit').count(), 0);
    assert.equal(await fin.page.getByTestId('approval-edit').count(), 0);
    assert.deepEqual(fin.errors, []);

    const com = await newSession(browser, stack.baseUrl);
    await loginAs(com.page, 'com3', USER_PASSWORD);
    await com.page.goto(`/#/p/${seed.pid}/chr`);
    await com.page.getByRole('heading', { name: 'پورسانت' }).waitFor();
    await com.page.screenshot({ path: `${shotDir}/charter-commerce.png`, fullPage: true });
    assert.equal(await com.page.getByRole('heading', { name: 'منشور پروژه' }).count(), 0);
    assert.equal(await com.page.locator('[data-testid$="-edit"]').count(), 0);
    await com.page.getByText('پورسانت فقط برای مشاهده است.').waitFor();
    assert.deepEqual(com.errors, []);
  });
});
