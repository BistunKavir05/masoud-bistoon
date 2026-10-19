/**
 * مدل دامنه‌ی هسته. این‌جا فقط «داده‌ی ورودی/اصلی» است؛ مقادیر مشتق (ES/EF/LS/LF، WBS، مسیر بحرانی، شاخص‌ها)
 * هرگز در مدل ذخیره‌شونده نمی‌آیند و هر بار از ورودی‌ها محاسبه می‌شوند.
 */
import type { IsoDate } from './date.ts';

export type DependencyType = 'FS' | 'SS' | 'FF' | 'SF';

/** وابستگی: فعالیت جاری «پس‌نیاز» و `predecessorId` «پیش‌نیاز» است. lag به روز کاری و می‌تواند منفی باشد. */
export interface Dependency {
  predecessorId: number;
  type: DependencyType;
  lag: number;
}

export type TaskKind = 'task' | 'summary' | 'milestone';

/** تخصیص منبع به فعالیت؛ `units` درصد تخصیص (۱۰۰ = یک واحد کامل) */
export interface Assignment {
  resourceId: number;
  units: number;
}

export interface DirectCostLine {
  name: string;
  amount: number;
}

/** منشأ قید «شروع نه زودتر»: فقط قیدهای تسطیح با «حذف تأخیرهای تسطیح» پاک می‌شوند. */
export type ConstraintSource = 'manual' | 'msp' | 'leveling';

export interface Task {
  /** شناسه‌ی داخلی پایدار؛ شماره‌ی ردیف یا WBS شناسه نیست. */
  id: number;
  name: string;
  /** سطح سلسله‌مراتب (۱ تا ۹). فرزندان یک خلاصه، فعالیت‌های بعدی با سطح بزرگ‌تر هستند. */
  level: number;
  kind: TaskKind;
  /** مدت ورودی به روز کاری؛ برای خلاصه و مایلستون صفر نادیده گرفته می‌شود. */
  duration: number;
  dependencies: Dependency[];
  weight: number;
  /** درصد پیشرفت ثبت‌شده (۰ تا ۱۰۰) */
  percentComplete: number;
  actualStart: IsoDate | null;
  actualFinish: IsoDate | null;
  /** کار (نفر-روز). اگر مثبت و دارای تخصیص باشد، مدت از کار و تخصیص محاسبه می‌شود. */
  work: number;
  assignments: Assignment[];
  /** قید «شروع نه زودتر» */
  startNoEarlierThan: IsoDate | null;
  startNoEarlierSource: ConstraintSource | null;
  deadline: IsoDate | null;
  /** فعالیت پشتیبانی (Level of Effort): در پایان پروژه و مسیر بحرانی دخالت ندارد. */
  levelOfEffort: boolean;
  directCosts: DirectCostLine[];
  /** هزینه‌ی واقعی ثبت‌شده روی خود فعالیت (برای داده‌های قدیمی بدون دفتر هزینه) */
  legacyActualCost: number | null;
  /** فعالیتی که حتی با هزینه‌ی صفر در جدول هزینه‌ها نمایش داده می‌شود */
  costTracked: boolean;
}

export type ResourceType = 'human' | 'equipment' | 'financial' | 'other';

export interface Resource {
  id: number;
  name: string;
  type: ResourceType;
  /** ظرفیت درصدی (۱۰۰ = یک واحد) */
  capacityPercent: number;
  /** نرخ روزانه‌ی یک واحد کامل */
  dailyRate: number;
}

export interface WorkDay {
  working: boolean;
  /** ساعت شروع و پایان `HH:mm` — فقط نمایشی/خروجی؛ در محاسبه‌ی مدت دخالت ندارد */
  from: string;
  to: string;
}

export interface Holiday {
  date: IsoDate;
  title: string;
}

export interface WorkCalendar {
  /** هفت عضو؛ اندیس ۰ یکشنبه … ۶ شنبه (روز هفته به‌سبک جاوااسکریپت) */
  days: WorkDay[];
  holidays: Holiday[];
}

/** ورودی مشترک محاسبات زمان‌بندی */
export interface ScheduleContext {
  projectStart: IsoDate;
  statusDate: IsoDate;
  calendar: WorkCalendar;
  /** افق محاسبه به روز تقویمی؛ پیش‌فرض ۱۵۰۰ */
  horizonDays?: number;
}

/** عنصر خط مبنا؛ تاریخ‌ها ثبت می‌شوند و اندیس روز کاری هر بار از تقویم جاری مشتق می‌شود. */
export interface BaselineItem {
  start: IsoDate;
  finish: IsoDate;
  /** مدت صفر (مایلستون یا گروه تهی) */
  zeroDuration: boolean;
  /** هزینه‌ی خط مبنا؛ null یعنی هزینه ندارد و از برآورد جاری استفاده می‌شود (رفتار سازگاری) */
  cost: number | null;
}

export type Baseline = Readonly<Record<number, BaselineItem>>;

export interface CostEntry {
  id: number;
  date: IsoDate;
  /** شناسه‌ی فعالیت؛ null = هزینه‌ی عمومی/سربار */
  taskId: number | null;
  description: string;
  document: string;
  amount: number;
}

export interface SnapshotTaskProgress {
  [taskId: number]: number;
}

export interface Snapshot {
  date: IsoDate;
  /** پیشرفت واقعی پروژه (٪) */
  actual: number;
  /** پیشرفت برنامه‌ای (٪) */
  planned?: number;
  /** تخمینی (بازسازی‌شده از تاریخ‌های واقعی) یا ثبت‌شده */
  estimated: boolean;
  tasks?: SnapshotTaskProgress;
  actualCost?: number;
}
