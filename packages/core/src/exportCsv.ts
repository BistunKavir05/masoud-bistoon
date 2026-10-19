/**
 * سازنده‌ی خروجی CSV داده‌های پروژه (فعالیت‌ها، ریسک، مسئله، تغییر، تصمیم، مستندات، هزینه‌ها).
 * فقط ردیف‌ها را می‌سازد؛ نویسه‌گذاری (BOM، CRLF، محافظ فرمول) با `toCsv` است.
 * ستون‌های فعالیت‌ها طبق مشخصات: ردیف، WBS، نام، نوع، مدت، پیش‌نیاز (با شماره‌ی ردیف)، وزن، پیشرفت، شروع، پایان (ISO)،
 * شروع/پایان شمسی، شناوری، بحرانی. تاریخ‌ها به‌صورت ISO میلادی (ذخیره) و شمسی (نمایش) هر دو می‌آیند.
 */
import type { CsvValue } from './csv.ts';
import { toCsv } from './csv.ts';
import type { IsoDate } from './date.ts';
import { formatJalali } from './jalali.ts';
import type { Analysis, ProjectModel } from './project.ts';
import { DOCUMENT_TYPE_LABELS } from './project.ts';
import {
  CHANGE_STATUS_LABELS,
  DECISION_STATUS_LABELS,
  ISSUE_PRIORITY_LABELS,
  ISSUE_STATUS_LABELS,
  RISK_CATEGORY_LABELS,
  RISK_STATUS_LABELS,
  RISK_STRATEGY_LABELS,
} from './records.ts';
import { wbsMap } from './structure.ts';
import type { CostEntry, Task } from './types.ts';

export const CSV_KINDS = ['tasks', 'risks', 'issues', 'changes', 'decisions', 'documents', 'costs'] as const;
export type CsvKind = (typeof CSV_KINDS)[number];

export const CSV_KIND_LABELS: Record<CsvKind, string> = {
  tasks: 'فعالیت‌ها',
  risks: 'ریسک‌ها',
  issues: 'مسائل',
  changes: 'درخواست‌های تغییر',
  decisions: 'تصمیم‌ها',
  documents: 'مستندات',
  costs: 'هزینه‌های واقعی',
};

const KIND_LABEL: Record<Task['kind'], string> = { task: 'فعالیت', summary: 'خلاصه', milestone: 'مایلستون' };

const j = (d: IsoDate | null | undefined): string => (d ? formatJalali(d, { persianDigits: false }) : '');
/** تاریخ ISO و معادل شمسی کنار هم */
const dates = (d: IsoDate | null | undefined): [string, string] => [d ?? '', j(d)];

export const TASK_CSV_HEADER = ['ردیف', 'WBS', 'نام', 'نوع', 'مدت (روز کاری)', 'پیش‌نیازها (شماره‌ی ردیف)', 'وزن', 'پیشرفت (٪)', 'شروع', 'پایان', 'شروع شمسی', 'پایان شمسی', 'شناوری (روز)', 'بحرانی'] as const;
export const COST_CSV_HEADER = ['تاریخ', 'کد WBS', 'نام فعالیت', 'شرح هزینه', 'شماره سند', 'مبلغ'] as const;

/** پیش‌نیاز: «۳» برای پایان‌به‌شروع بدون تأخیر؛ وگرنه «3SS+2» (نوع و تأخیر) */
function predecessorText(t: Task, rowOf: ReadonlyMap<number, number>): string {
  return t.dependencies
    .map((d) => {
      const row = rowOf.get(d.predecessorId);
      if (row === undefined) return '';
      if (d.type === 'FS' && d.lag === 0) return String(row);
      return `${row}${d.type}${d.lag > 0 ? `+${d.lag}` : d.lag < 0 ? String(d.lag) : ''}`;
    })
    .filter((x) => x !== '')
    .join(';');
}

export function taskCsvRows(model: ProjectModel, analysis: Pick<Analysis, 'schedule'>): CsvValue[][] {
  const wbs = wbsMap(model.tasks);
  const rowOf = new Map<number, number>(model.tasks.map((t, i) => [t.id, i + 1]));
  const rows: CsvValue[][] = [[...TASK_CSV_HEADER]];
  model.tasks.forEach((t, i) => {
    const st = analysis.schedule.byId.get(t.id);
    rows.push([
      i + 1,
      wbs.get(t.id) ?? '',
      t.name,
      KIND_LABEL[t.kind],
      st ? st.duration : t.duration,
      predecessorText(t, rowOf),
      t.weight,
      st ? Math.round(st.percent) : Math.round(t.percentComplete),
      st?.startDate ?? '',
      st?.finishDate ?? '',
      j(st?.startDate),
      j(st?.finishDate),
      st ? st.totalFloat : '',
      st ? (st.critical ? 'بله' : 'خیر') : '',
    ]);
  });
  return rows;
}

export function riskCsvRows(model: ProjectModel): CsvValue[][] {
  return [
    ['شناسه', 'عنوان', 'دسته', 'احتمال (۱ تا ۵)', 'اثر (۱ تا ۵)', 'مسئول', 'راهبرد', 'اقدام پاسخ', 'موعد', 'موعد شمسی', 'وضعیت'],
    ...model.risks.map((r) => [r.id, r.title, r.category ? RISK_CATEGORY_LABELS[r.category] : '', r.probability, r.impact, r.owner, r.strategy ? RISK_STRATEGY_LABELS[r.strategy] : '', r.response, ...dates(r.due), RISK_STATUS_LABELS[r.status]]),
  ];
}

