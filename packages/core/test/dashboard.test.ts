import { describe, expect, it } from 'vitest';
import { defaultCalendar } from '../src/calendar.ts';
import { emptyCharter, emptyContract } from '../src/charter.ts';
import { computeDashboard } from '../src/dashboard.ts';
import { buildBaseline } from '../src/baseline.ts';
import { analyzeProject } from '../src/project.ts';
import type { ProjectModel } from '../src/project.ts';
import { computeSchedule } from '../src/scheduling.ts';
import { defaultFinanceSettings } from '../src/finance.ts';
import { dep, task } from './fixtures.ts';

function model(over: Partial<ProjectModel> = {}): ProjectModel {
  return {
    name: 'p',
    start: '2026-09-01',
    status: '2026-09-01',
    contractEnd: null,
    calendar: defaultCalendar(),
    tasks: [task({ id: 1, duration: 4, weight: 4 }), task({ id: 2, duration: 6, weight: 6, dependencies: [dep(1)] }), task({ id: 3, kind: 'milestone', dependencies: [dep(2)] })],
    resources: [],
    baseline: {},
    baselineHistory: [],
    snapshots: [],
    costs: [],
    finance: defaultFinanceSettings(),
    charter: emptyCharter(),
    contract: emptyContract(),
    risks: [],
    issues: [],
    changes: [],
    decisions: [],
    documents: [],
    ...over,
  };
}

function run(m: ProjectModel) {
  const a = analyzeProject(m);
  if (!('schedule' in a)) throw new Error('cycle');
  return computeDashboard(m, a);
}

describe('داشبورد', () => {
  it('بدون خط مبنا هشدار می‌دهد و تأخیر صفر است', () => {
    const d = run(model());
    expect(d.hasBaseline).toBe(false);
    expect(d.delayWorkingDays).toBe(0);
    expect(d.alerts.map((a) => a.code)).toContain('NO_BASELINE');
    expect(d.criticalCount).toBe(3);
  });

  it('تأخیر نسبت به خط مبنا و فهرست فعالیت‌های دیرکرددار', () => {
    const base = model();
    const s0 = computeSchedule({ start: base.start, status: base.status, calendar: base.calendar, tasks: base.tasks });
    if (!s0.ok) throw new Error('cycle');
    const baseline = buildBaseline(base.tasks, s0, () => 0).baseline;
    // فعالیت اول دو روز بیشتر طول می‌کشد
    const tasks = base.tasks.map((t) => (t.id === 1 ? { ...t, duration: 6 } : t));
    const d = run({ ...base, tasks, baseline });
    expect(d.hasBaseline).toBe(true);
    expect(d.delayWorkingDays).toBe(2);
    expect(d.delayedTasks.map((x) => [x.id, x.delayDays])).toEqual([
      [1, 2],
      [2, 2],
    ]);
    expect(d.maxTaskDelay).toBe(2);
    expect(d.alerts.map((a) => a.code)).toContain('DELAYED');
  });

  it('فعالیت شروع‌شده با پیش‌نیاز تمام‌نشده خارج از توالی است', () => {
    const tasks = [task({ id: 1, duration: 4, weight: 4 }), task({ id: 2, duration: 6, weight: 6, dependencies: [dep(1)], actualStart: '2026-09-02', percentComplete: 10 })];
    const d = run(model({ tasks }));
    expect(d.outOfSequence).toEqual([{ taskId: 2, name: 'T2', predecessorId: 1, predecessorName: 'T1' }]);
    expect(d.alerts.map((a) => a.code)).toContain('OUT_OF_SEQUENCE');
  });

  it('ذخیره و کسری نسبت به پایان قرارداد', () => {
    const late = run(model({ contractEnd: '2026-09-05' }));
    expect(late.reserveWorkingDays).toBeLessThan(0);
    expect(late.alerts.map((a) => a.code)).toContain('PAST_CONTRACT_END');
    const ok = run(model({ contractEnd: '2027-01-01' }));
    expect(ok.reserveWorkingDays).toBeGreaterThan(0);
    expect(run(model()).reserveWorkingDays).toBeNull();
  });

  it('شمارش ریسک‌ها، مسائل و تصمیم‌ها', () => {
    const d = run(
      model({
        risks: [
          { id: 1, title: 'الف', category: null, probability: 5, impact: 4, owner: '', strategy: null, response: '', due: null, status: 'open' },
          { id: 2, title: 'ب', category: null, probability: 5, impact: 5, owner: '', strategy: null, response: '', due: null, status: 'closed' },
          { id: 3, title: 'ج', category: null, probability: 1, impact: 1, owner: '', strategy: null, response: '', due: null, status: 'in_progress' },
        ],
        issues: [
          { id: 1, title: 'م', owner: '', priority: 'high', due: null, impact: '', action: '', needsDecision: true, status: 'open' },
          { id: 2, title: 'ن', owner: '', priority: 'low', due: null, impact: '', action: '', needsDecision: true, status: 'resolved' },
        ],
        decisions: [{ id: 1, topic: 'ت', text: '', maker: '', date: null, status: 'pending' }],
        changes: [{ id: 1, title: 'چ', requester: '', date: null, reason: '', impact: '', previousFinish: null, newFinish: null, status: 'pending', approvedBy: '', approvedOn: null }],
      }),
    );
    expect(d.criticalRisks).toBe(1);
    expect(d.openRisks).toBe(2);
    expect(d.openIssues).toBe(1);
    expect(d.pendingDecisions).toBe(2);
    expect(d.pendingChanges).toBe(1);
  });

  it('مایلستون‌های پیش‌رو فقط تمام‌نشده‌ها را به ترتیب تاریخ می‌دهند', () => {
    const d = run(model());
    expect(d.upcomingMilestones.map((m) => m.id)).toEqual([3]);
    expect(d.upcomingMilestones[0]!.date).not.toBeNull();
  });
});
