/**
 * منحنی‌های هموار برای نمودارها، با «دقت اول، زیبایی بعد».
 *
 * همه‌ی مسیرها از قطعه‌هایی ساخته می‌شوند که x در آن‌ها با پارامتر t «خطی» است (خط، کمان درجه‌ی ۲ با نقاط کنترلِ هم‌فاصله،
 * و مکعبی هرمیت با نقاط کنترل در یک‌سوم‌ها). پس مقدار منحنی در هر x دقیقاً قابل محاسبه است (`evalCurve`) و می‌شود عددِ
 * نمایش‌داده‌شده را از خودِ منحنی ترسیم‌شده خواند، نه از یک تقریب جدا.
 *
 * دو روش:
 *  - `monotoneCurve`: درون‌یابی مکعبی یکنوا (PCHIP، فریچ–بوتلند). دقیقاً از همه‌ی نقطه‌ها می‌گذرد و در هر بازه بین دو مقدار
 *    کناری می‌ماند (بالازدگی و فروافتادگی ندارد). برای داده‌ی اندازه‌گیری‌شده‌ی کم‌نقطه (گزارش‌های پیشرفت).
 *  - `roundedCurve`: گوشه‌های یک خط شکسته‌ی چگال را با کمان درجه‌ی ۲ گرد می‌کند؛ اندازه‌ی گردی چنان است که اختلاف عمودی منحنی با
 *    خط شکسته‌ی اصلی در هیچ x ای از `maxDev` بیشتر نشود. برای منحنی‌هایی که مدل روی شبکه‌ی روزانه می‌سازد (برنامه‌ای، پیش‌بینی).
 * هیچ‌یک نقطه‌ی ابتدا و انتها را جابه‌جا نمی‌کنند و از جعبه‌ی محدودکننده‌ی داده بیرون نمی‌زنند.
 */

export type Pt = readonly [x: number, y: number];

export type Seg = { kind: 'L'; to: Pt } | { kind: 'Q'; c: Pt; to: Pt } | { kind: 'C'; c1: Pt; c2: Pt; to: Pt };

export interface Curve {
  start: Pt;
  segs: Seg[];
}

/** خط شکسته‌ی ساده (حالت «دقیق») */
export function polylineCurve(points: readonly Pt[]): Curve {
  const [first, ...rest] = points;
  if (!first) return { start: [0, 0], segs: [] };
  return { start: first, segs: rest.map((p): Seg => ({ kind: 'L', to: p })) };
}

const increasing = (pts: readonly Pt[]): boolean => pts.every((p, i) => i === 0 || p[0] > (pts[i - 1] as Pt)[0]);

/** رأس‌هایی که با همسایه‌هایشان هم‌خط‌اند حذف می‌شوند (فقط شیب‌های نزدیک به‌هم؛ x باید اکیداً صعودی باشد) */
export function mergeCollinear(points: readonly Pt[], tol = 1e-9): Pt[] {
  if (points.length < 3 || !increasing(points)) return points.slice();
  const out: Pt[] = [points[0] as Pt];
  for (let i = 1; i < points.length - 1; i += 1) {
    const a = points[i - 1] as Pt;
    const b = points[i] as Pt;
    const c = points[i + 1] as Pt;
    const s1 = (b[1] - a[1]) / (b[0] - a[0]);
    const s2 = (c[1] - b[1]) / (c[0] - b[0]);
    if (Math.abs(s2 - s1) > tol) out.push(b);
  }
  out.push(points[points.length - 1] as Pt);
  return out;
}

/**
 * گردکردن گوشه‌ها: در هر گوشه، دو نقطه‌ی هم‌فاصله (به‌اندازه‌ی d در جهت x) روی دو ضلع برمی‌داریم و با کمان درجه‌ی ۲ که
 * نقطه‌ی کنترلش خودِ گوشه است وصل می‌کنیم. اختلاف عمودی بیشینه برابر `d·|Δشیب|/4` است (در همان x گوشه)، پس
 * d = min(4·maxDev/|Δشیب|, نصفِ طولِ دو ضلعِ مجاور) اختلاف را حداکثر `maxDev` نگه می‌دارد. اتصال‌ها هم‌شیب (G¹) هستند.
 */
export function roundedCurve(points: readonly Pt[], maxDev: number): Curve {
  const pts = mergeCollinear(points);
  if (pts.length < 3 || !increasing(pts) || !(maxDev > 0)) return polylineCurve(pts);
  const slope = (i: number): number => ((pts[i + 1] as Pt)[1] - (pts[i] as Pt)[1]) / ((pts[i + 1] as Pt)[0] - (pts[i] as Pt)[0]);
  const run = (i: number): number => (pts[i + 1] as Pt)[0] - (pts[i] as Pt)[0];
  const segs: Seg[] = [];
  for (let i = 1; i < pts.length - 1; i += 1) {
    const [x, y] = pts[i] as Pt;
    const s1 = slope(i - 1);
    const s2 = slope(i);
    const d = Math.min((4 * maxDev) / Math.abs(s2 - s1), run(i - 1) / 2, run(i) / 2);
    segs.push({ kind: 'L', to: [x - d, y - s1 * d] });
    segs.push({ kind: 'Q', c: [x, y], to: [x + d, y + s2 * d] });
  }
  segs.push({ kind: 'L', to: pts[pts.length - 1] as Pt });
  return { start: pts[0] as Pt, segs };
}

