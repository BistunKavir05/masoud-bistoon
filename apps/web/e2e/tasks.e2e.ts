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

describe('فعالیت‌ها', () => {
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

  it('ادمین فعالیت‌ها را می‌بیند، ویرایش درجا می‌کند و ساختار را تغییر می‌دهد', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByTestId('tasks-table').waitFor();
    await page.screenshot({ path: `${shotDir}/tasks.png` });
    const rows = page.locator('[data-testid^="task-row-"]');
    assert.equal(await rows.count(), 9);
    // پیشرفت درجا
    const id = seed.tasks['طراحی مفهومی']!;
    await page.getByTestId(`task-row-${id}`).getByRole('button', { name: /ویرایش درصد پیشرفت/ }).click();
    await page.getByRole('textbox', { name: /درصد پیشرفت/ }).fill('۵۰');
    await page.keyboard.press('Enter');
    await page.getByTestId(`task-row-${id}`).getByText('۵۰٪').waitFor();
    // افزودن فعالیت
    await page.getByTestId('add-task').click();
    await page.getByTestId('add-name').fill('فعالیت تازه');
    await page.getByTestId('add-submit').click();
    await page.getByText('فعالیت تازه').waitFor();
    assert.equal(await rows.count(), 10);
    await page.screenshot({ path: `${shotDir}/tasks-added.png` });
    assert.deepEqual(errors, []);
  });
});
