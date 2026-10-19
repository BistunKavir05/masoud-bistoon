import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildMspXml } from '../src/mspExport.ts';
import { MSP_INVALID_FILE, mspHours, parseMspXml } from '../src/msp.ts';
import type { MspParsed } from '../src/msp.ts';
import { importLegacyProject } from '../src/legacy.ts';
import { defaultCalendar } from '../src/calendar.ts';
import { parseXml, xmlChildren, xmlDescendants, xmlText } from '../src/xml.ts';
import type { XmlNode } from '../src/xml.ts';
import type { WorkCalendar } from '../src/types.ts';

const read = (name: string): string => readFileSync(new URL(`./data/${name}`, import.meta.url), 'utf8');
const SAMPLE_XML = read('seed-project-msp.xml');
const legacyModel = () => {
  const l = importLegacyProject(JSON.parse(read('seed-project.json')), { today: '2026-10-03' });
  if ('error' in l) throw new Error(l.error);
  return l.model;
};
const ok = (xml: string, opts?: Parameters<typeof parseMspXml>[1]): MspParsed => {
  const r = parseMspXml(xml, opts);
  if (!r.ok) throw new Error(r.error);
  return r.value;
};

// ───── ساخت XML کوچک برای آزمون ─────
interface Row {
  uid: number;
  name?: string;
  summary?: boolean;
  milestone?: boolean;
  level?: number;
  duration?: string;
  pct?: number;
  actualStart?: string;
  actualFinish?: string;
  ctype?: number;
  cdate?: string;
  deadline?: string;
  fixed?: number;
  preds?: string; // «uid:type:lag»
  baseline?: { start: string; duration: string };
  extra?: string;
}
const el = (k: string, v: string | number | undefined): string => (v === undefined ? '' : `<${k}>${v}</${k}>`);
const row = (r: Row): string =>
  '<Task>' +
  el('UID', r.uid) + el('Name', r.name ?? `T${r.uid}`) + el('OutlineLevel', r.level ?? 1) +
  el('Summary', r.summary ? 1 : 0) + el('Milestone', r.milestone ? 1 : 0) + el('Duration', r.duration ?? (r.summary || r.milestone ? 'PT0H0M0S' : 'PT8H0M0S')) +
  el('PercentComplete', r.pct) + el('ActualStart', r.actualStart) + el('ActualFinish', r.actualFinish) +
  el('ConstraintType', r.ctype) + el('ConstraintDate', r.cdate) + el('Deadline', r.deadline) + el('FixedCost', r.fixed) +
  (r.preds ?? '').split(',').filter(Boolean).map((p) => { const [u, t, l] = p.split(':'); return `<PredecessorLink>${el('PredecessorUID', u)}${el('Type', t ?? 1)}${el('LinkLag', l ?? 0)}</PredecessorLink>`; }).join('') +
  (r.baseline ? `<Baseline>${el('Number', 0)}${el('Start', r.baseline.start)}${el('Duration', r.baseline.duration)}</Baseline>` : '') +
  (r.extra ?? '') + '</Task>';
const doc = (rows: Row[], head = '', tail = ''): string =>
  `<?xml version="1.0" encoding="UTF-8"?><Project xmlns="http://schemas.microsoft.com/project"><Name>پروژه‌ی آزمون</Name><StartDate>2026-09-01T07:30:00</StartDate><MinutesPerDay>480</MinutesPerDay>${head}<Tasks><Task><UID>0</UID><Name>ریشه</Name><Summary>1</Summary></Task>${rows.map(row).join('')}</Tasks>${tail}</Project>`;

