/**
 * تجزیه‌ی فهرست تعطیلات از متن چسبانده‌شده یا فایل CSV/متنی: هر خط «تاریخ، عنوان».
 * تاریخ شمسی یا میلادی ISO با ارقام فارسی/لاتین؛ جداکننده‌ی تاریخ و عنوان: ویرگول، نقطه‌ویرگول، تب یا فاصله.
 */
import { detectDelimiter, parseCsv } from '@bistoon/core';
import type { Holiday, IsoDate } from '@bistoon/core';
import { parseDateInput } from './fmt.ts';

export const MAX_HOLIDAY_ROWS = 2000;

export interface HolidayParse {
  rows: Holiday[];
  errors: { line: number; text: string; reason: string }[];
  /** ردیف‌هایی که تاریخشان قبلاً در فهرست بود (عنوان جدید جایگزین می‌شود) */
  overwrites: number;
  /** ردیف تکراریِ داخل خود متن (آخرین عنوان می‌ماند) */
  duplicates: number;
  tooMany: boolean;
}

const LEAD = /^\s*([0-9۰-۹٠-٩]{4}\s*[/\-.]\s*[0-9۰-۹٠-٩]{1,2}\s*[/\-.]\s*[0-9۰-۹٠-٩]{1,2})\s*[,;\t،؛ ]?\s*(.*)$/;

export function parseHolidayText(raw: string, existing: ReadonlySet<string>): HolidayParse {
  const lines = raw.replace(/^﻿/, '').split(/\r\n|\n|\r/);
  const rows = new Map<IsoDate, string>();
  const errors: HolidayParse['errors'] = [];
  let duplicates = 0;
  lines.forEach((line, i) => {
    if (line.trim() === '') return;
    // اگر خط واقعاً CSV با گیومه است، از پارسر CSV بگذرد؛ وگرنه الگوی «تاریخ + باقی‌مانده» کافی است
    let dateText: string;
    let title: string;
    const m = LEAD.exec(line);
    if (m) {
      dateText = m[1]!.replace(/\s+/g, '');
      title = (m[2] ?? '').trim();
      if (/^["']/.test(title)) {
        const delim = detectDelimiter(line);
        const cells = parseCsv(line, delim)[0] ?? [];
        title = (cells[1] ?? title).trim();
      }
    } else {
      errors.push({ line: i + 1, text: line.trim(), reason: 'ابتدای خط باید تاریخ باشد (مثل ۱۴۰۵/۰۱/۰۱ یا 2026-03-21).' });
      return;
    }
    const iso = parseDateInput(dateText);
    if (!iso) {
      errors.push({ line: i + 1, text: line.trim(), reason: 'تاریخ نامعتبر است.' });
      return;
    }
    if (title.length > 120) {
      errors.push({ line: i + 1, text: line.trim(), reason: 'عنوان بیش از ۱۲۰ نویسه است.' });
      return;
    }
    if (rows.has(iso)) duplicates += 1;
    rows.set(iso, title);
  });
  const list = [...rows.entries()].map(([date, title]) => ({ date, title })).sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  return { rows: list, errors, overwrites: list.filter((r) => existing.has(r.date)).length, duplicates, tooMany: list.length > MAX_HOLIDAY_ROWS };
}
