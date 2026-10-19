/**
 * فهرست‌های گزارش وضعیت: انتخاب و ترتیب‌دهی ریسک‌ها، مسائل، تصمیم‌ها و تغییرهای قابل‌گزارش.
 * منطق خالص تا رابط و آزمون‌ها یک تعریف داشته باشند؛ فهرست خالی در گزارش نمایش داده نمی‌شود.
 */
import type { IsoDate } from './date.ts';
import type { ChangeRequest, Decision, Issue, Risk } from './records.ts';
import { topRisks } from './records.ts';

export interface ReportRecords {
  risks: readonly Risk[];
  issues: readonly Issue[];
  decisions: readonly Decision[];
  changes: readonly ChangeRequest[];
}

export interface ReportLists {
  /** ریسک‌های باز با بیشترین امتیاز */
  topRisks: Risk[];
  /** مسائل حل‌نشده: اولویت بالا اول، سپس سررسید نزدیک‌تر (بدون سررسید آخر) */
  openIssues: Issue[];
  /** تصمیم‌های در انتظار: قدیمی‌تر اول */
  pendingDecisions: Decision[];
  /** درخواست‌های تغییر در انتظار: قدیمی‌تر اول */
  pendingChanges: ChangeRequest[];
}

const PRIORITY_ORDER: Record<Issue['priority'], number> = { high: 0, medium: 1, low: 2 };

/** تاریخ‌های خالی آخر می‌آیند */
const byDate = (a: IsoDate | null, b: IsoDate | null): number => (a === b ? 0 : a === null ? 1 : b === null ? -1 : a < b ? -1 : 1);

export function reportLists(rec: ReportRecords, opts: { maxRisks?: number } = {}): ReportLists {
  return {
    topRisks: topRisks(rec.risks, opts.maxRisks ?? 8),
    openIssues: rec.issues.filter((i) => i.status !== 'resolved').sort((a, b) => PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || byDate(a.due, b.due) || a.id - b.id),
    pendingDecisions: rec.decisions.filter((d) => d.status === 'pending').sort((a, b) => byDate(a.date, b.date) || a.id - b.id),
    pendingChanges: rec.changes.filter((c) => c.status === 'pending').sort((a, b) => byDate(a.date, b.date) || a.id - b.id),
  };
}

/** سررسیدگذشته نسبت به تاریخ وضعیت (سررسید خالی هرگز دیرکرد نیست) */
export const isOverdue = (due: IsoDate | null, status: IsoDate): boolean => due !== null && due < status;
