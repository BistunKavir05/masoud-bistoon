import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/project.ts';
import type { ProjectModel } from '../src/project.ts';
import { importLegacyProject } from '../src/legacy.ts';
import { buildMspXml } from '../src/mspExport.ts';
import { MSP_FIXED_COST_NAME, mappingStats, modelFromMsp, planMspImport, suggestMapping } from '../src/mspImport.ts';
import { parseMspXml } from '../src/msp.ts';
import type { MspParsed } from '../src/msp.ts';
import { defaultCalendar } from '../src/calendar.ts';
import { emptyCharter, emptyContract } from '../src/charter.ts';
import { defaultFinanceSettings } from '../src/finance.ts';
import { task } from './fixtures.ts';
import type { Task } from '../src/types.ts';

const read = (name: string): string => readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8');
const parse = (xml: string, opts?: Parameters<typeof parseMspXml>[1]): MspParsed => {
  const r = parseMspXml(xml, opts);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};
const legacy = (): ProjectModel => {
  const l = importLegacyProject(JSON.parse(read('seed-project.json')), { today: '2026-10-03' });
  if ('error' in l) throw new Error(l.error);
  return l.model;
};
const exported = (m: ProjectModel): string => {
  const o = buildMspXml(m);
  if (!o.ok) throw new Error(o.error);
  return o.xml;
};

function blank(tasks: Task[], extra: Partial<ProjectModel> = {}): ProjectModel {
  return {
    name: 'پروژه',
    start: '2026-09-01',
    status: '2026-09-01',
    contractEnd: null,
    calendar: defaultCalendar(),
    tasks,
    resources: [{ id: 1, name: 'علی', type: 'human', capacityPercent: 100, dailyRate: 1000 }],
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
    ...extra,
  };
}

// فایل کوچک: گروه ۱ ← الف (۲ روز)، ب (۳ روز، پس از الف)، مایلستون پ (پس از ب)
const xmlFor = (rows: { uid: number; name: string; level?: number; summary?: boolean; milestone?: boolean; dur?: number; preds?: number[]; extra?: string }[], head = ''): string =>
  `<Project xmlns="http://schemas.microsoft.com/project"><Name>فایل</Name><StartDate>2026-09-01T07:30:00</StartDate><MinutesPerDay>480</MinutesPerDay>${head}<Tasks><Task><UID>0</UID><Summary>1</Summary></Task>` +
  rows
    .map(
      (r) =>
        `<Task><UID>${r.uid}</UID><Name>${r.name}</Name><OutlineLevel>${r.level ?? 1}</OutlineLevel><Summary>${r.summary ? 1 : 0}</Summary><Milestone>${r.milestone ? 1 : 0}</Milestone><Duration>PT${(r.dur ?? 1) * 8}H0M0S</Duration>` +
        (r.preds ?? []).map((p) => `<PredecessorLink><PredecessorUID>${p}</PredecessorUID><Type>1</Type><LinkLag>0</LinkLag></PredecessorLink>`).join('') +
        `${r.extra ?? ''}</Task>`,
    )
    .join('') +
  '</Tasks></Project>';
const SMALL = xmlFor([
  { uid: 1, name: 'گروه', summary: true },
  { uid: 2, name: 'الف', level: 2, dur: 2 },
  { uid: 3, name: 'ب', level: 2, dur: 3, preds: [2] },
  { uid: 4, name: 'پ', level: 2, milestone: true, preds: [3] },
]);