describe('MSP: هم‌خوانی با برنامه‌ی مرجع روی نمونه‌ی ۶۵ردیفی', () => {
  const parsed = ok(SAMPLE_XML);
  const model = legacyModel();

  it('سربرگ و شمارش‌ها', () => {
    expect(parsed.name).toBe('پروژه توزین هوشمند صمت یاسوج');
    expect(parsed.start).toBe('2026-09-01');
    expect(parsed.status).toBe('2026-10-03');
    expect(parsed.minutesPerDay).toBe(440);
    expect(parsed.counts).toEqual({ rows: 65, tasks: 35, summaries: 14, milestones: 16, baselines: 47 });
    expect(parsed.calendarFromFile).toBe(false);
  });

  it('همه‌ی فیلدهای هر ردیف با ورود JSON قدیمی همان پروژه یکی است', () => {
    for (const t of parsed.tasks) {
      const l = model.tasks.find((x) => x.id === t.uid)!;
      expect(l).toBeDefined();
      expect([t.name, t.level, t.kind]).toEqual([l.name, l.level, l.kind]);
      if (l.kind === 'summary') continue;
      expect(t.duration).toBe(l.kind === 'task' ? l.duration : 0);
      expect(t.dependencies.map((d) => `${d.predecessorUid}${d.type}${d.lag}`)).toEqual(l.dependencies.map((d) => `${d.predecessorId}${d.type}${d.lag}`));
      expect(Math.abs(t.percentComplete - l.percentComplete)).toBeLessThan(0.51);
      expect([t.actualStart, t.actualFinish, t.startNoEarlierThan, t.deadline]).toEqual([l.actualStart, l.actualFinish, l.startNoEarlierThan, l.deadline]);
    }
  });

  it('خط مبنا: ۴۷ مورد با همان تاریخ‌ها', () => {
    let n = 0;
    for (const t of parsed.tasks) {
      const b = model.baseline[t.uid];
      expect(t.baseline?.start ?? null).toBe(b?.start ?? null);
      expect(t.baseline?.finish ?? null).toBe(b?.finish ?? null);
      expect(t.baseline?.zeroDuration ?? null).toBe(b?.zeroDuration ?? null);
      if (t.baseline) n += 1;
    }
    expect(n).toBe(47);
  });

  it('تاریخ واقعی خلاصه‌ها نادیده گرفته و یک‌جا گزارش می‌شود', () => {
    expect(parsed.warnings.map((w) => w.code)).toEqual(['SUMMARY_ACTUALS_IGNORED']);
  });
});

describe('MSP: خروجی', () => {
  const model = legacyModel();
  const out = buildMspXml(model);

  it('خروجی همه‌ی ردیف‌ها را با همان مقادیر خروجی مرجع می‌نویسد (به‌جز WBS و تاریخ واقعی خلاصه)', () => {
    if (!out.ok) throw new Error(out.error);
    expect(out.rows).toBe(65);
    const a = parseXml(SAMPLE_XML);
    const b = parseXml(out.xml);
    const flat = (n: XmlNode): Record<string, string> => Object.fromEntries(n.children.filter((c) => c.children.length === 0).map((c) => [c.name, c.text]));
    const link = (n: XmlNode): string => xmlChildren(n, 'PredecessorLink').map((p) => ['PredecessorUID', 'Type', 'LinkLag'].map((k) => xmlText(p, k)).join('/')).join();
    const base = (n: XmlNode): string => xmlChildren(n, 'Baseline').map((p) => ['Start', 'Finish', 'Duration'].map((k) => xmlText(p, k)).join('|')).join();
    const ta = xmlDescendants(a, 'Task');
    const tb = xmlDescendants(b, 'Task');
    expect(tb).toHaveLength(ta.length);
    ta.forEach((x, i) => {
      const fa = flat(x);
      const fb = flat(tb[i]!);
      for (const k of new Set([...Object.keys(fa), ...Object.keys(fb)])) {
        if (k === 'WBS' || k === 'OutlineNumber') continue;
        if (fa.Summary === '1' && (k === 'ActualStart' || k === 'ActualFinish')) continue;
        expect(`${fa.UID}.${k}=${fb[k]}`).toBe(`${fa.UID}.${k}=${fa[k]}`);
      }
      expect(link(tb[i]!)).toBe(link(x));
      expect(base(tb[i]!)).toBe(base(x));
    });
    const head = (n: XmlNode): Record<string, string> => flat(n);
    expect(head(b)).toEqual(head(a));
    expect(JSON.stringify(xmlDescendants(b, 'WeekDay').map(flat))).toBe(JSON.stringify(xmlDescendants(a, 'WeekDay').map(flat)));
  });

  it('رفت‌وبرگشت: خروجی دوباره وارد می‌شود و هیچ ردیف، پیش‌نیاز یا خط مبنایی گم نمی‌شود', () => {
    if (!out.ok) throw new Error(out.error);
    const back = ok(out.xml);
    expect(back.counts).toEqual({ rows: 65, tasks: 35, summaries: 14, milestones: 16, baselines: 47 });
    expect(back.warnings).toEqual([]);
    const first = ok(SAMPLE_XML);
    back.tasks.forEach((t, i) => {
      const f = first.tasks[i]!;
      expect([t.uid, t.name, t.level, t.kind, t.duration]).toEqual([f.uid, f.name, f.level, f.kind, f.duration]);
      expect(t.dependencies).toEqual(f.dependencies);
      expect(t.baseline).toEqual(f.baseline);
      if (f.kind !== 'summary') expect([t.actualStart, t.actualFinish]).toEqual([f.actualStart, f.actualFinish]);
    });
  });

  it('ضرب‌الاجل و قید در خروجی می‌آید و دوباره خوانده می‌شود', () => {
    const m = structuredClone(model);
    const t = m.tasks.find((x) => x.kind === 'task' && !x.actualStart)!;
    t.deadline = '2026-11-18';
    t.startNoEarlierThan = '2026-11-01';
    const o = buildMspXml(m);
    if (!o.ok) throw new Error(o.error);
    const back = ok(o.xml).tasks.find((x) => x.uid === t.id)!;
    expect([back.deadline, back.startNoEarlierThan]).toEqual(['2026-11-18', '2026-11-01']);
  });

  it('نام و تعطیلی با نویسه‌های مخرب escape می‌شود', () => {
    const m = structuredClone(model);
    m.name = 'پروژه <الف> & "ب"';
    m.calendar.holidays = [{ date: '2026-09-22', title: 'روز <ویژه> & "عید"' }];
    const o = buildMspXml(m);
    if (!o.ok) throw new Error(o.error);
    const root = parseXml(o.xml);
    expect(xmlText(root, 'Name')).toBe(m.name);
    const back = ok(o.xml, { useFileCalendar: true });
    expect(back.calendar.holidays).toEqual([{ date: '2026-09-22', title: 'روز <ویژه> & "عید"' }]);
  });

  it('برنامه‌ی دارای چرخه صادر نمی‌شود', () => {
    const m = structuredClone(model);
    const [a, b] = m.tasks.filter((x) => x.kind === 'task');
    a!.dependencies = [{ predecessorId: b!.id, type: 'FS', lag: 0 }];
    b!.dependencies = [{ predecessorId: a!.id, type: 'FS', lag: 0 }];
    const o = buildMspXml(m);
    expect(o.ok).toBe(false);
  });
});

