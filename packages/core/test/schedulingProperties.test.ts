import { describe, expect, it } from 'vitest';
import { addDays } from '../src/date.ts';
import type { IsoDate } from '../src/date.ts';
import type { Task } from '../src/types.ts';
import { N, SEED, locked, okSchedule, randomProject, rng, structuralViolations, withSnet } from './schedulingGen.ts';

describe('ویژگی‌های موتور زمان‌بندی روی پروژه‌های تصادفی', () => {
  it(`قواعد ساختاری روی ${N} پروژه‌ی بدون ضرب‌الاجل`, () => {
    const failures: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const p = randomProject(SEED + i);
      const s = okSchedule(p.input);
      const v = structuralViolations(p, s, { deadlines: false });
      if (v.length) failures.push(`seed ${SEED + i}: ${v.slice(0, 3).join(' | ')}`);
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  });

  it(`قواعد ساختاری روی ${N} پروژه‌ی دارای ضرب‌الاجل (شناوری منفی مجاز)`, () => {
    const failures: string[] = [];
    for (let i = 0; i < N; i += 1) {
      const p = randomProject(SEED + 100000 + i, { deadlines: true });
      const s = okSchedule(p.input);
      const v = structuralViolations(p, s, { deadlines: true });
      if (v.length) failures.push(`seed ${SEED + 100000 + i}: ${v.slice(0, 3).join(' | ')}`);
      if (failures.length >= 5) break;
    }
    expect(failures).toEqual([]);
  });

  it(`شناوری کل با به‌تعویق‌انداختن واقعی سنجیده می‌شود (${N} پروژه)`, () => {
    const failures: string[] = [];
    let checked = 0;
    for (let i = 0; i < N && failures.length < 5; i += 1) {
      const p = randomProject(SEED + 200000 + i, { noSummaryStartLinks: true });
      const s = okSchedule(p.input);
      const r = rng(SEED + 300000 + i);
      const cands = p.input.tasks.filter((t) => t.kind !== 'summary' && !locked(t) && !t.levelOfEffort && t.startNoEarlierThan === null);
      for (let k = 0; k < 3 && cands.length; k += 1) {
        const t = r.pick(cands);
        const row = s.byId.get(t.id)!;
        const tf = row.totalFloat;
        const delayTo = (days: number): IsoDate | null => s.axis.dateAt(row.earlyStart + days);
        const within = delayTo(tf);
        const beyond = delayTo(tf + 1);
        if (tf > 0 && within) {
          const s2 = okSchedule(withSnet(p.input, t.id, within));
          if (s2.projectFinish !== s.projectFinish) failures.push(`seed ${SEED + 200000 + i}: تأخیر ${tf} روزه‌ی ${t.id} (برابر شناوری) پایان پروژه را عوض کرد: ${s.projectFinish}→${s2.projectFinish}`);
          checked += 1;
        }
        if (beyond && row.earlyStart + tf + 1 < s.axis.length) {
          const s2 = okSchedule(withSnet(p.input, t.id, beyond));
          // با تأخیر بیش از شناوری، پایان پروژه باید عقب برود (فعالیت به پایان پروژه می‌رسد)
          if (s2.projectFinish <= s.projectFinish) failures.push(`seed ${SEED + 200000 + i}: تأخیر ${tf + 1} روزه‌ی ${t.id} (بیش از شناوری ${tf}) پایان پروژه را عقب نبرد: ${s.projectFinish}→${s2.projectFinish}`);
          checked += 1;
        }
      }
    }
    expect(failures).toEqual([]);
    expect(checked).toBeGreaterThan(0);
  });

  it(`یکنوایی: افزودن قید «شروع نه زودتر» هیچ فعالیتی را زودتر نمی‌کند (${N} پروژه)`, () => {
    const failures: string[] = [];
    for (let i = 0; i < N && failures.length < 5; i += 1) {
      const p = randomProject(SEED + 400000 + i);
      const s = okSchedule(p.input);
      const r = rng(SEED + 500000 + i);
      const cands = p.input.tasks.filter((t) => t.kind !== 'summary' && !locked(t) && t.startNoEarlierThan === null);
      if (!cands.length) continue;
      const t = cands[r.int(0, cands.length - 1)] as Task;
      const date = addDays(p.input.start, r.int(0, 160));
      const s2 = okSchedule(withSnet(p.input, t.id, date));
      for (const a of s.tasks) {
        const b = s2.byId.get(a.id)!;
        if (b.earlyStart < a.earlyStart || b.earlyFinish < a.earlyFinish) failures.push(`seed ${SEED + 400000 + i}: قید روی ${t.id} فعالیت ${a.id} را زودتر کرد`);
      }
      if (s2.projectFinish < s.projectFinish) failures.push(`seed ${SEED + 400000 + i}: قید پایان پروژه را زودتر کرد`);
    }
    expect(failures).toEqual([]);
  });

  it('قطعی بودن: دو بار محاسبه‌ی یک ورودی یک خروجی می‌دهد و ورودی را تغییر نمی‌دهد', () => {
    for (let i = 0; i < Math.min(N, 100); i += 1) {
      const p = randomProject(SEED + 600000 + i, { deadlines: true });
      const frozen = JSON.stringify(p.input);
      const a = okSchedule(p.input);
      const b = okSchedule(p.input);
      expect(JSON.stringify(a.tasks)).toBe(JSON.stringify(b.tasks));
      expect(JSON.stringify(p.input)).toBe(frozen);
    }
  });
});
