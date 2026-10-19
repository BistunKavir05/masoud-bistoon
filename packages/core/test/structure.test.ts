import { describe, expect, it } from 'vitest';
import { applyTaskPatch, type PatchContext } from '../src/taskPatch.ts';
import { deleteSubtree, guardCycle, hasDetails, indentTask, insertTask, moveTask, outdentTask, subtreeEnd, validateHierarchy, wbsMap } from '../src/structure.ts';
import { defaultCalendar } from '../src/calendar.ts';
import type { Task } from '../src/types.ts';
import { dep, task } from './fixtures.ts';

const sample = (): Task[] => [
  task({ id: 1, kind: 'summary', level: 1 }),
  task({ id: 2, level: 2, duration: 3 }),
  task({ id: 3, kind: 'summary', level: 2 }),
  task({ id: 4, level: 3, duration: 2, dependencies: [dep(2)] }),
  task({ id: 5, level: 1, duration: 4, dependencies: [dep(4)] }),
  task({ id: 6, level: 1, duration: 1 }),
];
const ids = (t: readonly Task[]): number[] => t.map((x) => x.id);
const lv = (t: readonly Task[]): number[] => t.map((x) => x.level);
function ok<T extends { ok: boolean }>(r: T): Extract<T, { ok: true }> {
  if (!r.ok) throw new Error(`failed: ${JSON.stringify(r)}`);
  return r as Extract<T, { ok: true }>;
}

