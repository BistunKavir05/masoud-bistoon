/**
 * ماتریس دسترسی نقش‌ها. نقش‌ها به‌ازای هر پروژه به کاربر داده می‌شوند و یک کاربر می‌تواند چند نقش داشته باشد؛
 * دسترسی نهایی اجتماع دسترسی‌های نقش‌هاست. ادمین سیستم (`users.is_system_admin`) خارج از این ماتریس و روی همه‌ی پروژه‌ها مجاز است.
 *
 * سرور مرجع نهایی است (هر درخواست بررسی می‌شود)؛ کلاینت از همین ماتریس فقط برای پنهان کردن گزینه‌ها استفاده می‌کند.
 * برای تغییر سیاست فقط همین جدول را عوض کنید؛ آزمون‌های permissions.test.ts قیدهای ثابت (مثل «بازرگانی فقط مشاهده می‌کند») را نگه می‌دارند.
 */

export const ROLES = ['admin', 'pm', 'finance', 'commerce', 'management', 'expert'] as const;
export type Role = (typeof ROLES)[number];

export const ROLE_LABELS: Record<Role, string> = {
  admin: 'ادمین',
  pm: 'مدیر پروژه',
  finance: 'مالی',
  commerce: 'بازرگانی',
  management: 'مدیریت',
  expert: 'کارشناس',
};

export const isRole = (v: unknown): v is Role => typeof v === 'string' && (ROLES as readonly string[]).includes(v);

/** قابلیت‌ها؛ نام‌ها «حوزه.عمل» هستند. */
export const CAPABILITY_LABELS = {
  'summary.view': 'مشاهده‌ی وضعیت و مرحله‌ی پروژه',
  'schedule.view': 'مشاهده‌ی فعالیت‌ها، گانت، پیشرفت و منحنی S',
  'schedule.edit': 'ویرایش ساختار و برنامه‌ی زمانی، منابع و تقویم',
  'progress.update': 'ثبت پیشرفت همه‌ی فعالیت‌ها',
  'progress.update.own': 'ثبت پیشرفت فعالیت‌های مربوط به منبع خود',
  'baseline.manage': 'ثبت و آرشیو خط مبنا و اسنپ‌شات',
  'costs.view': 'مشاهده‌ی هزینه‌ها و شاخص‌های مالی',
  'costs.edit': 'ثبت و ویرایش هزینه‌های واقعی',
  'charter.view': 'مشاهده‌ی منشور پروژه',
  'charter.edit': 'ویرایش منشور پروژه',
  'contract.view': 'مشاهده‌ی مبلغ قرارداد، فاکتور و وصول',
  'contract.edit': 'ویرایش اطلاعات قرارداد',
  'contract.collection.edit': 'ثبت مبلغ فاکتورشده و وصول‌شده',
  'commission.view': 'مشاهده‌ی پورسانت',
  'commission.edit': 'تعیین درصد پورسانت',
  'commission.approve': 'تأیید پورسانت',
  'risks.view': 'مشاهده‌ی ریسک‌ها، مسائل، تغییرات و تصمیم‌ها',
  'risks.edit': 'ویرایش ریسک‌ها و مسائل',
  'changes.approve': 'تأیید یا رد درخواست‌های تغییر و ثبت تصمیم‌ها',
  'documents.view': 'مشاهده‌ی اسناد',
  'documents.edit': 'ویرایش اسناد',
  'chat.use': 'استفاده از گفتگوی پروژه',
  'chat.moderate': 'حذف پیام‌های دیگران',
  'audit.view': 'مشاهده‌ی گزارش تغییرات',
  'project.settings': 'تنظیمات پروژه (نام، تاریخ‌ها، مالی)',
  'members.manage': 'مدیریت اعضا و نقش‌ها',
  'data.export': 'خروجی گرفتن از کل داده‌ی پروژه',
} as const;

export type Capability = keyof typeof CAPABILITY_LABELS;
export const CAPABILITIES = Object.keys(CAPABILITY_LABELS) as Capability[];

const A: Role = 'admin';
const P: Role = 'pm';
const F: Role = 'finance';
const C: Role = 'commerce';
const M: Role = 'management';
const E: Role = 'expert';

/** ستون‌ها: چه نقش‌هایی هر قابلیت را دارند */
export const PERMISSION_MATRIX: Readonly<Record<Capability, readonly Role[]>> = {
  'summary.view': [A, P, F, C, M, E],
  'schedule.view': [A, P, F, M, E],
  'schedule.edit': [A, P],
  'progress.update': [A, P],
  'progress.update.own': [E],
  'baseline.manage': [A, P],
  'costs.view': [A, P, F, M],
  'costs.edit': [A, P, F],
  'charter.view': [A, P, F, M, E],
  'charter.edit': [A, P],
  'contract.view': [A, P, F, C, M],
  'contract.edit': [A, P, F],
  'contract.collection.edit': [A, F],
  'commission.view': [A, F, C, M],
  'commission.edit': [A, F, M],
  'commission.approve': [A, M],
  'risks.view': [A, P, F, M, E],
  'risks.edit': [A, P],
  'changes.approve': [A, M],
  'documents.view': [A, P, F, M, E],
  'documents.edit': [A, P],
  'chat.use': [A, P, F, C, M, E],
  'chat.moderate': [A, P],
  'audit.view': [A, M],
  'project.settings': [A, P],
  'members.manage': [A],
  'data.export': [A, P],
};

export function can(roles: Iterable<Role>, capability: Capability): boolean {
  const allowed = PERMISSION_MATRIX[capability];
  for (const r of roles) if (allowed.includes(r)) return true;
  return false;
}

/** همه‌ی قابلیت‌هایی که مجموعه‌ی نقش‌های داده‌شده دارد (ترتیب ثابت) */
export function capabilitiesOf(roles: Iterable<Role>, opts: { systemAdmin?: boolean } = {}): Capability[] {
  if (opts.systemAdmin) return [...CAPABILITIES];
  const list = [...roles];
  return CAPABILITIES.filter((c) => can(list, c));
}

/** بازرگانی فقط مشاهده می‌کند و هیچ قابلیت ویرایشی ندارد؛ این تابع آزمون و رابط کاربری را ساده می‌کند. */
export function isReadOnly(roles: Iterable<Role>): boolean {
  const list = [...roles];
  return CAPABILITIES.every((c) => !isMutation(c) || !can(list, c));
}

const MUTATIONS = new Set<Capability>([
  'schedule.edit',
  'progress.update',
  'progress.update.own',
  'baseline.manage',
  'costs.edit',
  'charter.edit',
  'contract.edit',
  'contract.collection.edit',
  'commission.edit',
  'commission.approve',
  'risks.edit',
  'changes.approve',
  'documents.edit',
  'project.settings',
  'members.manage',
]);
export const isMutation = (c: Capability): boolean => MUTATIONS.has(c);
