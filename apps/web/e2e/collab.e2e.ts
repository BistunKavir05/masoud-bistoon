import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
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

describe('مستندات، گفتگو و گزارش تغییرات', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    for (const [u, name, role] of [['pm4', 'مدیر پروژه چهار', 'pm'], ['exp4', 'کارشناس چهار', 'expert'], ['com4', 'بازرگانی چهار', 'commerce'], ['mgr4', 'مدیریت چهار', 'management']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('مستندات: لینک نامعتبر رد می‌شود؛ افزودن، پیوند به فعالیت، جست‌وجو، ویرایش و حذف', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/docs`);
    await page.getByRole('heading', { name: 'مستندات' }).waitFor();
    await page.getByText('هنوز سندی ثبت نشده است').waitFor();

    await page.getByTestId('doc-add').click();
    const d = page.getByRole('dialog');
    await d.getByTestId('doc-title').fill('قرارداد اصلی');
    await d.getByTestId('doc-url').fill('ftp://files.example.com/contract.pdf');
    await d.getByText('نشانی باید با http:// یا https:// شروع شود.').first().waitFor();
    assert.equal(await d.getByTestId('doc-save').isDisabled(), true);
    await d.getByTestId('doc-url').fill('https://example.com/contract.pdf');
    await d.getByLabel('فعالیت مرتبط').selectOption(String(seed.tasks['طراحی مفهومی']));
    await d.getByTestId('doc-save').click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    const link = page.getByRole('link', { name: 'قرارداد اصلی' });
    await link.waitFor();
    assert.equal(await link.getAttribute('href'), 'https://example.com/contract.pdf');
    assert.equal(await link.getAttribute('target'), '_blank');
    assert.match((await link.getAttribute('rel')) ?? '', /noopener/);
    assert.match(await page.getByTestId('doc-table').innerText(), /طراحی مفهومی/);

    // سند دوم و جست‌وجو
    await page.getByTestId('doc-add').click();
    await d.getByTestId('doc-title').fill('نقشه‌ی سازه');
    await d.getByTestId('doc-url').fill('http://example.org/plan');
    await d.getByTestId('doc-save').click();
    await page.getByRole('link', { name: 'نقشه‌ی سازه' }).waitFor();
    assert.equal(await page.locator('[data-testid^="doc-row-"]').count(), 2);
    await page.getByTestId('doc-search').fill('نقشه');
    assert.equal(await page.locator('[data-testid^="doc-row-"]').count(), 1);
    await page.getByTestId('doc-search').fill('چیزی که نیست');
    await page.getByText('سندی با این فیلتر پیدا نشد.').waitFor();
    await page.getByTestId('doc-search').fill('');
    await page.screenshot({ path: `${shotDir}/docs.png` });

    // ویرایش
    await page.getByRole('button', { name: 'ویرایش نقشه‌ی سازه' }).click();
    await d.getByTestId('doc-title').fill('نقشه‌ی سازه (نسخه ۲)');
    await d.getByTestId('doc-save').click();
    await page.getByRole('link', { name: 'نقشه‌ی سازه (نسخه ۲)' }).waitFor();

    // حذف با تأیید؛ انصراف چیزی را حذف نمی‌کند
    await page.getByRole('button', { name: /^حذف نقشه/ }).click();
    await page.getByRole('button', { name: 'انصراف' }).click();
    assert.equal(await page.locator('[data-testid^="doc-row-"]').count(), 2);
    await page.getByRole('button', { name: /^حذف نقشه/ }).click();
    await page.getByRole('button', { name: 'حذف شود' }).click();
    await page.getByRole('link', { name: /نقشه‌ی سازه/ }).waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-testid^="doc-row-"]').count(), 1);
    assert.deepEqual(errors, []);
  });

  it('مستندات: مدیریت فقط می‌بیند؛ بازرگانی به بخش دسترسی ندارد', async () => {
    const mgr = await newSession(browser, stack.baseUrl);
    await loginAs(mgr.page, 'mgr4', USER_PASSWORD);
    await mgr.page.goto(`/#/p/${seed.pid}/docs`);
    await mgr.page.getByRole('link', { name: 'قرارداد اصلی' }).waitFor();
    assert.equal(await mgr.page.getByTestId('doc-add').count(), 0);
    assert.equal(await mgr.page.locator('[data-testid^="doc-edit-"]').count(), 0);
    assert.deepEqual(mgr.errors, []);

    const com = await newSession(browser, stack.baseUrl);
    await loginAs(com.page, 'com4', USER_PASSWORD);
    await com.page.goto(`/#/p/${seed.pid}/docs`);
    await com.page.getByText(/به بخش «مستندات» دسترسی ندارد/).waitFor();
    assert.deepEqual(com.errors, []);
  });

  it('گفتگو: ارسال، به‌روزرسانی خودکار برای دیگران، متن ساده، حذف شخصی و حذف توسط ناظر', async () => {
    const adm = await newSession(browser, stack.baseUrl);
    await loginAs(adm.page, 'admin', `${ADMIN_PASSWORD}-x`);
    await adm.page.goto(`/#/p/${seed.pid}/chat`);
    await adm.page.getByText('هنوز پیامی نیست').waitFor();

    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm4', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/chat`);
    const draft = pm.page.getByTestId('chat-draft');
    await draft.fill('خط اول');
    await draft.press('Shift+Enter');
    await draft.type('خط دوم');
    await draft.press('Enter');
    await pm.page.getByTestId('chat-list').getByText('خط دوم').waitFor();
    assert.equal(await draft.inputValue(), '');
    // متن HTML به‌صورت متن ساده نمایش داده می‌شود
    await draft.fill('<img src=x onerror=alert(1)> سلام');
    await draft.press('Enter');
    await pm.page.getByTestId('chat-list').getByText('<img src=x onerror=alert(1)> سلام').waitFor();
    assert.equal(await pm.page.getByTestId('chat-list').locator('img').count(), 0);

    // ادمین بدون بارگذاری مجدد، با به‌روزرسانی دوره‌ای پیام‌ها را می‌بیند
    await adm.page.getByTestId('chat-list').getByText('خط دوم').waitFor({ timeout: 20_000 });
    assert.match(await adm.page.getByTestId('chat-list').innerText(), /خط اول\s*\n?\s*خط دوم/);

    // کارشناس: حذف پیام دیگران را ندارد؛ پیام خودش را حذف می‌کند
    const ex = await newSession(browser, stack.baseUrl);
    await loginAs(ex.page, 'exp4', USER_PASSWORD);
    await ex.page.goto(`/#/p/${seed.pid}/chat`);
    await ex.page.getByTestId('chat-list').getByText('خط دوم').waitFor();
    assert.equal(await ex.page.locator('[data-testid^="msg-del-"]').count(), 0);
    await ex.page.getByTestId('chat-draft').fill('پیام کارشناس');
    await ex.page.getByTestId('chat-send').click();
    await ex.page.getByTestId('chat-list').getByText('پیام کارشناس').waitFor();
    assert.equal(await ex.page.locator('[data-testid^="msg-del-"]').count(), 1);
    await ex.page.screenshot({ path: `${shotDir}/chat.png` });
    await ex.page.locator('[data-testid^="msg-del-"]').click();
    await ex.page.getByRole('button', { name: 'حذف شود' }).click();
    await ex.page.getByText('این پیام حذف شد.').waitFor();
    assert.equal(await ex.page.getByText('پیام کارشناس').count(), 0);

    // مدیر پروژه (ناظر) پیام دیگران را حذف می‌کند
    await pm.page.reload();
    await pm.page.getByTestId('chat-list').getByText('این پیام حذف شد.').waitFor();
    assert.ok((await pm.page.locator('[data-testid^="msg-del-"]').count()) >= 2);
    const target = pm.page.locator('[data-testid^="msg-"]', { hasText: 'خط دوم' });
    await target.getByRole('button', { name: /حذف پیام/ }).click();
    await pm.page.getByRole('button', { name: 'حذف شود' }).click();
    await pm.page.getByTestId('chat-list').getByText('خط دوم').waitFor({ state: 'detached' });

    // بازرگانی هم می‌تواند گفتگو کند
    const com = await newSession(browser, stack.baseUrl);
    await loginAs(com.page, 'com4', USER_PASSWORD);
    await com.page.goto(`/#/p/${seed.pid}/chat`);
    await com.page.getByTestId('chat-draft').waitFor();
    for (const s of [adm, pm, ex, com]) assert.deepEqual(s.errors, []);
  });

  it('گزارش تغییرات: ادمین و مدیریت می‌بینند؛ فیلتر، جزئیات و خروجی CSV؛ مدیر پروژه و کارشناس دسترسی ندارند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/log`);
    await page.getByRole('heading', { name: 'گزارش تغییرات' }).waitFor();
    const table = page.getByTestId('log-table');
    await table.waitFor();
    const all = await page.locator('[data-testid^="log-row-"]').count();
    assert.ok(all > 5, `رخدادها کم است: ${all}`);
    await page.getByLabel('موضوع', { exact: true }).selectOption('document');
    await page.waitForFunction((n) => document.querySelectorAll('[data-testid^="log-row-"]').length < n, all);
    const docRows = page.locator('[data-testid^="log-row-"]');
    const nDoc = await docRows.count();
    assert.ok(nDoc >= 4, `باید ایجاد ۲، ویرایش و حذف سند ثبت شده باشد: ${nDoc}`);
    for (const t of await docRows.allInnerTexts()) assert.match(t, /سند/);
    // جست‌وجوی محلی
    await page.getByTestId('log-search').fill('نسخه ۲');
    assert.ok((await docRows.count()) < nDoc);
    await page.getByTestId('log-search').fill('');
    // جزئیات
    await docRows.first().getByRole('button', { name: 'جزئیات' }).click();
    const dlg = page.getByRole('dialog', { name: 'جزئیات رخداد' });
    await dlg.getByText('شناسه‌ی درخواست').waitFor();
    await page.screenshot({ path: `${shotDir}/log-detail.png` });
    await dlg.getByRole('button', { name: 'بستن' }).first().click();
    // خروجی CSV
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('log-export').click()]);
    assert.equal(dl.suggestedFilename(), `audit-${seed.pid}.csv`);
    const text = readFileSync((await dl.path())!, 'utf8');
    assert.match(text, /زمان/);
    assert.match(text, /سند/);
    await page.screenshot({ path: `${shotDir}/log.png` });

    // فیلتر کاربر
    await page.getByLabel('موضوع', { exact: true }).selectOption('');
    await page.getByLabel('کاربر', { exact: true }).selectOption({ label: 'کارشناس چهار' });
    await page.waitForFunction(() => document.querySelectorAll('[data-testid^="log-row-"]').length > 0);
    for (const t of await page.locator('[data-testid^="log-row-"]').allInnerTexts()) assert.match(t, /کارشناس چهار/);
    assert.deepEqual(errors, []);

    const mgr = await newSession(browser, stack.baseUrl);
    await loginAs(mgr.page, 'mgr4', USER_PASSWORD);
    await mgr.page.goto(`/#/p/${seed.pid}/log`);
    await mgr.page.getByTestId('log-table').waitFor();
    assert.deepEqual(mgr.errors, []);

    for (const u of ['pm4', 'exp4']) {
      const s = await newSession(browser, stack.baseUrl);
      await loginAs(s.page, u, USER_PASSWORD);
      await s.page.goto(`/#/p/${seed.pid}/log`);
      await s.page.getByText(/به بخش «گزارش تغییرات» دسترسی ندارد/).waitFor();
      assert.deepEqual(s.errors, []);
    }
  });
});
