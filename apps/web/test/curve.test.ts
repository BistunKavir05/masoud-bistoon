import { describe, expect, it } from 'vitest';
import { analyzeProject, defaultCalendar } from '@bistoon/core';
import type { ProjectModel, TaskDto } from '@bistoon/core';
import { curveKnots, curvePath, evalCurve, mergeCollinear, monotoneCurve, polylineCurve, roundedCurve } from '../src/lib/curve.ts';
import type { Curve, Pt } from '../src/lib/curve.ts';

function prng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const EPS = 1e-9;
const close = (a: number | null, b: number, tol = EPS): boolean => a !== null && Math.abs(a - b) <= tol;

/** مقدار خط شکسته‌ی اصلی در x (x در بازه‌ی نقطه‌ها) */
function polyAt(points: readonly Pt[], x: number): number {
  for (let i = 0; i < points.length - 1; i += 1) {
    const [x0, y0] = points[i] as Pt;
    const [x1, y1] = points[i + 1] as Pt;
    if (x >= x0 && x <= x1) return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0);
  }
  return NaN;
}

/** شیب منحنی در x (تفاضل مرکزی کوچک) */
const slopeAt = (c: Curve, x: number, side: -1 | 1, h = 1e-6): number => {
  const a = evalCurve(c, x);
  const b = evalCurve(c, x + side * h);
  return a === null || b === null ? NaN : ((b - a) / h) * side;
};

describe('درون‌یابی یکنوا (منحنی واقعی از چند گزارش)', () => {
  it('از همه‌ی نقطه‌ها دقیقاً می‌گذرد و بین دو مقدار کناری می‌ماند (بدون بالازدگی)', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = prng(seed);
      const n = 2 + Math.floor(r() * 9);
      const pts: Pt[] = [];
      let x = 0;
      for (let i = 0; i < n; i += 1) {
        pts.push([x, r() * 100]);
        x += 1 + Math.floor(r() * 40);
      }
      const c = monotoneCurve(pts);
      for (const [px, py] of pts) expect(close(evalCurve(c, px), py)).toBe(true);
      for (let i = 0; i < pts.length - 1; i += 1) {
        const [x0, y0] = pts[i] as Pt;
        const [x1, y1] = pts[i + 1] as Pt;
        const lo = Math.min(y0, y1) - EPS;
        const hi = Math.max(y0, y1) + EPS;
        for (let k = 0; k <= 20; k += 1) {
          const v = evalCurve(c, x0 + ((x1 - x0) * k) / 20) as number;
          expect(v >= lo && v <= hi).toBe(true);
        }
      }
    }
  });

  it('داده‌ی صعودی ← منحنی صعودی و درون ۰ تا ۱۰۰؛ بازگشت داده ← مماس افقی در نقطه‌ی بازگشت', () => {
    for (let seed = 1; seed <= 300; seed += 1) {
      const r = prng(seed + 1000);
      const n = 3 + Math.floor(r() * 8);
      const pts: Pt[] = [[0, 0]];
      let x = 0;
      let y = 0;
      for (let i = 1; i < n; i += 1) {
        x += 1 + Math.floor(r() * 30);
        y = Math.min(100, y + r() * 30);
        pts.push([x, y]);
      }
      const c = monotoneCurve(pts);
      let prev = -Infinity;
      const last = (pts[pts.length - 1] as Pt)[0];
      for (let k = 0; k <= 400; k += 1) {
        const v = evalCurve(c, (last * k) / 400) as number;
        expect(v >= prev - EPS).toBe(true);
        expect(v >= -EPS && v <= 100 + EPS).toBe(true);
        prev = v;
      }
    }
    // کاهش واقعی در داده (۳۰ → ۲۰) ← نقطه‌ی بازگشت با مماس افقی؛ منحنی از ۳۰ بالاتر نمی‌رود
    const c = monotoneCurve([
      [0, 0],
      [10, 30],
      [20, 20],
      [30, 50],
    ]);
    expect(Math.abs(slopeAt(c, 10, 1))).toBeLessThan(1e-3);
    for (let k = 0; k <= 100; k += 1) expect((evalCurve(c, (10 * k) / 100 + 0) as number) <= 30 + EPS).toBe(true);
  });

  it('مماس پیوسته است (بدون زاویه) و مقدار خوانده‌شده دقیقاً همان منحنی ترسیم‌شده است', () => {
    const pts: Pt[] = [
      [0, 0],
      [12, 8],
      [20, 25],
      [45, 40],
      [70, 90],
    ];
    const c = monotoneCurve(pts);
    for (let i = 1; i < pts.length - 1; i += 1) {
      const x = (pts[i] as Pt)[0];
      expect(Math.abs(slopeAt(c, x, -1) - slopeAt(c, x, 1))).toBeLessThan(1e-4);
    }
    // مسیر SVG همان نقطه‌های پایان را دارد (تبدیل واحد: ۱ → ۱)
    const d = curvePath(c, (x) => x, (y) => y);
    expect(d.startsWith('M0.00,0.00')).toBe(true);
    expect(d.match(/C/g)?.length).toBe(4);
    expect(curveKnots(c).map((p) => p[0])).toEqual(pts.map((p) => p[0]));
  });

  it('دو نقطه: خط راست؛ جهش قائم (دو گزارش هم‌روز): بدون NaN و مقدار پس از جهش', () => {
    const two = monotoneCurve([
      [0, 0],
      [10, 20],
    ]);
    expect(close(evalCurve(two, 5), 10)).toBe(true);
    const jump = monotoneCurve([
      [0, 0],
      [10, 10],
      [10, 30],
      [20, 40],
    ]);
    expect(/NaN|Infinity/.test(curvePath(jump, (x) => x, (y) => y))).toBe(false);
    expect(close(evalCurve(jump, 10), 30)).toBe(true);
    expect(close(evalCurve(jump, 0), 0)).toBe(true);
    expect(close(evalCurve(jump, 20), 40)).toBe(true);
    for (let k = 0; k < 50; k += 1) {
      const v = evalCurve(jump, (10 * k) / 50) as number;
      expect(v >= -EPS && v <= 10 + EPS).toBe(true); // قبل از جهش (x < ۱۰) از ۱۰ بالاتر نمی‌رود
    }
  });
});

