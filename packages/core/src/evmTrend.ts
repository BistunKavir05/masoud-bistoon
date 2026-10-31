/**
 * روند شاخص‌های ارزش کسب‌شده (EVM) در گزارش‌های پیشرفت: به‌ازای هر گزارش ثبت‌شده/تخمینی و وضعیت فعلی یک ردیف.
 *
 * مبنای محاسبه (مثل جدول مدیریت پروژه‌ی اکسل و منحنی S): PV = BAC × درصد برنامه‌ای و EV = BAC × درصد واقعی (درصدهای وزنی گزارش).
 * AC هزینه‌ی واقعیِ ثبت‌شده در همان گزارش است (شامل سربار)؛ گزارش‌های تخمینی و گزارش‌های قدیمی بدون AC، شاخص‌های وابسته به هزینه را ندارند.
 * به همین دلیل ممکن است اعداد ردیف «وضعیت فعلی» اندکی با کارت‌های زنده‌ی تب مالی (که EV را هزینه‌وزنی حساب می‌کند و سربار را در AC نمی‌آورد) تفاوت داشته باشند.
 */
import type { IsoDate } from './date.ts';
import type { EacMethod } from './finance.ts';
import type { SnapshotRow, SnapshotRowKind } from './snapshots.ts';
import type { Snapshot } from './types.ts';

export interface EvmPoint {
  date: IsoDate;
  kind: SnapshotRowKind;
  /** درصد برنامه‌ای و واقعی که مبنای محاسبه بوده */
  plannedPercent: number;
  actualPercent: number;
  pv: number;
  ev: number;
  /** null = هزینه‌ی واقعی برای این گزارش ثبت نشده است */
  ac: number | null;
  sv: number;
  spi: number | null;
  cv: number | null;
  cpi: number | null;
  eac: number | null;
  etc: number | null;
  vac: number | null;
  tcpi: number | null;
}

const NO_COST = { cv: null, cpi: null, eac: null, etc: null, vac: null, tcpi: null } as const;

/** شاخص‌های یک نقطه از PV/EV/AC/BAC و روش پیش‌بینی (همان فرمول‌های `computeFinance`) */
export function evmPoint(args: { bac: number; pv: number; ev: number; ac: number | null; method: EacMethod }): Omit<EvmPoint, 'date' | 'kind' | 'plannedPercent' | 'actualPercent'> {
  const { bac, pv, ev, ac, method } = args;
  const spi = pv > 0 ? ev / pv : null;
  const base = { pv, ev, ac, sv: ev - pv, spi };
  if (ac === null) return { ...base, ...NO_COST };
  const cpi = ac > 0 ? ev / ac : null;
  const remaining = bac - ev;
  let eac: number | null;
  if (method === 'remaining') eac = ac + remaining;
  else if (method === 'both') eac = cpi && spi ? ac + remaining / (cpi * spi) : ac + remaining;
  else eac = cpi ? bac / cpi : bac;
  return { ...base, cv: ev - ac, cpi, eac, etc: eac - ac, vac: bac - eac, tcpi: bac !== ac ? (bac - ev) / (bac - ac) : null };
}

export function computeEvmTrend(args: {
  rows: readonly SnapshotRow[];
  snapshots: readonly Snapshot[];
  /** هزینه‌ی واقعی زنده شامل سربار، برای ردیف «وضعیت فعلی» */
  currentAc: number;
  bac: number;
  method: EacMethod;
}): EvmPoint[] {
  const { rows, snapshots, currentAc, bac, method } = args;
  const costOf = new Map(snapshots.filter((s) => !s.estimated && s.actualCost !== undefined).map((s) => [s.date, s.actualCost as number]));
  return rows.map((r) => {
    const ac = r.kind === 'current' ? currentAc : r.kind === 'recorded' ? (costOf.get(r.date) ?? null) : null;
    const pv = (bac * r.planned) / 100;
    const ev = (bac * r.actual) / 100;
    return { date: r.date, kind: r.kind, plannedPercent: r.planned, actualPercent: r.actual, ...evmPoint({ bac, pv, ev, ac, method }) };
  });
}
