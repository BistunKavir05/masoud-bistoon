import { analyzeProject, wbsMap } from '@bistoon/core';
import type { Analysis, HealthStatus, IsoDate, StatusSummary } from '@bistoon/core';
import type { FullModel } from './store.ts';

/** آستانه‌های سلامت پروژه (پیشنهادی؛ در docs/decisions.md ثبت شده): اختلاف پیشرفت برنامه‌ای و واقعی به درصد */
export const HEALTH_WATCH_GAP = 3;
export const HEALTH_LATE_GAP = 10;

export function healthOf(actual: number, planned: number, delayWorkingDays: number, hasTasks: boolean): HealthStatus {
  if (!hasTasks) return 'unknown';
  const gap = planned - actual;
  if (delayWorkingDays > 0 || gap > HEALTH_LATE_GAP) return 'late';
  if (gap > HEALTH_WATCH_GAP) return 'watch';
  return 'ok';
}

export function computeAnalysis(full: FullModel): Analysis | { error: string } {
  const a = analyzeProject(full.model);
  if ('ok' in a && a.ok === false) {
    return { error: a.error === 'CYCLE' ? 'وابستگی دایره‌ای بین فعالیت‌ها وجود دارد؛ برنامه‌ی زمانی محاسبه نمی‌شود.' : 'شناسه‌ی فعالیت تکراری است؛ برنامه‌ی زمانی محاسبه نمی‌شود.' };
  }
  return a as Analysis;
}

export function buildSummary(full: FullModel, analysis: Analysis | { error: string }): StatusSummary {
  const m = full.model;
  const leaves = m.tasks.filter((t) => t.kind !== 'summary');
  const counts = {
    total: leaves.length,
    done: leaves.filter((t) => t.percentComplete >= 100 || t.actualFinish !== null).length,
    inProgress: leaves.filter((t) => t.percentComplete > 0 && t.percentComplete < 100 && t.actualFinish === null).length,
    notStarted: leaves.filter((t) => t.percentComplete <= 0 && t.actualFinish === null).length,
  };
  const base = { start: m.start, status: m.status, contractEnd: m.contractEnd, counts };
  if ('error' in analysis) {
    return { ...base, actual: 0, planned: 0, forecastFinish: null, baselineFinish: null, delayWorkingDays: 0, health: 'unknown', stages: [], scheduleError: analysis.error };
  }
  const { schedule, progress } = analysis;
  const wbs = wbsMap(m.tasks);
  const stages = m.tasks
    .filter((t) => t.kind === 'summary' && t.level === 1)
    .map((t) => {
      const s = schedule.byId.get(t.id);
      return { id: t.id, wbs: wbs.get(t.id) ?? '', name: t.name, percent: s ? s.percent : 0, start: s?.startDate ?? null, finish: s?.finishDate ?? null };
    });
  const dateOfEnd = (endExclusive: number): IsoDate | null => (endExclusive > 0 ? schedule.axis.dateAt(endExclusive - 1) : null);
  const actual = round1(progress.actual);
  const planned = round1(progress.planned);
  return {
    ...base,
    actual,
    planned,
    forecastFinish: dateOfEnd(progress.forecastFinish),
    baselineFinish: dateOfEnd(progress.baselineFinish),
    delayWorkingDays: progress.delay,
    health: healthOf(progress.actual, progress.planned, progress.delay, counts.total > 0),
    stages,
    scheduleError: null,
  };
}

const round1 = (v: number): number => Math.round(v * 10) / 10;
