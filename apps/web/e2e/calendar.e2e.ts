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

interface Cal {
  days: { working: boolean; from: string; to: string }[];
  holidays: { date: string; title: string }[];
}
const calendar = async (stack: Stack, pid: number): Promise<Cal> => (await stack.admin.call<{ calendar: Cal }>('GET', `/projects/${pid}/model`)).calendar;

describe('تقویم کاری', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    for (const [u, name, role] of [['mgr7', 'مدیریت هفت', 'management'], ['com7', 'بازرگانی هفت', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('هفته‌ی کاری: الگو در فرم اعمال می‌شود، اثر نشان داده می‌شود و فقط با تأیید ذخیره می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.setViewportSize({ width: 1360, height: 1500 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/cal`);
    await page.getByTestId('week-table').waitFor();
    await page.screenshot({ path: `${shotDir}/calendar.png` });
    assert.equal(await page.getByRole('checkbox', { name: 'جمعه کاری است' }).isChecked(), false);
    assert.equal(await page.getByRole('checkbox', { name: 'پنجشنبه کاری است' }).isChecked(), true);
    assert.match(await page.getByTestId('week-hours').innerText(), /۴۴/);
    assert.equal(await page.getByTestId('week-save').isDisabled(), true);

    await page.getByLabel('الگوی آماده').selectOption({ label: 'شنبه تا چهارشنبه، پنجشنبه و جمعه تعطیل (۰۸:۰۰ تا ۱۶:۰۰)' });
    await page.getByTestId('week-apply-template').click();
    assert.equal(await page.getByRole('checkbox', { name: 'پنجشنبه کاری است' }).isChecked(), false);
    assert.match(await page.getByTestId('week-hours').innerText(), /۴۰/);
    // تا تأیید چیزی ذخیره نشده
    assert.equal((await calendar(stack, seed.pid)).days[4]!.working, true);

    await page.getByTestId('week-save').click();
    const impact = page.getByTestId('calendar-impact');
    await impact.waitFor();
    assert.match(await impact.innerText(), /پایان پروژه/);
    assert.match(await impact.innerText(), /دیرتر/);
    assert.match(await page.getByRole('dialog').innerText(), /خط مبنا با تاریخ‌های ثبت‌شده‌اش ثابت می‌ماند/);
    await page.screenshot({ path: `${shotDir}/calendar-impact.png` });
    // انصراف: ذخیره نمی‌شود
    await page.getByRole('dialog').getByRole('button', { name: 'انصراف' }).click();
    assert.equal((await calendar(stack, seed.pid)).days[4]!.working, true);

    await page.getByTestId('week-save').click();
    await page.getByTestId('week-confirm').click();
    await page.getByText('هفته‌ی کاری ذخیره شد.').first().waitFor();
    const saved = await calendar(stack, seed.pid);
    assert.equal(saved.days[4]!.working, false);
    assert.equal(saved.days[6]!.from, '08:00');
    assert.equal(saved.days[6]!.to, '16:00');

    // ساعت پایان قبل از شروع: ذخیره ممکن نیست
    await page.getByLabel('ساعت پایان شنبه').fill('۰۷:۰۰');
    await page.getByText(/ساعت پایان هر روز کاری باید بعد از ساعت شروع باشد/).waitFor();
    assert.equal(await page.getByTestId('week-save').isDisabled(), true);
    await page.getByTestId('week-reset').click();

    // بازگشت به پیش‌فرض
    await page.getByLabel('الگوی آماده').selectOption({ index: 0 });
    await page.getByTestId('week-apply-template').click();
    await page.getByTestId('week-save').click();
    await page.getByTestId('week-confirm').click();
    // اعلانِ ذخیره‌ی قبلی هنوز روی صفحه است و `.first()` فوراً برمی‌گردد؛ پس تا ثبت واقعی در سرور صبر می‌کنیم
    const deadline = Date.now() + 10_000;
    while ((await calendar(stack, seed.pid)).days[4]!.working !== true && Date.now() < deadline) await page.waitForTimeout(100);
    assert.equal((await calendar(stack, seed.pid)).days[4]!.working, true);
    assert.deepEqual(errors, []);
  });

  it('تعطیلی از روی شبکه‌ی ماه افزوده، ویرایش و حذف می‌شود و اثرش بر برنامه دیده می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.setViewportSize({ width: 1360, height: 1500 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/cal`);
    await page.getByTestId('hol-month').waitFor();
    await page.getByText('تعطیلی ثبت نشده است').waitFor();
    await page.getByTestId('day-2026-10-21').click();
    const d = page.getByRole('dialog');
    await d.getByTestId('hol-title').fill('تعطیلی آزمون');
    await d.getByTestId('calendar-impact').waitFor();
    assert.match(await d.getByTestId('calendar-impact').innerText(), /فعالیت جابه‌جا می‌شود/);
    await page.screenshot({ path: `${shotDir}/holiday-add.png` });
    await d.getByTestId('hol-save').click();
    await page.getByTestId('hol-row-2026-10-21').waitFor();
    assert.deepEqual((await calendar(stack, seed.pid)).holidays, [{ date: '2026-10-21', title: 'تعطیلی آزمون' }]);
    await page.getByTestId('day-2026-10-21').waitFor();
    assert.match((await page.getByTestId('day-2026-10-21').getAttribute('aria-label')) ?? '', /تعطیل: تعطیلی آزمون/);

    // ویرایش عنوان
    await page.getByTestId('day-2026-10-21').click();
    await page.getByRole('dialog').getByTestId('hol-title').fill('عنوان تازه');
    await page.getByRole('dialog').getByTestId('hol-save').click();
    await page.getByText('عنوان تازه').first().waitFor();

    // جمعه: هشدار بی‌اثر بودن
    await page.getByTestId('day-2026-10-16').click();
    await page.getByRole('dialog').getByText(/در هفته‌ی کاری فعلی تعطیل است/).waitFor();
    await page.getByRole('dialog').getByRole('button', { name: 'انصراف' }).click();

    // حذف با تأیید
    await page.getByTestId('hol-del-2026-10-21').click();
    await page.getByRole('dialog').getByRole('button', { name: 'حذف شود' }).click();
    await page.getByText('تعطیلی ثبت نشده است').waitFor();
    assert.deepEqual((await calendar(stack, seed.pid)).holidays, []);
    assert.deepEqual(errors, []);
  });

  it('افزودن گروهی: خطا مانع ثبت است، پیش‌نمایش شمارش می‌کند و جایگزینی تعطیلی‌های بیرون از فهرست را حذف می‌کند', async () => {
    await stack.admin.call('POST', `/projects/${seed.pid}/calendar/holidays`, { holidays: [{ date: '2026-12-01', title: 'قدیمی' }], replace: true });
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.setViewportSize({ width: 1360, height: 1500 });
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/cal`);
    await page.getByTestId('hol-bulk').click();
    const d = page.getByRole('dialog');
    await d.getByTestId('hol-bulk-text').fill('۱۴۰۵/۰۸/۱۰ الف\nخراب\n۱۴۰۵/۰۸/۱۱ ب');
    await d.getByTestId('hol-bulk-summary').waitFor();
    assert.match(await d.getByTestId('hol-bulk-summary').innerText(), /خط ۲/);
    assert.equal(await d.getByTestId('hol-bulk-apply').isDisabled(), true);
    await d.getByTestId('hol-bulk-text').fill('۱۴۰۵/۰۸/۱۰ الف\n۱۴۰۵/۰۸/۱۱\tب\n۱۴۰۵/۰۸/۱۰ الف دوباره');
    assert.match(await d.getByTestId('hol-bulk-summary').innerText(), /۲ تعطیلی معتبر/);
    assert.match(await d.getByTestId('hol-bulk-summary').innerText(), /۱ ردیف تکراری/);
    assert.equal(await d.getByTestId('hol-bulk-apply').isDisabled(), false);
    // تا تأیید چیزی ثبت نشده
    assert.equal((await calendar(stack, seed.pid)).holidays.length, 1);
    await d.getByTestId('hol-bulk-replace').check();
    await d.getByText(/۱ تعطیلیِ موجود که در این فهرست نیست حذف می‌شود/).waitFor();
    await page.screenshot({ path: `${shotDir}/holiday-bulk.png` });
    await d.getByTestId('hol-bulk-apply').click();
    await page.getByText('۲ تعطیلی ثبت شد.').first().waitFor();
    const hs = (await calendar(stack, seed.pid)).holidays.map((h) => `${h.date} ${h.title}`);
    assert.deepEqual(hs, ['2026-11-01 الف دوباره', '2026-11-02 ب']);
    assert.deepEqual(errors, []);
  });

  it('نقش‌ها: مدیریت فقط می‌بیند؛ بازرگانی تب را ندارد', async () => {
    const mg = await newSession(browser, stack.baseUrl);
    await loginAs(mg.page, 'mgr7', USER_PASSWORD);
    await mg.page.goto(`/#/p/${seed.pid}/cal`);
    await mg.page.getByTestId('week-table').waitFor();
    assert.equal(await mg.page.getByTestId('week-save').count(), 0);
    assert.equal(await mg.page.getByTestId('hol-add').count(), 0);
    assert.equal(await mg.page.getByTestId('hol-bulk').count(), 0);
    assert.equal(await mg.page.getByTestId('day-2026-10-21').isDisabled(), true);
    assert.equal(await mg.page.getByRole('checkbox', { name: 'شنبه کاری است', exact: true }).isDisabled(), true);
    assert.equal(await mg.page.locator('[data-testid^="hol-del-"]').count(), 0);
    assert.deepEqual(mg.errors, []);
    const cm = await newSession(browser, stack.baseUrl);
    await loginAs(cm.page, 'com7', USER_PASSWORD);
    await cm.page.goto(`/#/p/${seed.pid}/cal`);
    await cm.page.getByText(/به بخش «تقویم کاری» دسترسی ندارد/).waitFor();
    assert.deepEqual(cm.errors, []);
  });
});
