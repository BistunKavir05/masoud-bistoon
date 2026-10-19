import { describe, expect, it } from 'vitest';
import { baselineIndices } from '../src/baseline.ts';
import { buildWorkingDays, defaultCalendar } from '../src/calendar.ts';
import { importLegacyProject } from '../src/legacy.ts';
import { analyzeProject } from '../src/project.ts';

const TODAY = '2026-06-01' as const;

const legacy = () => ({
  name: 'تست',
  start: '2026-09-01',
  status: '2026-09-03',
  ver: 7,
  tasks: [
    { id: 1, lv: 1, sm: true, name: 'G', as: '2026-09-01', preds: '9FS', p: 55, w: 4 },
    { id: 2, lv: 2, name: 'A', dur: 5, preds: '', w: 5, p: 0, res: 'ENG:100, GHOST:50', cs: [{ n: 'x', a: 1000 }] },
    { id: 3, lv: 2, name: 'B', dur: 3, preds: '2FS+1,۲SS', w: 3, p: 0, res: '', snet: '2026-09-10', dl: '2026-09-30' },
    { id: 4, lv: 1, ms: true, name: 'M', preds: '3FS,zzz', w: 0, p: 0 },
    { id: 2, lv: 1, name: 'dup', dur: 9 },
  ],
  base: { 2: { ES: 0, D: 5, c: 1234 }, 3: { ES: 6, D: 3 }, 4: { ES: 9, D: 0 }, 77: { ES: 1, D: 1 } },
  res: [{ n: 'ENG', t: 'انسانی', c: 100, rate: 1000 }],
  snaps: [{ d: '2026-09-02', a: 12.5, est: false, t: { 2: 50, x: 3 }, ac: 100 }, { d: 'bad', a: 1 }],
  costs: [
    { id: 1, d: '2026-09-02', task: 2, n: 'a', a: 300, doc: '' },
    { id: 1, d: '2026-09-02', task: 999, n: 'orphan', a: 50, doc: '' },
    { id: 3, d: '2026-09-02', task: 0, n: 'g', a: 20, doc: '' },
    { id: 4, d: 'bad', task: 0, n: 'x', a: 20 },
  ],
  ch: { amount: 1000000, comPct: 3, retAmt: 100000, comRetPct: 5, paid: 450000, cdate: '2026-08-01', salesOK: 'تأیید شده', client: 'ک' },
  risks: [{ id: 1, title: 'r', cat: 'فنی', prob: 4, impact: 5, owner: 'o', str: 'کاهش', resp: '', due: '2026-10-01', status: 'در حال پیگیری' }],
  end: '2026-12-01',
});

