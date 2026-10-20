/**
 * تولید پروژه‌ی تصادفی در قالب JSON نسخه‌ی قدیمی برنامه (ورودی تابع `fix` قدیمی).
 * بذر ثابت ⇒ نتیجه‌ی تکرارپذیر. هدف، پوشش رفتارهای مرزی موتور است، نه واقع‌نمایی.
 */
export type Rng = () => number;

export function mulberry32(seed: number): Rng {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const pad = (n: number): string => String(n).padStart(2, '0');
const isoOfEpoch = (day: number): string => {
  const d = new Date(day * 86400000);
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
};
const epochOf = (iso: string): number => Date.parse(`${iso}T00:00:00Z`) / 86400000;

export interface GenOptions {
  /** حداکثر تعداد فعالیت */
  maxTasks?: number;
  /** احتمال وجود دور در وابستگی‌ها */
  cycleProb?: number;
  /** فعالیت خلاصه تاریخ واقعی داشته باشد (رفتار شبه‌باگ قدیمی) */
  summaryActuals?: boolean;
}

type J = Record<string, unknown>;

export function genLegacyProject(seed: number, opts: GenOptions = {}): J {
  const rnd = mulberry32(seed);
  const ri = (a: number, b: number): number => a + Math.floor(rnd() * (b - a + 1));
  const chance = (p: number): boolean => rnd() < p;
  const pick = <T>(xs: readonly T[]): T => xs[Math.floor(rnd() * xs.length)] as T;

  const startDay = epochOf('2026-01-01') + ri(0, 400);
  const start = isoOfEpoch(startDay);
  const statusOff = ri(-5, 220);
  const status = isoOfEpoch(startDay + statusOff);
  const dayAt = (off: number): string => isoOfEpoch(startDay + off);

  // تقویم
  let cal: J | undefined;
  if (chance(0.35)) {
    const days = [0, 1, 2, 3, 4, 5, 6].map((i) => ({ w: i !== 5 ? chance(0.9) : chance(0.1), f: '07:30', t: i === 4 ? '14:00' : '15:00' }));
    if (!days.some((d) => d.w)) (days[6] as { w: boolean }).w = true;
    const hol = Array.from({ length: ri(0, 18) }, () => ({ d: dayAt(ri(0, 500)), n: 'تعطیل' }));
    cal = { days, hol };
  }

  // منابع
  const resNames = ['ENG', 'DEV', 'OPS', 'CRANE', 'CASH'].slice(0, ri(2, 5));
  const res = resNames.map((n, i) => ({ n, t: n === 'CASH' ? 'مالی' : pick(['انسانی', 'تجهیزات', 'سایر']), c: pick([50, 100, 100, 150, 200]), rate: i === 0 ? 0 : ri(0, 6) * 1000 }));

  // ساختار سلسله‌مراتب
  const maxN = opts.maxTasks ?? 40;
  const n = ri(1, maxN);
  const shape: { lv: number; sm: boolean }[] = [];
  let lv = 1;
  while (shape.length < n) {
    const canDeeper = lv < 4;
    const sm = canDeeper && chance(0.18);
    shape.push({ lv, sm });
    if (sm) lv += chance(0.97) ? 1 : 0;
    else lv = ri(1, lv);
  }
  // شناسه‌های یکتا با ترتیب نامنظم
  const ids = Array.from({ length: n }, (_, i) => i + 1 + ri(0, 3) * 100);
  const uniq = [...new Set(ids)];
  while (uniq.length < n) uniq.push(1000 + uniq.length);
  for (let i = uniq.length - 1; i > 0; i -= 1) {
    const j = ri(0, i);
    [uniq[i], uniq[j]] = [uniq[j] as number, uniq[i] as number];
  }
  // رتبه‌ی توپولوژیک: برگ‌ها تصادفی؛ رتبه‌ی هر خلاصه از همه‌ی زیرمجموعه‌اش بزرگ‌تر است تا یال‌های فرزند←خلاصه با یال‌های
  // پیش‌نیاز (که فقط از رتبه‌ی کمتر به بیشتر می‌روند) دور نسازند.
  const rank: number[] = uniq.map(() => rnd());
  for (let i = n - 1; i >= 0; i -= 1) {
    if (!(shape[i] as { sm: boolean }).sm) continue;
    let max = -1;
    for (let j = i + 1; j < n && (shape[j] as { lv: number }).lv > (shape[i] as { lv: number }).lv; j += 1) max = Math.max(max, rank[j] as number);
    rank[i] = max < 0 ? rnd() : max + 0.5;
  }
  const cyc = chance(opts.cycleProb ?? 0.04);

  const tasks: J[] = shape.map((s, i) => {
    const id = uniq[i] as number;
    const isMs = !s.sm && chance(0.1);
    const t: J = { id, wbs: '', lv: s.lv, sm: s.sm, ms: isMs, name: `T${id}`, dur: s.sm || isMs ? 0 : ri(1, 18), preds: '', w: 0, p: 0, as: '', af: '', res: '', wk: 0, snet: '', dl: '' };
    if (s.sm) {
      if (opts.summaryActuals && chance(0.5)) t.as = dayAt(ri(0, Math.max(0, statusOff)));
      return t;
    }
    t.w = chance(0.1) ? 0 : isMs ? ri(0, 3) : ri(1, 12);
    // پیش‌نیازها
    const k = chance(0.25) ? 0 : ri(1, 3);
    const parts: string[] = [];
    for (let q = 0; q < k; q += 1) {
      let j = ri(0, n - 1);
      if (!cyc && (rank[j] as number) >= (rank[i] as number)) {
        j = ri(0, n - 1);
        if ((rank[j] as number) >= (rank[i] as number)) continue;
      }
      const type = pick(['FS', 'FS', 'FS', 'SS', 'FF', 'SF']);
      const lag = chance(0.6) ? 0 : ri(-3, 5);
      parts.push(`${uniq[j]}${type}${lag === 0 ? '' : lag > 0 ? `+${lag}` : lag}`);
    }
    if (chance(0.02)) parts.push('99999FS');
    if (chance(0.01)) parts.push(`${id}FS`);
    t.preds = parts.join(chance(0.2) ? '،' : ',');
    // واقعی
    if (chance(0.3)) {
      const asOff = ri(-3, Math.max(0, statusOff));
      t.as = dayAt(asOff);
      if (chance(0.4)) {
        t.af = dayAt(asOff + ri(chance(0.04) ? -2 : 0, 12));
        t.p = 100;
      } else t.p = ri(0, 99);
    } else if (chance(0.05)) t.p = ri(1, 99);
    if (chance(0.08) && !t.as) t.snet = dayAt(ri(0, 300));
    if (chance(0.12)) t.dl = dayAt(ri(0, 300));
    // D-029: در موتور جدید، LoE سقف پایان پروژه ندارد (برنامه‌ی مرجع دارد)؛ برای مقایسه‌ی منصفانه LoE پیش‌نیاز ندارد.
    if (chance(0.05)) {
      t.loe = true;
      t.preds = '';
    }
    if (chance(0.3)) {
      const m = ri(1, 2);
      t.res = Array.from({ length: m }, () => `${chance(0.04) ? 'GHOST' : pick(resNames)}:${pick([25, 50, 100, 100, 150])}`).join(chance(0.2) ? '،' : ',');
      if (chance(0.4)) t.wk = ri(1, 40);
    }
    if (chance(0.2)) t.cs = Array.from({ length: ri(1, 2) }, (_, q) => ({ n: `c${q}`, a: ri(1, 9) * 1000 }));
    if (chance(0.1)) t.ac = ri(0, 9) * 500;
    if (chance(0.1)) t.cb = true;
    return t;
  });

  // خط مبنا
  const base: J = {};
  if (chance(0.6)) {
    for (const t of tasks) {
      base[String(t.id)] = { ES: ri(0, 150), D: chance(0.15) ? 0 : ri(1, 18), ...(chance(0.7) ? { c: ri(0, 12) * 1000 } : {}) };
    }
  }

  // اسنپ‌شات
  const snaps: J[] = [];
  if (chance(0.5)) {
    for (let q = 0; q < ri(1, 6); q += 1) {
      const sn: J = { d: dayAt(ri(0, Math.max(1, statusOff + 30))), a: ri(0, 100) + rnd(), est: chance(0.4) };
      if (chance(0.5)) sn.pl = ri(0, 100);
      if (chance(0.4)) sn.ac = ri(0, 50000);
      if (chance(0.7)) {
        const tm: J = {};
        for (const t of tasks) if (!t.sm && chance(0.8)) tm[String(t.id)] = ri(0, 100);
        sn.t = tm;
      }
      snaps.push(sn);
    }
  }

  // دفتر هزینه
  const costs: J[] = [];
  for (let q = 0; q < ri(0, 8); q += 1) {
    costs.push({ id: q + 1, d: dayAt(ri(0, 400)), task: chance(0.3) ? 0 : chance(0.05) ? 424242 : (pick(tasks).id as number), n: `x${q}`, a: ri(1, 9) * 500, doc: '' });
  }

  return {
    name: `P${seed}`,
    start,
    status,
    ver: ri(0, 5),
    tasks,
    base,
    ...(cal ? { cal } : {}),
    snaps,
    log: [],
    res,
    users: [],
    risks: [],
    fin: { unit: 'ریال', budget: chance(0.5) ? ri(1, 50) * 100000 : 0, eac: pick(['cpi', 'rem', 'both']) },
    costs,
    ch: chance(0.6) ? { amount: ri(1, 90) * 1000000, comPct: ri(0, 5), retAmt: ri(0, 9) * 1000000, comRetPct: ri(0, 5), paid: ri(0, 50) * 1000000 } : {},
    end: chance(0.5) ? dayAt(ri(30, 450)) : '',
    docs: [],
    bh: [],
    issues: [],
    changes: [],
    decisions: [],
  };
}