describe('ساختار', () => {
  it('پایان زیردرخت', () => {
    const t = sample();
    expect(subtreeEnd(t, 0)).toBe(4);
    expect(subtreeEnd(t, 2)).toBe(4);
    expect(subtreeEnd(t, 4)).toBe(5);
  });
  it('شماره‌ی WBS مشتق', () => {
    expect([...wbsMap(sample()).values()]).toEqual(['1', '1.1', '1.2', '1.2.1', '2', '3']);
  });
  it('درج هم‌سطح بعد از زیردرخت', () => {
    const r = ok(insertTask(sample(), { referenceId: 1, asChild: false, kind: 'task', name: ' جدید ' }));
    expect(ids(r.tasks)).toEqual([1, 2, 3, 4, 7, 5, 6]);
    expect(r.tasks[4]).toMatchObject({ id: 7, level: 1, name: 'جدید', duration: 1, weight: 1 });
    expect(r.newId).toBe(7);
    expect(r.convertedId).toBeNull();
  });
  it('درج زیرمجموعه زیر فعالیت عادی آن را خلاصه می‌کند و جزئیاتش را پاک', () => {
    const t = sample();
    expect(hasDetails(t[4] as Task)).toBe(true);
    const r = ok(insertTask(t, { referenceId: 5, asChild: true, kind: 'milestone', name: 'M' }));
    expect(r.convertedId).toBe(5);
    expect(r.tasks[4]).toMatchObject({ kind: 'summary', dependencies: [], duration: 0, weight: 0 });
    expect(r.tasks[5]).toMatchObject({ id: 7, level: 2, kind: 'milestone', duration: 0, weight: 0 });
  });
  it('درج در ابتدا و مرجع ناموجود', () => {
    expect(ids(ok(insertTask(sample(), { referenceId: null, asChild: false, kind: 'task', name: '' })).tasks)[0]).toBe(7);
    expect(insertTask(sample(), { referenceId: 99, asChild: false, kind: 'task', name: 'x' }).ok).toBe(false);
  });
  it('حداکثر عمق ۹', () => {
    const deep = [task({ id: 1, kind: 'summary', level: 9 })];
    const r = insertTask(deep, { referenceId: 1, asChild: true, kind: 'task', name: 'x' });
    expect(r.ok).toBe(false);
  });
  it('حذف زیردرخت و پاک شدن ارجاع پیش‌نیازها', () => {
    const r = ok(deleteSubtree(sample(), 3));
    expect(r.removedIds).toEqual([3, 4]);
    expect(ids(r.tasks)).toEqual([1, 2, 5, 6]);
    expect((r.tasks[2] as Task).dependencies).toEqual([]);
  });
  it('جابه‌جایی بالا/پایین بین هم‌سطح‌ها', () => {
    expect(ids(ok(moveTask(sample(), 6, -1)).tasks)).toEqual([1, 2, 3, 4, 6, 5]);
    expect(ids(ok(moveTask(sample(), 1, 1)).tasks)).toEqual([5, 1, 2, 3, 4, 6]);
    expect(moveTask(sample(), 1, -1).ok).toBe(false);
    expect(moveTask(sample(), 6, 1).ok).toBe(false);
    expect(moveTask(sample(), 2, -1).ok).toBe(false);
  });
  it('زیرمجموعه‌کردن و بیرون‌آوردن', () => {
    const ind = ok(indentTask(sample(), 5));
    expect(lv(ind.tasks)).toEqual([1, 2, 2, 3, 2, 1]);
    const ind2 = ok(indentTask(sample(), 6));
    expect(ind2.convertedId).toBe(5);
    expect(lv(ind2.tasks)).toEqual([1, 2, 2, 3, 1, 2]);
    expect((ind2.tasks[4] as Task).kind).toBe('summary');
    expect(indentTask(sample(), 1).ok).toBe(false);
    expect(indentTask(sample(), 2).ok).toBe(false);
    const out = ok(outdentTask(sample(), 3));
    expect(ids(out.tasks)).toEqual([1, 2, 3, 4, 5, 6]);
    expect(lv(out.tasks)).toEqual([1, 2, 1, 2, 1, 1]);
    expect(outdentTask(sample(), 1).ok).toBe(false);
  });
  it('بیرون‌آوردن بعد از زیردرخت والد قرار می‌گیرد', () => {
    const t = [
      task({ id: 1, kind: 'summary', level: 1 }),
      task({ id: 2, level: 2 }),
      task({ id: 3, level: 2 }),
      task({ id: 4, level: 1 }),
    ];
    const r = ok(outdentTask(t, 2));
    expect(ids(r.tasks)).toEqual([1, 3, 2, 4]);
    expect(lv(r.tasks)).toEqual([1, 2, 1, 1]);
  });
  it('چرخه‌ی ناشی از ساختار شناسایی می‌شود', () => {
    // 2 زیر خلاصه‌ی 1 است و پیش‌نیازش خود 1 است ⇒ فرزند←خلاصه و خلاصه←فرزند
    const t = [task({ id: 1, kind: 'summary', level: 1 }), task({ id: 2, level: 2, dependencies: [dep(1)] })];
    const r = guardCycle({ ok: true as const, tasks: t }, { start: '2026-09-01', status: '2026-09-01', calendar: defaultCalendar() });
    expect(r.ok).toBe(false);
  });
  it('اعتبارسنجی سلسله‌مراتب', () => {
    expect(validateHierarchy(sample())).toEqual([]);
    const bad = [task({ id: 1, level: 2 }), task({ id: 2, level: 3 }), task({ id: 3, level: 1 }), task({ id: 4, level: 2 })];
    expect(validateHierarchy(bad).map((i) => i.taskId)).toEqual([1, 2, 4]);
  });
});