/** شیب‌های مماس به‌روش فریچ–بوتلند (همان PCHIP)؛ بازه‌ی با طول صفر «جهش» است و مماس دو سویش صفر می‌شود */
function tangents(pts: readonly Pt[]): number[] {
  const n = pts.length;
  const h: number[] = [];
  const d: number[] = [];
  for (let i = 0; i < n - 1; i += 1) {
    const dx = (pts[i + 1] as Pt)[0] - (pts[i] as Pt)[0];
    h.push(dx);
    d.push(dx > 0 ? ((pts[i + 1] as Pt)[1] - (pts[i] as Pt)[1]) / dx : 0);
  }
  const m = new Array<number>(n).fill(0);
  if (n < 2) return m;
  const edge = (h0: number, h1: number, d0: number, d1: number): number => {
    let v = ((2 * h0 + h1) * d0 - h0 * d1) / (h0 + h1);
    if (Math.sign(v) !== Math.sign(d0)) v = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0;
    return v;
  };
  for (let i = 1; i < n - 1; i += 1) {
    const hl = h[i - 1] as number;
    const hr = h[i] as number;
    const dl = d[i - 1] as number;
    const dr = d[i] as number;
    if (hl <= 0 || hr <= 0 || dl * dr <= 0) continue; // جهش یا نقطه‌ی بازگشت (اکسترمم): مماس افقی
    const w1 = 2 * hr + hl;
    const w2 = hr + 2 * hl;
    m[i] = (w1 + w2) / (w1 / dl + w2 / dr);
  }
  const h0 = h[0] as number;
  const d0 = d[0] as number;
  m[0] = h0 <= 0 ? 0 : n > 2 && (h[1] as number) > 0 ? edge(h0, h[1] as number, d0, d[1] as number) : d0;
  const hl = h[n - 2] as number;
  const dl = d[n - 2] as number;
  m[n - 1] = hl <= 0 ? 0 : n > 2 && (h[n - 3] as number) > 0 ? edge(hl, h[n - 3] as number, dl, d[n - 3] as number) : dl;
  return m;
}

/** درون‌یابی مکعبی یکنوا از میان نقطه‌ها (x باید ناکاهشی باشد؛ دو x برابر = جهش قائم) */
export function monotoneCurve(points: readonly Pt[]): Curve {
  const pts = points;
  if (pts.length < 3) return polylineCurve(pts);
  const m = tangents(pts);
  const segs: Seg[] = [];
  for (let i = 0; i < pts.length - 1; i += 1) {
    const [x0, y0] = pts[i] as Pt;
    const [x1, y1] = pts[i + 1] as Pt;
    const h = x1 - x0;
    if (h <= 0) {
      segs.push({ kind: 'L', to: [x1, y1] });
      continue;
    }
    segs.push({ kind: 'C', c1: [x0 + h / 3, y0 + ((m[i] as number) * h) / 3], c2: [x1 - h / 3, y1 - ((m[i + 1] as number) * h) / 3], to: [x1, y1] });
  }
  return { start: pts[0] as Pt, segs };
}

/** نقاط پایان قطعه‌ها به‌ترتیب (با نقطه‌ی آغاز) */
export function curveKnots(curve: Curve): Pt[] {
  return [curve.start, ...curve.segs.map((s) => s.to)];
}

/**
 * مقدار منحنی در x؛ خارج از بازه‌ی منحنی null. x در همه‌ی قطعه‌ها خطی در t است، پس t = (x − x₀)/(x₁ − x₀) دقیق است.
 * در جهش قائم مقدار «بعد از جهش» برمی‌گردد.
 */
export function evalCurve(curve: Curve, x: number): number | null {
  let from = curve.start;
  let found: number | null = null;
  if (x === from[0]) found = from[1];
  for (const s of curve.segs) {
    const [x0, y0] = from;
    const [x1, y1] = s.to;
    if (x >= x0 && x <= x1) {
      if (x1 === x0) found = y1;
      else {
        const t = (x - x0) / (x1 - x0);
        const u = 1 - t;
        if (s.kind === 'L') found = u * y0 + t * y1;
        else if (s.kind === 'Q') found = u * u * y0 + 2 * u * t * s.c[1] + t * t * y1;
        else found = u * u * u * y0 + 3 * u * u * t * s.c1[1] + 3 * u * t * t * s.c2[1] + t * t * t * y1;
      }
    }
    from = s.to;
  }
  return found;
}

/** مسیر SVG؛ `mx`/`my` تبدیل خطیِ مختصات داده به مختصات صفحه‌اند (کنترل‌ها هم با همان تبدیل می‌شوند) */
export function curvePath(curve: Curve, mx: (x: number) => number, my: (y: number) => number): string {
  const f = (p: Pt): string => `${mx(p[0]).toFixed(2)},${my(p[1]).toFixed(2)}`;
  let out = `M${f(curve.start)}`;
  for (const s of curve.segs) {
    if (s.kind === 'L') out += `L${f(s.to)}`;
    else if (s.kind === 'Q') out += `Q${f(s.c)} ${f(s.to)}`;
    else out += `C${f(s.c1)} ${f(s.c2)} ${f(s.to)}`;
  }
  return out;
}
