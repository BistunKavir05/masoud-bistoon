import { join } from 'node:path';
import type { Browser, BrowserContext, Page } from 'playwright';

async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    return (await import(process.env['PLAYWRIGHT_PATH'] ?? '/opt/npm-tools/node_modules/playwright/index.mjs')) as typeof import('playwright');
  }
}

export async function launch(): Promise<Browser> {
  const pw = await loadPlaywright();
  return pw.chromium.launch({ args: ['--no-sandbox'] });
}

export interface Session {
  context: BrowserContext;
  page: Page;
  errors: string[];
}

/** صفحه‌ی تازه با ثبت خطاهای کنسول و درخواست‌های ناموفق (برای اطمینان از نبود خطای پنهان) */
export async function newSession(browser: Browser, baseUrl: string, opts: { width?: number; height?: number; colorScheme?: 'light' | 'dark' } = {}): Promise<Session> {
  const context = await browser.newContext({ baseURL: baseUrl, viewport: { width: opts.width ?? 1360, height: opts.height ?? 860 }, locale: 'fa-IR', colorScheme: opts.colorScheme ?? 'light', acceptDownloads: true });
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`pageerror: ${e.message}`));
  page.on('console', (m) => {
    // خطای «Failed to load resource» برای پاسخ‌های 4xx مورد انتظار (مثل ورود ناموفق) ثبت نمی‌شود؛ 5xx پایین‌تر جدا بررسی می‌شود.
    if (m.type() === 'error' && !/Failed to load resource: the server responded with a status of 4\d\d/.test(m.text())) errors.push(`console: ${m.text()}`);
  });
  page.on('response', (r) => {
    if (r.status() >= 500) errors.push(`http ${r.status()}: ${r.request().method()} ${r.url()}`);
  });
  return { context, page, errors };
}

export const shotDir = process.env['SHOT_DIR'] ?? join('/tmp', 'bn', 'shots');
