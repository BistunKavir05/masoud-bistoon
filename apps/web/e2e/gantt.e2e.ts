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

describe('گانت', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    for (const [u, name, role] of [['mgr6', 'مدیریت شش', 'management'], ['com6', 'بازرگانی شش', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('میله‌ها، گروه‌ها، مایلستون‌ها، خط مبنا و ارتباط‌ها از داده‌ی واقعی رسم می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.setViewportSize({ width: 1360, height: 900 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/gantt`);
    await page.getByTestId('gantt-body').waitFor();
    assert.equal(await page.locator('[data-testid^="gantt-row-"]').count(), 9);
    assert.equal(await page.locator('.g-task').count(), 5);
    assert.equal(await page.locator('.g-sum').count(), 2);
    assert.equal(await page.locator('.g-ms').count(), 2);
    assert.equal(await page.locator('path.g-link').count(), 6);
    assert.equal(await page.locator('.g-base').count(), 9);
    await page.screenshot({ path: `${shotDir}/gantt.png` });

    // انتخاب فعالیت: جزئیات و برجسته‌شدن ارتباط‌هایش
    await page.getByTestId(`gantt-row-${seed.tasks['طراحی تفصیلی']}`).getByRole('button', { name: /طراحی تفصیلی/ }).click();
    const d = page.getByTestId('gantt-details');
    await d.waitFor();
    const text = await d.innerText();
    assert.match(text, /طراحی مفهومی \(FS\)/);
    assert.match(text, /تأیید طراحی/);
    assert.equal(await page.locator('path.g-link.hot').count(), 2);
    await page.screenshot({ path: `${shotDir}/gantt-selected.png` });

    // کلیک روی میله هم انتخاب می‌کند
    const bar = page.locator('.g-task').first();
    const box = (await bar.boundingBox())!;
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
    await page.locator('.gantt-details').getByText(/طراحی مفهومی/).first().waitFor();
    assert.deepEqual(errors, []);
  });

  it('بزرگ‌نمایی، بستن گروه، فقط بحرانی و خاموش‌کردن لایه‌ها', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.setViewportSize({ width: 1360, height: 900 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/gantt`);
    const svg = page.getByTestId('gantt-body');
    await svg.waitFor();
    const wDay = Number(await svg.getAttribute('width'));
    await page.getByRole('group', { name: 'بزرگ‌نمایی' }).getByRole('button', { name: 'هفته' }).click();
    const wWeek = Number(await svg.getAttribute('width'));
    await page.getByRole('group', { name: 'بزرگ‌نمایی' }).getByRole('button', { name: 'ماه' }).click();
    const wMonth = Number(await svg.getAttribute('width'));
    assert.ok(wDay > wWeek && wWeek > wMonth, `${wDay} ${wWeek} ${wMonth}`);
    await page.screenshot({ path: `${shotDir}/gantt-month.png` });
    await page.getByRole('group', { name: 'بزرگ‌نمایی' }).getByRole('button', { name: 'روز' }).click();

    // بستن یک گروه، فرزندانش را پنهان می‌کند؛ ارتباط‌های یک‌سر‌پنهان رسم نمی‌شود
    await page.getByRole('button', { name: 'بستن گروه مهندسی' }).click();
    assert.equal(await page.locator('[data-testid^="gantt-row-"]').count(), 6);
    assert.ok((await page.locator('path.g-link').count()) < 6);
    await page.getByTestId('gantt-collapse').click(); // «باز کردن همه‌ی گروه‌ها»
    assert.equal(await page.locator('[data-testid^="gantt-row-"]').count(), 9);
    // بستن همه
    await page.getByTestId('gantt-collapse').click();
    assert.equal(await page.locator('[data-testid^="gantt-row-"]').count(), 3); // مهندسی، ساخت، تحویل نهایی
    await page.getByTestId('gantt-collapse').click();

    // لایه‌ها
    await page.getByTestId('gantt-links').uncheck();
    assert.equal(await page.locator('path.g-link').count(), 0);
    await page.getByTestId('gantt-base').uncheck();
    assert.equal(await page.locator('.g-base').count(), 0);

    // فقط بحرانی: در این پروژه‌ی زنجیره‌ای همه‌ی فعالیت‌ها بحرانی‌اند و گروه‌ها حفظ می‌شوند
    await page.getByTestId('gantt-critical').check();
    assert.ok((await page.locator('[data-testid^="gantt-row-"]').count()) >= 7);
    assert.deepEqual(errors, []);
  });

  it('نقش‌ها: مدیریت گانت را می‌بیند، بازرگانی دسترسی ندارد', async () => {
    const mg = await newSession(browser, stack.baseUrl);
    await loginAs(mg.page, 'mgr6', USER_PASSWORD);
    await mg.page.goto(`/#/p/${seed.pid}/gantt`);
    await mg.page.getByTestId('gantt-body').waitFor();
    assert.deepEqual(mg.errors, []);
    const cm = await newSession(browser, stack.baseUrl);
    await loginAs(cm.page, 'com6', USER_PASSWORD);
    await cm.page.goto(`/#/p/${seed.pid}/gantt`);
    await cm.page.getByText(/به بخش «گانت» دسترسی ندارد/).waitFor();
    assert.equal(await cm.page.getByTestId('gantt-body').count(), 0);
    assert.deepEqual(cm.errors, []);
  });
});
