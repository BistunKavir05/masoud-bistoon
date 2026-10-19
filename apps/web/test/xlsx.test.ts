import { describe, expect, it } from 'vitest';
import { XlsxError, readXlsx, writeXlsx } from '../src/lib/xlsx.ts';
import { COSTS_XLSX_BASE64 } from './fixtures/costsXlsx.ts';
import { crc32, readZip, writeZip } from '../src/lib/zip.ts';

async function failure(p: Promise<unknown>): Promise<unknown> {
  try {
    await p;
  } catch (e) {
    return e;
  }
  return null;
}

const fixture = (): Uint8Array => Uint8Array.from(atob(COSTS_XLSX_BASE64), (c) => c.charCodeAt(0));

describe('xlsx', () => {
  it('فایل ساخته‌شده‌ی خارجی (deflate، متن مشترک، فرمول، بولی، فاصله‌ی سلول و ردیف) درست خوانده می‌شود', async () => {
    const s = await readXlsx(fixture());
    expect(s.name).toBe('هزینه‌ها');
    expect(s.rows[0]).toEqual(['تاریخ', 'کد WBS', null, 'مبلغ']);
    expect(s.rows[1]).toEqual([46312, '1.2.1', 'خرید مصالح', 1500000]);
    expect(s.rows[2]).toEqual([]);
    expect(s.rows[3]).toEqual(['ab', true, 'A & B <1> ف', 2.5, null]);
  });

  it('برگه‌ی دوم با نام', async () => {
    const s = await readXlsx(fixture(), 'دوم');
    expect(s.rows).toEqual([[7]]);
    expect((await failure(readXlsx(fixture(), 'نیست'))) instanceof XlsxError).toBe(true);
  });

  it('نوشتن و خواندن رفت‌وبرگشت (متن فرمول‌نما متن می‌ماند)', async () => {
    const rows = [
      ['تاریخ', 'شرح', 'مبلغ'],
      ['1405/07/25', '=SUM(A1:A2)', 1500000],
      ['2026-10-17', 'a & <b> "c"', -5],
      [null, 'خط\nجدید', 0.25],
    ];
    const bytes = writeXlsx([{ name: 'گزارش:*?', rows }]);
    const back = await readXlsx(bytes);
    expect(back.name).toBe('گزارش');
    expect(back.rows[1]![1]).toBe('=SUM(A1:A2)');
    expect(back.rows[2]).toEqual(['2026-10-17', 'a & <b> "c"', -5]);
    expect(back.rows[3]).toEqual([null, 'خط\nجدید', 0.25]);
  });

  it('فایل غیر xlsx و ZIP خراب پیام روشن می‌دهند', async () => {
    expect((await failure(readXlsx(new TextEncoder().encode('hello')))) instanceof XlsxError).toBe(true);
    const bytes = writeXlsx([{ name: 's', rows: [['a']] }]);
    expect((await failure(readXlsx(bytes.slice(0, bytes.length - 40)))) instanceof XlsxError).toBe(true);
    const notXlsx = writeZip([{ name: 'a.txt', data: new TextEncoder().encode('x') }]);
    expect((await failure(readXlsx(notXlsx))) instanceof XlsxError).toBe(true);
  });
});

describe('zip', () => {
  it('CRC32 مرجع و رفت‌وبرگشت', async () => {
    expect(crc32(new TextEncoder().encode('123456789'))).toBe(0xcbf43926);
    const z = writeZip([
      { name: 'a/b.txt', data: new TextEncoder().encode('سلام') },
      { name: 'c.bin', data: new Uint8Array([0, 1, 2, 255]) },
    ]);
    const m = await readZip(z, () => true);
    expect(new TextDecoder().decode(m.get('a/b.txt'))).toBe('سلام');
    expect([...m.get('c.bin')!]).toEqual([0, 1, 2, 255]);
  });

  it('سقف حجم بازشده اعمال می‌شود', async () => {
    const z = writeZip([{ name: 'big', data: new Uint8Array(1000) }]);
    expect((await failure(readZip(z, () => true, { maxTotal: 10, maxEntries: 10 }))) instanceof Error).toBe(true);
  });
});
