/**
 * خروجی Microsoft Project XML — مطابق «بخش ۱۱-۲» مشخصات و تابع مرجع `xmlStr`.
 *
 * چه چیزی منتقل می‌شود: ساختار و سطح، نوع، مدت برنامه‌ریزی‌شده، پیش‌نیازها با lag، تاریخ‌های محاسبه‌شده، درصد، تاریخ‌های واقعی،
 * قید «شروع نه زودتر»، ضرب‌الاجل، خط مبنای شماره‌ی ۰، تقویم کاری و تعطیلی‌ها.
 * منتقل نمی‌شود: منابع و تخصیص‌ها، هزینه‌ها، وزن، فعالیت پشتیبانی (LoE)، اسنپ‌شات‌ها، ریسک/مسئله/تغییر/تصمیم.
 * هیچ ادعای سازگاری با Microsoft Project واقعی نمی‌شود؛ ساختار با نمونه‌ی خود برنامه (و بازورود به همین برنامه) سنجیده شده است.
 * مدت صادرشده «مدت برنامه‌ریزی‌شده» است، نه الزاماً مدت مؤثر فعلی.
 */
import { plannedDuration, computeSchedule } from './scheduling.ts';
import type { Schedule } from './scheduling.ts';
import { weekday } from './date.ts';
import type { IsoDate } from './date.ts';
import type { ProjectModel } from './project.ts';
import type { DependencyType, Task } from './types.ts';
import { xmlEscape } from './xml.ts';

export const MSP_EXPORT_OMITS = ['منابع و تخصیص‌ها', 'هزینه‌ها و دفتر هزینه', 'وزن فعالیت‌ها', 'فعالیت‌های پشتیبانی (LoE)', 'اسنپ‌شات‌ها', 'ریسک، مسئله، درخواست تغییر و تصمیم'] as const;

const TYPE_CODE: Record<DependencyType, number> = { FF: 0, FS: 1, SF: 2, SS: 3 };
const hm = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));

export type MspExportResult = { ok: true; xml: string; rows: number } | { ok: false; error: string };

export function buildMspXml(model: Pick<ProjectModel, 'name' | 'start' | 'status' | 'calendar' | 'tasks' | 'baseline'>): MspExportResult {
  const sched = computeSchedule({ start: model.start, status: model.status, calendar: model.calendar, tasks: model.tasks });
  if (!sched.ok) return { ok: false, error: 'برنامه وابستگی دایره‌ای دارد؛ ابتدا آن را اصلاح کنید.' };
  return { ok: true, xml: render(model, sched), rows: model.tasks.length };
}

