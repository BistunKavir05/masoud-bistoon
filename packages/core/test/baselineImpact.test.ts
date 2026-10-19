import { describe, expect, it } from 'vitest';
import { buildBaseline } from '../src/baseline.ts';
import { plannedCost } from '../src/finance.ts';
import { previewBaseline, summarizeBaseline } from '../src/baselineImpact.ts';
import { computeSchedule } from '../src/scheduling.ts';
import type { Resource } from '../src/types.ts';
import { dep, input, task } from './fixtures.ts';

function sched(tasks: ReturnType<typeof task>[]) {
  const r = computeSchedule(input(tasks));
  if (!r.ok) throw new Error('cycle');
  return r;
}
const mk = (bDur = 6) => [
  task({ id: 1, name: 'A', duration: 4, directCosts: [{ name: 'x', amount: 100 }] }),
  task({ id: 2, name: 'B', duration: bDur, dependencies: [dep(1)], directCosts: [{ name: 'y', amount: 50 }] }),
];
const resources: Resource[] = [];

describe('پیش‌نمایش اثر خط مبنا', () => {
  it('بدون خط مبنای فعلی: before تهی و after کامل', () => {
    const t = mk();
    const s = sched(t);
    const r = previewBaseline({ tasks: t, schedule: s, resources, current: {} });
    expect(r.before).toBeNull();
    expect(r.after.tasks).toBe(2);
    expect(r.after.bac).toBe(150);
    expect(r.after.finish).toBe(s.axis.dateAt(9));
    expect([r.changed, r.added, r.removed]).toEqual([0, 0, 0]);
  });

  it('تغییر مدت، فعالیت تازه و فعالیت حذف‌شده شمرده می‌شوند', () => {
    const old = mk(6);
    const base = buildBaseline(old, sched(old), (t) => plannedCost(t, resources)).baseline;
    // B کوتاه‌تر شد، C تازه است
    const now = [...mk(3), task({ id: 3, name: 'C', duration: 2, dependencies: [dep(2)] })];
    const s = sched(now);
    const r = previewBaseline({ tasks: now, schedule: s, resources, current: base });
    expect(r.before).not.toBeNull();
    expect(r.before!.finish).toBe(sched(old).axis.dateAt(9));
    expect(r.after.finish).toBe(s.axis.dateAt(8));
    expect(r.changed).toBe(1);
    expect(r.added).toBe(1);
    expect(r.removed).toBe(0);
    // حذف: خط مبنا دارای فعالیت ۲ است ولی فعالیت فعلی فقط ۱
    const only = [mk()[0]!];
    const r2 = previewBaseline({ tasks: only, schedule: sched(only), resources, current: base });
    expect(r2.removed).toBe(1);
  });

  it('خلاصه: فعالیت پشتیبانی و خلاصه در پایان نمی‌آید', () => {
    const t = [task({ id: 1, name: 'A', duration: 3 }), task({ id: 2, name: 'پشتیبانی', duration: 30, levelOfEffort: true })];
    const s = sched(t);
    const base = buildBaseline(t, s, () => 0).baseline;
    expect(summarizeBaseline(t, s, base, resources).finish).toBe(s.axis.dateAt(2));
  });
});
