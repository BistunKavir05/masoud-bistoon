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

describe('داشبورد و نقش‌ها', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    // مقداری پیشرفت و تأخیر: طراحی مفهومی کندتر از برنامه
    const m = await stack.admin.call<{ tasks: { id: number; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t = m.tasks.find((x) => x.id === seed.tasks['طراحی مفهومی'])!;
    await stack.admin.call('PATCH', `/projects/${seed.pid}/tasks/${t.id}`, { version: t.version, patch: { percentComplete: 40 } });
    await stack.admin.call('PATCH', `/projects/${seed.pid}/contract`, { version: 1, number: 'ق-۱۴۰۵-۱۲', amount: 1_000_000_000, invoicedTotal: 400_000_000, collectedTotal: 300_000_000, salesCommissionPercent: 2 });
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('ادمین شاخص‌ها، هشدار، مراحل و مالی را می‌بیند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/dash`);
    await page.getByRole('heading', { name: 'وضعیت و مراحل پروژه' }).waitFor();
    await page.getByRole('heading', { name: 'شاخص‌های مالی' }).waitFor();
    await page.getByRole('heading', { name: 'قرارداد و وصول' }).waitFor();
    await page.screenshot({ path: `${shotDir}/dashboard.png`, fullPage: true });
    assert.equal(await page.getByRole('progressbar', { name: 'مهندسی' }).count(), 1);
    assert.deepEqual(errors, []);
  });

  it('بازرگانی فقط وضعیت و قرارداد را می‌بیند و منوی فعالیت‌ها ندارد', async () => {
    const uid = await stack.createUser('bazar', 'بازرگانی نمونه');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${uid}`, { roles: ['commerce'] });
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'bazar', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/dash`);
    await page.getByRole('heading', { name: 'قرارداد و وصول' }).waitFor();
    await page.screenshot({ path: `${shotDir}/dashboard-commerce.png`, fullPage: true });
    assert.equal(await page.getByTestId('nav-tasks').count(), 0);
    assert.equal(await page.getByTestId('nav-fin').count(), 0);
    assert.equal(await page.getByRole('heading', { name: 'شاخص‌های مالی' }).count(), 0);
    assert.equal(await page.getByText('فعالیت‌های بحرانی').count(), 0);
    // پورسانت را می‌بیند (فقط مشاهده)
    await page.getByText('پورسانت قابل پرداخت').waitFor();
    // ورود مستقیم به آدرس فعالیت‌ها پیام دسترسی می‌دهد
    await page.goto(`/#/p/${seed.pid}/tasks`);
    await page.getByText('به بخش «فعالیت‌ها» دسترسی ندارد').waitFor();
    assert.deepEqual(errors, []);
  });
});
