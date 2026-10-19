/**
 * خواندن و نوشتن کمینه‌ی Excel (.xlsx) بدون کتابخانه‌ی بیرونی و بدون CDN.
 * خواندن: اولین برگه، سلول‌های عدد/متن/متن مشترک/بولی/فرمول (مقدار ذخیره‌شده). تاریخ‌ها همان شماره‌ی ترتیبی Excel می‌مانند
 * (تبدیل با `parseCellDate` در هسته). نوشتن: یک یا چند برگه با متن درون‌خطی (متن هرگز فرمول اجرا نمی‌کند) و راست‌به‌چپ.
 */
import { ZipError, readZip, writeZip } from './zip.ts';

export type XlsxCell = string | number | boolean | null;
export interface XlsxSheet {
  name: string;
  rows: XlsxCell[][];
}

export class XlsxError extends ZipError {}

const dec = new TextDecoder('utf-8');
const enc = new TextEncoder();

export const MAX_SHEET_ROWS = 20000;
export const MAX_SHEET_COLS = 200;

function unescapeXml(s: string): string {
  return s.replace(/&(#x[0-9a-fA-F]+|#\d+|amp|lt|gt|quot|apos);/g, (_m, e: string) => {
    if (e === 'amp') return '&';
    if (e === 'lt') return '<';
    if (e === 'gt') return '>';
    if (e === 'quot') return '"';
    if (e === 'apos') return "'";
    const code = e[1] === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : '';
  });
}

/** متن تمام `<t>`های یک قطعه (به‌جز آوانگاری `rPh`) */
function textOf(xml: string): string {
  const clean = xml.replace(/<rPh\b[\s\S]*?<\/rPh>/g, '');
  let out = '';
  const re = /<t\b[^>]*?(?:\/>|>([\s\S]*?)<\/t>)/g;
  for (let m = re.exec(clean); m; m = re.exec(clean)) out += unescapeXml(m[1] ?? '');
  return out;
}

function attr(attrs: string, name: string): string | null {
  const m = new RegExp(`(?:^|\\s)${name}="([^"]*)"`).exec(attrs);
  return m ? unescapeXml(m[1] as string) : null;
}

function colIndex(ref: string): number {
  let n = 0;
  for (const ch of ref) {
    const c = ch.charCodeAt(0);
    if (c < 65 || c > 90) break;
    n = n * 26 + (c - 64);
  }
  return n - 1;
}

function sharedStrings(xml: string | undefined): string[] {
  if (!xml) return [];
  const out: string[] = [];
  const re = /<si\b[^>]*?(?:\/>|>([\s\S]*?)<\/si>)/g;
  for (let m = re.exec(xml); m; m = re.exec(xml)) out.push(textOf(m[1] ?? ''));
  return out;
}

