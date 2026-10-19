import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { analyzeProject } from '../src/project.ts';
import type { Analysis, ProjectModel } from '../src/project.ts';
import { importLegacyProject } from '../src/legacy.ts';
import { parseCsv } from '../src/csv.ts';
import { CSV_KINDS, TASK_CSV_HEADER, buildCsv, costCsvRows, csvFileName, taskCsvRows } from '../src/exportCsv.ts';

const model = (): ProjectModel => {
  const l = importLegacyProject(JSON.parse(readFileSync(new URL('./data/seed-project.json', import.meta.url), 'utf8')), { today: '2026-10-03' });
  if ('error' in l) throw new Error(l.error);
  return l.model;
};
const analyze = (m: ProjectModel): Analysis => {
  const a = analyzeProject(m);
  if (!('schedule' in a)) throw new Error('schedule failed');
  return a;
};
const parse = (text: string): string[][] => parseCsv(text);

describe('CSV فعالیت‌ها', () => {
  it('۱۴ ستون، یک ردیف به‌ازای هر فعالیت، ردیف‌های ۱ تا n و WBS مشتق‌شده', () => {
    const m = model();
    const rows = taskCsvRows(m, analyze(m));
    expect(rows[0]).toEqual([...TASK_CSV_HEADER]);
    expect(rows[0]).toHaveLength(14);
    expect(rows).toHaveLength(m.tasks.length + 1);
    expect(rows.every((r) => r.length === 14)).toBe(true);
    expect(rows.slice(1).map((r) => r[0])).toEqual(m.tasks.map((_t, i) => i + 1));
    expect(rows[1]![1]).toBe('1');
    expect(rows[1]![3]).toBe('خلاصه');
  });

  it('پیش‌نیاز با شماره‌ی ردیف، تاریخ‌ها ISO و شمسی، شناوری و بحرانی', () => {
    const m = model();
    const a = analyze(m);
    const rows = taskCsvRows(m, a);
    const withPred = rows.slice(1).filter((r) => r[5] !== '');
    expect(withPred.length).toBeGreaterThan(10);
    const idx = m.tasks.findIndex((t) => t.dependencies.length > 0);
    const t = m.tasks[idx]!;
    const row = rows[idx + 1]!;
    const first = t.dependencies[0]!;
    const predRow = m.tasks.findIndex((x) => x.id === first.predecessorId) + 1;
    expect(String(row[5]).split(';')[0]!.startsWith(String(predRow))).toBe(true);
    const st = a.schedule.byId.get(t.id)!;
    expect(row[8]).toBe(st.startDate);
    expect(row[9]).toBe(st.finishDate);
    expect(/^\d{4}\/\d{2}\/\d{2}$/.test(String(row[10]))).toBe(true);
    expect(row[12]).toBe(st.totalFloat);
    expect(row[13]).toBe(st.critical ? 'بله' : 'خیر');
    expect(rows.slice(1).some((r) => r[13] === 'بله')).toBe(true);
  });

  it('نوع و تأخیر پیش‌نیاز در متن می‌آید', () => {
    const m = model();
    const [a, b, c] = m.tasks.filter((t) => t.kind === 'task');
    b!.dependencies = [{ predecessorId: a!.id, type: 'SS', lag: 2 }];
    c!.dependencies = [{ predecessorId: a!.id, type: 'FS', lag: -1 }, { predecessorId: b!.id, type: 'FS', lag: 0 }];
    const rows = taskCsvRows(m, analyze(m));
    const rowOf = (id: number): number => m.tasks.findIndex((t) => t.id === id) + 1;
    expect(rows[rowOf(b!.id)]![5]).toBe(`${rowOf(a!.id)}SS+2`);
    expect(rows[rowOf(c!.id)]![5]).toBe(`${rowOf(a!.id)}FS-1;${rowOf(b!.id)}`);
  });

  it('متن با = + - @ در خروجی پیشوند می‌گیرد و عدد منفی واقعی نه؛ رفت‌وبرگشت با parseCsv', () => {
    const m = model();
    m.tasks[1]!.name = '=HYPERLINK("http://x")';
    m.tasks[2]!.name = '-خطرناک, با ویرگول';
    const out = buildCsv('tasks', m, analyze(m), { canSeeCosts: false });
    if (!out.ok) throw new Error(out.error);
    expect(out.text.startsWith('﻿')).toBe(true);
    expect(out.text.includes('\r\n')).toBe(true);
    expect(out.text.includes('\n') && !out.text.replace(/\r\n/g, '').includes('\n')).toBe(true);
    const back = parse(out.text);
    expect(back[2]![2]).toBe(`'=HYPERLINK("http://x")`);
    expect(back[3]![2]).toBe("'-خطرناک, با ویرگول");
    expect(back).toHaveLength(m.tasks.length + 1);
    expect(out.rows).toBe(m.tasks.length);
  });

  it('برنامه‌ی نامحاسبه‌پذیر: خطای روشن', () => {
    const m = model();
    const r = buildCsv('tasks', m, null, { canSeeCosts: true });
    expect(r.ok).toBe(false);
  });
});