/** خط شکسته‌ی صعودیِ روزانه مثل منحنی برنامه‌ای: چند شیب پیاپی، گاهی تخت */
function randomDaily(seed: number): Pt[] {
  const r = prng(seed);
  const days = 20 + Math.floor(r() * 300);
  const pts: Pt[] = [[0, 0]];
  let y = 0;
  let slope = 0;
  let hold = 0;
  for (let x = 1; x <= days; x += 1) {
    if (hold <= 0) {
      slope = r() < 0.25 ? 0 : r() * 4;
      hold = 1 + Math.floor(r() * 40);
    }
    hold -= 1;
    y = Math.min(100, y + slope);
    pts.push([x, y]);
  }
  return pts;
}

describe('گردکردن گوشه‌ها (منحنی برنامه‌ای و پیش‌بینی)', () => {
  it('انحراف عمودی از خط شکسته‌ی اصلی در هیچ x از سقف بیشتر نیست؛ ابتدا و انتها ثابت‌اند', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      for (const maxDev of [0.1, 1, 3]) {
        const pts = randomDaily(seed);
        const c = roundedCurve(pts, maxDev);
        expect(curveKnots(c)[0]).toEqual(pts[0]);
        expect(curveKnots(c).at(-1)).toEqual(pts[pts.length - 1]);
        const last = (pts[pts.length - 1] as Pt)[0];
        // همه‌ی روزها + نقاط میانی
        for (let k = 0; k <= last * 4; k += 1) {
          const x = k / 4;
          const v = evalCurve(c, x);
          expect(v).not.toBeNull();
          expect(Math.abs((v as number) - polyAt(pts, x))).toBeLessThanOrEqual(maxDev + 1e-9);
        }
      }
    }
  });

  it('صعودی می‌ماند، از ۰ تا ۱۰۰ بیرون نمی‌زند و با گردکردن مقدار هیچ روزی از داده‌ی خودش عبور نمی‌کند', () => {
    for (let seed = 500; seed <= 700; seed += 1) {
      const pts = randomDaily(seed);
      const c = roundedCurve(pts, 1);
      let prev = -Infinity;
      const last = (pts[pts.length - 1] as Pt)[0];
      for (let k = 0; k <= last * 8; k += 1) {
        const v = evalCurve(c, k / 8) as number;
        expect(v >= prev - 1e-9).toBe(true);
        expect(v >= -1e-9 && v <= 100 + 1e-9).toBe(true);
        prev = v;
      }
    }
  });

  it('اتصال‌ها هم‌شیب‌اند (بدون زاویه‌ی تازه) و مسیر شامل NaN نیست', () => {
    const pts: Pt[] = [];
    for (let x = 0; x <= 60; x += 1) pts.push([x, x < 20 ? 0 : x < 40 ? (x - 20) * 4 : 80 + (x - 40) * 1]);
    const c = roundedCurve(pts, 1);
    const knots = curveKnots(c);
    for (let i = 1; i < knots.length - 1; i += 1) {
      const x = (knots[i] as Pt)[0];
      if (x <= 0.001 || x >= 59.999) continue;
      const l = slopeAt(c, x, -1);
      const rr = slopeAt(c, x, 1);
      if (Number.isFinite(l) && Number.isFinite(rr)) expect(Math.abs(l - rr)).toBeLessThan(1e-2);
    }
    expect(/NaN|Infinity/.test(curvePath(c, (x) => x, (y) => y))).toBe(false);
  });

  it('ضلع‌های هم‌خط یکی می‌شوند؛ سقف صفر یا x غیرصعودی ← خط شکسته‌ی دقیق', () => {
    const flat: Pt[] = [0, 1, 2, 3, 4].map((x) => [x, x * 2] as const);
    expect(mergeCollinear(flat)).toEqual([flat[0], flat[4]]);
    const zig = roundedCurve(flat, 0);
    expect(zig.segs.every((s) => s.kind === 'L')).toBe(true);
    const bad = roundedCurve([[0, 0], [5, 5], [5, 9], [10, 10]], 1);
    expect(bad.segs.every((s) => s.kind === 'L')).toBe(true);
    expect(polylineCurve([]).segs).toEqual([]);
  });
});

