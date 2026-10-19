/**
 * شاخص‌های داشبورد و هشدارها؛ منطق خالص بدون React تا هم در رابط و هم در گزارش چاپی یکسان باشد.
 * تعریف‌ها از داشبورد برنامه‌ی قبلی گرفته شده‌اند (مبنای «تأخیر پروژه»: پایان پیش‌بینی منهای پایان خط مبنا به روز کاری).
 */
import type { IsoDate } from './date.ts';
import { diffDays } from './date.ts';
import { baselineOrCurrent } from './baseline.ts';
import type { Analysis, ProjectModel } from './project.ts';
import { riskLevel, riskScore } from './records.ts';
import { computeUtilization, countOverbooked } from './resources.ts';
import { wbsMap } from './structure.ts';

export interface DelayedTask {
  id: number;
  wbs: string;
  name: string;
  percent: number;
  baselineFinish: IsoDate | null;
  forecastFinish: IsoDate | null;
  /** روز کاری */
  delayDays: number;
}

export interface UpcomingMilestone {
  id: number;
  wbs: string;
  name: string;
  date: IsoDate | null;
}

export interface OverbookedWeek {
  resourceId: number;
  name: string;
  weekStart: IsoDate;
  /** درصد بارگذاری نسبت به ظرفیت */
  load: number;
}

export interface OutOfSequence {
  taskId: number;
  name: string;
  predecessorId: number;
  predecessorName: string;
}

export type AlertSeverity = 'bad' | 'warn' | 'info';
export interface DashboardAlert {
  code: string;
  severity: AlertSeverity;
  message: string;
}

export interface DashboardMetrics {
  baselineFinishDate: IsoDate | null;
  forecastFinishDate: IsoDate | null;
  delayWorkingDays: number;
  delayCalendarDays: number;
  /** ذخیره (مثبت) یا کسری (منفی) نسبت به پایان قرارداد، به روز کاری؛ null بدون پایان قرارداد */
  reserveWorkingDays: number | null;
  criticalCount: number;
  delayedTasks: DelayedTask[];
  maxTaskDelay: number;
  unfinishedCount: number;
  outOfSequence: OutOfSequence[];
  overbooked: OverbookedWeek[];
  /** تعداد (منبع، روز) بیش‌تخصیص */
  overbookedDays: number;
  criticalRisks: number;
  openRisks: number;
  openIssues: number;
  pendingDecisions: number;
  pendingChanges: number;
  upcomingMilestones: UpcomingMilestone[];
  hasBaseline: boolean;
  alerts: DashboardAlert[];
}

const EPS = 1e-9;

