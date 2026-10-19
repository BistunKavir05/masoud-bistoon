import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync } from 'node:fs';
import type { Browser, Page } from 'playwright';
import { launch, newSession, shotDir } from './browser.ts';
import { ADMIN_PASSWORD, USER_PASSWORD, startStack } from './harness.ts';
import type { Stack } from './harness.ts';
import { seedProject } from './seed.ts';
import type { SeedIds } from './seed.ts';
import { writeXlsx } from '../src/lib/xlsx.ts';

async function loginAs(page: Page, user: string, pass: string): Promise<void> {
  await page.goto('/');
  await page.getByTestId('login-user').fill(user);
  await page.getByTestId('login-pass').fill(pass);
  await page.getByTestId('login-submit').click();
  await page.getByTestId('user-menu').waitFor();
}

const latin = (s: string): string => s.replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d))).replace(/[٬,\s]/g, '');
const csvBuf = (rows: string[][]): Buffer => Buffer.from(rows.map((r) => r.join(',')).join('\n'), 'utf8');

describe('مدیریت پروژه‌ها (پورتفولیو)', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  let second = 0;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin);
    const r = await stack.admin.call<{ project: { id: number } }>('POST', '/projects', { name: 'پروژه‌ی دوم', start: '2026-09-12', status: '2026-10-19', finance: { unit: 'تومان' } }, 201);
    second = r.project.id;
    await stack.admin.call('POST', '/portfolio/import', {
      updates: [
        { projectId: seed.pid, charter: { client: 'شرکت قبلی', location: 'یاسوج' }, contract: { number: 'QA-1', amount: 1_000_000_000, invoicedTotal: 500_000_000, collectedTotal: 300_000_000, salesCommissionPercent: 2 } },
        { projectId: second, contract: { number: 'QA-1', amount: 400 } },
      ],
    });
    const pm = await stack.createUser('pm7', 'مدیر پروژه هفت');
    await stack.admin.call('PUT', `/projects/${seed.pid}/members/${pm}`, { roles: ['pm'] });
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('جدول، جمع‌ها به‌تفکیک واحد پول، هشدارها، جست‌وجو و باز کردن پروژه', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/port`);
    await page.getByRole('heading', { name: 'مدیریت پروژه‌ها' }).waitFor();
    await page.getByTestId('port-table').waitFor();
    assert.equal(await page.locator('[data-testid^="port-row-"]').count(), 2);
    // واحدهای مختلف: جمع جدا، هشدار نمایش داده می‌شود
    await page.getByText(/واحد پولی متفاوت دارند/).waitFor();
    assert.equal(await page.locator('[data-testid="port-totals"] tbody tr').count(), 2);
    const totals = latin(await page.getByTestId('port-totals').innerText());
    assert.match(totals, /1000000000/);
    assert.match(totals, /400/);
    // نبود کارفرما برای پروژه‌ی دوم و شماره قرارداد تکراری
    assert.match(await page.getByTestId('port-missing').innerText(), /پروژه‌ی دوم/);
    await page.getByText(/شماره قرارداد تکراری: QA-1/).waitFor();
    await page.screenshot({ path: `${shotDir}/portfolio.png` });
    // جست‌وجو
    await page.getByTestId('port-search').fill('یاسوج');
    assert.equal(await page.locator('[data-testid^="port-row-"]').count(), 1);
    await page.getByTestId('port-search').fill('');
    // باز کردن
    await page.getByTestId(`port-open-${seed.pid}`).click();
    await page.getByRole('heading', { name: 'منشور پروژه' }).waitFor();
    assert.deepEqual(errors, []);
  });

  it('خروجی CSV و Excel', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/port`);
    await page.getByTestId('port-table').waitFor();
    const [csv] = await Promise.all([page.waitForEvent('download'), page.getByTestId('port-csv').click()]);
    assert.equal(csv.suggestedFilename(), 'bistoon-projects.csv');
    const text = readFileSync((await csv.path())!, 'utf8');
    assert.match(text, /شماره قرارداد/);
    assert.match(text, /پروژه‌ی نمونه/);
    assert.match(text, /1000000000/);
    const [xl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('port-xlsx').click()]);
    assert.equal(xl.suggestedFilename(), 'bistoon-projects.xlsx');
    const bytes = readFileSync((await xl.path())!);
    assert.equal(bytes.subarray(0, 2).toString('latin1'), 'PK');
    const [tpl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('port-template').click()]);
    assert.equal(tpl.suggestedFilename(), 'bistoon-projects-template.csv');
    assert.deepEqual(errors, []);
  });

  it('ورود از CSV: پیش‌نمایش، سلول خالی چیزی را پاک نمی‌کند، پروژه‌ی ناموجود وارد نمی‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/port`);
    await page.getByTestId('port-table').waitFor();
    await page.getByTestId('port-file').setInputFiles({
      name: 'contracts.csv',
      mimeType: 'text/csv',
      buffer: csvBuf([
        ['پروژه', 'شماره قرارداد', 'نام مشتری (کارفرما)', 'مبلغ قرارداد (ریال)', 'مبلغ کل وصول‌شده', 'تأییدیه فروش'],
        ['پروژه‌ی نمونه', 'QA-2', '', '۲٬۰۰۰٬۰۰۰٬۰۰۰', '', 'تأیید شده'],
        ['پروژه‌ی ناموجود', 'X', 'ک', '5', '', ''],
        ['پروژه‌ی دوم', '', 'شرکت دوم', 'abc', '', ''],
      ]),
    });
    const dlg = page.getByRole('dialog', { name: 'ورود اطلاعات قرارداد از فایل' });
    await dlg.getByTestId('pimport-table').waitFor();
    const counts = await dlg.getByTestId('pimport-counts').innerText();
    assert.match(counts, /قابل ورود: ۱/);
    assert.match(counts, /پروژه پیدا نشد: ۱/);
    assert.match(counts, /قابل ورود \(برخی سلول‌ها نامعتبر و نادیده\): ۱/);
    await dlg.getByText(/نامعتبر و نادیده: مبلغ قرارداد/).waitFor();
    await page.screenshot({ path: `${shotDir}/portfolio-import.png` });
    assert.match(await dlg.getByTestId('pimport-summary').innerText(), /۲/);
    await dlg.getByTestId('pimport-apply').click();
    await page.getByRole('dialog', { name: 'ورود انجام شد' }).waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    // مبلغ و شماره‌ی قرارداد عوض شد؛ کارفرمای قبلی (سلول خالی) سر جایش ماند؛ وصول‌شده دست‌نخورده
    const row = page.getByTestId(`port-row-${seed.pid}`);
    await row.waitFor();
    const t = latin(await row.innerText());
    assert.match(t, /QA-2/);
    assert.match(t, /2000000000/);
    assert.match(t, /شرکتقبلی/);
    assert.match(t, /300000000/);
    const second2 = latin(await page.getByTestId(`port-row-${second}`).innerText());
    assert.match(second2, /شرکتدوم/);
    assert.match(second2, /400/);
    // لاگ پروژه: ورود با منبع مشخص ثبت شده
    const log = await stack.admin.call<{ entries: { details: { source?: string } | null; action: string }[] }>('GET', `/projects/${seed.pid}/audit?limit=200`);
    assert.ok(log.entries.some((e) => e.details?.source === 'portfolio.import' && e.action === 'contract.update'));
    assert.deepEqual(errors, []);
  });

  it('ورود از Excel، فایل نامعتبر و فرمت پشتیبانی‌نشده', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/port`);
    await page.getByTestId('port-table').waitFor();
    const xlsx = writeXlsx([{ name: 'پروژه‌ها', rows: [['پروژه', 'مبلغ پیش‌پرداخت', 'تاریخ انعقاد قرارداد'], ['پروژه‌ی نمونه', 123456789, '1405/07/10']] }]);
    await page.getByTestId('port-file').setInputFiles({ name: 'c.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: Buffer.from(xlsx) });
    const dlg = page.getByRole('dialog', { name: 'ورود اطلاعات قرارداد از فایل' });
    await dlg.getByTestId('pimport-apply').click();
    await page.getByRole('dialog', { name: 'ورود انجام شد' }).waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    const t = latin(await page.getByTestId(`port-row-${seed.pid}`).innerText());
    assert.match(t, /123456789/);
    assert.match(t, /1405\/07\/10/);

    // ستون قابل‌شناسایی ندارد
    await page.getByTestId('port-file').setInputFiles({ name: 'bad.csv', mimeType: 'text/csv', buffer: csvBuf([['الف', 'ب'], ['1', '2']]) });
    await page.getByRole('dialog', { name: 'فایل قابل ورود نیست' }).waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    // فرمت پشتیبانی‌نشده
    await page.getByTestId('port-file').setInputFiles({ name: 'old.xls', mimeType: 'application/vnd.ms-excel', buffer: Buffer.from('x') });
    await page.getByRole('dialog', { name: 'فایل پشتیبانی نمی‌شود' }).waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    assert.deepEqual(errors, []);
  });

  it('مدیر پروژه به این بخش دسترسی ندارد (رابط و سرور)', async () => {
    const s = await newSession(browser, stack.baseUrl);
    await loginAs(s.page, 'pm7', USER_PASSWORD);
    await s.page.goto(`/#/p/${seed.pid}/port`);
    await s.page.getByText(/به بخش «مدیریت پروژه‌ها» دسترسی ندارد/).waitFor();
    assert.equal(await s.page.getByTestId('port-table').count(), 0);
    const status = await s.page.evaluate(async () => (await fetch('/api/portfolio', { credentials: 'same-origin' })).status);
    assert.equal(status, 403);
    assert.deepEqual(s.errors, []);
  });
});