describe('ویرایش فعالیت', () => {
  const ctx: PatchContext = { taskIds: new Set([1, 2, 3]) };
  const base = task({ id: 1, duration: 5 });
  const asOk = (p: Parameters<typeof applyTaskPatch>[1], t: Task = base, c = ctx) => {
    const r = applyTaskPatch(t, p, c);
    if (!r.ok) throw new Error(JSON.stringify(r.issues));
    return r;
  };
  const codes = (p: Parameters<typeof applyTaskPatch>[1], t: Task = base, c = ctx) => {
    const r = applyTaskPatch(t, p, c);
    return r.ok ? [] : r.issues.map((i) => i.code);
  };

  it('نام و عددها', () => {
    expect(asOk({ name: '  x ' }).task.name).toBe('x');
    expect(codes({ name: '   ' })).toEqual(['EMPTY_NAME']);
    expect(codes({ percentComplete: 101 })).toEqual(['PERCENT_RANGE']);
    expect(codes({ percentComplete: -1 })).toEqual(['INVALID_NUMBER']);
    expect(codes({ duration: 0 })).toEqual(['DURATION_TOO_SMALL']);
    expect(codes({ duration: 2.5 })).toEqual(['INVALID_NUMBER']);
    expect(codes({ weight: Number.NaN })).toEqual(['INVALID_NUMBER']);
  });
  it('مایلستون: مدت صفر و برگشت به فعالیت مدت ۱', () => {
    const ms = asOk({ isMilestone: true }).task;
    expect([ms.kind, ms.duration]).toEqual(['milestone', 0]);
    expect(codes({ duration: 3 }, ms)).toEqual(['MILESTONE_DURATION']);
    const back = asOk({ isMilestone: false }, ms).task;
    expect([back.kind, back.duration]).toEqual(['task', 1]);
  });
  it('درصد ۱۰۰ بدون شروع واقعی، شروع برنامه‌ای را ثبت می‌کند', () => {
    const r = asOk({ percentComplete: 100 }, base, { ...ctx, plannedStart: '2026-09-01' });
    expect(r.task.actualStart).toBe('2026-09-01');
    expect(r.notes).toHaveLength(1);
    expect(r.changes.map((c) => c.field).sort()).toEqual(['actualStart', 'percentComplete']);
  });
  it('پایان واقعی درصد را ۱۰۰ می‌کند و باید بعد از شروع باشد', () => {
    const r = asOk({ actualStart: '2026-09-01', actualFinish: '2026-09-03' });
    expect(r.task.percentComplete).toBe(100);
    expect(codes({ actualFinish: '2026-08-01' }, { ...base, actualStart: '2026-09-01' })).toEqual(['FINISH_BEFORE_START']);
    expect(codes({ actualFinish: '2026-02-30' as never })).toEqual(['INVALID_DATE']);
  });
  it('پیش‌نیاز: ناموجود، خود، نوع نامعتبر', () => {
    expect(asOk({ dependencies: [dep(2, 'SS', 1)] }).task.dependencies).toEqual([dep(2, 'SS', 1)]);
    expect(codes({ dependencies: [dep(99)] })).toEqual(['UNKNOWN_PREDECESSOR']);
    expect(codes({ dependencies: [dep(1)] })).toEqual(['SELF_DEPENDENCY']);
    expect(codes({ dependencies: [{ predecessorId: 2, type: 'XX' as never, lag: 0 }] })).toEqual(['INVALID_DEPENDENCY']);
    expect(codes({ dependencies: [{ predecessorId: 2, type: 'FS', lag: 1.5 }] })).toEqual(['INVALID_DEPENDENCY']);
  });
  it('تخصیص منابع', () => {
    expect(codes({ assignments: [{ resourceId: 1, units: 0 }] })).toEqual(['INVALID_ASSIGNMENT']);
    expect(codes({ assignments: [{ resourceId: 1, units: 50 }, { resourceId: 1, units: 50 }] })).toEqual(['DUPLICATE_RESOURCE']);
    expect(asOk({ assignments: [{ resourceId: 1, units: 50 }] }).task.assignments).toHaveLength(1);
  });
  it('قید شروع دستی منبع «manual» می‌گیرد و پاک‌شدنش منبع را هم پاک می‌کند', () => {
    const a = asOk({ startNoEarlierThan: '2026-10-01' }).task;
    expect([a.startNoEarlierThan, a.startNoEarlierSource]).toEqual(['2026-10-01', 'manual']);
    const b = asOk({ startNoEarlierThan: null }, a).task;
    expect([b.startNoEarlierThan, b.startNoEarlierSource]).toEqual([null, null]);
  });
  it('فعالیت خلاصه فیلدهای مخصوص فعالیت را نمی‌پذیرد، ولی نامش را می‌پذیرد', () => {
    const g = task({ id: 1, kind: 'summary' });
    expect(codes({ duration: 3 }, g)).toEqual(['SUMMARY_FIELD']);
    expect(codes({ percentComplete: 10, weight: 2 }, g)).toEqual(['SUMMARY_FIELD', 'SUMMARY_FIELD']);
    expect(asOk({ name: 'گروه' }, g).task.name).toBe('گروه');
  });
  it('بدون تغییر ⇒ فهرست تغییرات خالی', () => {
    expect(asOk({ name: 'T1' }).changes).toEqual([]);
  });
});
