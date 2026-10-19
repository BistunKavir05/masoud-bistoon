import { after, before, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync } from 'node:fs';
import type { Browser } from 'playwright';
import { launch, newSession, shotDir } from './browser.ts';
import { startStack, USER_PASSWORD } from './harness.ts';
import type { Stack } from './harness.ts';

describe('ورود و پوسته', () => {
  let stack: Stack;
  let browser: Browser;
  before(async () => {
    mkdirSync(shotDir, { recursive: true });
    stack = await startStack();
    browser = await launch();
  });
  after(async () => {
    await browser?.close();
    await stack?.stop();
  });

  it('ورود نادرست پیام فارسی می‌دهد و ورود درست پوسته را باز می‌کند', async () => {
    await stack.createUser('ali', 'علی رضایی');
    const { page, errors } = await newSession(browser, stack.baseUrl);
    await page.goto('/');
    await page.getByTestId('login-user').fill('ali');
    await page.getByTestId('login-pass').fill('wrong-password-1');
    await page.getByTestId('login-submit').click();
    await page.getByRole('alert').first().waitFor();
    assert.match((await page.getByRole('alert').first().textContent()) ?? '', /نادرست|نامعتبر/);
    await page.screenshot({ path: `${shotDir}/login-error.png` });
    await page.getByTestId('login-pass').fill(USER_PASSWORD);
    await page.getByTestId('login-submit').click();
    await page.getByTestId('user-menu').waitFor();
    await page.screenshot({ path: `${shotDir}/shell-empty.png` });
    assert.deepEqual(errors, []);
  });
});