export function computeDashboard(model: ProjectModel, analysis: Analysis): DashboardMetrics {
  const { schedule, progress } = analysis;
  const { axis } = schedule;
  const wbs = wbsMap(model.tasks);
  const byId = new Map(model.tasks.map((t) => [t.id, t]));
  const hasBaseline = Object.keys(model.baseline).length > 0;

  const baselineFinishDate = progress.baselineFinish > 0 ? axis.dateAt(progress.baselineFinish - 1) : null;
  const forecastFinishDate = schedule.projectFinish > 0 ? axis.dateAt(schedule.projectFinish - 1) : null;
  const delayCalendarDays = baselineFinishDate && forecastFinishDate ? diffDays(forecastFinishDate, baselineFinishDate) : 0;

  const delayedTasks: DelayedTask[] = [];
  for (const id of progress.delayedTaskIds) {
    const t = byId.get(id);
    const s = schedule.byId.get(id);
    if (!t || !s) continue;
    const b = baselineOrCurrent(t, schedule, model.baseline);
    const bEnd = b.earlyStart + b.duration;
    delayedTasks.push({ id, wbs: wbs.get(id) ?? '', name: t.name, percent: s.percent, baselineFinish: axis.dateAt(bEnd - 1), forecastFinish: axis.dateAt(s.earlyFinish - 1), delayDays: s.earlyFinish - bEnd });
  }
  delayedTasks.sort((a, b) => b.delayDays - a.delayDays || a.id - b.id);

  const leaves = model.tasks.filter((t) => t.kind !== 'summary');
  const unfinishedCount = leaves.filter((t) => (schedule.byId.get(t.id)?.percent ?? 0) < 100).length;

  const outOfSequence: OutOfSequence[] = [];
  for (const t of leaves) {
    if (!t.actualStart && !t.actualFinish) continue;
    for (const d of t.dependencies) {
      const p = byId.get(d.predecessorId);
      if (d.type === 'FS' && p && p.kind !== 'milestone' && p.kind !== 'summary' && (schedule.byId.get(p.id)?.percent ?? 0) < 100) {
        outOfSequence.push({ taskId: t.id, name: t.name, predecessorId: p.id, predecessorName: p.name });
        break;
      }
    }
  }

  const util = computeUtilization(model.tasks, schedule, model.resources);
  const resName = new Map(model.resources.map((r) => [r.id, r.name]));
  const overbooked: OverbookedWeek[] = [];
  for (const [rid, weeks] of util.load) {
    for (const w of util.weeks) {
      const v = weeks.get(w.week);
      if (v !== undefined && v > 100 + EPS) overbooked.push({ resourceId: rid, name: resName.get(rid) ?? `#${rid}`, weekStart: w.start, load: v });
    }
  }
  overbooked.sort((a, b) => a.weekStart.localeCompare(b.weekStart) || a.resourceId - b.resourceId);

  const openRisks = model.risks.filter((r) => r.status !== 'closed');
  const criticalRisks = openRisks.filter((r) => riskLevel(riskScore(r)) === 'critical').length;
  const unresolvedIssues = model.issues.filter((i) => i.status !== 'resolved');
  const pendingDecisions = model.decisions.filter((d) => d.status === 'pending').length + unresolvedIssues.filter((i) => i.needsDecision).length;
  const pendingChanges = model.changes.filter((c) => c.status === 'pending').length;

  const upcomingMilestones: UpcomingMilestone[] = model.tasks
    .filter((t) => t.kind === 'milestone' && (schedule.byId.get(t.id)?.percent ?? 0) < 100)
    .map((t) => ({ id: t.id, wbs: wbs.get(t.id) ?? '', name: t.name, date: schedule.byId.get(t.id)?.startDate ?? null }))
    .sort((a, b) => (a.date ?? '9999').localeCompare(b.date ?? '9999') || a.id - b.id)
    .slice(0, 5);

  const reserve = model.contractEnd ? axis.after(model.contractEnd) - schedule.projectFinish : null;

  const alerts: DashboardAlert[] = [];
  const add = (code: string, severity: AlertSeverity, message: string): void => void alerts.push({ code, severity, message });
  const fa = (n: number): string => String(n);
  if (reserve !== null && reserve < 0) add('PAST_CONTRACT_END', 'bad', `پایان پیش‌بینی پروژه ${fa(-reserve)} روز کاری بعد از پایان قرارداد است.`);
  if (progress.delay > 0) add('DELAYED', 'bad', `پایان پروژه ${fa(progress.delay)} روز کاری از خط مبنا عقب است.`);
  if (outOfSequence.length > 0) add('OUT_OF_SEQUENCE', 'warn', `در ${fa(outOfSequence.length)} فعالیت، کار شروع یا تمام شده در حالی‌که پیش‌نیاز (FS) آن هنوز تمام نشده است؛ ترتیب یا وابستگی‌ها را بررسی کنید.`);
  if (overbooked.length > 0) add('OVERBOOKED', 'warn', `${fa(overbooked.length)} مورد بیش‌تخصیص منبع در هفته‌های آینده وجود دارد.`);
  if (!hasBaseline) add('NO_BASELINE', 'info', 'خط مبنا ثبت نشده است؛ انحراف و «برنامه‌ای» با برنامه‌ی جاری سنجیده می‌شوند و تأخیر تاریخی دیده نمی‌شود.');
  for (const w of schedule.warnings) if (w.code === 'HORIZON_OVERFLOW') add('HORIZON', 'warn', w.message);
  return {
    baselineFinishDate,
    forecastFinishDate,
    delayWorkingDays: progress.delay,
    delayCalendarDays,
    reserveWorkingDays: reserve,
    criticalCount: schedule.tasks.filter((s) => s.critical && model.tasks.find((t) => t.id === s.id)?.kind !== 'summary').length,
    delayedTasks,
    maxTaskDelay: delayedTasks.reduce((m, d) => Math.max(m, d.delayDays), 0),
    unfinishedCount,
    outOfSequence,
    overbooked,
    overbookedDays: countOverbooked(model.tasks, schedule, model.resources),
    criticalRisks,
    openRisks: openRisks.length,
    openIssues: unresolvedIssues.length,
    pendingDecisions,
    pendingChanges,
    upcomingMilestones,
    hasBaseline,
    alerts,
  };
}