describe('MSP: تبدیل تاریخ و مدت', () => {
  it('شروع در پایان روز ← روز بعد؛ پایان در آغاز روز ← روز قبل', () => {
    const r = ok(doc([
      { uid: 1, actualStart: '2026-09-02T15:00:00' },
      { uid: 2, actualStart: '2026-09-02T07:30:00', actualFinish: '2026-09-03T08:00:00', pct: 100 },
      { uid: 3, actualStart: '2026-09-02T15:00:00', actualFinish: '2026-09-03T08:00:00', pct: 100 },
    ]));
    expect([r.tasks[0]!.actualStart, r.tasks[0]!.actualFinish]).toEqual(['2026-09-03', null]);
    expect([r.tasks[1]!.actualStart, r.tasks[1]!.actualFinish]).toEqual(['2026-09-02', '2026-09-02']);
    // پایان پس از اصلاح قبل از شروع می‌افتد ← پایان برابر شروع و هشدار
    expect([r.tasks[2]!.actualStart, r.tasks[2]!.actualFinish]).toEqual(['2026-09-03', '2026-09-03']);
    expect(r.warnings.map((w) => w.code)).toContain('ACTUAL_DATES_FIXED');
  });

  it('پایان بدون شروع: شروع برابر پایان می‌شود', () => {
    const t = ok(doc([{ uid: 1, actualFinish: '2026-09-03T15:00:00', pct: 100 }])).tasks[0]!;
    expect([t.actualStart, t.actualFinish]).toEqual(['2026-09-03', '2026-09-03']);
  });

  it('روز غیرکاری (جمعه): شروع به جلو، پایان به عقب؛ مایلستون ساعت ندارد', () => {
    const r = ok(doc([
      { uid: 1, actualStart: '2026-09-04T07:30:00' },
      { uid: 2, actualFinish: '2026-09-04T15:00:00', pct: 100 },
      { uid: 3, milestone: true, actualStart: '2026-09-02T16:00:00', actualFinish: '2026-09-02T16:00:00', pct: 100 },
    ]));
    expect(r.tasks[0]!.actualStart).toBe('2026-09-05');
    expect([r.tasks[1]!.actualStart, r.tasks[1]!.actualFinish]).toEqual(['2026-09-03', '2026-09-03']);
    expect(r.tasks[2]!.actualStart).toBe('2026-09-02');
    expect(r.warnings.map((w) => w.code)).toContain('DATES_SHIFTED');
  });

  it('شروع پروژه‌ی افتاده روی جمعه به شنبه می‌رود', () => {
    const x = doc([{ uid: 1 }]).replace('2026-09-01T07:30:00', '2026-09-04T07:30:00');
    expect(ok(x).start).toBe('2026-09-05');
  });

  it('مدت از ساعت روز فایل (یا ساعت انتخابی) به روز کاری تبدیل می‌شود، حداقل یک روز', () => {
    const rows: Row[] = [{ uid: 1, duration: 'PT16H0M0S' }, { uid: 2, duration: 'PT2H0M0S' }, { uid: 3, duration: 'PT0H0M0S' }, { uid: 4, duration: 'PT24H' }];
    expect(ok(doc(rows)).tasks.map((t) => t.duration)).toEqual([2, 1, 1, 3]);
    expect(ok(doc(rows), { hoursPerDay: 4 }).tasks.map((t) => t.duration)).toEqual([4, 1, 1, 6]);
    // ساعت نامعتبر نادیده گرفته می‌شود
    expect(ok(doc(rows), { hoursPerDay: 99 }).hoursPerDay).toBe(8);
  });

  it('lag به روز کاری و نوع وابستگی', () => {
    const r = ok(doc([{ uid: 1 }, { uid: 2, preds: '1:1:4800,1:3:-9600,1:0:0,1:2:0,1:9:0' }]));
    expect(r.tasks[1]!.dependencies.map((d) => `${d.type}${d.lag}`)).toEqual(['FS1', 'SS-2', 'FF0', 'SF0', 'FS0']);
    expect(ok(doc([{ uid: 1 }, { uid: 2, preds: '1:1:4800' }]), { hoursPerDay: 4 }).tasks[1]!.dependencies[0]!.lag).toBe(2);
  });

  it('mspHours: قالب‌های رایج', () => {
    expect(mspHours('PT293H20M0S')).toBeCloseTo(293.3333, 3);
    expect(mspHours('PT8H')).toBe(8);
    expect(mspHours('PT30M')).toBe(0.5);
    expect(mspHours('P1DT2H')).toBe(2);
    expect(mspHours('abc')).toBe(0);
    expect(mspHours(null)).toBe(0);
  });
});