describe('CSV ریسک، مسئله، تغییر، تصمیم، مستندات، هزینه', () => {
  it('هر دسته عنوان فارسی، ستون‌های هم‌طول و برچسب‌های فارسی دارد', () => {
    const m = model();
    m.changes = [{ id: 1, title: 'تغییر', requester: 'الف', date: '2026-09-02', reason: 'r', impact: 'i', previousFinish: '2026-12-01', newFinish: '2026-12-20', status: 'approved', approvedBy: 'ب', approvedOn: '2026-09-05' }];
    m.decisions = [{ id: 1, topic: 'موضوع', text: 'متن', maker: 'ج', date: '2026-09-03', status: 'decided' }];
    for (const kind of CSV_KINDS) {
      const out = buildCsv(kind, m, analyze(m), { canSeeCosts: true });
      if (!out.ok) throw new Error(out.error);
      const rows = parse(out.text);
      const w = rows[0]!.length;
      expect(rows.every((r) => r.length === w)).toBe(true);
      expect(out.rows).toBe(rows.length - 1);
    }
    const ch = parse((buildCsv('changes', m, null, { canSeeCosts: false }) as { text: string }).text);
    expect(ch[1]).toContain('تأییدشده');
    expect(ch[1]).toContain('2026-12-20');
    const dec = parse((buildCsv('decisions', m, null, { canSeeCosts: false }) as { text: string }).text);
    expect(dec[1]).toContain('تصمیم‌گیری‌شده');
  });

  it('ریسک: ستون «امتیاز» محاسباتی نیست و دسته/راهبرد/وضعیت فارسی است', () => {
    const m = model();
    m.risks = [{ id: 7, title: 'ریسک', category: 'schedule', probability: 4, impact: 3, owner: 'م', strategy: 'mitigate', response: 'اقدام', due: '2026-11-01', status: 'in_progress' }];
    const out = buildCsv('risks', m, null, { canSeeCosts: false });
    if (!out.ok) throw new Error(out.error);
    const rows = parse(out.text);
    expect(rows[0]!.includes('امتیاز')).toBe(false);
    expect(rows[0]![2]).toBe('دسته');
    const r0 = m.risks[0]!;
    expect(rows[1]![0]).toBe(String(r0.id));
    expect(rows[1]![3]).toBe(String(r0.probability));
    expect(rows[1]).toContain('در حال پیگیری');
    expect(rows[1]).toContain('کاهش');
  });

  it('مستندات: فعالیت با WBS و نام؛ سند بدون فعالیت ستون خالی', () => {
    const m = model();
    m.documents = [
      { id: 1, title: 'قرارداد', type: 'contract', url: 'https://example.com/a.pdf', taskId: m.tasks[1]!.id, date: '2026-09-01', addedBy: 'x' },
      { id: 2, title: 'گزارش', type: 'report', url: 'https://example.com/b.pdf', taskId: null, date: null, addedBy: 'x' },
    ];
    const rows = parse((buildCsv('documents', m, null, { canSeeCosts: false }) as { text: string }).text);
    expect(rows[0]).toEqual(['عنوان', 'نوع', 'لینک', 'فعالیت', 'تاریخ', 'تاریخ شمسی']);
    expect(rows[1]![1]).toBe('قرارداد');
    expect(rows[1]![3].startsWith('1.1 ')).toBe(true);
    expect(rows[2]![3]).toBe('');
    expect(rows[2]![4]).toBe('');
  });

  it('هزینه‌ها: بدون دسترسی مالی فقط BOM؛ با دسترسی به ترتیب تاریخ و با WBS', () => {
    const m = model();
    m.costs = [
      { id: 2, date: '2026-09-10', taskId: m.tasks[2]!.id, description: '=cmd', document: 'F2', amount: 200 },
      { id: 1, date: '2026-09-05', taskId: null, description: 'کلی', document: '', amount: 100 },
    ];
    const none = buildCsv('costs', m, null, { canSeeCosts: false });
    expect(none).toEqual({ ok: true, text: '﻿', rows: 0 });
    const ok = buildCsv('costs', m, null, { canSeeCosts: true });
    if (!ok.ok) throw new Error(ok.error);
    const rows = parse(ok.text);
    expect(rows).toHaveLength(3);
    expect(rows[1]![5]).toBe('100');
    expect(rows[2]![3]).toBe("'=cmd");
    expect(costCsvRows(m.costs, m.tasks)[1]![1]).toBe('');
  });

  it('نام فایل ASCII است', () => {
    expect(csvFileName('tasks', '2026-10-03')).toBe('bistoon-tasks-2026-10-03.csv');
  });
});
