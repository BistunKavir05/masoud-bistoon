import { faInt } from './fmt.ts';

/** برچسب‌های فارسی گزارش تغییرات: موضوع، عمل، فیلد و مقدار. بدون React تا قابل آزمون باشد. */

export const ENTITY_LABELS: Record<string, string> = {
  task: 'فعالیت',
  resource: 'منبع',
  cost: 'هزینه',
  baseline: 'خط مبنا',
  snapshot: 'گزارش پیشرفت',
  document: 'سند',
  risk: 'ریسک',
  issue: 'مسئله',
  change: 'درخواست تغییر',
  decision: 'تصمیم',
  charter: 'منشور',
  contract: 'قرارداد',
  calendar: 'تقویم',
  holiday: 'تعطیلی',
  chat: 'پیام گفتگو',
  member: 'عضو پروژه',
  project: 'پروژه',
  user: 'کاربر',
  legacy: 'داده‌ی نسخه‌ی قدیمی',
};

const ACTION_LABELS: Record<string, string> = {
  login: 'ورود',
  'login.failed': 'ورود ناموفق',
  logout: 'خروج',
  'password.change': 'تغییر گذرواژه',
  'user.reset_password': 'بازنشانی گذرواژه',
  'baseline.set': 'ثبت خط مبنا',
  'snapshot.record': 'ثبت گزارش پیشرفت',
  'snapshot.estimate': 'بازسازی تخمینی گزارش‌ها',
  'snapshot.delete': 'حذف گزارش پیشرفت',
  'calendar.days': 'ویرایش هفته‌ی کاری',
  'calendar.holiday.set': 'ثبت تعطیلی',
  'calendar.holiday.delete': 'حذف تعطیلی',
  'calendar.holiday.bulk': 'افزودن گروهی تعطیلات',
  'cost.import': 'ورود دسته‌ای هزینه',
  'task.insert': 'افزودن فعالیت',
  'task.move': 'جابه‌جایی فعالیت',
  'task.indent': 'زیرمجموعه‌کردن فعالیت',
  'task.outdent': 'بیرون‌آوردن از زیرمجموعه',
  'member.set': 'تنظیم نقش عضو',
  'project.export': 'خروجی گرفتن از پروژه',
  'project.import': 'ورود پروژه',
  'portfolio.import': 'ورود گروهی اطلاعات قرارداد از جدول',
  'project.import.legacy': 'ورود پروژه از نسخه‌ی قدیمی',
  'legacy.change': 'تغییر واردشده از نسخه‌ی قدیمی',
};

const VERBS: Record<string, string> = { create: 'ایجاد', update: 'ویرایش', delete: 'حذف' };

/** عنوان فارسی یک رخداد؛ ناشناخته: «موضوع — عمل» یا همان کد خام */
export function actionLabel(action: string, entity?: string): string {
  const known = ACTION_LABELS[action];
  if (known) return known;
  const dot = action.lastIndexOf('.');
  const verb = dot > 0 ? VERBS[action.slice(dot + 1)] : undefined;
  const ent = ENTITY_LABELS[dot > 0 ? action.slice(0, dot) : (entity ?? '')];
  if (verb && ent) return `${verb} ${ent}`;
  return action;
}

const FIELD_LABELS: Record<string, string> = {
  id: 'شناسه',
  name: 'نام',
  addedBy: 'افزوده‌شده توسط',
  number: 'شماره',
  subject: 'موضوع',
  title: 'عنوان',
  kind: 'نوع',
  duration: 'مدت',
  weight: 'وزن',
  percentComplete: 'درصد پیشرفت',
  dependencies: 'پیش‌نیازها',
  actualStart: 'شروع واقعی',
  actualFinish: 'پایان واقعی',
  startNoEarlierThan: 'شروع نه زودتر از',
  deadline: 'ضرب‌الاجل',
  levelOfEffort: 'فعالیت پشتیبانی',
  assignments: 'تخصیص منابع',
  directCosts: 'هزینه‌های مستقیم',
  costTracked: 'نمایش در هزینه‌ها',
  work: 'کار',
  status: 'وضعیت',
  start: 'شروع',
  contractEnd: 'پایان قرارداد',
  finance: 'تنظیمات مالی',
  archived: 'بایگانی',
  amount: 'مبلغ',
  date: 'تاریخ',
  description: 'شرح',
  document: 'شماره سند',
  taskId: 'فعالیت',
  url: 'نشانی',
  type: 'نوع',
  capacityPercent: 'ظرفیت',
  dailyRate: 'نرخ روزانه',
  userId: 'کاربر',
  owner: 'مسئول',
  level: 'سطح',
  probability: 'احتمال',
  impact: 'اثر',
  mitigation: 'اقدام پیشگیرانه',
  decision: 'تصمیم',
  roles: 'نقش‌ها',
  displayName: 'نام نمایشی',
  isActive: 'فعال',
  isSystemAdmin: 'مدیر سیستم',
};

export const fieldLabel = (f: string): string => FIELD_LABELS[f] ?? f;

/** مقدار ثبت‌شده در گزارش به متن کوتاه و قابل‌خواندن */
export function formatAuditValue(v: unknown, max = 100): string {
  if (v === null || v === undefined || v === '') return '—';
  let s: string;
  if (typeof v === 'string') s = v;
  else if (typeof v === 'number') s = String(v);
  else if (typeof v === 'boolean') s = v ? 'بله' : 'خیر';
  else s = JSON.stringify(v);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

const NAME_KEYS = ['title', 'name', 'displayName', 'number', 'subject', 'description'];

/** خلاصه‌ی یک مقدار برای سلول جدول: شیء ← نام/عنوان آن یا «n فیلد»، آرایه ← «n مورد» */
export function summarizeAuditValue(v: unknown, max = 60): string {
  if (Array.isArray(v)) return `${faInt(v.length)} مورد`;
  if (v !== null && typeof v === 'object') {
    const o = v as Record<string, unknown>;
    for (const k of NAME_KEYS) {
      const x = o[k];
      if (typeof x === 'string' && x.trim() !== '') return formatAuditValue(x, max);
    }
    return `${faInt(Object.keys(o).length)} فیلد`;
  }
  return formatAuditValue(v, max);
}

/** شیء تخت با مقدارهای ساده (قابل نمایش به‌صورت فهرست «فیلد: مقدار») */
export function flatEntries(v: unknown): [string, unknown][] | null {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null;
  const e = Object.entries(v as Record<string, unknown>);
  return e.every(([, x]) => x === null || ['string', 'number', 'boolean'].includes(typeof x)) ? e : null;
}
