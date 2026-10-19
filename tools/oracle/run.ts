/**
 * آزمون تفاضلی (differential): همان پروژه‌ی تصادفی را (۱) در برنامه‌ی قدیمی داخل Chromium و (۲) با هسته‌ی جدید محاسبه می‌کند
 * و خروجی‌ها را مقایسه می‌کند. برنامه‌ی قدیمی «مرجع» است؛ هر اختلاف باید یا اصلاح شود یا در docs/divergences.md ثبت شود.
 *
 * اجرا:  node tools/oracle/run.ts --count 500 --seed 1
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { analyzeProject, computeSchedule, computeUtilization, countOverbooked, importLegacyProject, levelResources } from '../../packages/core/src/index.ts';
import type { Analysis, ProjectModel } from '../../packages/core/src/index.ts';
import { genLegacyProject, type GenOptions } from './gen.ts';

// در CI بسته‌ی playwright نصب است؛ در محیط‌های بدون registry مسیر نصب سراسری با PLAYWRIGHT_PATH داده می‌شود.
async function loadPlaywright(): Promise<typeof import('playwright')> {
  try {
    return await import('playwright');
  } catch {
    return (await import(process.env.PLAYWRIGHT_PATH ?? '/opt/npm-tools/node_modules/playwright/index.mjs')) as typeof import('playwright');
  }
}
const { chromium } = await loadPlaywright();

const arg = (name: string, def: string): string => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? (process.argv[i + 1] as string) : def;
};
const COUNT = Number(arg('count', '200'));
const SEED0 = Number(arg('seed', '1'));
const MAX_TASKS = Number(arg('maxTasks', '40'));
const SUMMARY_ACTUALS = arg('summaryActuals', '0') === '1';
const HTML = resolve(arg('html', 'reference/bistoon-v34.html'));
const OUT = arg('out', '');

type Json = Record<string, any>;

const PAGE_FN = `(raw) => {
  const f = fix(JSON.parse(JSON.stringify(raw)));
  if (!f) return { fixnull: true };
  S = f; mk();
  const r = calc();
  if (r.err) return { err: true };
  R = r;
  const u = (v) => (v === undefined ? null : v);
  const m = met();
  const res = {
    wdlen: wd.length, PF: r.PF,
    tasks: S.tasks.map((t) => ({ id: t.id, ES: t.ES, EF: t.EF, LS: t.LS, LF: t.LF, TF: t.TF, D: t.D, pp: t.pp, cr: !!t.cr, sd: u(t.sd), fd: u(t.fd) })),
    met: { act: m.act, pl: m.pl, bf: m.bf, ff: m.ff, delay: m.delay, dl: m.dl.map((t) => t.id), sw: m.sw, sti: m.sti },
    fmet: fmet(),
  };
  const sc = scData(m);
  res.sc = { n: sc.n, s0: sc.s0, pl: sc.pl, ac: sc.ac.map((a) => [a[0], a[1]]), fc: sc.fc, pS: sc.pS, end: sc.end };
  if (r.PF < wd.length - 5) {
    res.util = util();
    const countAll = () => { const sk = new Set(); let n = 0, c; while ((c = conflicts(sk)) && n < 5000) { sk.add(c.n + '\\u0001' + c.i); n += 1; } return n; };
    res.overbookedBefore = countAll();
    try {
      res.level = level();
      const keep = S.tasks.map((t) => t.snet);
      res.level.sug.forEach((s) => { const t = S.tasks.find((x) => x.id == s.id); if (t) t.snet = s.snet; });
      calc();
      res.levelOldOverbooked = countAll();
      S.tasks.forEach((t, i) => { t.snet = keep[i]; });
      calc();
    } catch (e) { res.levelErr = String(e); }
  }
  return res;
}`;

const same = (a: unknown, b: unknown): boolean => {
  if (typeof a === 'number' && typeof b === 'number') {
    if (Number.isNaN(a) && Number.isNaN(b)) return true;
    if (a === b) return true;
    return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(a), Math.abs(b));
  }
  return a === b || (a == null && b == null);
};

interface Diff {
  seed: number;
  where: string;
  old: unknown;
  neu: unknown;
}

function compare(seed: number, old: Json, model: ProjectModel, an: Analysis, diffs: Diff[]): void {
  const d = (where: string, o: unknown, n: unknown): void => {
    if (!same(o, n)) diffs.push({ seed, where, old: o, neu: n });
  };
  const s = an.schedule;
  d('PF', old.PF, s.projectFinish);
  d('wdlen', old.wdlen, s.axis.length);
  d('tasks.length', old.tasks.length, s.tasks.length);
  for (const ot of old.tasks as Json[]) {
    const nt = s.byId.get(ot.id);
    if (!nt) {
      diffs.push({ seed, where: `task ${ot.id} missing`, old: ot, neu: null });
      continue;
    }
    const w = `task ${ot.id}`;
    d(`${w}.ES`, ot.ES, nt.earlyStart);
    d(`${w}.EF`, ot.EF, nt.earlyFinish);
    d(`${w}.LS`, ot.LS, nt.lateStart);
    d(`${w}.LF`, ot.LF, nt.lateFinish);
    d(`${w}.TF`, ot.TF, nt.totalFloat);
    d(`${w}.D`, ot.D, nt.duration);
    d(`${w}.pp`, ot.pp, nt.percent);
    d(`${w}.cr`, ot.cr, nt.critical);
    d(`${w}.sd`, ot.sd, nt.startDate);
    d(`${w}.fd`, ot.fd, nt.finishDate);
  }
  const m = an.progress;
  d('met.act', old.met.act, m.actual);
  d('met.pl', old.met.pl, m.planned);
  d('met.bf', old.met.bf, m.baselineFinish);
  d('met.ff', old.met.ff, m.forecastFinish);
  d('met.delay', old.met.delay, m.delay);
  d('met.dl', JSON.stringify(old.met.dl), JSON.stringify(m.delayedTaskIds));
  d('met.sw', old.met.sw, m.totalWeight);
  d('met.sti', old.met.sti, m.statusIndex);
  const f = an.finance;
  const fm: Record<string, number | null> = { OH: f.overhead, COST: f.totalActualWithOverhead, FC: f.forecastWithOverhead, BAC: f.bac, CUR: f.currentPlanned, AC: f.ac, EV: f.ev, PV: f.pv, CV: f.cv, SV: f.sv, CPI: f.cpi, SPI: f.spi, EAC: f.eac, ETC: f.etc, VAC: f.vac, TCPI: f.tcpi, sti: f.statusIndex };
  for (const [k, v] of Object.entries(fm)) d(`fmet.${k}`, old.fmet[k], v);
  const c = an.scurve;
  d('sc.n', old.sc.n, c.length);
  d('sc.s0', old.sc.s0, c.statusX);
  d('sc.pS', old.sc.pS, c.plannedAtStatus);
  d('sc.end', old.sc.end, c.contractEndX);
  d('sc.pl.len', old.sc.pl.length, c.planned.length);
  old.sc.pl.forEach((p: number[], i: number) => {
    const q = c.planned[i];
    if (q) {
      d(`sc.pl[${i}].x`, p[0], q[0]);
      d(`sc.pl[${i}].y`, p[1], q[1]);
    }
  });
  d('sc.ac.len', old.sc.ac.length, c.actual.length);
  old.sc.ac.forEach((p: number[], i: number) => {
    const q = c.actual[i];
    if (q) {
      d(`sc.ac[${i}].x`, p[0], q.x);
      d(`sc.ac[${i}].y`, p[1], q.y);
    }
  });
  d('sc.fc.len', old.sc.fc.length, c.forecast.length);
  old.sc.fc.forEach((p: number[], i: number) => {
    const q = c.forecast[i];
    if (q) {
      d(`sc.fc[${i}].x`, p[0], q[0]);
      d(`sc.fc[${i}].y`, p[1], q[1]);
    }
  });
  if (old.util) {
    const names = new Map(model.resources.map((r) => [r.id, r.name]));
    const nu = computeUtilization(model.tasks, s, model.resources);
    const flat = new Map<string, number>();
    for (const [rid, wk] of nu.load) for (const [w, v] of wk) flat.set(`${names.get(rid)}|${w}`, v);
    const oflat = new Map<string, number>();
    for (const [name, wk] of Object.entries(old.util.out as Json)) for (const [w, v] of Object.entries(wk as Json)) oflat.set(`${name}|${w}`, v as number);
    d('util.size', oflat.size, flat.size);
    for (const [k, v] of oflat) d(`util[${k}]`, v, flat.get(k) ?? null);
  }
  if (old.level) {
    // الگوریتم تسطیح عمداً عوض شده (docs/divergences.md D-002)؛ به‌جای برابری، ناوردایی‌ها بررسی می‌شوند.
    const input = { start: model.start, status: model.status, calendar: model.calendar, tasks: model.tasks };
    const lv = levelResources(input, model.resources);
    if (!lv) {
      diffs.push({ seed, where: 'level.null', old: old.level, neu: null });
      return;
    }
    const again = levelResources(input, model.resources);
    d('level.deterministic', JSON.stringify(lv), JSON.stringify(again));
    const applied = model.tasks.map((t) => {
      const sg = lv.suggestions.find((q) => q.taskId === t.id);
      return sg ? { ...t, startNoEarlierThan: sg.startNoEarlierThan } : t;
    });
    const after = computeSchedule({ ...input, tasks: applied });
    if (!after.ok) diffs.push({ seed, where: 'level.cycle-after', old: null, neu: null });
    else {
      const left = countOverbooked(applied, after, model.resources);
      d('level.unresolved-matches-count', left, lv.unresolved);
      d('level.finish-consistent', after.projectFinish, lv.finishAfter);
      if (lv.finishAfter < lv.finishBefore) diffs.push({ seed, where: 'level.finish-decreased', old: lv.finishBefore, neu: lv.finishAfter });
      for (const sg of lv.suggestions) {
        const t = model.tasks.find((x) => x.id === sg.taskId);
        if (t && (t.actualStart || t.actualFinish || t.kind === 'milestone')) diffs.push({ seed, where: 'level.moved-fixed-task', old: null, neu: sg.taskId });
        if (sg.delayDays <= 0) diffs.push({ seed, where: 'level.non-positive-delay', old: null, neu: sg });
      }
      levelStats.projects += 1;
      levelStats.oldLeft += old.levelOldOverbooked ?? 0;
      levelStats.newLeft += left;
      levelStats.before += old.overbookedBefore ?? 0;
      levelStats.oldFinish += old.level.f1 - old.level.f0;
      levelStats.newFinish += lv.finishAfter - lv.finishBefore;
      if ((old.levelOldOverbooked ?? 0) > 0 && old.level.unres === 0) levelStats.oldSilentFail += 1;
      if (left > (old.levelOldOverbooked ?? 0)) {
        levelStats.newWorse += 1;
        worse.push({ seed, before: old.overbookedBefore, oldLeft: old.levelOldOverbooked, newLeft: left, oldFinish: old.level.f1 - old.level.f0, newFinish: lv.finishAfter - lv.finishBefore });
      }
    }
  }
}

const browser = await chromium.launch({ args: ['--no-sandbox'] });
const page = await browser.newPage();
const pageErrors: string[] = [];
page.on('pageerror', (e) => pageErrors.push(String(e)));
page.on('dialog', (dlg) => void dlg.accept());
await page.goto(`file://${HTML}`);
await page.waitForTimeout(500);

const diffs: Diff[] = [];
const worse: Record<string, unknown>[] = [];
const levelStats = { projects: 0, before: 0, oldLeft: 0, newLeft: 0, oldFinish: 0, newFinish: 0, oldSilentFail: 0, newWorse: 0 };
let cycles = 0;
let compared = 0;
let leveled = 0;
let moved = 0;
const opts: GenOptions = { maxTasks: MAX_TASKS, summaryActuals: SUMMARY_ACTUALS };
const t0 = Date.now();
for (let i = 0; i < COUNT; i += 1) {
  const seed = SEED0 + i;
  const raw = genLegacyProject(seed, opts);
  const old = (await page.evaluate(`(${PAGE_FN})(${JSON.stringify(raw)})`)) as Json;
  const imp = importLegacyProject(raw, { today: '2026-06-01' });
  if ('error' in imp) {
    diffs.push({ seed, where: 'import', old: null, neu: imp.error });
    continue;
  }
  const an = analyzeProject(imp.model);
  if (old.err || !an.schedule) {
    cycles += 1;
    if (Boolean(old.err) !== !an.schedule) diffs.push({ seed, where: 'cycle-detect', old: Boolean(old.err), neu: !an.schedule });
    continue;
  }
  compared += 1;
  if (old.level) {
    leveled += 1;
    moved += old.level.sug.length;
  }
  compare(seed, old, imp.model, an, diffs);
}
await browser.close();

console.log(JSON.stringify({ count: COUNT, seed0: SEED0, compared, cycles, leveled, movedTasks: moved, diffs: diffs.length, ms: Date.now() - t0, pageErrors: pageErrors.slice(0, 3) }));
const bySeed = new Map<number, Diff[]>();
for (const x of diffs) bySeed.set(x.seed, [...(bySeed.get(x.seed) ?? []), x]);
console.log(`projects with diffs: ${bySeed.size}`);
console.log('leveling:', JSON.stringify(levelStats));
if (worse.length) console.log('new worse than old:', JSON.stringify(worse));
let shown = 0;
for (const [seed, xs] of bySeed) {
  if (shown++ >= 5) break;
  console.log(`seed ${seed}: ${xs.length} diffs`);
  for (const x of xs.slice(0, 6)) console.log('  ', x.where, 'old=', JSON.stringify(x.old), 'new=', JSON.stringify(x.neu));
}
if (OUT) {
  mkdirSync(resolve(OUT, '..'), { recursive: true });
  writeFileSync(OUT, JSON.stringify(diffs.slice(0, 200), null, 1));
}
process.exit(diffs.length ? 1 : 0);