describe('MSP: قید، ضرب‌الاجل، هزینه‌ی ثابت و خط مبنا', () => {
  it('SNET/MSO ← شروع نه زودتر؛ FNLT/MFO و Deadline ← ضرب‌الاجل (Deadline برتر)', () => {
    const r = ok(doc([
      { uid: 1, ctype: 4, cdate: '2026-09-10T07:30:00' },
      { uid: 2, ctype: 2, cdate: '2026-09-12T07:30:00' },
      { uid: 3, ctype: 7, cdate: '2026-09-20T15:00:00' },
      { uid: 4, ctype: 3, cdate: '2026-09-21T15:00:00', deadline: '2026-09-24T15:00:00' },
      { uid: 5, ctype: 5, cdate: '2026-09-21T15:00:00' },
      { uid: 6, ctype: 4, cdate: '2026-09-10T07:30:00', actualStart: '2026-09-02T07:30:00', pct: 10 },
      { uid: 7, ctype: 7, cdate: '2026-09-20T15:00:00', actualStart: '2026-09-02T07:30:00', actualFinish: '2026-09-03T15:00:00', pct: 100 },
    ]));
    const p = r.tasks.map((t) => [t.startNoEarlierThan, t.deadline]);
    expect(p).toEqual([['2026-09-10', null], ['2026-09-12', null], [null, '2026-09-20'], [null, '2026-09-24'], [null, null], [null, null], [null, null]]);
  });

  it('هزینه‌ی ثابت فقط برای غیرخلاصه', () => {
    const r = ok(doc([{ uid: 1, summary: true, fixed: 500 }, { uid: 2, level: 2, fixed: 1500 }, { uid: 3, level: 2, fixed: 0 }]));
    expect(r.tasks.map((t) => t.fixedCost)).toEqual([0, 1500, 0]);
  });

  it('فقط خط مبنای شماره‌ی ۰ و فقط غیرخلاصه؛ مایلستون با مدت صفر', () => {
    const x = doc([
      { uid: 1, summary: true, baseline: { start: '2026-09-02T07:30:00', duration: 'PT8H0M0S' } },
      { uid: 2, level: 2, baseline: { start: '2026-09-02T07:30:00', duration: 'PT16H0M0S' } },
      { uid: 3, level: 2, milestone: true, baseline: { start: '2026-09-09T07:30:00', duration: 'PT0H0M0S' } },
      { uid: 4, level: 2, extra: '<Baseline><Number>1</Number><Start>2026-09-02T07:30:00</Start><Duration>PT8H0M0S</Duration></Baseline>' },
    ]);
    const r = ok(x);
    expect(r.tasks[0]!.baseline).toBeNull();
    expect(r.tasks[1]!.baseline).toEqual({ start: '2026-09-02', finish: '2026-09-03', zeroDuration: false });
    expect(r.tasks[2]!.baseline).toEqual({ start: '2026-09-09', finish: '2026-09-09', zeroDuration: true });
    expect(r.tasks[3]!.baseline).toBeNull();
    expect(r.counts.baselines).toBe(2);
  });

  it('خط مبنای پیش از شروع پروژه به روز اول می‌رود و گزارش می‌شود', () => {
    const r = ok(doc([{ uid: 1, baseline: { start: '2026-08-20T07:30:00', duration: 'PT8H0M0S' } }]));
    expect(r.tasks[0]!.baseline!.start).toBe('2026-09-01');
    expect(r.warnings.map((w) => w.code)).toContain('BASELINE_BEFORE_START');
  });
});

