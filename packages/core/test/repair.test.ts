import { describe, expect, it } from 'vitest';
import { importLegacyProject, repairForStorage, validateHierarchy } from '../src/index.ts';
import type { ProjectModel } from '../src/index.ts';
import { dep, task } from './fixtures.ts';

function legacyModel(): ProjectModel {
  const r = importLegacyProject({ name: 'x', start: '2026-03-21', status: '2026-04-01', tasks: [{ id: 1, name: 'a', lv: 1, dur: 3 }] }, { today: '2026-04-01' });
  if ('error' in r) throw new Error(r.error);
  return r.model;
}

const codes = (m: ProjectModel): string[] => {
  const r = repairForStorage(m);
  if (!r.ok) throw new Error(r.error);
  return r.warnings.map((w) => w.code);
};

describe('آماده‌سازی برای ذخیره', () => {
  it('داده‌ی سالم بدون هشدار می‌گذرد', () => {
    const m = legacyModel();
    const r = repairForStorage(m);
    expect(r).toMatchObject({ ok: true, warnings: [] });
  });

  it('سطح‌ها: ردیف اول ۱، پرش یک‌پله‌ای، فرزند فقط زیر خلاصه', () => {
    const m = legacyModel();
    m.tasks = [task({ id: 1, level: 3 }), task({ id: 2, level: 2 }), task({ id: 3, kind: 'summary', level: 1 }), task({ id: 4, level: 4 })];
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks.map((t) => t.level)).toEqual([1, 1, 1, 2]);
    expect(validateHierarchy(r.model.tasks)).toEqual([]);
    expect(r.warnings.filter((w) => w.code === 'LEVEL_ADJUSTED').length).toBe(3);
  });

  it('پایان واقعی قبل از شروع حذف و پایان با درصد کمتر از ۱۰۰ کامل می‌شود', () => {
    const m = legacyModel();
    m.tasks = [
      task({ id: 1, actualStart: '2026-04-05', actualFinish: '2026-04-01', percentComplete: 100 }),
      task({ id: 2, actualStart: '2026-04-01', actualFinish: '2026-04-05', percentComplete: 70 }),
    ];
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks[0]).toMatchObject({ actualFinish: null, actualStart: '2026-04-05' });
    expect(r.model.tasks[1]).toMatchObject({ actualFinish: '2026-04-05', percentComplete: 100 });
    expect(r.warnings.map((w) => w.code)).toEqual(['FINISH_BEFORE_START', 'FINISH_WITH_INCOMPLETE']);
  });

  it('پیش‌نیاز ناموجود، خودارجاع و تکراری حذف می‌شود', () => {
    const m = legacyModel();
    m.tasks = [task({ id: 1 }), task({ id: 2, dependencies: [dep(1), dep(1), dep(2), dep(99)] })];
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks[1]?.dependencies).toEqual([dep(1)]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['DUPLICATE_PREDECESSOR_DROPPED', 'SELF_DEPENDENCY_DROPPED', 'UNKNOWN_PREDECESSOR_DROPPED']);
  });

  it('تخصیص‌های تکراری جمع و منبع ناموجود حذف می‌شود؛ نام منبع تکراری یکتا می‌شود', () => {
    const m = legacyModel();
    m.resources = [
      { id: 1, name: 'علی', type: 'human', capacityPercent: 100, dailyRate: 10 },
      { id: 2, name: 'علی', type: 'human', capacityPercent: 100, dailyRate: 10 },
    ];
    m.tasks = [
      task({
        id: 1,
        assignments: [
          { resourceId: 1, units: 30 },
          { resourceId: 1, units: 20 },
          { resourceId: 9, units: 50 },
        ],
      }),
    ];
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks[0]?.assignments).toEqual([{ resourceId: 1, units: 50 }]);
    expect(r.model.resources.map((x) => x.name)).toEqual(['علی', 'علی (2)']);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['ASSIGNMENTS_MERGED', 'RESOURCE_RENAMED', 'UNKNOWN_RESOURCE_DROPPED']);
  });

  it('ریسک، هزینه و قرارداد در بازه‌های پایگاه‌داده قرار می‌گیرند', () => {
    const m = legacyModel();
    m.risks = [
      { id: 1, title: 'a', category: null, probability: 9, impact: 0, owner: '', strategy: null, response: '', due: null, status: 'open' },
      { id: 1, title: 'b', category: null, probability: 3, impact: 3, owner: '', strategy: null, response: '', due: null, status: 'open' },
    ];
    m.costs = [{ id: 1, date: '2026-04-01', taskId: 77, description: 'x'.repeat(200), document: '', amount: 10.456 }];
    m.contract = { ...m.contract, amount: 1000.6, retentionMode: 'percent', retentionValue: 150, salesCommissionPercent: 120 };
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.risks.map((x) => [x.id, x.probability, x.impact])).toEqual([
      [1, 5, 1],
      [2, 3, 3],
    ]);
    expect(r.model.costs[0]).toMatchObject({ taskId: null, amount: 10.46 });
    expect(r.model.costs[0]?.description.length).toBe(120);
    expect(r.model.contract).toMatchObject({ amount: 1001, retentionValue: 100, salesCommissionPercent: 100 });
    expect(codes(m)).toContain('COST_TASK_MISSING');
  });

  it('شناسه‌ی غیرمثبت فعالیت خطاست', () => {
    const m = legacyModel();
    m.tasks = [task({ id: 0 })];
    expect(repairForStorage(m)).toMatchObject({ ok: false });
  });

  it('خلاصه همه‌ی فیلدهای مشتق را خالی دارد', () => {
    const m = legacyModel();
    m.tasks = [task({ id: 1, kind: 'summary', duration: 5, weight: 3, percentComplete: 20, actualStart: '2026-04-01', assignments: [{ resourceId: 1, units: 50 }] })];
    const r = repairForStorage(m);
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks[0]).toMatchObject({ duration: 0, weight: 0, percentComplete: 0, actualStart: null, assignments: [] });
  });
});
