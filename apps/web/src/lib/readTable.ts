/** خواندن فایل جدولی (.xlsx یا .csv/.txt) به ردیف‌های خام؛ مشترک بین ورود هزینه و ورود پورتفولیو. */
import { parseCsv } from '@bistoon/core';
import { decodeText } from './download.ts';
import { readXlsx } from './xlsx.ts';

export class TableFileError extends Error {
  readonly title: string;
  constructor(title: string, message: string) {
    super(message);
    this.title = title;
  }
}

export async function readTableFile(file: File): Promise<{ rows: unknown[][]; note: string }> {
  if (!/\.(xlsx|csv|txt)$/i.test(file.name)) {
    throw new TableFileError('فایل پشتیبانی نمی‌شود', 'فقط فایل‌های «.xlsx» و «.csv» خوانده می‌شود. اگر فایل «.xls» قدیمی دارید، آن را در Excel با «Save As ← Excel Workbook (.xlsx)» یا «CSV UTF-8» ذخیره کنید.');
  }
  try {
    const buf = await file.arrayBuffer();
    if (/\.xlsx$/i.test(file.name)) return { rows: (await readXlsx(buf)).rows, note: '' };
    const d = decodeText(buf);
    const note = d.encoding !== 'utf-8' ? 'کدگذاری فایل UTF-8 نبود و با «ویندوز ۱۲۵۶» خوانده شد؛ اگر حروف درست نیست، فایل را به‌صورت «CSV UTF-8» ذخیره کنید.' : '';
    return { rows: parseCsv(d.text), note };
  } catch (e) {
    throw new TableFileError('خواندن فایل ممکن نشد', e instanceof Error ? e.message : 'فایل خوانده نشد.');
  }
}