describe('MSP: هشدارها و فایل نامعتبر', () => {
  it('کد تکراری، پیش‌نیاز ناموجود و خودارجاع، پیوند خلاصه، منابع', () => {
    const r = ok(
      doc(
        [
          { uid: 1, summary: true, preds: '2:1:0' },
          { uid: 2, level: 2 },
          { uid: 2, level: 2, name: 'تکراری' },
          { uid: 3, level: 2, preds: '99:1:0,3:1:0,2:1:0' },
        ],
        '',
        '<Resources><Resource><UID>0</UID></Resource><Resource><UID>5</UID></Resource></Resources><Assignments><Assignment><UID>1</UID></Assignment></Assignments>',
      ),
    );
    expect(r.tasks.map((t) => t.uid)).toEqual([1, 2, 3]);
    expect(r.tasks[2]!.dependencies.map((d) => d.predecessorUid)).toEqual([2]);
    expect(r.tasks[0]!.dependencies).toEqual([]);
    expect(r.warnings.map((w) => w.code).sort()).toEqual(['DUPLICATE_UID', 'MISSING_PREDECESSOR', 'RESOURCES_NOT_IMPORTED', 'SELF_PREDECESSOR', 'SUMMARY_PREDECESSORS_DROPPED']);
  });

  it('ردیف ریشه (UID=0) و کد نامعتبر نادیده گرفته می‌شود', () => {
    const r = ok(doc([{ uid: 1 }], '').replace('<Tasks>', '<Tasks><Task><UID>x</UID><Name>بد</Name></Task><Task><Name>بدون کد</Name></Task>'));
    expect(r.tasks.map((t) => t.uid)).toEqual([1]);
  });

  const invalid: [string, string][] = [
    ['متن بی‌ربط', 'سلام دنیا'],
    ['XML خراب', '<Project><Tasks><Task>'],
    ['ریشه‌ی دیگر', '<Other><Tasks><Task><UID>1</UID></Task></Tasks></Other>'],
    ['بدون ردیف', '<Project><StartDate>2026-09-01T07:30:00</StartDate></Project>'],
    ['بدون شروع', '<Project><Tasks><Task><UID>1</UID><Name>a</Name></Task></Tasks></Project>'],
    ['شروع نامعتبر', '<Project><StartDate>فردا</StartDate><Tasks><Task><UID>1</UID></Task></Tasks></Project>'],
    ['DOCTYPE', '<!DOCTYPE x [<!ENTITY a "b">]><Project/>'],
  ];
  for (const [title, src] of invalid) {
    it(`رد می‌شود: ${title}`, () => {
      const r = parseMspXml(src);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toBe(MSP_INVALID_FILE);
    });
  }

  it('فایلی که فقط ردیف ریشه دارد پذیرفته نمی‌شود', () => {
    const r = parseMspXml(doc([]));
    expect(r.ok).toBe(false);
  });
});