describe('روی منحنی S واقعیِ برنامه', () => {
  const mk = (p: Partial<TaskDto> & { id: number }): TaskDto => {
    const kind = p.kind ?? 'task';
    return {
      name: `T${p.id}`,
      level: 1,
      kind,
      duration: kind === 'task' ? 1 : 0,
      dependencies: [],
      weight: kind === 'summary' ? 0 : 1,
      percentComplete: 0,
      actualStart: null,
      actualFinish: null,
      work: 0,
      assignments: [],
      startNoEarlierThan: null,
      startNoEarlierSource: null,
      deadline: null,
      levelOfEffort: false,
      directCosts: [],
      legacyActualCost: null,
      costTracked: false,
      recurrence: null,
      version: 1,
      ...p,
    };
  };

  it('برنامه‌ای: مقدار گرد‌شده در هر روز حداکثر ۱ واحد درصد با مقدار دقیق اختلاف دارد', () => {
    const tasks = [
      mk({ id: 1, duration: 12, weight: 12 }),
      mk({ id: 2, duration: 20, weight: 20, dependencies: [{ predecessorId: 1, type: 'FS', lag: 0 }] }),
      mk({ id: 3, duration: 6, weight: 6, dependencies: [{ predecessorId: 1, type: 'SS', lag: 4 }] }),
      mk({ id: 4, duration: 15, weight: 15, dependencies: [{ predecessorId: 2, type: 'FS', lag: 3 }] }),
    ];
    const m: ProjectModel = {
      name: 'x',
      start: '2026-09-12',
      status: '2026-09-30',
      contractEnd: null,
      calendar: defaultCalendar(),
      tasks,
      resources: [],
      baseline: {},
      baselineHistory: [],
      snapshots: [],
      costs: [],
      finance: { unit: 'ریال', budget: 0, eacMethod: 'remaining' },
      charter: {} as ProjectModel['charter'],
      contract: {} as ProjectModel['contract'],
      risks: [],
      issues: [],
      changes: [],
      decisions: [],
      documents: [],
    };
    const a = analyzeProject(m);
    if (!('schedule' in a)) throw new Error('cycle');
    const planned = a.scurve.planned;
    const c = roundedCurve(planned, 1);
    for (const [x, y] of planned) expect(Math.abs((evalCurve(c, x) as number) - y)).toBeLessThanOrEqual(1 + 1e-9);
    // نقطه‌ی پایانی (۱۰۰٪) و آغاز (۰٪) دست‌نخورده است
    expect(close(evalCurve(c, (planned[planned.length - 1] as Pt)[0]), 100, 1e-9)).toBe(true);
    expect(close(evalCurve(c, 0), 0)).toBe(true);
    // پیش‌بینی هم همین ضمانت را دارد
    if (a.scurve.forecast.length > 2) {
      const f = roundedCurve(a.scurve.forecast, 1);
      for (const [x, y] of a.scurve.forecast) expect(Math.abs((evalCurve(f, x) as number) - y)).toBeLessThanOrEqual(1 + 1e-9);
    }
  });
});
