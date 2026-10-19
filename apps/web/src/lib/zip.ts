/**
 * خواندن و نوشتن ZIP بدون وابستگی (برای xlsx). خواندن با `DecompressionStream` مرورگر/Node؛
 * نوشتن بدون فشرده‌سازی (method 0). ZIP64، رمزگذاری و چندقسمتی پشتیبانی نمی‌شود و خطای روشن می‌دهد.
 */

export class ZipError extends Error {}

const SIG_EOCD = 0x06054b50;
const SIG_CEN = 0x02014b50;
const SIG_LOC = 0x04034b50;

export interface ZipLimits {
  /** سقف مجموع حجم بازشده (دفاع در برابر zip bomb) */
  maxTotal: number;
  maxEntries: number;
}
export const DEFAULT_LIMITS: ZipLimits = { maxTotal: 60 * 1024 * 1024, maxEntries: 2000 };

async function inflateRaw(data: Uint8Array, expected: number): Promise<Uint8Array> {
  if (typeof DecompressionStream === 'undefined') throw new ZipError('این مرورگر از بازکردن فایل فشرده پشتیبانی نمی‌کند؛ مرورگر را به‌روز کنید یا فایل را CSV ذخیره کنید.');
  const stream = new Blob([data as BlobPart]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > expected) {
      await reader.cancel();
      throw new ZipError('اندازه‌ی محتوای فشرده با سرآیند فایل نمی‌خواند (فایل خراب یا مشکوک است).');
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let o = 0;
  for (const c of chunks) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}

/** نام ورودی → محتوا (فقط ورودی‌هایی که `want` بپذیرد باز می‌شوند) */
export async function readZip(buf: ArrayBuffer | Uint8Array, want: (name: string) => boolean, limits: ZipLimits = DEFAULT_LIMITS): Promise<Map<string, Uint8Array>> {
  const u8 = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
  let eocd = -1;
  for (let i = u8.length - 22; i >= Math.max(0, u8.length - 22 - 65535); i -= 1) {
    if (dv.getUint32(i, true) === SIG_EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0) throw new ZipError('فایل فشرده (ZIP) معتبر نیست.');
  const count = dv.getUint16(eocd + 10, true);
  const cenSize = dv.getUint32(eocd + 12, true);
  let p = dv.getUint32(eocd + 16, true);
  if (count === 0xffff || p === 0xffffffff || cenSize === 0xffffffff) throw new ZipError('فایل ZIP64 پشتیبانی نمی‌شود.');
  if (count > limits.maxEntries) throw new ZipError('تعداد ورودی‌های فایل فشرده بیش از حد است.');
  const dec = new TextDecoder('utf-8');
  const out = new Map<string, Uint8Array>();
  let total = 0;
  for (let n = 0; n < count; n += 1) {
    if (p + 46 > u8.length || dv.getUint32(p, true) !== SIG_CEN) throw new ZipError('فهرست فایل فشرده خراب است.');
    const flags = dv.getUint16(p + 8, true);
    const method = dv.getUint16(p + 10, true);
    const csize = dv.getUint32(p + 20, true);
    const usize = dv.getUint32(p + 24, true);
    const nlen = dv.getUint16(p + 28, true);
    const elen = dv.getUint16(p + 30, true);
    const clen = dv.getUint16(p + 32, true);
    const off = dv.getUint32(p + 42, true);
    const name = dec.decode(u8.subarray(p + 46, p + 46 + nlen));
    p += 46 + nlen + elen + clen;
    if (!want(name)) continue;
    if (flags & 1) throw new ZipError('فایل رمزگذاری‌شده پشتیبانی نمی‌شود.');
    total += usize;
    if (total > limits.maxTotal) throw new ZipError('حجم محتوای فایل فشرده بیش از حد مجاز است.');
    if (off + 30 > u8.length || dv.getUint32(off, true) !== SIG_LOC) throw new ZipError('ورودی فایل فشرده خراب است.');
    const start = off + 30 + dv.getUint16(off + 26, true) + dv.getUint16(off + 28, true);
    if (start + csize > u8.length) throw new ZipError('فایل فشرده ناقص است.');
    const raw = u8.subarray(start, start + csize);
    if (method === 0) out.set(name, raw.slice());
    else if (method === 8) out.set(name, await inflateRaw(raw, usize));
    else throw new ZipError(`روش فشرده‌سازی ${method} پشتیبانی نمی‌شود.`);
  }
  return out;
}

// ───────────── نوشتن ─────────────

let table: Uint32Array | null = null;
export function crc32(data: Uint8Array): number {
  if (!table) {
    table = new Uint32Array(256);
    for (let n = 0; n < 256; n += 1) {
      let c = n;
      for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      table[n] = c >>> 0;
    }
  }
  let c = 0xffffffff;
  for (let i = 0; i < data.length; i += 1) c = (table[(c ^ (data[i] as number)) & 0xff] as number) ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

/** تاریخ/زمان ثابت (۲۰۲۶-۰۱-۰۱) تا خروجی قطعی (reproducible) باشد */
const DOS_TIME = 0;
const DOS_DATE = ((2026 - 1980) << 9) | (1 << 5) | 1;

export function writeZip(files: readonly { name: string; data: Uint8Array }[]): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];
  const central: Uint8Array[] = [];
  let offset = 0;
  for (const f of files) {
    const name = enc.encode(f.name);
    const crc = crc32(f.data);
    const loc = new Uint8Array(30 + name.length);
    const lv = new DataView(loc.buffer);
    lv.setUint32(0, SIG_LOC, true);
    lv.setUint16(4, 20, true);
    lv.setUint16(6, 0x0800, true);
    lv.setUint16(8, 0, true);
    lv.setUint16(10, DOS_TIME, true);
    lv.setUint16(12, DOS_DATE, true);
    lv.setUint32(14, crc, true);
    lv.setUint32(18, f.data.length, true);
    lv.setUint32(22, f.data.length, true);
    lv.setUint16(26, name.length, true);
    loc.set(name, 30);
    parts.push(loc, f.data);
    const cen = new Uint8Array(46 + name.length);
    const cv = new DataView(cen.buffer);
    cv.setUint32(0, SIG_CEN, true);
    cv.setUint16(4, 20, true);
    cv.setUint16(6, 20, true);
    cv.setUint16(8, 0x0800, true);
    cv.setUint16(10, 0, true);
    cv.setUint16(12, DOS_TIME, true);
    cv.setUint16(14, DOS_DATE, true);
    cv.setUint32(16, crc, true);
    cv.setUint32(20, f.data.length, true);
    cv.setUint32(24, f.data.length, true);
    cv.setUint16(28, name.length, true);
    cv.setUint32(42, offset, true);
    cen.set(name, 46);
    central.push(cen);
    offset += loc.length + f.data.length;
  }
  const cenSize = central.reduce((a, c) => a + c.length, 0);
  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  ev.setUint32(0, SIG_EOCD, true);
  ev.setUint16(8, files.length, true);
  ev.setUint16(10, files.length, true);
  ev.setUint32(12, cenSize, true);
  ev.setUint32(16, offset, true);
  const all = [...parts, ...central, end];
  const out = new Uint8Array(all.reduce((a, c) => a + c.length, 0));
  let o = 0;
  for (const c of all) {
    out.set(c, o);
    o += c.length;
  }
  return out;
}
