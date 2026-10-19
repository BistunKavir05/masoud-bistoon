import { describe, expect, it } from 'vitest';
import { createRecurrence, defaultRecurrence, defaultCalendar, updateRecurrence } from '@bistoon/core';
import type { RecurrenceResult, Task } from '@bistoon/core';
import { recurrenceImpact } from '../src/tabs/tasks/recurrenceImpact.ts';

const START = '2026-09-12';
const cal = defaultCalendar();
const pattern = (count: number) => ({ ...defaultRecurrence(START), name: 'جلسه', count });

function build(): Task[] {
  const r = createRecurrence([], pattern(5), { projectStart: START, calendar: cal, referenceId: null, asChild: false, firstId: 1 });
  if (!r.ok) throw new Error(r.message);
  return r.tasks.map((t) => {
    if (t.id === 5) return { ...t, percentComplete: 30 }; // رخداد چهارم
    if (t.id === 6) return { ...t, actualStart: '2026-10-10' }; // رخداد پنجم
    return t;
  });
}
const ok = (r: RecurrenceResult) => {
  if (!r.ok) throw new Error(r.message);
  return r;
};

describe('اثر ویرایش الگوی تکرار', () => {
  it('بدون تغییر تعداد: همه حفظ می‌شوند', () => {
    const tasks = build();
    const imp = recurrenceImpact(tasks, ok(updateRecurrence(tasks, 1, pattern(5), { projectStart: START, calendar: cal, firstId: 50 })), []);
    expect(imp).toMatchObject({ added: 0, kept: 5, dependentsCleared: 0 });
    expect(imp.removed).toEqual([]);
  });

  it('افزایش تعداد: رخدادهای تازه', () => {
    const tasks = build();
    const imp = recurrenceImpact(tasks, ok(updateRecurrence(tasks, 1, pattern(8), { projectStart: START, calendar: cal, firstId: 50 })), []);
    expect(imp).toMatchObject({ added: 3, kept: 5 });
  });

  it('کاهش تعداد: پیشرفت، هزینه و وابسته‌های بیرونی در خطر گزارش می‌شود', () => {
    const tasks: Task[] = [...build(), { ...build()[1]!, id: 90, name: 'پس از جلسه چهارم', level: 1, recurrence: null, percentComplete: 0, actualStart: null, dependencies: [{ predecessorId: 5, type: 'FS', lag: 0 }] }];
    const res = ok(updateRecurrence(tasks, 1, pattern(3), { projectStart: START, calendar: cal, firstId: 100 }));
    const imp = recurrenceImpact(tasks, res, [{ taskId: 6 }, { taskId: 6 }, { taskId: 2 }, { taskId: null }]);
    expect(imp.kept).toBe(3);
    expect(imp.removed.map((r) => r.id)).toEqual([5, 6]);
    expect(imp.removedWithProgress.map((r) => r.id)).toEqual([5, 6]);
    expect(imp.removedWithCosts).toEqual([{ id: 6, name: 'جلسه 5', hasProgress: true, costCount: 2 }]);
    expect(imp.dependentsCleared).toBe(1);
  });
});