function parseSheet(xml: string, shared: readonly string[]): XlsxCell[][] {
  const rows: XlsxCell[][] = [];
  const rowRe = /<row\b([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g;
  let auto = 0;
  for (let rm = rowRe.exec(xml); rm; rm = rowRe.exec(xml)) {
    const rAttr = attr(rm[1] ?? '', 'r');
    const rIdx = rAttr ? Number(rAttr) - 1 : auto;
    auto = rIdx + 1;
    if (!Number.isInteger(rIdx) || rIdx < 0) continue;
    if (rIdx >= MAX_SHEET_ROWS) throw new XlsxError(`برگه بیش از ${MAX_SHEET_ROWS} ردیف دارد.`);
    const cells: XlsxCell[] = [];
    const cellRe = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let next = 0;
    for (let cm = cellRe.exec(rm[2] ?? ''); cm; cm = cellRe.exec(rm[2] ?? '')) {
      const a = cm[1] ?? '';
      const ref = attr(a, 'r');
      const ci = ref ? colIndex(ref) : next;
      next = ci + 1;
      if (ci < 0 || ci >= MAX_SHEET_COLS) continue;
      const body = cm[2] ?? '';
      const t = attr(a, 't');
      const v = /<v\b[^>]*?>([\s\S]*?)<\/v>/.exec(body)?.[1];
      let value: XlsxCell = null;
      if (t === 'inlineStr') value = textOf(/<is\b[^>]*?>([\s\S]*?)<\/is>/.exec(body)?.[1] ?? '');
      else if (v !== undefined) {
        const raw = unescapeXml(v);
        if (t === 's') value = shared[Number(raw)] ?? null;
        else if (t === 'str') value = raw;
        else if (t === 'b') value = raw === '1';
        else if (t === 'e') value = null;
        else {
          const n = Number(raw);
          value = raw.trim() !== '' && Number.isFinite(n) ? n : raw;
        }
      }
      while (cells.length < ci) cells.push(null);
      cells[ci] = value;
    }
    while (rows.length < rIdx) rows.push([]);
    rows[rIdx] = cells;
  }
  return rows;
}

/** اولین برگه‌ی فایل (یا برگه‌ای که نامش داده شود) */
export async function readXlsx(buf: ArrayBuffer | Uint8Array, sheetName?: string): Promise<XlsxSheet> {
  let files: Map<string, Uint8Array>;
  try {
    files = await readZip(buf, (n) => n === 'xl/workbook.xml' || n === 'xl/_rels/workbook.xml.rels' || n === 'xl/sharedStrings.xml' || /^xl\/worksheets\/[^/]+\.xml$/.test(n));
  } catch (e) {
    if (e instanceof ZipError) throw new XlsxError(e.message);
    throw e;
  }
  const text = (n: string): string | undefined => {
    const f = files.get(n);
    return f ? dec.decode(f) : undefined;
  };
  const wb = text('xl/workbook.xml');
  if (!wb) throw new XlsxError('فایل Excel معتبر نیست (workbook پیدا نشد). فقط قالب .xlsx پشتیبانی می‌شود.');
  const rels = text('xl/_rels/workbook.xml.rels') ?? '';
  const sheets = [...wb.matchAll(/<sheet\b([^>]*?)\/?>/g)].map((m) => ({ name: attr(m[1] ?? '', 'name') ?? '', rid: attr(m[1] ?? '', 'r:id') ?? '' }));
  const pick = sheetName ? sheets.find((s) => s.name === sheetName) : sheets[0];
  if (!pick) throw new XlsxError('برگه‌ای در فایل پیدا نشد.');
  let target: string | null = null;
  for (const m of rels.matchAll(/<Relationship\b([^>]*?)\/?>/g)) {
    if (attr(m[1] ?? '', 'Id') === pick.rid) target = attr(m[1] ?? '', 'Target');
  }
  if (!target) throw new XlsxError('مسیر برگه در فایل پیدا نشد.');
  const path = target.startsWith('/') ? target.slice(1) : `xl/${target.replace(/^\.\//, '')}`;
  const sheet = text(path);
  if (sheet === undefined) throw new XlsxError('محتوای برگه پیدا نشد.');
  return { name: pick.name, rows: parseSheet(sheet, sharedStrings(text('xl/sharedStrings.xml'))) };
}

// ───────────── نوشتن ─────────────

const escXml = (s: string): string => s.replace(/[&<>"]/g, (c) => (c === '&' ? '&amp;' : c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&quot;')).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');

function colName(i: number): string {
  let s = '';
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(rows: readonly (readonly XlsxCell[])[]): string {
  const body = rows
    .map((r, ri) => {
      const cells = r
        .map((v, ci) => {
          if (v === null || v === undefined || v === '') return '';
          const ref = `${colName(ci)}${ri + 1}`;
          if (typeof v === 'number') return Number.isFinite(v) ? `<c r="${ref}"><v>${v}</v></c>` : '';
          if (typeof v === 'boolean') return `<c r="${ref}" t="b"><v>${v ? 1 : 0}</v></c>`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${escXml(v)}</t></is></c>`;
        })
        .join('');
      return `<row r="${ri + 1}">${cells}</row>`;
    })
    .join('');
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView rightToLeft="1" workbookViewId="0"/></sheetViews><sheetData>${body}</sheetData></worksheet>`;
}

export function writeXlsx(sheets: readonly XlsxSheet[]): Uint8Array {
  if (sheets.length === 0) throw new XlsxError('حداقل یک برگه لازم است.');
  const safeName = (n: string, i: number): string => n.replace(/[\\/?*[\]:]/g, ' ').trim().slice(0, 31) || `Sheet${i + 1}`;
  const files: { name: string; data: Uint8Array }[] = [];
  const add = (name: string, xml: string): void => void files.push({ name, data: enc.encode(xml) });
  const head = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>';
  add(
    '[Content_Types].xml',
    `${head}<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets
      .map((_s, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`)
      .join('')}</Types>`,
  );
  add('_rels/.rels', `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`);
  add(
    'xl/workbook.xml',
    `${head}<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets
      .map((s, i) => `<sheet name="${escXml(safeName(s.name, i))}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
      .join('')}</sheets></workbook>`,
  );
  add(
    'xl/_rels/workbook.xml.rels',
    `${head}<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets
      .map((_s, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`)
      .join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`,
  );
  add(
    'xl/styles.xml',
    `${head}<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><fonts count="1"><font><sz val="11"/><name val="Tahoma"/></font></fonts><fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/></cellXfs></styleSheet>`,
  );
  sheets.forEach((s, i) => add(`xl/worksheets/sheet${i + 1}.xml`, sheetXml(s.rows)));
  return writeZip(files);
}