describe('ورود بک‌آپ قدیمی', () => {
  it('ساختار نامعتبر خطا می‌دهد', () => {
    expect('error' in importLegacyProject(null, { today: TODAY })).toBe(true);
    expect('error' in importLegacyProject({ tasks: 1 }, { today: TODAY })).toBe(true);
  });

  const imp = importLegacyProject(legacy(), { today: TODAY });
  if ('error' in imp) throw new Error(imp.error);
  const m = imp.model;
  const codes = imp.warnings.map((w) => w.code);

  it('فعالیت‌ها و نوع‌ها', () => {
    expect(m.tasks.map((t) => [t.id, t.kind, t.level])).toEqual([
      [1, 'summary', 1],
      [2, 'task', 2],
      [3, 'task', 2],
      [4, 'milestone', 1],
    ]);
    expect(codes).toContain('DUPLICATE_TASK_ID');
  });
  it('خلاصه: پیش‌نیاز، تاریخ واقعی و پیشرفت ثبت‌شده کنار گذاشته می‌شود و هشدار می‌دهد', () => {
    const g = m.tasks[0]!;
    expect(g.dependencies).toEqual([]);
    expect(g.actualStart).toBeNull();
    expect(g.percentComplete).toBe(0);
    expect(g.weight).toBe(0);
    expect(codes).toContain('SUMMARY_PREDECESSORS_DROPPED');
    expect(codes).toContain('SUMMARY_ACTUALS_DROPPED');
  });
  it('پیش‌نیازها با ارقام فارسی و نوع/lag', () => {
    expect(m.tasks[2]!.dependencies).toEqual([
      { predecessorId: 2, type: 'FS', lag: 1 },
      { predecessorId: 2, type: 'SS', lag: 0 },
    ]);
    expect(codes).toContain('INVALID_PREDECESSOR');
  });
  it('منابع: ناموجود ساخته می‌شود و گزارش می‌شود', () => {
    expect(m.resources.map((r) => [r.name, r.dailyRate, r.capacityPercent])).toEqual([
      ['ENG', 1000, 100],
      ['GHOST', 0, 100],
    ]);
    expect(m.tasks[1]!.assignments).toEqual([
      { resourceId: 1, units: 100 },
      { resourceId: 2, units: 50 },
    ]);
    expect(codes).toContain('IMPLICIT_RESOURCE');
  });
  it('قیدها، ضرب‌الاجل و هزینه‌ی مستقیم', () => {
    const b = m.tasks[2]!;
    expect([b.startNoEarlierThan, b.startNoEarlierSource, b.deadline]).toEqual(['2026-09-10', 'manual', '2026-09-30']);
    expect(m.tasks[1]!.directCosts).toEqual([{ name: 'x', amount: 1000 }]);
  });
  it('خط مبنا: تبدیل اندیس به تاریخ و برگشت دقیق', () => {
    const days = buildWorkingDays('2026-09-01', defaultCalendar());
    expect(Object.keys(m.baseline).sort()).toEqual(['2', '3', '4']); // 77 ناموجود حذف شد
    const ax = { onOrAfter: (iso: string) => days.findIndex((d) => d >= iso) } as never;
    expect(baselineIndices(m.baseline[2]!, ax)).toEqual({ earlyStart: 0, duration: 5 });
    expect(baselineIndices(m.baseline[3]!, ax)).toEqual({ earlyStart: 6, duration: 3 });
    expect(baselineIndices(m.baseline[4]!, ax)).toEqual({ earlyStart: 9, duration: 0 });
    expect(m.baseline[2]!.cost).toBe(1234);
    expect(m.baseline[3]!.cost).toBeNull();
  });
  it('اسنپ‌شات و دفتر هزینه پاک‌سازی می‌شوند', () => {
    expect(m.snapshots).toHaveLength(1);
    expect(m.snapshots[0]).toEqual({ date: '2026-09-02', actual: 12.5, estimated: false, actualCost: 100, tasks: { 2: 50 } });
    expect(m.costs.map((c) => [c.id, c.taskId, c.amount])).toEqual([
      [1, 2, 300],
      [2, null, 50],
      [3, null, 20],
    ]);
  });
  it('قرارداد و پورسانت', () => {
    expect(m.contract.amount).toBe(1_000_000);
    expect(m.contract.retentionMode).toBe('fixed');
    expect(m.contract.retentionValue).toBe(100_000);
    expect(m.contract.salesApproval).toBe('approved');
    expect(m.charter.client).toBe('ک');
  });
  it('رکوردها و عنوان‌های فارسی به کد تبدیل می‌شوند', () => {
    expect(m.risks[0]).toMatchObject({ id: 1, category: 'technical', strategy: 'mitigate', status: 'in_progress', probability: 4, impact: 5, due: '2026-10-01' });
  });
  it('نسخه، پایان قرارداد و تحلیل کامل', () => {
    expect(imp.legacyVersion).toBe(7);
    expect(m.contractEnd).toBe('2026-12-01');
    const a = analyzeProject(m);
    expect('schedule' in a).toBe(true);
    if ('schedule' in a) {
      expect(a.commission.payableSales).toBe(13_500);
      expect(a.schedule.warnings.map((w) => w.code)).toEqual([]);
    }
  });
});