function render(model: Pick<ProjectModel, 'name' | 'start' | 'status' | 'calendar' | 'tasks' | 'baseline'>, sched: Schedule): string {
  const cal = model.calendar;
  const working = cal.days.filter((d) => d.working);
  const mp = Math.round(working.reduce((a, d) => a + hm(d.to) - hm(d.from), 0) / Math.max(1, working.length)) || 450;
  const axis = sched.axis;
  const lastDay = axis.days[axis.length - 1] as IsoDate;
  const tm = (iso: IsoDate, k: 'from' | 'to'): string => `${iso}T${cal.days[weekday(iso)]?.[k] ?? (k === 'from' ? '07:30' : '15:00')}:00`;
  const dur = (days: number): string => {
    const m = Math.round(days * mp);
    return `PT${Math.floor(m / 60)}H${m % 60}M0S`;
  };
  const e = (k: string, v: string | number): string => `<${k}>${typeof v === 'number' ? v : xmlEscape(v)}</${k}>`;
  const head = (id: number, i: number, name: string, type: number): string => e('UID', id) + e('ID', i) + e('Name', name) + e('Active', 1) + e('Manual', 0) + e('Type', type) + e('IsNull', 0);

  const first = axis.days[0] as IsoDate;
  const lastWork = (axis.dateAt(Math.max(0, sched.projectFinish - 1)) ?? lastDay) as IsoDate;
  const root =
    '<Task>' + head(0, 0, model.name, 1) + e('OutlineNumber', 0) + e('OutlineLevel', 0) + e('Priority', 500) + e('Start', tm(first, 'from')) + e('Finish', tm(lastWork, 'to')) +
    e('Duration', dur(sched.projectFinish || 0)) + e('DurationFormat', 7) + e('Work', 'PT0H0M0S') + e('EffortDriven', 0) + e('Estimated', 0) + e('Milestone', 0) + e('Summary', 1) + e('ConstraintType', 0) + e('CalendarUID', -1) + '</Task>';

  const wbs = (() => {
    const counters: number[] = [];
    const out = new Map<number, string>();
    for (const t of model.tasks) {
      counters.length = t.level;
      counters[t.level - 1] = (counters[t.level - 1] ?? 0) + 1;
      for (let i = 0; i < t.level - 1; i += 1) counters[i] = counters[i] ?? 1;
      out.set(t.id, counters.slice(0, t.level).join('.'));
    }
    return out;
  })();

  const tasks = model.tasks
    .map((t: Task, i: number) => {
      const s = sched.byId.get(t.id);
      const sd = (s?.startDate ?? first) as IsoDate;
      const fd = (s?.finishDate ?? sd) as IsoDate;
      const isMs = t.kind === 'milestone';
      const isSum = t.kind === 'summary';
      const planned = isSum ? (s?.duration ?? 0) : plannedDuration(t);
      const b = isSum ? undefined : model.baseline[t.id];
      let out = '<Task>' + head(t.id, i + 1, t.name, isSum ? 1 : 0) + e('WBS', wbs.get(t.id) ?? '') + e('OutlineNumber', wbs.get(t.id) ?? '') + e('OutlineLevel', t.level) + e('Priority', 500);
      out += e('Start', tm(sd, 'from')) + e('Finish', tm(fd, isMs ? 'from' : 'to')) + e('Duration', dur(planned)) + e('DurationFormat', 7) + e('Work', 'PT0H0M0S') + e('EffortDriven', 0) + e('Estimated', 0);
      out += e('Milestone', isMs ? 1 : 0) + e('Summary', isSum ? 1 : 0) + e('PercentComplete', Math.round(s?.percent ?? 0)) + e('PercentWorkComplete', 0);
      if (!isSum && t.actualStart) out += e('ActualStart', tm(t.actualStart, 'from'));
      if (!isSum && t.actualFinish) out += e('ActualFinish', tm(t.actualFinish, isMs ? 'from' : 'to'));
      out += e('ConstraintType', t.startNoEarlierThan ? 4 : 0) + e('CalendarUID', -1);
      if (t.startNoEarlierThan) out += e('ConstraintDate', tm(t.startNoEarlierThan, 'from'));
      if (!isSum && t.deadline) out += e('Deadline', tm(t.deadline, 'to'));
      for (const d of t.dependencies) {
        out += '<PredecessorLink>' + e('PredecessorUID', d.predecessorId) + e('Type', TYPE_CODE[d.type]) + e('CrossProject', 0) + e('LinkLag', Math.round(d.lag * mp * 10)) + e('LagFormat', 7) + '</PredecessorLink>';
      }
      if (b) {
        const si = axis.onOrAfter(b.start);
        const days = b.zeroDuration ? 0 : axis.onOrAfter(b.finish) - si + 1;
        out += '<Baseline>' + e('Number', 0) + e('Start', tm(b.start, 'from')) + e('Finish', tm(b.finish, days > 0 ? 'to' : 'from')) + e('Duration', dur(days)) + '</Baseline>';
      }
      return `${out}</Task>`;
    })
    .join('');

  const days = cal.days
    .map((d, i) => '<WeekDay>' + e('DayType', i + 1) + e('DayWorking', d.working ? 1 : 0) + (d.working ? '<WorkingTimes><WorkingTime>' + e('FromTime', `${d.from}:00`) + e('ToTime', `${d.to}:00`) + '</WorkingTime></WorkingTimes>' : '') + '</WeekDay>')
    .join('');
  const holidays = cal.holidays.length
    ? '<Exceptions>' + cal.holidays.map((h) => '<Exception>' + e('EnteredByOccurrences', 0) + '<TimePeriod>' + e('FromDate', `${h.date}T00:00:00`) + e('ToDate', `${h.date}T23:59:00`) + '</TimePeriod>' + e('Occurrences', 1) + e('Name', h.title) + e('Type', 1) + e('DayWorking', 0) + '</Exception>').join('') + '</Exceptions>'
    : '';
  const calendar = '<Calendars><Calendar>' + e('UID', 1) + e('Name', 'تقویم پروژه') + e('IsBaseCalendar', 1) + e('IsBaselineCalendar', 0) + e('BaseCalendarUID', -1) + `<WeekDays>${days}</WeekDays>${holidays}</Calendar></Calendars>`;
  const w0 = working[0] ?? { from: '07:30', to: '15:00' };
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Project xmlns="http://schemas.microsoft.com/project">' +
    e('SaveVersion', 14) + e('Name', model.name) + e('ScheduleFromStart', 1) + e('StartDate', tm(first, 'from')) + e('FinishDate', tm(lastWork, 'to')) + e('FYStartDate', 1) + e('CriticalSlackLimit', 0) + e('CurrencyDigits', 2) + e('CalendarUID', 1) +
    e('DefaultStartTime', `${w0.from}:00`) + e('DefaultFinishTime', `${w0.to}:00`) + e('MinutesPerDay', mp) + e('MinutesPerWeek', mp * working.length) + e('DaysPerMonth', 20) + e('DefaultTaskType', 0) + e('DurationFormat', 7) + e('WorkFormat', 2) + e('WeekStartDay', 6) +
    e('StatusDate', `${model.status}T${w0.to}:00`) +
    `${calendar}<Tasks>${root}${tasks}</Tasks><Resources><Resource>` + e('UID', 0) + e('ID', 0) + e('Type', 1) + e('IsNull', 0) + e('MaxUnits', '1.00') + e('CalendarUID', 1) + '</Resource></Resources></Project>'
  );
}
