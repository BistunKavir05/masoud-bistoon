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

describe('کاربران، اعضا و نقش‌ها', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    const pm = await stack.createUser('pm6', 'مدیر پروژه شش');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${pm}`, { roles: ['pm'] });
    const padm = await stack.createUser('padm6', 'ادمین پروژه شش');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${padm}`, { roles: ['admin'] });
    await stack.createUser('free6', 'کاربر آزاد شش');
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('ادمین سیستم: افزودن عضو، ویرایش نقش‌ها، حذف از پروژه و جدول دسترسی', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/usr`);
    await page.getByRole('heading', { name: 'کاربران' }).waitFor();
    await page.getByTestId('member-table').waitFor();
    assert.equal(await page.getByTestId('member-row-pm6').count(), 1);

    await page.getByTestId('member-add').click();
    const d = page.getByRole('dialog');
    assert.equal(await d.getByTestId('member-save').isDisabled(), true);
    await d.getByLabel('کاربر', { exact: false }).first().selectOption({ label: 'کاربر آزاد شش (free6)' });
    await d.getByLabel('کارشناس', { exact: true }).check();
    await d.getByTestId('member-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const row = page.getByTestId('member-row-free6');
    await row.waitFor();
    assert.match(await row.innerText(), /کارشناس/);

    await page.getByTestId('member-edit-free6').click();
    await d.getByLabel('مالی', { exact: true }).check();
    await d.getByTestId('member-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => /مالی/.test(document.querySelector('[data-testid="member-row-free6"]')?.textContent ?? ''));

    // حذف: انصراف چیزی را عوض نمی‌کند
    await page.getByTestId('member-del-free6').click();
    await page.getByRole('button', { name: 'انصراف' }).click();
    assert.equal(await page.getByTestId('member-row-free6').count(), 1);
    await page.getByTestId('member-del-free6').click();
    await page.getByRole('button', { name: 'حذف شود' }).click();
    await page.getByTestId('member-row-free6').waitFor({ state: 'detached' });

    // جدول دسترسی
    await page.getByText('نمایش جدول (چه نقشی چه کاری می‌تواند بکند)').click();
    const matrix = page.locator('.matrix-tbl tbody tr');
    assert.ok((await matrix.count()) >= 20);
    const commissionRow = page.locator('.matrix-tbl tbody tr', { hasText: 'مشاهده‌ی پورسانت' });
    await commissionRow.waitFor();
    await page.screenshot({ path: `${shotDir}/users.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it('ادمین سیستم: ساخت کاربر با گذرواژه‌ی تولیدشده، ورود با تغییر اجباری، بازنشانی و غیرفعال‌سازی', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/usr`);
    await page.getByTestId('user-table').waitFor();

    await page.getByTestId('user-add').click();
    const d = page.getByRole('dialog');
    await d.getByTestId('user-username').fill('ali6');
    await d.getByTestId('user-display').fill('علی ششم');
    await d.getByTestId('pw-input').fill('abc');
    await d.getByText('گذرواژه باید دست‌کم ۱۰ نویسه باشد.').waitFor();
    assert.equal(await d.getByTestId('user-save').isDisabled(), true);
    await d.getByTestId('pw-generate').click();
    const pw = await d.getByTestId('pw-input').inputValue();
    assert.ok(pw.length >= 12, pw);
    await d.getByTestId('user-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const row = page.getByTestId('user-row-ali6');
    await row.waitFor();
    assert.match(await row.innerText(), /باید گذرواژه را عوض کند/);
    assert.match(await row.innerText(), /هرگز/);

    // ورود کاربر تازه: تغییر گذرواژه‌ی اجباری
    const u = await newSession(browser, stack.baseUrl);
    await u.page.goto('/');
    await u.page.getByTestId('login-user').fill('ali6');
    await u.page.getByTestId('login-pass').fill(pw);
    await u.page.getByTestId('login-submit').click();
    await u.page.getByRole('heading', { name: 'تغییر گذرواژه' }).waitFor();
    assert.deepEqual(u.errors, []);
    await u.context.close();

    // بازنشانی گذرواژه
    await page.getByTestId('user-reset-ali6').click();
    await d.getByTestId('pw-input').fill('short');
    assert.equal(await d.getByTestId('reset-save').isDisabled(), true);
    await d.getByTestId('pw-generate').click();
    const pw2 = await d.getByTestId('pw-input').inputValue();
    await d.getByTestId('reset-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const u2 = await newSession(browser, stack.baseUrl);
    await u2.page.goto('/');
    await u2.page.getByTestId('login-user').fill('ali6');
    await u2.page.getByTestId('login-pass').fill(pw);
    await u2.page.getByTestId('login-submit').click();
    await u2.page.getByRole('alert').first().waitFor();
    assert.equal(await u2.page.getByTestId('user-menu').count(), 0);
    await u2.page.getByTestId('login-pass').fill(pw2);
    await u2.page.getByTestId('login-submit').click();
    await u2.page.getByRole('heading', { name: 'تغییر گذرواژه' }).waitFor();
    await u2.context.close();

    // غیرفعال‌سازی
    await page.getByTestId('user-edit-ali6').click();
    await d.getByLabel('حساب فعال است').uncheck();
    await d.getByTestId('user-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    await page.waitForFunction(() => /غیرفعال/.test(document.querySelector('[data-testid="user-row-ali6"]')?.textContent ?? ''));
    const u3 = await newSession(browser, stack.baseUrl);
    await u3.page.goto('/');
    await u3.page.getByTestId('login-user').fill('ali6');
    await u3.page.getByTestId('login-pass').fill(pw2);
    await u3.page.getByTestId('login-submit').click();
    await u3.page.getByRole('alert').first().waitFor();
    assert.equal(await u3.page.getByTestId('user-menu').count(), 0);
    await u3.context.close();

    // حفاظت از خود: ادمینی و فعال‌بودن حساب خودمان قابل برداشتن نیست
    await page.getByTestId('user-edit-admin').click();
    assert.equal(await d.getByLabel(/ادمین سیستم/).isDisabled(), true);
    assert.equal(await d.getByLabel('حساب فعال است').isDisabled(), true);
    await d.getByRole('button', { name: 'انصراف' }).click();
    await page.screenshot({ path: `${shotDir}/users-accounts.png`, fullPage: true });
    assert.deepEqual(errors, []);
  });

  it('ادمین پروژه (غیر ادمین سیستم) فقط اعضای پروژه را می‌بیند؛ مدیر پروژه به بخش دسترسی ندارد', async () => {
    const adm = await newSession(browser, stack.baseUrl);
    await loginAs(adm.page, 'padm6', USER_PASSWORD);
    await adm.page.goto(`/#/p/${seed.pid}/usr`);
    await adm.page.getByTestId('member-table').waitFor();
    assert.equal(await adm.page.getByTestId('user-table').count(), 0);
    assert.equal(await adm.page.getByTestId('user-add').count(), 0);
    await adm.page.getByTestId('member-add').click();
    const d = adm.page.getByRole('dialog');
    await d.getByLabel('کاربر', { exact: false }).first().selectOption({ label: 'کاربر آزاد شش (free6)' });
    await d.getByLabel('بازرگانی', { exact: true }).check();
    await d.getByTestId('member-save').click();
    await adm.page.getByTestId('member-row-free6').waitFor();
    assert.deepEqual(adm.errors, []);

    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm6', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/usr`);
    await pm.page.getByText(/به بخش «کاربران» دسترسی ندارد/).waitFor();
    // سرور هم رد می‌کند (نه فقط رابط)
    const status = await pm.page.evaluate(async () => (await fetch('/api/users', { credentials: 'same-origin' })).status);
    assert.equal(status, 403);
    assert.deepEqual(pm.errors, []);
  });
});