describe('ورود فایل MSP به‌عنوان پروژه‌ی جدید', () => {
  it('نمونه‌ی ۶۵ردیفی: شناسه = UID، خط مبنا، اسنپ‌شات تخمینی و تحلیل سالم', () => {
    const r = modelFromMsp(parse(read('seed-project-msp.xml'), { useFileCalendar: true }), { today: '2026-10-20' });
    if (!r.ok) throw new Error(r.error);
    const m = r.model;
    expect(m.name).toBe('پروژه توزین هوشمند صمت یاسوج');
    expect(m.tasks).toHaveLength(65);
    expect(m.tasks[1]!.id).toBe(55);
    expect(Object.keys(m.baseline)).toHaveLength(47);
    expect(m.status).toBe('2026-10-03');
    expect(m.snapshots.length).toBeGreaterThan(0);
    expect(m.snapshots.every((s) => s.estimated)).toBe(true);
    expect(m.contract.amount).toBe(0);
    expect(r.schedule.ok).toBe(true);
    const a = analyzeProject(m);
    expect('ok' in a && a.ok === false).toBe(false);
    // تاریخ پایان پیش‌بینی با پایان ثبت‌شده‌ی خود فایل (FinishDate) یکی است
    if (r.schedule.ok) expect(r.schedule.finish).toBe('2026-10-17');
  });

  it('وزن فعالیت = مدت؛ مایلستون و خلاصه صفر؛ هزینه‌ی ثابت به هزینه‌ی مستقیم تبدیل می‌شود؛ قید با منشأ msp', () => {
    const x = xmlFor([
      { uid: 1, name: 'گروه', summary: true },
      { uid: 2, name: 'الف', level: 2, dur: 4, extra: '<FixedCost>2500</FixedCost><ConstraintType>4</ConstraintType><ConstraintDate>2026-09-10T07:30:00</ConstraintDate>' },
      { uid: 3, name: 'م', level: 2, milestone: true },
    ]);
    const r = modelFromMsp(parse(x), { today: '2026-09-01', unit: 'تومان' });
    if (!r.ok) throw new Error(r.error);
    const [g, a, mm] = r.model.tasks;
    expect([g!.weight, a!.weight, mm!.weight]).toEqual([0, 4, 0]);
    expect(a!.directCosts).toEqual([{ name: MSP_FIXED_COST_NAME, amount: 2500 }]);
    expect([a!.startNoEarlierThan, a!.startNoEarlierSource]).toEqual(['2026-09-10', 'msp']);
    expect(r.model.finance.unit).toBe('تومان');
  });

  it('نام جایگزین و تاریخ وضعیت پیش‌فرض (امروز)', () => {
    const r = modelFromMsp(parse(SMALL), { today: '2026-09-15', name: '  نام تازه  ' });
    if (!r.ok) throw new Error(r.error);
    expect(r.model.name).toBe('نام تازه');
    expect(r.model.status).toBe('2026-09-15');
  });

  it('وابستگی دایره‌ای: ساخته نمی‌شود', () => {
    const x = xmlFor([{ uid: 1, name: 'الف', preds: [2] }, { uid: 2, name: 'ب', preds: [1] }]);
    const r = modelFromMsp(parse(x), { today: '2026-09-01' });
    expect(r.ok).toBe(false);
  });

  it('سطح‌های ناسازگار اصلاح و گزارش می‌شود', () => {
    const x = xmlFor([{ uid: 1, name: 'الف', level: 3 }, { uid: 2, name: 'ب', level: 1 }]);
    const r = modelFromMsp(parse(x), { today: '2026-09-01' });
    if (!r.ok) throw new Error(r.error);
    expect(r.model.tasks[0]!.level).toBe(1);
    expect(r.warnings.map((w) => w.code)).toContain('LEVEL_ADJUSTED');
  });
});

