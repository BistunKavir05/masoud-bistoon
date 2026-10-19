/**
 * شکل داده‌ی رد و بدل‌شده بین API و رابط کاربری. همه‌ی نوع‌ها فقط توصیف‌اند و کدی اجرا نمی‌کنند.
 * `version` در هر مورد قابل‌ویرایش شماره‌ی نسخه‌ی ردیف برای قفل خوش‌بینانه است؛ هنگام ویرایش همان را برگردانید.
 */
import type { Capability, Role } from './permissions.ts';
import type { Charter, CommissionPayable, Contract } from './charter.ts';
import type { IsoDate } from './date.ts';
import type { EacMethod } from './finance.ts';
import type { MspCounts, MspWarning } from './msp.ts';
import type { MspBlocker, MspEffect, MspMapping, MspMappingStats, MspPlan, MspRemoved, MspSchedulePreview } from './mspImport.ts';
import type { ProjectDocument } from './project.ts';
import type { ChangeRequest, Decision, Issue, Risk } from './records.ts';
import type { RepairWarning } from './repair.ts';
import type { Baseline, CostEntry, Resource, Snapshot, Task, WorkCalendar } from './types.ts';

export interface ProjectDto {
  id: number;
  name: string;
  start: IsoDate;
  status: IsoDate;
  contractEnd: IsoDate | null;
  finance: { unit: string; budget: number; eacMethod: EacMethod };
  /** با هر تغییر ساختاری فعالیت‌ها (درج، حذف، جابه‌جایی، تورفتگی) بالا می‌رود */
  structureVersion: number;
  version: number;
  archived: boolean;
}

export interface ProjectListItem {
  id: number;
  name: string;
  start: IsoDate;
  status: IsoDate;
  contractEnd: IsoDate | null;
  archived: boolean;
  roles: Role[];
  capabilities: Capability[];
}

export interface MeDto {
  roles: Role[];
  capabilities: Capability[];
  isSystemAdmin: boolean;
  /** منابعی از این پروژه که به این کاربر وصل‌اند (برای نقش کارشناس) */
  ownResourceIds: number[];
}

export type TaskDto = Task & { version: number };
export type ResourceDto = Resource & { userId: number | null };

export interface BaselineDto {
  id: number;
  label: string;
  /** تاریخ وضعیتی که خط مبنا در آن ثبت شد */
  statusDate: IsoDate;
  items: Baseline;
}
export interface BaselineHistoryDto extends BaselineDto {
  archivedOn: IsoDate;
}

export type CostEntryDto = CostEntry & { version: number };
export type CharterDto = Charter & { version: number };

/** فیلدهای پورسانت فقط برای کسانی که `commission.view` دارند می‌آید. */
export type CommissionFields = 'salesApproval' | 'salesCommissionPercent' | 'retentionCommissionPercent';
export type ContractDto = Omit<Contract, CommissionFields> & Partial<Pick<Contract, CommissionFields>> & { version: number };

export type RiskDto = Risk & { version: number };
export type IssueDto = Issue & { version: number };
export type ChangeRequestDto = ChangeRequest & { version: number };
export type DecisionDto = Decision & { version: number };
export type DocumentDto = ProjectDocument;

export interface StageSummary {
  id: number;
  wbs: string;
  name: string;
  percent: number;
  start: IsoDate | null;
  finish: IsoDate | null;
}

export type HealthStatus = 'ok' | 'watch' | 'late' | 'unknown';

/** وضعیت و مرحله‌ی پروژه؛ برای همه‌ی نقش‌ها (حتی بازرگانی) محاسبه می‌شود. */
export interface StatusSummary {
  start: IsoDate;
  status: IsoDate;
  contractEnd: IsoDate | null;
  /** درصد پیشرفت واقعی و برنامه‌ای (۰ تا ۱۰۰) */
  actual: number;
  planned: number;
  forecastFinish: IsoDate | null;
  baselineFinish: IsoDate | null;
  /** دیرکرد پایان پیش‌بینی نسبت به خط مبنا به روز کاری؛ مثبت = دیرکرد */
  delayWorkingDays: number;
  health: HealthStatus;
  /** مراحل = فعالیت‌های خلاصه‌ی سطح ۱ */
  stages: StageSummary[];
  /** فعالیت‌های شمرده‌شده (غیرخلاصه) */
  counts: { total: number; done: number; inProgress: number; notStarted: number };
  /** اگر برنامه محاسبه‌شدنی نباشد (مثلاً وابستگی دایره‌ای) */
  scheduleError: string | null;
}

