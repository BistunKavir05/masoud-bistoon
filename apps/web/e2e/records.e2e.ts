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

describe('ریسک، تغییر و تصمیم', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('ریسک ثبت، ویرایش و حذف می‌شود و ماتریس به‌روز می‌ماند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/ri`);
    await page.getByText('هنوز ریسک ثبت نشده است').waitFor();
    await page.getByTestId('risk-add').click();
    await page.getByTestId('risk-title').fill('تأخیر در تأمین تجهیزات');
    await page.getByLabel(/احتمال/).fill('۴');
    await page.getByLabel(/اثر \(۱ تا ۵\)/).fill('۵');
    await page.getByTestId('risk-save').click();
    await page.getByTestId('risk-table').waitFor();
    const matrix = page.getByTestId('risk-matrix');
    // احتمال ۴ × اثر ۵ = ۲۰ → بحرانی؛ یک ریسک در ماتریس
    await matrix.getByRole('cell', { name: /تأخیر در تأمین تجهیزات/ }).waitFor();
    await page.getByRole('cell', { name: 'بحرانی' }).first().waitFor();
    await page.screenshot({ path: `${shotDir}/risks.png`, fullPage: true });

    // ویرایش: بستن ریسک آن را از ماتریس بیرون می‌برد
    await page.getByRole('button', { name: /ویرایش تأخیر/ }).click();
    await page.getByRole('dialog').getByLabel('وضعیت').selectOption('closed');
    await page.getByTestId('risk-save').click();
    await page.getByText('تغییرات ذخیره شد.').first().waitFor();
    assert.equal(await matrix.getByRole('cell', { name: /تأخیر در تأمین تجهیزات/ }).count(), 0);

    // حذف با تأیید
    await page.getByRole('button', { name: /حذف تأخیر/ }).click();
    await page.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByText('هنوز ریسک ثبت نشده است').waitFor();
    assert.deepEqual(errors, []);
  });

  it('مسئله و تصمیم ثبت می‌شوند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/ri`);
    await page.getByRole('tab', { name: /مسائل/ }).click();
    await page.getByTestId('issue-add').click();
    await page.getByTestId('issue-title').fill('نبود دسترسی به سایت');
    await page.getByLabel('نیاز به تصمیم دارد').check();
    await page.getByTestId('issue-save').click();
    await page.getByText('نبود دسترسی به سایت').waitFor();
    // تصمیم
    await page.goto(`/#/p/${seed.pid}/dec`);
    await page.getByTestId('dec-add').click();
    await page.getByTestId('dec-topic').fill('تغییر پیمانکار');
    await page.getByTestId('dec-save').click();
    await page.getByText('تغییر پیمانکار').waitFor();
    assert.deepEqual(errors, []);
  });

  it('تأیید تغییر فقط با مدیریت و بدون تغییر خودکار برنامه', async () => {
    const pmId = await stack.createUser('pm1', 'مدیر پروژه');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${pmId}`, { roles: ['pm'] });
    const mgId = await stack.createUser('mgr1', 'مدیریت');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${mgId}`, { roles: ['management'] });

    // مدیر پروژه درخواست ثبت می‌کند اما دکمه‌ی تأیید ندارد
    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm1', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/chg`);
    await pm.page.getByTestId('chg-add').click();
    await pm.page.getByTestId('chg-title').fill('افزودن فاز دوم');
    await pm.page.getByTestId('chg-save').click();
    await pm.page.getByText('افزودن فاز دوم').waitFor();
    assert.equal(await pm.page.locator('[data-testid^="chg-approve-"]').count(), 0);
    assert.deepEqual(pm.errors, []);

    // مدیریت تأیید می‌کند
    const mg = await newSession(browser, stack.baseUrl);
    await loginAs(mg.page, 'mgr1', USER_PASSWORD);
    await mg.page.goto(`/#/p/${seed.pid}/chg`);
    const approve = mg.page.locator('[data-testid^="chg-approve-"]').first();
    await approve.waitFor();
    await approve.click();
    await mg.page.getByRole('cell', { name: 'تأییدشده' }).first().waitFor();
    await mg.page.screenshot({ path: `${shotDir}/changes.png`, fullPage: true });
    assert.equal(await mg.page.locator('[data-testid^="chg-approve-"]').count(), 0);
    assert.deepEqual(mg.errors, []);
  });

  it('کارشناس ریسک‌ها را می‌بیند اما دکمه‌ی افزودن ندارد', async () => {
    const id = await stack.createUser('exp1', 'کارشناس');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: ['expert'] });
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'exp1', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/ri`);
    await page.getByRole('heading', { name: 'ریسک و مسئله' }).waitFor();
    assert.equal(await page.getByTestId('risk-add').count(), 0);
    assert.deepEqual(errors, []);
  });
});
