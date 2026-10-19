/** ریسک، مسئله، درخواست تغییر و تصمیم. کدهای انگلیسی ذخیره می‌شوند و برچسب فارسی فقط برای نمایش است. */
import type { IsoDate } from './date.ts';

export const RISK_CATEGORIES = ['technical', 'schedule', 'cost', 'procurement', 'client', 'hse', 'other'] as const;
export type RiskCategory = (typeof RISK_CATEGORIES)[number];
export const RISK_CATEGORY_LABELS: Record<RiskCategory, string> = {
  technical: 'فنی',
  schedule: 'زمان‌بندی',
  cost: 'هزینه',
  procurement: 'تأمین / خرید',
  client: 'کارفرما',
  hse: 'ایمنی و محیط',
  other: 'سایر',
};

export const RISK_STRATEGIES = ['avoid', 'mitigate', 'transfer', 'accept'] as const;
export type RiskStrategy = (typeof RISK_STRATEGIES)[number];
export const RISK_STRATEGY_LABELS: Record<RiskStrategy, string> = { avoid: 'اجتناب', mitigate: 'کاهش', transfer: 'انتقال', accept: 'پذیرش' };

export const RISK_STATUSES = ['open', 'in_progress', 'closed'] as const;
export type RiskStatus = (typeof RISK_STATUSES)[number];
export const RISK_STATUS_LABELS: Record<RiskStatus, string> = { open: 'باز', in_progress: 'در حال پیگیری', closed: 'بسته' };

export interface Risk {
  id: number;
  title: string;
  category: RiskCategory | null;
  /** ۱ تا ۵ */
  probability: number;
  /** ۱ تا ۵ */
  impact: number;
  owner: string;
  strategy: RiskStrategy | null;
  response: string;
  due: IsoDate | null;
  status: RiskStatus;
}

export type RiskLevel = 'critical' | 'high' | 'medium' | 'low';
export const RISK_LEVEL_LABELS: Record<RiskLevel, string> = { critical: 'بحرانی', high: 'بالا', medium: 'متوسط', low: 'پایین' };
export const RISK_PROBABILITY_LABELS = ['خیلی کم', 'کم', 'متوسط', 'زیاد', 'خیلی زیاد'] as const;

export const riskScore = (r: Pick<Risk, 'probability' | 'impact'>): number => r.probability * r.impact;

/** سطح ریسک از امتیاز (احتمال × اثر): ≥۱۵ بحرانی، ≥۱۰ بالا، ≥۵ متوسط، وگرنه پایین */
export function riskLevel(score: number): RiskLevel {
  return score >= 15 ? 'critical' : score >= 10 ? 'high' : score >= 5 ? 'medium' : 'low';
}

const inScale = (v: number): boolean => Number.isInteger(v) && v >= 1 && v <= 5;

/** ریسک‌های باز یا در حال پیگیری با احتمال و اثر معتبر */
export function openRisks<R extends Risk>(risks: readonly R[]): R[] {
  return risks.filter((r) => r.status !== 'closed' && inScale(r.probability) && inScale(r.impact));
}

export function topRisks<R extends Risk>(risks: readonly R[], n: number): R[] {
  return openRisks(risks)
    .sort((a, b) => riskScore(b) - riskScore(a) || a.id - b.id)
    .slice(0, n);
}

export const ISSUE_PRIORITIES = ['high', 'medium', 'low'] as const;
export type IssuePriority = (typeof ISSUE_PRIORITIES)[number];
export const ISSUE_PRIORITY_LABELS: Record<IssuePriority, string> = { high: 'بالا', medium: 'متوسط', low: 'پایین' };
export const ISSUE_STATUSES = ['open', 'in_progress', 'resolved'] as const;
export type IssueStatus = (typeof ISSUE_STATUSES)[number];
export const ISSUE_STATUS_LABELS: Record<IssueStatus, string> = { open: 'باز', in_progress: 'در حال انجام', resolved: 'حل‌شده' };

export interface Issue {
  id: number;
  title: string;
  owner: string;
  priority: IssuePriority;
  due: IsoDate | null;
  impact: string;
  action: string;
  needsDecision: boolean;
  status: IssueStatus;
}

export const CHANGE_STATUSES = ['pending', 'approved', 'rejected'] as const;
export type ChangeStatus = (typeof CHANGE_STATUSES)[number];
export const CHANGE_STATUS_LABELS: Record<ChangeStatus, string> = { pending: 'در انتظار', approved: 'تأییدشده', rejected: 'ردشده' };

export interface ChangeRequest {
  id: number;
  title: string;
  requester: string;
  date: IsoDate | null;
  reason: string;
  impact: string;
  previousFinish: IsoDate | null;
  newFinish: IsoDate | null;
  status: ChangeStatus;
  approvedBy: string;
  approvedOn: IsoDate | null;
}

export const DECISION_STATUSES = ['pending', 'decided', 'implemented'] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];
export const DECISION_STATUS_LABELS: Record<DecisionStatus, string> = { pending: 'در انتظار', decided: 'تصمیم‌گیری‌شده', implemented: 'اجراشده' };

export interface Decision {
  id: number;
  topic: string;
  text: string;
  maker: string;
  date: IsoDate | null;
  status: DecisionStatus;
}
