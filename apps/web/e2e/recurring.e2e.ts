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

describe('فعالیت تکرارشونده', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  let groupId = 0;
  const NAME = 'جلسه‌ی هفتگی';
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    for (const [u, name, role] of [['pm7', 'مدیر پروژه هفت', 'pm'], ['exp7', 'کارشناس هفت', 'expert'], ['com7', 'بازرگانی هفت', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  const rows = (page: Page) => page.locator('[data-testid^="task-row-"]');
  const open = async (page: Page): Promise<void> => {
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
  };

  it('ساخت: پیش‌نمایش زنده، خطای روز هفته، سپس ساخت گروه و رخدادها', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await open(page);
    assert.equal(await rows(page).count(), 9);

    await page.getByTestId('add-recurring').click();
    const save = page.getByTestId('rec-save');
    await page.getByTestId('rec-name').fill(NAME);
    await page.getByTestId('rec-count').fill('۴');
    const preview = page.getByTestId('rec-preview');
    await preview.getByText(/۴ رخداد/).waitFor();
    assert.equal(await save.isDisabled(), false);
    assert.equal(await preview.locator('li').count(), 4);
    assert.match((await preview.locator('li').first().innerText()).replace(/\s+/g, ' '), /جلسه‌ی هفتگی 1 — /);
    await page.screenshot({ path: `${shotDir}/recurring-dialog.png` });

    // هیچ روز هفته‌ای ← پیام خطا و ذخیره غیرفعال
    await page.getByTestId('rec-weekdays').getByLabel('شنبه', { exact: true }).uncheck();
    await preview.getByText('حداقل یک روز هفته را انتخاب کنید.').waitFor();
    assert.equal(await save.isDisabled(), true);
    await page.getByTestId('rec-weekdays').getByLabel('دوشنبه', { exact: true }).check();
    await preview.getByText(/۴ رخداد/).waitFor();
    assert.equal(await save.isDisabled(), false);

    // بازه‌ی بدون رخداد (پایان قبل از ... ) نیست؛ ولی تعداد ۴۰۰ هفتگی از افق برنامه بیرون می‌زند و فقط رخدادهای داخل افق ساخته می‌شود
    await page.getByTestId('rec-count').fill('۴۰۰');
    await preview.getByText(/رخداد/).first().waitFor();
    await page.getByTestId('rec-count').fill('۴');
    await preview.getByText(/^۴ رخداد/).waitFor();

    await save.click();
    await page.getByText(/۴ رخداد ساخته شد/).waitFor();
    await rows(page).nth(12).waitFor();
    assert.equal(await rows(page).count(), 14);
    const group = page.locator('[data-testid^="recurring-badge-"]');
    assert.equal(await group.count(), 1);
    groupId = Number((await group.first().getAttribute('data-testid'))!.replace('recurring-badge-', ''));
    assert.ok(groupId > 0);
    await page.getByTestId(`task-row-${groupId}`).getByText(NAME).first().waitFor();
    for (let k = 1; k <= 4; k++) await page.getByText(`${NAME} ${k}`, { exact: true }).waitFor();
    await page.screenshot({ path: `${shotDir}/recurring-created.png` });
    assert.deepEqual(errors, []);
  });

  it('ویرایش الگو: تعداد بیشتر، حفظ پیشرفت، هشدار حذف، و مانع هزینه', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await open(page);
    // دکمه‌ی ویرایش الگو فقط وقتی گروه تکرارشونده انتخاب است (چیدمان نوار ابزار ثابت می‌ماند)
    assert.equal(await page.getByTestId('edit-recurring').isDisabled(), true);
    await page.getByTestId(`task-row-${groupId}`).click();
    assert.equal(await page.getByTestId('edit-recurring').isDisabled(), false);
    await page.getByTestId('edit-recurring').click();
    assert.equal(await page.getByTestId('rec-name').inputValue(), NAME);
    await page.getByTestId('rec-count').fill('۶');
    const impact = page.getByTestId('rec-impact');
    await impact.getByText(/۴ رخداد حفظ می‌شود/).waitFor();
    await impact.getByText(/۲ رخداد تازه ساخته می‌شود/).waitFor();
    await page.screenshot({ path: `${shotDir}/recurring-edit.png` });
    await page.getByTestId('rec-save').click();
    await page.getByText('الگو ذخیره و رخدادها به‌روز شد.').waitFor();
    await rows(page).nth(14).waitFor();
    assert.equal(await rows(page).count(), 16);

    // پیشرفت و هزینه از طریق API روی رخدادهای پنجم و ششم
    const a = stack.admin;
    const m = await a.call<{ tasks: { id: number; name: string; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t5 = m.tasks.find((t) => t.name === `${NAME} 5`)!;
    const t6 = m.tasks.find((t) => t.name === `${NAME} 6`)!;
    await a.call('PATCH', `/projects/${seed.pid}/tasks/${t5.id}`, { version: t5.version, patch: { percentComplete: 40 } });
    await a.call('POST', `/projects/${seed.pid}/costs`, { date: '2026-10-05', taskId: t6.id, amount: 3000, description: 'پذیرایی' }, 201);
    await page.reload();
    await page.getByTestId('tasks-table').waitFor();
    await page.getByTestId(`task-row-${groupId}`).click();
    await page.getByTestId('edit-recurring').click();
    await page.getByTestId('rec-count').fill('۵');
    // رخداد ششم هزینه دارد ← مانع
    const im = page.getByTestId('rec-impact');
    await im.getByText(/هزینه‌ی ثبت‌شده دارند و حذف نمی‌شوند/).waitFor();
    assert.equal(await page.getByTestId('rec-save').isDisabled(), true);
    await page.getByTestId('rec-count').fill('۶');
    await page.getByText(/هزینه‌ی ثبت‌شده دارند/).waitFor({ state: 'detached' });
    // تغییر نام و مدت بدون تغییر تعداد: پیشرفت می‌ماند
    await page.getByTestId('rec-name').fill('جلسه‌ی هماهنگی');
    await page.getByTestId('rec-duration').fill('۲');
    await page.getByTestId('rec-save').click();
    await page.getByText('الگو ذخیره و رخدادها به‌روز شد.').waitFor();
    await page.getByText('جلسه‌ی هماهنگی 5', { exact: true }).waitFor();
    const after = await a.call<{ tasks: { id: number; name: string; duration: number; percentComplete: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t5b = after.tasks.find((t) => t.id === t5.id)!;
    assert.equal(t5b.name, 'جلسه‌ی هماهنگی 5');
    assert.equal(t5b.percentComplete, 40);
    assert.equal(t5b.duration, 2);
    assert.deepEqual(errors, []);
  });

  it('از دیالوگ ویرایش فعالیت هم به ویرایش الگو می‌رسیم', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await open(page);
    await page.getByTestId(`task-row-${groupId}`).dblclick();
    await page.getByTestId('td-edit-recurrence').click();
    await page.getByTestId('rec-name').waitFor();
    assert.equal(await page.getByTestId('rec-name').inputValue(), 'جلسه‌ی هماهنگی');
    assert.equal(await page.getByTestId('td-name').count(), 0, 'دیالوگ ویرایش فعالیت بسته شده');
    await page.getByRole('button', { name: 'انصراف' }).click();
    await page.getByTestId('rec-name').waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  });

  it('ماهانه و سالانه: فرم‌های مخصوص، خلاصه‌ی پیش‌نمایش', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await open(page);
    await page.getByTestId('add-recurring').click();
    await page.getByTestId('rec-name').fill('گزارش ماهانه');
    await page.getByRole('button', { name: 'ماهانه (شمسی)' }).click();
    await page.getByTestId('rec-monthday').fill('۵');
    await page.getByTestId('rec-count').fill('۳');
    const preview = page.getByTestId('rec-preview');
    await preview.getByText(/^۳ رخداد/).waitFor();
    assert.equal(await preview.locator('li').count(), 3);
    await page.getByRole('button', { name: 'یک روز هفته‌ی مشخص' }).click();
    await preview.getByText(/^۳ رخداد/).waitFor();
    await page.getByRole('button', { name: 'سالانه (شمسی)' }).click();
    await page.getByTestId('rec-count').fill('۲');
    await preview.getByText(/^۲ رخداد/).waitFor();
    await page.screenshot({ path: `${shotDir}/recurring-yearly.png` });
    await page.getByRole('button', { name: 'انصراف' }).click();
    assert.equal(await rows(page).count(), 16);
    assert.deepEqual(errors, []);
  });

  it('نقش‌های دیگر: کارشناس دکمه را نمی‌بیند؛ مدیر پروژه می‌بیند؛ بازرگانی اصلاً به فعالیت‌ها دسترسی ندارد', async () => {
    for (const [user, sees] of [['exp7', false], ['pm7', true]] as const) {
      const { page, errors } = await newSession(browser, stack.baseUrl);
      await loginAs(page, user, USER_PASSWORD);
      await open(page);
      assert.equal(await page.getByTestId('add-recurring').count(), sees ? 1 : 0, user);
      assert.equal(await page.getByTestId('edit-recurring').count(), sees ? 1 : 0, user);
      assert.equal(await page.locator('[data-testid^="recurring-badge-"]').count(), 1, `${user}: نشان تکرار برای همه‌ی نقش‌های دارای دسترسی به برنامه`);
      assert.deepEqual(errors, [], user);
    }
    const { page } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'com7', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.waitForTimeout(1500);
    assert.equal(await page.getByTestId('tasks-table').count(), 0);
    assert.equal(await page.getByTestId('add-recurring').count(), 0);
  });

  it('نمای موبایل: دیالوگ بدون اسکرول افقی', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl, { width: 390, height: 800 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await open(page);
    await page.getByTestId('add-recurring').click();
    await page.getByTestId('rec-name').fill('نمونه');
    await page.getByTestId('rec-preview').getByText(/رخداد/).first().waitFor();
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    assert.equal(overflow, false);
    await page.screenshot({ path: `${shotDir}/recurring-mobile.png` });
    assert.deepEqual(errors, []);
  });
});
