import { describe, expect, it } from 'vitest';
import { computeSchedule } from '../src/scheduling.ts';
import { computeUtilization, levelResources, weekIndexOf, weekStartOf } from '../src/resources.ts';
import type { Resource } from '../src/types.ts';
import { dep, input, task } from './fixtures.ts';

const eng: Resource = { id: 1, name: 'ENG', type: 'human', capacityPercent: 100, dailyRate: 0 };
const asg = (units: number) => [{ resourceId: 1, units }];

describe('هفته', () => {
  it('هفته از شنبه شروع می‌شود', () => {
    expect(weekStartOf('2026-10-17')).toBe('2026-10-17'); // شنبه
    expect(weekStartOf('2026-10-21')).toBe('2026-10-17'); // چهارشنبه
    expect(weekStartOf('2026-10-23')).toBe('2026-10-17'); // جمعه
    expect(weekStartOf('2026-10-24')).toBe('2026-10-24');
    expect(weekIndexOf('2026-10-23')).toBe(weekIndexOf('2026-10-17'));
    expect(weekIndexOf('2026-10-24')).toBe(weekIndexOf('2026-10-17') + 1);
  });
});

describe('بارگذاری و تسطیح', () => {
  const two = () => [task({ id: 1, duration: 3, assignments: asg(100) }), task({ id: 2, duration: 3, assignments: asg(100) })];

  it('بارگذاری ۲۰۰٪ هنگام هم‌پوشانی', () => {
    const t = two();
    const s = computeSchedule(input(t));
    if (!s.ok) throw new Error('x');
    const u = computeUtilization(t, s, [eng]);
    expect(u.load.get(1)?.get(weekIndexOf('2026-09-01'))).toBe(200);
  });
  it('ظرفیت ۲۰۰٪ بیش‌تخصیص نیست', () => {
    const t = two();
    const r = levelResources(input(t), [{ ...eng, capacityPercent: 200 }]);
    expect(r?.suggestions).toEqual([]);
    expect(r?.unresolved).toBe(0);
  });
  it('تسطیح بیش‌تخصیص را برطرف می‌کند و پایان را عقب می‌اندازد', () => {
    const t = two();
    const r = levelResources(input(t), [eng]);
    expect(r).not.toBeNull();
    if (!r) return;
    expect(r.suggestions.length).toBeGreaterThan(0);
    expect(r.finishAfter).toBeGreaterThan(r.finishBefore);
    expect(r.unresolved).toBe(0);
    const leveled = t.map((x) => {
      const sg = r.suggestions.find((q) => q.taskId === x.id);
      return sg ? { ...x, startNoEarlierThan: sg.startNoEarlierThan } : x;
    });
    const s = computeSchedule(input(leveled));
    if (!s.ok) throw new Error('x');
    const u = computeUtilization(leveled, s, [eng]);
    for (const wk of u.load.get(1)?.values() ?? []) expect(wk).toBeLessThanOrEqual(100 + 1e-9);
  });
  it('فعالیت شروع‌شده جابه‌جا نمی‌شود', () => {
    const t = [
      task({ id: 1, duration: 3, assignments: asg(100), actualStart: '2026-09-01', percentComplete: 10 }),
      task({ id: 2, duration: 3, assignments: asg(100) }),
    ];
    const r = levelResources(input(t, { status: '2026-09-02' }), [eng]);
    expect(r?.suggestions.map((x) => x.taskId)).toEqual([2]);
  });
  it('دور ⇒ null', () => {
    const t = [task({ id: 1, dependencies: [dep(2)] }), task({ id: 2, dependencies: [dep(1)] })];
    expect(levelResources(input(t), [eng])).toBeNull();
  });
  it('دو فعالیت ثابت که با هم ظرفیت را می‌شکنند حل‌نشده شمرده می‌شوند', () => {
    const t = [
      task({ id: 1, duration: 2, assignments: asg(100), actualStart: '2026-09-01', percentComplete: 10 }),
      task({ id: 2, duration: 2, assignments: asg(100), actualStart: '2026-09-01', percentComplete: 10 }),
    ];
    const r = levelResources(input(t, { status: '2026-09-02' }), [eng]);
    expect(r?.suggestions).toEqual([]);
    expect(r?.unresolved).toBeGreaterThan(0);
  });
});