describe('MSP: تقویم', () => {
  const week = (rows: [number, boolean][]): string =>
    '<Calendars><Calendar><UID>1</UID><IsBaseCalendar>1</IsBaseCalendar><WeekDays>' +
    rows.map(([t, w]) => `<WeekDay><DayType>${t}</DayType><DayWorking>${w ? 1 : 0}</DayWorking>${w ? '<WorkingTimes><WorkingTime><FromTime>08:00:00</FromTime><ToTime>16:00:00</ToTime></WorkingTime></WorkingTimes>' : ''}</WeekDay>`).join('') +
    '</WeekDays><Exceptions><Exception><TimePeriod><FromDate>2026-09-08T00:00:00</FromDate><ToDate>2026-09-09T23:59:00</ToDate></TimePeriod><Name>تعطیل</Name><DayWorking>0</DayWorking></Exception></Exceptions></Calendar></Calendars><CalendarUID>1</CalendarUID>';
  // یکشنبه تا چهارشنبه کاری (DayType ۱=یکشنبه)، پنجشنبه تا شنبه غیرکاری
  const sunWed = week([[1, true], [2, true], [3, true], [4, true], [5, false], [6, false], [7, false]]);
  const wedHead = sunWed.replace('<CalendarUID>1</CalendarUID>', '') + '<CalendarUID>1</CalendarUID>';

  it('با گزینه‌ی تقویم فایل: هفته‌ی کاری و تعطیلی‌ها از فایل می‌آید', () => {
    const r = ok(doc([{ uid: 1 }], wedHead), { useFileCalendar: true });
    expect(r.calendarFromFile).toBe(true);
    expect(r.calendar.days.map((d) => d.working)).toEqual([true, true, true, true, false, false, false]);
    expect(r.calendar.days[0]).toEqual({ working: true, from: '08:00', to: '16:00' });
    expect(r.calendar.holidays.map((h) => h.date)).toEqual(['2026-09-08', '2026-09-09']);
    expect(r.calendar.holidays[0]!.title).toBe('تعطیل');
  });

  it('تاریخ‌ها با تقویم فایل (نه جمعه‌ی ثابت) اصلاح می‌شوند', () => {
    // ۲۰۲۶-۰۹-۰۳ پنجشنبه؛ در این تقویم غیرکاری است ← یکشنبه‌ی بعد
    const r = ok(doc([{ uid: 1, actualStart: '2026-09-03T08:00:00' }], wedHead), { useFileCalendar: true });
    expect(r.tasks[0]!.actualStart).toBe('2026-09-06');
  });

  it('بدون گزینه‌ی تقویم فایل: تقویم داده‌شده (یا پیش‌فرض) به کار می‌رود و تقویم فایل نادیده است', () => {
    const r = ok(doc([{ uid: 1, actualStart: '2026-09-03T08:00:00' }], wedHead));
    expect(r.calendarFromFile).toBe(false);
    expect(r.tasks[0]!.actualStart).toBe('2026-09-03');
    const sat: WorkCalendar = { ...defaultCalendar(), holidays: [{ date: '2026-09-03', title: 'تعطیل' }] };
    expect(ok(doc([{ uid: 1, actualStart: '2026-09-03T08:00:00' }]), { calendar: sat }).tasks[0]!.actualStart).toBe('2026-09-05');
  });

  it('تقویم ناقص یا ناکارآمد: هشدار و بازگشت به پیش‌فرض', () => {
    const partial = ok(doc([{ uid: 1 }], week([[1, true]])), { useFileCalendar: true });
    expect(partial.warnings.map((w) => w.code)).toContain('CALENDAR_PARTIAL');
    const none = ok(doc([{ uid: 1 }], week([[1, false], [2, false], [3, false], [4, false], [5, false], [6, false], [7, false]])), { useFileCalendar: true });
    expect(none.warnings.map((w) => w.code)).toContain('CALENDAR_INVALID');
    expect(none.calendar.days.some((d) => d.working)).toBe(true);
  });
});
