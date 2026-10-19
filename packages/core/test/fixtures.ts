import { defaultCalendar } from '../src/calendar.ts';
import type { ScheduleInput } from '../src/scheduling.ts';
import type { Task } from '../src/types.ts';

/** فعالیت با پیش‌فرض‌های سازگار؛ فقط فیلدهای لازم را بدهید */
export function task(p: Partial<Task> & { id: number }): Task {
  const kind = p.kind ?? 'task';
  return {
    name: `T${p.id}`,
    level: 1,
    kind,
    duration: kind === 'task' ? 1 : 0,
    dependencies: [],
    weight: kind === 'summary' ? 0 : (p.duration ?? 1),
    percentComplete: 0,
    actualStart: null,
    actualFinish: null,
    work: 0,
    assignments: [],
    startNoEarlierThan: null,
    startNoEarlierSource: null,
    deadline: null,
    levelOfEffort: false,
    directCosts: [],
    legacyActualCost: null,
    costTracked: false,
    recurrence: null,
    ...p,
  };
}

export const dep = (predecessorId: number, type: 'FS' | 'SS' | 'FF' | 'SF' = 'FS', lag = 0) => ({ predecessorId, type, lag });

export function input(tasks: Task[], extra: Partial<ScheduleInput> = {}): ScheduleInput {
  return { start: '2026-09-01', status: '2026-09-01', calendar: defaultCalendar(), tasks, ...extra };
}
