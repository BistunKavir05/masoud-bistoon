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

describe('منابع و تسطیح', () => {
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

  it('منبع افزوده، ویرایش و حذف می‌شود؛ منبع تخصیص‌یافته حذف نمی‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/res`);
    await page.getByTestId('res-table').waitFor();
    assert.equal(await page.locator('[data-testid^="res-row-"]').count(), 3);
    await page.getByTestId('res-add').click();
    await page.getByTestId('res-name').fill('بازرس کیفیت');
    await page.getByRole('dialog').getByLabel(/ظرفیت/).fill('۵۰');
    await page.getByTestId('res-save').click();
    await page.getByRole('cell', { name: 'بازرس کیفیت', exact: true }).waitFor();
    assert.equal(await page.locator('[data-testid^="res-row-"]').count(), 4);
    // نام نامعتبر
    await page.getByRole('button', { name: 'ویرایش بازرس کیفیت' }).click();
    await page.getByTestId('res-name').fill('الف، ب');
    await page.getByText('نباید «,» «،» یا «:» داشته باشد').waitFor();
    assert.equal(await page.getByTestId('res-save').isDisabled(), true);
    await page.getByTestId('res-name').fill('بازرس ارشد');
    await page.getByTestId('res-save').click();
    await page.getByRole('cell', { name: 'بازرس ارشد', exact: true }).waitFor();
    // حذف منبع تخصیص‌یافته مسدود است
    await page.getByRole('button', { name: 'حذف مهندس طراح' }).click();
    await page.getByText('به ۲ فعالیت تخصیص دارد').waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    // حذف منبع آزاد
    await page.getByRole('button', { name: 'حذف بازرس ارشد' }).click();
    await page.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByRole('cell', { name: 'بازرس ارشد', exact: true }).waitFor({ state: 'detached' });
    assert.deepEqual(errors, []);
  });

  it('بیش‌تخصیص دیده می‌شود، پیشنهاد تسطیح تا اعمال چیزی را تغییر نمی‌دهد و پاک‌کردن فقط قیدهای تسطیح را برمی‌دارد', async () => {
    // فعالیتی هم‌زمان با «طراحی مفهومی» روی همان مهندس
    const proj = await stack.admin.call<{ project: { structureVersion: number } }>('GET', `/projects/${seed.pid}`);
    const added = await stack.admin.call<{ newId: number }>('POST', `/projects/${seed.pid}/tasks`, { referenceId: seed.tasks['مهندسی']!, asChild: true, kind: 'task', name: 'بازبینی موازی', structureVersion: proj.project.structureVersion });
    const m = await stack.admin.call<{ tasks: { id: number; version: number }[] }>('GET', `/projects/${seed.pid}/model`);
    const t = m.tasks.find((x) => x.id === added.newId)!;
    await stack.admin.call('PATCH', `/projects/${seed.pid}/tasks/${added.newId}`, { version: t.version, patch: { duration: 5, assignments: [{ resourceId: seed.resources['مهندس طراح']!, units: 100 }] } });

    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/res`);
    await page.getByTestId('res-load').waitFor();
    await page.screenshot({ path: `${shotDir}/resources.png`, fullPage: true });
    const kpi = page.locator('.kpi', { hasText: 'روز-منبع بیش‌تخصیص' });
    await kpi.waitFor();
    assert.doesNotMatch((await kpi.innerText()).replace(/\s+/g, ' '), /^روز-منبع بیش‌تخصیص ۰ /);

    await page.getByTestId('res-suggest').click();
    await page.getByTestId('res-plan').waitFor();
    await page.screenshot({ path: `${shotDir}/resources-plan.png`, fullPage: true });
    // قبل از اعمال هیچ قیدی ثبت نشده است
    let model = await stack.admin.call<{ tasks: { startNoEarlierSource: string | null }[] }>('GET', `/projects/${seed.pid}/model`);
    assert.equal(model.tasks.filter((x) => x.startNoEarlierSource === 'leveling').length, 0);

    await page.getByTestId('res-apply').click();
    await page.getByRole('button', { name: 'اعمال پیشنهاد' }).last().click();
    await page.getByTestId('res-clear').waitFor();
    model = await stack.admin.call('GET', `/projects/${seed.pid}/model`);
    assert.equal(model.tasks.filter((x) => x.startNoEarlierSource === 'leveling').length >= 1, true);
    assert.equal(await page.getByTestId('res-plan').count(), 0);

    await page.getByTestId('res-clear').click();
    await page.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByTestId('res-clear').waitFor({ state: 'detached' });
    model = await stack.admin.call('GET', `/projects/${seed.pid}/model`);
    assert.equal(model.tasks.filter((x) => x.startNoEarlierSource === 'leveling').length, 0);
    assert.deepEqual(errors, []);
  });

  it('کارشناس فهرست و بار را می‌بیند ولی ابزار ویرایش و تسطیح ندارد', async () => {
    const uid = await stack.createUser('exp2', 'کارشناس دو');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${uid}`, { roles: ['expert'] });
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'exp2', USER_PASSWORD);
    await page.goto(`/#/p/${seed.pid}/res`);
    await page.getByTestId('res-table').waitFor();
    assert.equal(await page.getByTestId('res-add').count(), 0);
    assert.equal(await page.getByTestId('res-suggest').count(), 0);
    assert.deepEqual(errors, []);
  });
});
