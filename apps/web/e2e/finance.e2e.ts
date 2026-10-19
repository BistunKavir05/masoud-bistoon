import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
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

async function costs(stack: Stack, pid: number): Promise<{ id: number; amount: number; taskId: number | null; description: string }[]> {
  return (await stack.admin.call<{ costs: { id: number; amount: number; taskId: number | null; description: string }[] }>('GET', `/projects/${pid}/model`)).costs;
}

describe('مالی و دفتر هزینه', () => {
  let stack: Stack;
  let browser: Browser;
  let seed: SeedIds;
  const dir = '/tmp/bn/files';
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    mkdirSync(dir, { recursive: true });
    stack = await startStack();
    browser = await launch();
    seed = await seedProject(stack.admin, { baseline: true });
    for (const [u, name, role] of [['pm4', 'مدیر پروژه چهار', 'pm'], ['mgr4', 'مدیریت چهار', 'management'], ['com4', 'بازرگانی چهار', 'commerce']] as const) {
      const id = await stack.createUser(u, name);
      await stack.admin.call('PUT', `/projects/${seed.pid}/members/${id}`, { roles: [role] });
    }
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('شاخص‌های EVM و جدول فعالیت‌ها دیده می‌شود؛ هزینه ثبت، ویرایش و حذف می‌شود', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/fin`);
    await page.getByTestId('evm').waitFor();
    await page.getByTestId('fin-table').waitFor();
    await page.screenshot({ path: `${shotDir}/finance.png`, fullPage: true });

    await page.getByRole('tab', { name: /دفتر هزینه/ }).click();
    await page.getByText('هنوز هزینه ثبت نشده است').waitFor();
    await page.getByTestId('cost-add').click();
    const d = page.getByRole('dialog');
    await d.getByLabel(/^مبلغ/).fill('۲۵۰۰۰۰۰');
    await d.getByLabel('فعالیت', { exact: true }).selectOption({ label: '2.1 تأمین مواد' }).catch(async () => {
      await d.getByLabel('فعالیت', { exact: true }).selectOption({ index: 1 });
    });
    await page.getByTestId('cost-description').fill('=HYPERLINK("http://x")');
    await page.getByTestId('cost-document').fill('F-۱');
    await page.getByTestId('cost-save').click();
    await page.getByTestId('cost-table').waitFor();
    let list = await costs(stack, seed.pid);
    assert.equal(list.length, 1);
    assert.equal(list[0]!.amount, 2500000);
    assert.equal(list[0]!.taskId, seed.tasks['تأمین مواد']);

    // خروجی CSV: BOM و محافظت از تزریق فرمول
    const [dl] = await Promise.all([page.waitForEvent('download'), page.getByTestId('cost-export-csv').click()]);
    const file = join(dir, 'out.csv');
    await dl.saveAs(file);
    const csv = readFileSync(file, 'utf8');
    assert.ok(csv.startsWith('﻿'));
    assert.match(csv, /تاریخ,کد WBS,نام فعالیت,شرح هزینه,شماره سند,مبلغ/);
    assert.match(csv, /"'=HYPERLINK\(""http:\/\/x""\)"/);
    assert.match(csv, /,2\.1,تأمین مواد,/);

    // ویرایش
    await page.getByRole('button', { name: /^ویرایش/ }).first().click();
    await page.getByRole('dialog').getByLabel(/^مبلغ/).fill('۳۰۰۰۰۰۰');
    await page.getByTestId('cost-save').click();
    await page.getByText('تغییرات ذخیره شد.').first().waitFor();
    list = await costs(stack, seed.pid);
    assert.equal(list[0]!.amount, 3000000);

    // حذف
    await page.getByRole('button', { name: /^حذف/ }).first().click();
    await page.getByRole('button', { name: 'حذف', exact: true }).click();
    await page.getByText('هنوز هزینه ثبت نشده است').waitFor();
    assert.equal((await costs(stack, seed.pid)).length, 0);
    assert.deepEqual(errors, []);
  });

  it('ورود CSV: پیش‌نمایش طبقه‌بندی می‌کند و فقط با تأیید ثبت می‌کند', async () => {
    const csv =
      '﻿تاریخ,کد WBS,نام فعالیت,شرح هزینه,شماره سند,مبلغ\r\n' +
      '1405/07/20,2.1,,ورق,F1,"1,500,000"\r\n' +
      '1405/07/21,,مونتاژ,پیچ و مهره,F2,300000\r\n' +
      '1405/07/22,,,اجاره دفتر,,700000\r\n' +
      '1405/07/22,9.9,,نامشخص,,100\r\n' +
      'خراب,2.1,,x,,100\r\n' +
      '1405/07/20,2.1,,ورق,F1,"1,500,000"\r\n';
    const f = join(dir, 'in.csv');
    writeFileSync(f, csv);
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/fin`);
    await page.getByRole('tab', { name: /دفتر هزینه/ }).click();
    await page.getByTestId('cost-import-input').setInputFiles(f);
    await page.getByTestId('import-table').waitFor();
    const counts = (await page.getByTestId('import-counts').innerText()).replace(/\s+/g, ' ');
    assert.match(counts, /معتبر: ۲/);
    assert.match(counts, /هزینه‌ی عمومی: ۱/);
    assert.match(counts, /فعالیت پیدا نشد: ۱/);
    assert.match(counts, /تاریخ نامعتبر: ۱/);
    assert.match(counts, /تکراری: ۱/);
    await page.screenshot({ path: `${shotDir}/cost-import.png`, fullPage: true });
    // تا تأیید چیزی ثبت نشده
    assert.equal((await costs(stack, seed.pid)).length, 0);
    assert.match(latin(await page.getByTestId('import-summary').innerText()), /3ردیف.*2500000/);
    await page.getByTestId('import-apply').click();
    await page.getByTestId('cost-table').waitFor();
    const list = await costs(stack, seed.pid);
    assert.equal(list.length, 3);
    assert.equal(list.reduce((a, c) => a + c.amount, 0), 2500000);
    assert.equal(list.filter((c) => c.taskId === null).length, 1);
    assert.equal(list.find((c) => c.description === 'پیچ و مهره')!.taskId, seed.tasks['مونتاژ']);

    // ورود دوباره: همه تکراری؛ «فعالیت پیدا نشد» فقط با انتخاب صریح به‌عنوان عمومی وارد می‌شود
    await page.getByTestId('cost-import-input').setInputFiles(f);
    await page.getByTestId('import-table').waitFor();
    assert.equal(await page.getByTestId('import-apply').isDisabled(), true);
    await page.getByLabel(/به‌صورت هزینه‌ی عمومی/).check();
    assert.match(latin(await page.getByTestId('import-summary').innerText()), /1ردیف.*100/);
    await page.getByTestId('import-apply').click();
    await page.getByText('۱ ردیف هزینه ثبت شد.').waitFor();
    assert.equal((await costs(stack, seed.pid)).length, 4);
    assert.deepEqual(errors, []);
  });

  it('ورود فایل Excel (xlsx) با تاریخ شماره‌ی ترتیبی و فایل نامعتبر', async () => {
    const x = join(dir, 'in.xlsx');
    writeFileSync(
      x,
      writeXlsx([
        {
          name: 'هزینه‌ها',
          rows: [
            ['تاریخ', 'کد WBS', 'نام فعالیت', 'شرح هزینه', 'شماره سند', 'مبلغ'],
            [46312, '', 'ساخت قطعات', 'ماشین‌کاری', 'X9', 4000000],
          ],
        },
      ]),
    );
    const bad = join(dir, 'bad.xlsx');
    writeFileSync(bad, 'این xlsx نیست');
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/fin`);
    await page.getByRole('tab', { name: /دفتر هزینه/ }).click();
    await page.getByTestId('cost-import-input').setInputFiles(bad);
    await page.getByRole('dialog', { name: 'خواندن فایل ممکن نشد' }).waitFor();
    await page.getByRole('button', { name: 'بسیار خوب' }).click();
    await page.getByTestId('cost-import-input').setInputFiles(x);
    await page.getByTestId('import-table').waitFor();
    await page.getByTestId('import-apply').click();
    await page.getByText('۱ ردیف هزینه ثبت شد.').waitFor();
    const list = await costs(stack, seed.pid);
    const row = list.find((c) => c.description === 'ماشین‌کاری')!;
    assert.equal(row.taskId, seed.tasks['ساخت قطعات']);
    assert.equal(row.amount, 4000000);
    assert.deepEqual(errors, []);
  });

  it('نقش‌ها: مدیریت فقط می‌بیند، مدیر پروژه ثبت می‌کند، بازرگانی تب مالی ندارد', async () => {
    const mg = await newSession(browser, stack.baseUrl);
    await loginAs(mg.page, 'mgr4', USER_PASSWORD);
    await mg.page.goto(`/#/p/${seed.pid}/fin`);
    await mg.page.getByTestId('evm').waitFor();
    await mg.page.getByRole('tab', { name: /دفتر هزینه/ }).click();
    await mg.page.getByTestId('cost-table').waitFor();
    assert.equal(await mg.page.getByTestId('cost-add').count(), 0);
    assert.equal(await mg.page.getByTestId('cost-import').count(), 0);
    assert.equal(await mg.page.getByTestId('cost-export-csv').count(), 1);
    assert.deepEqual(mg.errors, []);

    const pm = await newSession(browser, stack.baseUrl);
    await loginAs(pm.page, 'pm4', USER_PASSWORD);
    await pm.page.goto(`/#/p/${seed.pid}/fin`);
    await pm.page.getByRole('tab', { name: /دفتر هزینه/ }).click();
    await pm.page.getByTestId('cost-add').waitFor();
    assert.equal(await pm.page.getByTestId('cost-import').count(), 1);
    assert.deepEqual(pm.errors, []);

    const cm = await newSession(browser, stack.baseUrl);
    await loginAs(cm.page, 'com4', USER_PASSWORD);
    assert.equal(await cm.page.getByTestId('nav-fin').count(), 0);
    await cm.page.goto(`/#/p/${seed.pid}/fin`);
    await cm.page.getByText('به بخش «مالی» دسترسی ندارد').waitFor();
    assert.deepEqual(cm.errors, []);
  });

  it('تنظیمات مالی: واحد و روش EAC تغییر می‌کند', async () => {
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await loginAs(page, 'admin', `${ADMIN_PASSWORD}-x`);
    await page.goto(`/#/p/${seed.pid}/fin`);
    await page.getByTestId('fin-settings').click();
    await page.getByTestId('fin-unit').fill('تومان');
    await page.getByRole('dialog').getByLabel(/روش پیش‌بینی/).selectOption('cpi');
    await page.getByTestId('fin-settings-save').click();
    await page.getByText('روش EAC: بودجه ÷ CPI').waitFor();
    const proj = await stack.admin.call<{ project: { finance: { unit: string; eacMethod: string } } }>('GET', `/projects/${seed.pid}`);
    assert.equal(proj.project.finance.unit, 'تومان');
    assert.equal(proj.project.finance.eacMethod, 'cpi');
    assert.deepEqual(errors, []);
  });
});