export function issueCsvRows(model: ProjectModel): CsvValue[][] {
  return [
    ['شناسه', 'عنوان', 'مسئول', 'اولویت', 'موعد', 'موعد شمسی', 'اثر', 'اقدام', 'نیاز به تصمیم', 'وضعیت'],
    ...model.issues.map((x) => [x.id, x.title, x.owner, ISSUE_PRIORITY_LABELS[x.priority], ...dates(x.due), x.impact, x.action, x.needsDecision ? 'بله' : 'خیر', ISSUE_STATUS_LABELS[x.status]]),
  ];
}

export function changeCsvRows(model: ProjectModel): CsvValue[][] {
  return [
    ['شناسه', 'عنوان', 'درخواست‌دهنده', 'تاریخ', 'تاریخ شمسی', 'دلیل', 'اثر', 'پایان قبلی', 'پایان قبلی شمسی', 'پایان جدید', 'پایان جدید شمسی', 'وضعیت', 'تأییدکننده', 'تاریخ تأیید', 'تاریخ تأیید شمسی'],
    ...model.changes.map((c) => [c.id, c.title, c.requester, ...dates(c.date), c.reason, c.impact, ...dates(c.previousFinish), ...dates(c.newFinish), CHANGE_STATUS_LABELS[c.status], c.approvedBy, ...dates(c.approvedOn)]),
  ];
}

export function decisionCsvRows(model: ProjectModel): CsvValue[][] {
  return [
    ['شناسه', 'موضوع', 'متن تصمیم', 'تصمیم‌گیرنده', 'تاریخ', 'تاریخ شمسی', 'وضعیت'],
    ...model.decisions.map((d) => [d.id, d.topic, d.text, d.maker, ...dates(d.date), DECISION_STATUS_LABELS[d.status]]),
  ];
}

export function documentCsvRows(model: ProjectModel): CsvValue[][] {
  const wbs = wbsMap(model.tasks);
  const byId = new Map(model.tasks.map((t) => [t.id, t]));
  return [
    ['عنوان', 'نوع', 'لینک', 'فعالیت', 'تاریخ', 'تاریخ شمسی'],
    ...model.documents.map((d) => {
      const t = d.taskId === null ? undefined : byId.get(d.taskId);
      return [d.title, DOCUMENT_TYPE_LABELS[d.type], d.url, t ? `${wbs.get(t.id) ?? ''} ${t.name}`.trim() : '', ...dates(d.date)];
    }),
  ];
}

/** ردیف‌های دفتر هزینه به ترتیب تاریخ؛ همان قالب «خروجی CSV/Excel» تب مالی */
export function costCsvRows(costs: readonly CostEntry[], tasks: readonly Task[]): (string | number)[][] {
  const wbs = wbsMap(tasks);
  const byId = new Map(tasks.map((t) => [t.id, t]));
  return [
    [...COST_CSV_HEADER],
    ...[...costs]
      .sort((a, c) => (a.date < c.date ? -1 : a.date > c.date ? 1 : a.id - c.id))
      .map((r) => [j(r.date), r.taskId === null ? '' : (wbs.get(r.taskId) ?? ''), r.taskId === null ? '' : (byId.get(r.taskId)?.name ?? ''), r.description, r.document, r.amount]),
  ];
}

export interface CsvExportOptions {
  /** دسترسی به ارقام مالی (ادمین/مدیر پروژه). بدون آن خروجی هزینه‌ها فقط BOM دارد و ردیفی ندارد. */
  canSeeCosts: boolean;
}

export type CsvBuild = { ok: true; text: string; rows: number } | { ok: false; error: string };

/** خروجی کامل یک دسته؛ `rows` تعداد ردیف‌های داده (بدون عنوان) */
export function buildCsv(kind: CsvKind, model: ProjectModel, analysis: Pick<Analysis, 'schedule'> | null, opts: CsvExportOptions): CsvBuild {
  let rows: CsvValue[][];
  switch (kind) {
    case 'tasks':
      if (!analysis) return { ok: false, error: 'برنامه‌ی پروژه محاسبه‌پذیر نیست (مثلاً دور در وابستگی‌ها)؛ ابتدا آن را اصلاح کنید.' };
      rows = taskCsvRows(model, analysis);
      break;
    case 'risks':
      rows = riskCsvRows(model);
      break;
    case 'issues':
      rows = issueCsvRows(model);
      break;
    case 'changes':
      rows = changeCsvRows(model);
      break;
    case 'decisions':
      rows = decisionCsvRows(model);
      break;
    case 'documents':
      rows = documentCsvRows(model);
      break;
    case 'costs':
      if (!opts.canSeeCosts) return { ok: true, text: '﻿', rows: 0 };
      rows = costCsvRows(model.costs, model.tasks);
      break;
  }
  return { ok: true, text: toCsv(rows), rows: rows.length - 1 };
}

/** نام فایل خروجی: `bistoon-<نوع>-<تاریخ وضعیت>.csv` (ASCII، مناسب سیستم‌فایل) */
export function csvFileName(kind: CsvKind, statusDate: IsoDate): string {
  return `bistoon-${kind}-${statusDate}.csv`;
}
