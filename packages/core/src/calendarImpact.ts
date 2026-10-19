/** پیش‌نمایش اثر تغییر تقویم کاری بر برنامه: پایان پروژه و تعداد فعالیت‌هایی که تاریخشان جابه‌جا می‌شود. */
import type { IsoDate } from './date.ts';
import { diffDays } from './date.ts';
import { computeSchedule } from './scheduling.ts';
import type { Schedule } from './scheduling.ts';
import { weeklyHours } from './calendar.ts';
import type { ProjectModel } from './project.ts';
import type { WorkCalendar } from './types.ts';

export interface CalendarImpact {
  /** false اگر برنامه با یکی از دو تقویم محاسبه‌پذیر نباشد (مثلاً دور در وابستگی‌ها) */
  computable: boolean;
  weeklyHoursBefore: number;
  weeklyHoursAfter: number;
  finishBefore: IsoDate | null;
  finishAfter: IsoDate | null;
  /** finishAfter − finishBefore به روز تقویمی؛ مثبت = دیرتر */
  finishShiftDays: number | null;
  /** فعالیت‌هایی که تاریخ شروع یا پایانشان عوض می‌شود */
  moved: number;
  /** فعالیت‌هایی که با تقویم تازه از افق محاسبه بیرون می‌افتند */
  outOfHorizon: number;
}

function finishOf(s: Schedule): IsoDate | null {
  return s.projectFinish > 0 ? s.axis.dateAt(s.projectFinish - 1) : null;
}

export function previewCalendarChange(model: Pick<ProjectModel, 'start' | 'status' | 'tasks' | 'calendar'>, next: WorkCalendar): CalendarImpact {
  const base = { weeklyHoursBefore: weeklyHours(model.calendar), weeklyHoursAfter: weeklyHours(next) };
  const a = computeSchedule({ start: model.start, status: model.status, calendar: model.calendar, tasks: model.tasks });
  const b = computeSchedule({ start: model.start, status: model.status, calendar: next, tasks: model.tasks });
  if (!a.ok || !b.ok) return { ...base, computable: false, finishBefore: null, finishAfter: null, finishShiftDays: null, moved: 0, outOfHorizon: 0 };
  let moved = 0;
  let outOfHorizon = 0;
  for (const t of b.tasks) {
    const old = a.byId.get(t.id);
    if (t.startDate === null || t.finishDate === null) outOfHorizon += 1;
    if (!old || old.startDate !== t.startDate || old.finishDate !== t.finishDate) moved += 1;
  }
  const finishBefore = finishOf(a);
  const finishAfter = finishOf(b);
  return { ...base, computable: true, finishBefore, finishAfter, finishShiftDays: finishBefore && finishAfter ? diffDays(finishAfter, finishBefore) : null, moved, outOfHorizon };
}
