/** خواندن فایل‌های ورودی (XML و JSON) با محدودیت حجم و پیام فارسی */

export class FileReadError extends Error {}

/** سقف حجم فایل XML؛ بدنه‌ی درخواست سرور (BODY_LIMIT) پیش‌فرض ۱۶ مگابایت است */
export const MAX_XML_BYTES = 12 * 1024 * 1024;
export const MAX_JSON_BYTES = 14 * 1024 * 1024;

const mb = (n: number): string => (n / 1024 / 1024).toFixed(1);

function checkSize(file: File, max: number): void {
  if (file.size > max) throw new FileReadError(`حجم فایل ${mb(file.size)} مگابایت است؛ حداکثر ${mb(max)} مگابایت پذیرفته می‌شود.`);
  if (file.size === 0) throw new FileReadError('فایل خالی است.');
}

/** XML: UTF-8 (با/بی BOM) یا UTF-16 با BOM — خروجی بعضی نسخه‌های Project */
export async function readXmlFile(file: File): Promise<string> {
  checkSize(file, MAX_XML_BYTES);
  const buf = new Uint8Array(await file.arrayBuffer());
  if (buf[0] === 0xff && buf[1] === 0xfe) return new TextDecoder('utf-16le').decode(buf.subarray(2));
  if (buf[0] === 0xfe && buf[1] === 0xff) return new TextDecoder('utf-16be').decode(buf.subarray(2));
  return new TextDecoder('utf-8').decode(buf);
}

export async function readJsonFile(file: File): Promise<Record<string, unknown>> {
  checkSize(file, MAX_JSON_BYTES);
  const text = (await file.text()).replace(/^﻿/, '');
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    throw new FileReadError('محتوای فایل JSON معتبر نیست.');
  }
  if (v === null || typeof v !== 'object' || Array.isArray(v)) throw new FileReadError('ساختار فایل JSON پشتیبان پروژه نیست.');
  return v as Record<string, unknown>;
}