/** پاسخ GET /api/projects/:pid/model. بخش‌هایی که نقش کاربر اجازه نمی‌دهد اصلاً نمی‌آیند. */
export interface ModelBundle {
  project: ProjectDto;
  me: MeDto;
  summary: StatusSummary;
  calendar?: WorkCalendar;
  tasks?: TaskDto[];
  resources?: ResourceDto[];
  baseline?: BaselineDto | null;
  baselineHistory?: BaselineHistoryDto[];
  snapshots?: Snapshot[];
  costs?: CostEntryDto[];
  charter?: CharterDto;
  contract?: ContractDto;
  commission?: CommissionPayable;
  risks?: RiskDto[];
  issues?: IssueDto[];
  changes?: ChangeRequestDto[];
  decisions?: DecisionDto[];
  documents?: DocumentDto[];
}

export interface ApiErrorBody {
  error: { code: string; message: string; details?: unknown; requestId?: string };
}

// ───── ورود فایل MS Project ─────

/** فهرست کوتاه‌شده: تعداد کل و چند مورد اول */
export interface Capped<T> {
  count: number;
  items: T[];
}

/** پاسخ پیش‌نمایش ورود MSP به پروژه‌ی موجود (POST /projects/:pid/import/msp/preview) */
export interface MspPreviewDto {
  file: { name: string; start: IsoDate; status: IsoDate | null; minutesPerDay: number; hoursPerDay: number; counts: MspCounts; calendarFromFile: boolean };
  project: { start: IsoDate; taskCount: number };
  mapping: { used: MspMapping; suggested: MspMapping; stats: Record<MspMapping, MspMappingStats> };
  options: { keepProgress: boolean; keepStart: boolean };
  result: {
    rows: number;
    matched: number;
    added: number;
    removed: Capped<MspRemoved>;
    renamed: Capped<MspPlan['renamed'][number]>;
    kindChanged: Capped<MspPlan['kindChanged'][number]>;
    start: IsoDate;
    replaceBaseline: boolean;
    schedule: MspSchedulePreview;
  };
  effects: MspEffect[];
  blockers: MspBlocker[];
  warnings: Capped<MspWarning | RepairWarning>;
  /** نشانه‌ی تأیید این پیش‌نمایش؛ همراه تأیید نهایی فرستاده می‌شود */
  token: string;
}

/** پاسخ پیش‌نمایش پروژه‌ی جدید از فایل MSP (dryRun) */
export interface MspNewPreviewDto {
  dryRun: true;
  name: string;
  summary: {
    file: MspPreviewDto['file'];
    rows: number;
    baselineItems: number;
    snapshots: number;
    schedule: MspSchedulePreview;
  };
  warnings: Capped<MspWarning | RepairWarning>;
}

export interface ImportSummary {
  tasks: number;
  resources: number;
  costs: number;
  risks: number;
  snapshots: number;
  baselineItems: number;
  issues?: number;
  changes?: number;
  decisions?: number;
  documents?: number;
  baselineHistory?: number;
  legacyLog?: number;
}

/** پاسخ پیش‌نمایش بازیابی پشتیبان/ورود نسخه‌ی قدیمی (dryRun) */
export interface ImportPreviewDto {
  dryRun: true;
  name: string;
  start: IsoDate;
  status?: IsoDate;
  schemaVersion?: number;
  exportedAt?: string | null;
  exportedBy?: string | null;
  summary: ImportSummary;
  warnings: (RepairWarning | { code: string; message: string })[];
  legacyUsers?: { id: string; role: string; resourceNames: string; suggestedRole: Role }[];
}
