/**
 * خواننده‌ی کوچک و امن XML برای فایل‌های Microsoft Project (MSPDI).
 *
 * چرا خودمان؟ هسته بدون DOM و بدون وابستگی اجرا می‌شود (Node و مرورگر یک کد دارند) و آزمون‌پذیر است.
 * ایمنی: DOCTYPE و موجودیت‌های سفارشی (حمله‌ی «میلیارد خنده»/XXE) به‌طور کامل رد می‌شوند؛ عمق و تعداد گره محدود است.
 * پشتیبانی: عنصر، متن، CDATA، توضیح، دستور پردازشی، ویژگی (خوانده می‌شود ولی نادیده)، پیشوند نام‌فضا (حذف می‌شود).
 */

export class XmlError extends Error {
  readonly offset: number;

  constructor(message: string, offset: number) {
    super(message);
    this.name = 'XmlError';
    this.offset = offset;
  }
}

export interface XmlNode {
  /** نام محلی (بدون پیشوند نام‌فضا) */
  name: string;
  children: XmlNode[];
  /** متن مستقیم عنصر (بدون متن فرزندان)، به‌هم‌چسبیده */
  text: string;
}

export interface XmlLimits {
  maxDepth: number;
  maxNodes: number;
}

const DEFAULT_LIMITS: XmlLimits = { maxDepth: 64, maxNodes: 2_000_000 };

const PREDEFINED: Record<string, string> = { lt: '<', gt: '>', amp: '&', quot: '"', apos: "'" };

/** نویسه‌هایی که در XML 1.0 مجاز نیستند (به‌جز Tab/LF/CR) */
// eslint-disable-next-line no-control-regex
const ILLEGAL_RE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/;

function decodeEntities(raw: string, at: number): string {
  if (!raw.includes('&')) return raw;
  return raw.replace(/&(#x[0-9A-Fa-f]+|#[0-9]+|[A-Za-z][A-Za-z0-9]*);/g, (_m, body: string) => {
    if (body.startsWith('#')) {
      const code = body[1] === 'x' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff || (code >= 0xd800 && code <= 0xdfff) || code === 0) throw new XmlError('ارجاع نویسه‌ی نامعتبر.', at);
      return String.fromCodePoint(code);
    }
    const v = PREDEFINED[body];
    if (v === undefined) throw new XmlError(`موجودیت «&${body};» تعریف نشده است.`, at);
    return v;
  });
}

const localName = (qname: string): string => {
  const i = qname.lastIndexOf(':');
  return i >= 0 ? qname.slice(i + 1) : qname;
};