describe('ورود MSP به پروژه‌ی موجود: برنامه‌ی ورود', () => {
  it('رفت‌وبرگشت همان پروژه با نگاشت هم‌شناسه: هیچ تغییر و هشدار و مانعی نیست', () => {
    const m = legacy();
    const parsed = parse(exported(m));
    const plan = planMspImport(m, parsed, { mapping: 'id', idFloor: 100 });
    expect(plan.blockers).toEqual([]);
    expect([plan.matched, plan.added, plan.removed.length, plan.renamed.length, plan.kindChanged.length]).toEqual([65, 0, 0, 0, 0]);
    expect(plan.start).toBe(m.start);
    expect(plan.replaceBaseline).toBe(true);
    expect(Object.keys(plan.baseline)).toHaveLength(47);
    expect(plan.schedule.ok).toBe(true);
    // هر فیلدِ برنامه یکی می‌ماند
    plan.tasks.forEach((t, i) => {
      const o = m.tasks[i]!;
      expect([t.id, t.name, t.level, t.kind, t.duration, t.weight]).toEqual([o.id, o.name, o.level, o.kind, o.duration, o.weight]);
      expect(t.dependencies).toEqual(o.dependencies);
    });
    expect(plan.effects.find((e) => e.area === 'شروع پروژه')!.text).toBe('شروع پروژه تغییر نمی‌کند.');
  });

  it('suggestMapping و mappingStats', () => {
    const m = legacy();
    const parsed = parse(exported(m));
    expect(suggestMapping(m, parsed)).toBe('id');
    expect(mappingStats(m, parsed).id).toEqual({ matched: 65, renamed: 0 });
    expect(suggestMapping(blank([]), parsed)).toBe('none');
    // فایل بیگانه: UIDهای هم‌شماره با نام‌های دیگر
    const foreign = parse(xmlFor([{ uid: 1, name: 'چیز دیگر' }, { uid: 2, name: 'و باز چیز دیگر' }]));
    const mine = blank([task({ id: 1, name: 'الف' }), task({ id: 2, name: 'ب' })]);
    expect(suggestMapping(mine, foreign)).toBe('none');
    const sameNames = parse(xmlFor([{ uid: 7, name: 'ب' }, { uid: 8, name: 'الف' }]));
    expect(suggestMapping(mine, sameNames)).toBe('name');
  });

  it('نگاشت هم‌نام: تطبیق با نام؛ نام تکراری با WBS یکتا می‌شود و در ابهام جدید حساب می‌شود', () => {
    const mine = blank([task({ id: 10, name: 'الف' }), task({ id: 11, name: 'ب' }), task({ id: 12, name: 'ب' })]);
    const file = parse(xmlFor([{ uid: 1, name: 'الف' }, { uid: 2, name: 'ب' }, { uid: 3, name: 'ب' }, { uid: 4, name: 'ج' }]).replace(/<Task><UID>(\d)<\/UID>/g, (_m0, u) => `<Task><UID>${u}</UID><WBS>${u}</WBS>`));
    const plan = planMspImport(mine, file, { mapping: 'name', idFloor: 13 });
    // «ب» دوبار در هر دو سو آمده و WBS (۲ و ۳ در فایل؛ ۲ و ۳ در پروژه) یکتا نیست؟ — در پروژه WBS ردیف‌ها ۱،۲،۳ و در فایل ۲،۳ است: جفت‌ها یکتا می‌شوند
    expect(plan.matched).toBe(3);
    expect(plan.tasks.map((t) => t.id)).toEqual([10, 11, 12, 13]);
    expect(plan.removed).toEqual([]);
    expect(plan.added).toBe(1);
  });

  it('نگاشت هم‌نام با ابهام: مورد مبهم جدید حساب می‌شود و پیام دارد', () => {
    const mine = blank([task({ id: 10, name: 'ب' }), task({ id: 11, name: 'ب' })]);
    const file = parse(xmlFor([{ uid: 1, name: 'ب' }, { uid: 2, name: 'ب' }]).replace(/<UID>(\d)<\/UID>/g, '<UID>$1</UID><WBS>9</WBS>'));
    const plan = planMspImport(mine, file, { mapping: 'name', idFloor: 12 });
    expect(plan.matched).toBe(0);
    expect(plan.added).toBe(2);
    expect(plan.removed).toHaveLength(2);
    expect(plan.warnings.map((w) => w.code)).toContain('MAPPING_AMBIGUOUS');
  });

  it('بدون نگاشت: همه‌ی فعالیت‌های فعلی حذف و جدیدها با شناسه‌ی تازه ساخته می‌شوند (هیچ شناسه‌ی قدیمی دوباره به کار نمی‌رود)', () => {
    const mine = blank([task({ id: 3, name: 'قدیمی' })]);
    const plan = planMspImport(mine, parse(SMALL), { mapping: 'none', idFloor: 9 });
    expect(plan.tasks.map((t) => t.id)).toEqual([9, 10, 11, 12]);
    expect(plan.removed.map((r) => r.id)).toEqual([3]);
    expect(plan.tasks[2]!.dependencies.map((d) => d.predecessorId)).toEqual([10]);
    expect(plan.blockers).toEqual([]);
  });

  it('شناسه‌ی تازه از «بیشینه‌ی شناسه‌ی فعلی + ۱» هم کمتر نمی‌شود', () => {
    const mine = blank([task({ id: 40, name: 'x' })]);
    const plan = planMspImport(mine, parse(SMALL), { mapping: 'none', idFloor: 2 });
    expect(plan.tasks.map((t) => t.id)).toEqual([41, 42, 43, 44]);
  });

  it('فعالیت حذف‌شونده‌ی دارای هزینه: ورود مسدود و پیام روشن', () => {
    const mine = blank([task({ id: 1, name: 'الف' }), task({ id: 2, name: 'ب' })], { costs: [{ id: 1, date: '2026-09-02', taskId: 2, description: '', document: '', amount: 5_000_000 }] });
    const file = parse(xmlFor([{ uid: 1, name: 'الف' }]));
    const plan = planMspImport(mine, file, { mapping: 'id', idFloor: 3 });
    expect(plan.blockers.map((b) => b.code)).toEqual(['REMOVED_HAS_COSTS']);
    expect(plan.blockers[0]!.message).toContain('«ب»');
    expect(plan.removed[0]).toMatchObject({ id: 2, ledgerRows: 1, ledgerAmount: 5_000_000 });
    // اگر هزینه روی فعالیت باقی‌مانده باشد مانعی نیست
    const ok1 = planMspImport({ ...mine, costs: [{ ...mine.costs[0]!, taskId: 1 }] }, file, { mapping: 'id', idFloor: 3 });
    expect(ok1.blockers).toEqual([]);
  });

  it('چرخه: مانع CYCLE با نام فعالیت‌های درگیر', () => {
    const file = parse(xmlFor([{ uid: 1, name: 'الف', preds: [2] }, { uid: 2, name: 'ب', preds: [1] }]));
    const plan = planMspImport(blank([]), file, { mapping: 'none', idFloor: 1 });
    expect(plan.blockers.map((b) => b.code)).toEqual(['CYCLE']);
    expect(plan.schedule.ok).toBe(false);
    expect(plan.blockers[0]!.message).toContain('«الف»');
  });

  it('پروژه‌ی بایگانی‌شده: مسدود', () => {
    const plan = planMspImport(blank([]), parse(SMALL), { mapping: 'none', idFloor: 1 }, true);
    expect(plan.blockers.map((b) => b.code)).toContain('ARCHIVED');
  });

  it('ستون‌هایی که XML ندارد برای فعالیت تطبیق‌یافته می‌ماند؛ فایل فقط برنامه را عوض می‌کند', () => {
    const old = task({
      id: 2, name: 'الف قدیمی', duration: 5, weight: 7, work: 3, assignments: [{ resourceId: 1, units: 50 }], levelOfEffort: true, costTracked: true, legacyActualCost: 123,
      directCosts: [{ name: 'خرید', amount: 10 }, { name: MSP_FIXED_COST_NAME, amount: 99 }], percentComplete: 60, actualStart: '2026-09-02',
    });
    const mine = blank([task({ id: 1, name: 'گروه', kind: 'summary' }), { ...old, level: 2 }]);
    const file = parse(xmlFor([{ uid: 1, name: 'گروه', summary: true }, { uid: 2, name: 'الف', level: 2, dur: 2, extra: '<FixedCost>400</FixedCost><PercentComplete>10</PercentComplete>' }]));
    const plan = planMspImport(mine, file, { mapping: 'id', idFloor: 3 });
    const t = plan.tasks[1]!;
    expect([t.name, t.duration, t.percentComplete, t.actualStart]).toEqual(['الف', 2, 10, null]); // برنامه و پیشرفت از فایل
    expect([t.weight, t.work, t.levelOfEffort, t.costTracked, t.legacyActualCost]).toEqual([7, 3, true, true, 123]);
    expect(t.assignments).toEqual([{ resourceId: 1, units: 50 }]);
    expect(t.directCosts).toEqual([{ name: 'خرید', amount: 10 }, { name: MSP_FIXED_COST_NAME, amount: 400 }]);
    expect(plan.renamed).toEqual([{ id: 2, from: 'الف قدیمی', to: 'الف' }]);
    // حفظ پیشرفت
    const keep = planMspImport(mine, file, { mapping: 'id', idFloor: 3, keepProgress: true }).tasks[1]!;
    expect([keep.percentComplete, keep.actualStart]).toEqual([60, '2026-09-02']);
  });

  it('تبدیل فعالیت به خلاصه با تخصیص یا هزینه‌ی مستقیم: هشدار صریح', () => {
    const mine = blank([task({ id: 1, name: 'الف', assignments: [{ resourceId: 1, units: 100 }] })]);
    const file = parse(xmlFor([{ uid: 1, name: 'الف', summary: true }, { uid: 2, name: 'فرزند', level: 2 }]));
    const plan = planMspImport(mine, file, { mapping: 'id', idFloor: 2 });
    expect(plan.kindChanged).toEqual([{ id: 1, name: 'الف', from: 'task', to: 'summary' }]);
    expect(plan.effects.some((e) => e.level === 'warn' && e.text.includes('تخصیص یا هزینه‌ی مستقیم'))).toBe(true);
    expect(plan.tasks[0]!.assignments).toEqual([]);
  });

  it('خط مبنا: اگر فایل داشت جایگزین می‌شود؛ اگر نداشت خط مبنای فعلی می‌ماند', () => {
    const cur = { 1: { start: '2026-09-01', finish: '2026-09-02', zeroDuration: false, cost: 5 } };
    const mine = blank([task({ id: 1, name: 'الف', duration: 2 })], { baseline: cur });
    const without = planMspImport(mine, parse(xmlFor([{ uid: 1, name: 'الف', dur: 2 }])), { mapping: 'id', idFloor: 2 });
    expect(without.replaceBaseline).toBe(false);
    expect(without.baseline).toEqual(cur);
    const withB = planMspImport(mine, parse(xmlFor([{ uid: 1, name: 'الف', dur: 2, extra: '<Baseline><Number>0</Number><Start>2026-09-03T07:30:00</Start><Duration>PT16H0M0S</Duration></Baseline>' }])), { mapping: 'id', idFloor: 2 });
    expect(withB.replaceBaseline).toBe(true);
    expect(withB.baseline[1]).toEqual({ start: '2026-09-03', finish: '2026-09-05', zeroDuration: false, cost: null });
    expect(withB.effects.find((e) => e.area === 'خط مبنا')!.text).toContain('بایگانی');
  });

  it('شروع پروژه: پیش‌فرض از فایل و آشکار در اثرها؛ با keepStart ثابت می‌ماند', () => {
    const mine = blank([task({ id: 1, name: 'الف' })], { start: '2026-08-01', status: '2026-09-01' });
    const file = parse(xmlFor([{ uid: 1, name: 'الف' }]));
    const a = planMspImport(mine, file, { mapping: 'id', idFloor: 2 });
    expect(a.start).toBe('2026-09-01');
    expect(a.effects.find((e) => e.area === 'شروع پروژه')!.level).toBe('warn');
    const b = planMspImport(mine, file, { mapping: 'id', idFloor: 2, keepStart: true });
    expect(b.start).toBe('2026-08-01');
    expect(b.effects.filter((e) => e.area === 'شروع پروژه')).toHaveLength(2);
  });

  it('اثر بر هر دسته از داده نوشته می‌شود و داده‌ی دیگر دست‌نخورده است', () => {
    const m = blank([task({ id: 1, name: 'الف' }), task({ id: 2, name: 'ب' })], {
      documents: [{ id: 1, title: 'نقشه', type: 'drawing', url: 'https://x.test', taskId: 2, date: null, addedBy: '' }],
      snapshots: [{ date: '2026-09-02', actual: 10, estimated: false }],
      costs: [],
    });
    const plan = planMspImport(m, parse(xmlFor([{ uid: 1, name: 'الف' }])), { mapping: 'id', idFloor: 3 });
    const areas = plan.effects.map((e) => e.area);
    for (const a of ['فعالیت‌ها', 'شروع پروژه', 'زمان‌بندی', 'پیشرفت', 'خط مبنا', 'منابع و تخصیص‌ها', 'دفتر هزینه', 'مستندات', 'اسنپ‌شات‌ها', 'ریسک، مسئله، تغییر، تصمیم', 'تقویم، تاریخ وضعیت، پایان قرارداد، منشور و قرارداد']) expect(areas).toContain(a);
    expect(plan.effects.find((e) => e.area === 'مستندات')!.text).toContain('اتصال ۱ سند');
    expect(plan.effects.find((e) => e.area === 'اسنپ‌شات‌ها')!.text).toContain('۱ اسنپ‌شات');
    expect(plan.blockers).toEqual([]);
  });

  it('پایان پیش‌بینی و تعداد بحرانی را با تقویم و وضعیت پروژه حساب می‌کند', () => {
    const mine = blank([]);
    const plan = planMspImport(mine, parse(SMALL), { mapping: 'none', idFloor: 1 });
    if (!plan.schedule.ok) throw new Error('schedule');
    // الف (۲ روز: سه‌شنبه، چهارشنبه) ← ب (۳ روز: پنجشنبه، شنبه، یکشنبه) ← مایلستون؛ جمعه تعطیل. پایان = آخرین روز کاری (اندیس ۴)
    expect(plan.schedule.workingDays).toBe(5);
    expect(plan.schedule.finish).toBe('2026-09-06');
    expect(plan.schedule.criticalCount).toBe(2);
  });
});

describe('پروژه‌ی دوباره‌ورودی: همان فایل دوبار وارد شود تغییری نمی‌کند', () => {
  it('وارد کردن دوباره‌ی خروجی خودِ پروژه‌ی واردشده یکسان است', () => {
    const first = modelFromMsp(parse(read('seed-project-msp.xml'), { useFileCalendar: true }), { today: '2026-10-20' });
    if (!first.ok) throw new Error(first.error);
    const x2 = exported(first.model);
    const plan = planMspImport(first.model, parse(x2), { mapping: 'id', idFloor: 100 });
    expect(plan.blockers).toEqual([]);
    expect([plan.added, plan.removed.length, plan.renamed.length]).toEqual([0, 0, 0]);
    plan.tasks.forEach((t, i) => {
      const o = first.model.tasks[i]!;
      expect([t.id, t.name, t.duration, t.kind, t.percentComplete, t.actualStart, t.actualFinish]).toEqual([o.id, o.name, o.duration, o.kind, o.kind === 'summary' ? 0 : o.percentComplete, o.actualStart, o.actualFinish]);
      expect(t.dependencies).toEqual(o.dependencies);
    });
  });
});
