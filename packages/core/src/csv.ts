/**
 * خواندن و نوشتن CSV (RFC 4180).
 * - خواندن: BOM حذف می‌شود؛ جداکننده (`,` `;` `؛` یا Tab) از ردیف عنوان تشخیص داده می‌شود تا ارقام هزارگان‌دار در سلول بدون گیومه خراب نشوند.
 * - نوشتن: UTF-8 با BOM و پایان خط CRLF؛ مقدار متنی که با `= + - @` یا Tab/CR شروع شود با `'` امن می‌شود (تزریق فرمول در Excel).
 */

const DELIMS = [',', ';', '؛', '\t'] as const;

/** جداکننده‌ی محتمل: پرتکرارترین نویسه‌ی جداکننده‌ی بیرون از گیومه در اولین ردیف غیرخالی (در تساوی ترتیب `, ; ؛ Tab`) */
export function detectDelimiter(text: string): string {
  const counts = new Map<string, number>(DELIMS.map((d) => [d, 0]));
  let inQuotes = false;
  let seen = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (c === '"') {
      if (inQuotes && text[i + 1] === '"') i += 1;
      else inQuotes = !inQuotes;
    } else if (!inQuotes) {
      if (c === '\n' || c === '\r') {
        if (seen) break;
      } else {
        seen = true;
        if (counts.has(c)) counts.set(c, (counts.get(c) ?? 0) + 1);
      }
    }
  }
  let best: string = ',';
  let max = 0;
  for (const d of DELIMS) {
    const n = counts.get(d) ?? 0;
    if (n > max) {
      max = n;
      best = d;
    }
  }
  return best;
}

/** ردیف‌های کاملاً خالی حذف می‌شوند. */
export function parseCsv(input: string, delimiter?: string): string[][] {
  const text = input.replace(/^﻿/, '');
  const d = delimiter ?? detectDelimiter(text);
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i] as string;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else quoted = false;
      } else field += c;
    } else if (c === '"' && field === '') quoted = true;
    else if (c === d) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i += 1;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += c;
  }
  row.push(field);
  rows.push(row);
  return rows.filter((r) => r.some((x) => x.trim() !== ''));
}

export type CsvValue = string | number | boolean | null | undefined;

/** سلول امن CSV: فقط رشته‌ها در برابر تزریق فرمول محافظت می‌شوند (عدد واقعی، عدد است). */
export function csvCell(v: CsvValue): string {
  if (v === null || v === undefined) return '';
  if (typeof v === 'number') return Number.isFinite(v) ? String(v) : '';
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  const s = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n;؛\t]/.test(s) || s !== s.trim() ? `"${s.replace(/"/g, '""')}"` : s;
}

export function toCsv(rows: readonly (readonly CsvValue[])[], opts: { bom?: boolean } = {}): string {
  const body = rows.map((r) => r.map(csvCell).join(',')).join('\r\n');
  return `${opts.bom === false ? '' : '﻿'}${body}\r\n`;
}
