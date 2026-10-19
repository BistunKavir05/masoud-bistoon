/** مدل کامل یک پروژه و تحلیل یکجا (زمان‌بندی، پیشرفت، مالی، منحنی S، پورسانت). */
import type { IsoDate } from './date.ts';
import type { Charter, Contract } from './charter.ts';
import { commissionPayable, type CommissionPayable } from './charter.ts';
import { computeFinance, defaultFinanceSettings, type FinanceMetrics, type FinanceSettings } from './finance.ts';
import { computeProgress, type ProgressMetrics } from './progress.ts';
import type { ChangeRequest, Decision, Issue, Risk } from './records.ts';
import { computeSCurve, type SCurve } from './scurve.ts';
import { computeSchedule, type Schedule, type ScheduleFailure } from './scheduling.ts';
import type { Baseline, CostEntry, Resource, Snapshot, Task, WorkCalendar } from './types.ts';

export const DOCUMENT_TYPES = ['contract', 'drawing', 'minutes', 'report', 'spec', 'other'] as const;
export type DocumentType = (typeof DOCUMENT_TYPES)[number];
export const DOCUMENT_TYPE_LABELS: Record<DocumentType, string> = {
  contract: 'قرارداد',
  drawing: 'نقشه / طراحی',
  minutes: 'صورتجلسه',
  report: 'گزارش',
  spec: 'مشخصات فنی',
  other: 'سایر',
};

export interface ProjectDocument {
  id: number;
  title: string;
  type: DocumentType;
  url: string;
  taskId: number | null;
  date: IsoDate | null;
  addedBy: string;
}

export interface BaselineVersion {
  id: number;
  archivedOn: IsoDate;
  items: Baseline;
}

export interface ProjectModel {
  name: string;
  start: IsoDate;
  status: IsoDate;
  contractEnd: IsoDate | null;
  calendar: WorkCalendar;
  tasks: Task[];
  resources: Resource[];
  baseline: Baseline;
  baselineHistory: BaselineVersion[];
  snapshots: Snapshot[];
  costs: CostEntry[];
  finance: FinanceSettings;
  charter: Charter;
  contract: Contract;
  risks: Risk[];
  issues: Issue[];
  changes: ChangeRequest[];
  decisions: Decision[];
  documents: ProjectDocument[];
}

export interface Analysis {
  schedule: Schedule;
  progress: ProgressMetrics;
  finance: FinanceMetrics;
  scurve: SCurve;
  commission: CommissionPayable;
}

export function analyzeProject(model: ProjectModel): Analysis | ScheduleFailure {
  const schedule = computeSchedule({ start: model.start, status: model.status, calendar: model.calendar, tasks: model.tasks });
  if (!schedule.ok) return schedule;
  const progress = computeProgress(model.tasks, schedule, model.baseline);
  const finance = computeFinance({
    tasks: model.tasks,
    schedule,
    baseline: model.baseline,
    resources: model.resources,
    ledger: model.costs,
    method: model.finance.eacMethod ?? defaultFinanceSettings().eacMethod,
  });
  const scurve = computeSCurve({
    tasks: model.tasks,
    schedule,
    baseline: model.baseline,
    snapshots: model.snapshots,
    progress,
    status: model.status,
    contractEnd: model.contractEnd,
  });
  return { schedule, progress, finance, scurve, commission: commissionPayable(model.contract) };
}
