/** ذخیره‌ی فایل ساخته‌شده در مرورگر (بدون ارسال به سرور) */
export function downloadFile(name: string, data: string | Uint8Array, mime: string): void {
  const blob = new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.rel = 'noopener';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export const MIME_CSV = 'text/csv;charset=utf-8';
export const MIME_XLSX = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/** متن فایل: UTF-8؛ اگر معتبر نبود (CSV ذخیره‌شده‌ی Excel فارسی ویندوز) با windows-1256 */
export function decodeText(buf: ArrayBuffer): { text: string; encoding: 'utf-8' | 'windows-1256' } {
  try {
    return { text: new TextDecoder('utf-8', { fatal: true }).decode(buf), encoding: 'utf-8' };
  } catch {
    return { text: new TextDecoder('windows-1256').decode(buf), encoding: 'windows-1256' };
  }
}