/** یک سند XML را می‌خواند. در خطا `XmlError` می‌اندازد. */
export function parseXml(source: string, limits: Partial<XmlLimits> = {}): XmlNode {
  const lim = { ...DEFAULT_LIMITS, ...limits };
  const s = source.charCodeAt(0) === 0xfeff ? source.slice(1) : source;
  const n = s.length;
  let i = 0;
  let nodes = 0;
  let root: XmlNode | null = null;
  const stack: { node: XmlNode; qname: string }[] = [];

  const addText = (raw: string, at: number): void => {
    const top = stack[stack.length - 1];
    if (!top) {
      if (raw.trim() !== '') throw new XmlError('متن خارج از عنصر ریشه.', at);
      return;
    }
    if (ILLEGAL_RE.test(raw)) throw new XmlError('نویسه‌ی غیرمجاز در XML.', at);
    top.node.text += decodeEntities(raw, at);
  };

  while (i < n) {
    const lt = s.indexOf('<', i);
    if (lt < 0) {
      addText(s.slice(i), i);
      i = n;
      break;
    }
    if (lt > i) addText(s.slice(i, lt), i);
    i = lt;

    if (s.startsWith('<!--', i)) {
      const end = s.indexOf('-->', i + 4);
      if (end < 0) throw new XmlError('توضیح (comment) بسته نشده است.', i);
      i = end + 3;
      continue;
    }
    if (s.startsWith('<![CDATA[', i)) {
      const end = s.indexOf(']]>', i + 9);
      if (end < 0) throw new XmlError('بخش CDATA بسته نشده است.', i);
      const top = stack[stack.length - 1];
      if (!top) throw new XmlError('CDATA خارج از عنصر ریشه.', i);
      const raw = s.slice(i + 9, end);
      if (ILLEGAL_RE.test(raw)) throw new XmlError('نویسه‌ی غیرمجاز در XML.', i);
      top.node.text += raw;
      i = end + 3;
      continue;
    }
    if (s.startsWith('<?', i)) {
      const end = s.indexOf('?>', i + 2);
      if (end < 0) throw new XmlError('دستور پردازشی بسته نشده است.', i);
      i = end + 2;
      continue;
    }
    if (s.startsWith('<!', i)) throw new XmlError('تعریف DOCTYPE/موجودیت در این فایل مجاز نیست.', i);

    if (s[i + 1] === '/') {
      const end = s.indexOf('>', i + 2);
      if (end < 0) throw new XmlError('برچسب پایانی بسته نشده است.', i);
      const qname = s.slice(i + 2, end).trim();
      const top = stack.pop();
      if (!top || top.qname !== qname) throw new XmlError(`برچسب پایانی «${qname}» با برچسب باز هم‌خوان نیست.`, i);
      i = end + 1;
      continue;
    }

    // برچسب آغازین: نام، ویژگی‌ها (با گیومه)، و «/>» یا «>»
    let j = i + 1;
    while (j < n && !/[\s/>]/.test(s[j] as string)) j += 1;
    const qname = s.slice(i + 1, j);
    if (qname === '' || /["'=<]/.test(qname)) throw new XmlError('نام عنصر نامعتبر است.', i);
    let selfClose = false;
    for (;;) {
      if (j >= n) throw new XmlError(`برچسب «${qname}» بسته نشده است.`, i);
      const c = s[j] as string;
      if (c === '>') {
        j += 1;
        break;
      }
      if (c === '/') {
        if (s[j + 1] !== '>') throw new XmlError(`برچسب «${qname}» نامعتبر است.`, j);
        selfClose = true;
        j += 2;
        break;
      }
      if (c === '"' || c === "'") {
        const q = s.indexOf(c, j + 1);
        if (q < 0) throw new XmlError('مقدار ویژگی بسته نشده است.', j);
        j = q + 1;
        continue;
      }
      if (c === '<') throw new XmlError(`برچسب «${qname}» نامعتبر است.`, j);
      j += 1;
    }

    nodes += 1;
    if (nodes > lim.maxNodes) throw new XmlError('تعداد عنصرهای فایل از حد مجاز بیشتر است.', i);
    const node: XmlNode = { name: localName(qname), children: [], text: '' };
    const parent = stack[stack.length - 1];
    if (parent) parent.node.children.push(node);
    else if (root) throw new XmlError('بیش از یک عنصر ریشه.', i);
    else root = node;
    if (!selfClose) {
      if (stack.length >= lim.maxDepth) throw new XmlError('عمق تودرتویی فایل از حد مجاز بیشتر است.', i);
      stack.push({ node, qname });
    }
    i = j;
  }

  if (stack.length > 0) throw new XmlError(`برچسب «${stack[stack.length - 1]!.qname}» بسته نشده است.`, n);
  if (!root) throw new XmlError('فایل عنصر ریشه ندارد.', 0);
  return root;
}

/** اولین فرزند مستقیم با این نام محلی */
export function xmlChild(node: XmlNode, name: string): XmlNode | undefined {
  return node.children.find((c) => c.name === name);
}

/** متنِ بریده‌شده‌ی اولین فرزند مستقیم؛ اگر فرزندی نباشد `null` */
export function xmlText(node: XmlNode, name: string): string | null {
  const c = xmlChild(node, name);
  return c ? c.text.trim() : null;
}

/** همه‌ی فرزندان مستقیم با این نام */
export function xmlChildren(node: XmlNode, name: string): XmlNode[] {
  return node.children.filter((c) => c.name === name);
}

/** همه‌ی نسل‌ها (عمق‌اول، به ترتیب سند) با این نام، به‌جز خود گره */
export function xmlDescendants(node: XmlNode, name: string): XmlNode[] {
  const out: XmlNode[] = [];
  const walk = (x: XmlNode): void => {
    for (const c of x.children) {
      if (c.name === name) out.push(c);
      walk(c);
    }
  };
  walk(node);
  return out;
}

/** نشانه‌گذاری ایمن متن برای خروجی XML (نویسه‌های غیرمجاز حذف می‌شوند) */
export function xmlEscape(value: string): string {
  return value
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F￾￿]/g, '') // eslint-disable-line no-control-regex
    .replace(/[<>&"']/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' })[c] as string);
}
