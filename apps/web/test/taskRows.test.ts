import { describe, expect, it } from 'vitest';
import type { TaskDto } from '@bistoon/core';
import { newTask } from '@bistoon/core';
import { buildRows, visibleRows } from '../src/tabs/tasks/rows.ts';

const mk = (id: number, level: number, kind: TaskDto['kind'], name: string): TaskDto => ({ ...newTask(id, level, kind, name), version: 1 });

describe('ردیف‌های جدول فعالیت‌ها', () => {
  const tasks = [mk(1, 1, 'summary', 'مرحله یک'), mk(2, 2, 'task', 'طراحی'), mk(3, 2, 'task', 'ساخت'), mk(4, 1, 'summary', 'مرحله دو'), mk(5, 2, 'milestone', 'تحویل')];
  const rows = buildRows(tasks, null, [], null);

  it('WBS و فرزندداری از ترتیب و سطح مشتق می‌شود', () => {
    expect(rows.map((r) => r.wbs)).toEqual(['1', '1.1', '1.2', '2', '2.1']);
    expect(rows.map((r) => r.hasChildren)).toEqual([true, false, false, true, false]);
  });
  it('گروه بسته زیرمجموعه را پنهان می‌کند', () => {
    expect(visibleRows(rows, new Set([1]), '', 'all').map((r) => r.t.id)).toEqual([1, 4, 5]);
    expect(visibleRows(rows, new Set([1, 4]), '', 'all').map((r) => r.t.id)).toEqual([1, 4]);
  });
  it('جست‌وجو ردیف مطابق و پدرانش را نگه می‌دارد', () => {
    expect(visibleRows(rows, new Set(), 'ساخت', 'all').map((r) => r.t.id)).toEqual([1, 3]);
    expect(visibleRows(rows, new Set(), '2.1', 'all').map((r) => r.t.id)).toEqual([4, 5]);
  });
  it('فیلتر وضعیت فقط فعالیت‌های غیرخلاصه را می‌شمارد', () => {
    expect(visibleRows(rows, new Set(), '', 'todo').map((r) => r.t.id)).toEqual([1, 2, 3, 4, 5]);
    expect(visibleRows(rows, new Set(), '', 'done').map((r) => r.t.id)).toEqual([]);
  });
  it('پس از خط مبنا فقط وقتی خط مبنا وجود دارد علامت می‌خورد', () => {
    expect(rows.some((r) => r.afterBaseline)).toBe(false);
    const withBase = buildRows(tasks, null, [], { 2: { start: '2026-01-01', finish: '2026-01-02', zeroDuration: false, cost: null } });
    expect(withBase.filter((r) => r.afterBaseline).map((r) => r.t.id)).toEqual([3, 5]);
  });
});
