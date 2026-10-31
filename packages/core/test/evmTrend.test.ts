import { describe, expect, it } from 'vitest';
import { computeEvmTrend, evmPoint } from '../src/evmTrend.ts';
import type { SnapshotRow } from '../src/snapshots.ts';
import type { Snapshot } from '../src/types.ts';

const row = (date: string, kind: SnapshotRow['kind'], planned: number, actual: number): SnapshotRow => ({ date, kind, planned, actual, deviation: actual - planned, tasks: null, dropFrom: null, staleAgainstLive: false });
const close = (a: number | null, b: number): void => expect(Math.abs((a ?? NaN) - b) < 1e-9).toBe(true);

describe('شاخص‌های EVM یک نقطه', () => {
  it('روش باقی‌مانده: EAC = AC + (BAC − EV)', () => {
    const p = evmPoint({ bac: 1000, pv: 400, ev: 300, ac: 450, method: 'remaining' });
    expect(p.sv).toBe(-100);
    expect(p.cv).toBe(-150);
    close(p.spi, 0.75);
    close(p.cpi, 300 / 450);
    expect(p.eac).toBe(1150);
    expect(p.etc).toBe(700);
    expect(p.vac).toBe(-150);
    close(p.tcpi, 700 / 550);
  });

  it('روش CPI و ترکیبی', () => {
    const cpi = evmPoint({ bac: 1000, pv: 400, ev: 300, ac: 450, method: 'cpi' });
    close(cpi.eac, 1000 / (300 / 450));
    const both = evmPoint({ bac: 1000, pv: 400, ev: 300, ac: 450, method: 'both' });
    close(both.eac, 450 + 700 / ((300 / 450) * 0.75));
  });

  it('بدون هزینه‌ی واقعی شاخص‌های هزینه‌ای تهی‌اند؛ PV صفر → SPI تهی؛ AC صفر → CPI تهی', () => {
    const noCost = evmPoint({ bac: 1000, pv: 400, ev: 300, ac: null, method: 'remaining' });
    expect([noCost.cv, noCost.cpi, noCost.eac, noCost.etc, noCost.vac, noCost.tcpi]).toEqual([null, null, null, null, null, null]);
    expect(noCost.sv).toBe(-100);
    expect(evmPoint({ bac: 1000, pv: 0, ev: 0, ac: 0, method: 'remaining' })).toMatchObject({ spi: null, cpi: null, eac: 1000 });
  });
});

describe('روند EVM', () => {
  const snaps: Snapshot[] = [
    { date: '2026-09-01', actual: 10, planned: 12, estimated: false, actualCost: 120 },
    { date: '2026-09-08', actual: 20, planned: 25, estimated: true },
    { date: '2026-09-15', actual: 40, planned: 45, estimated: false },
  ];
  const rows = [row('2026-09-01', 'recorded', 12, 10), row('2026-09-08', 'estimated', 25, 20), row('2026-09-15', 'recorded', 45, 40), row('2026-09-20', 'current', 50, 45)];

  it('PV و EV از BAC × درصد؛ AC فقط برای ثبت‌شده‌ی دارای هزینه و وضعیت فعلی', () => {
    const t = computeEvmTrend({ rows, snapshots: snaps, currentAc: 500, bac: 2000, method: 'remaining' });
    expect(t.map((p) => p.date)).toEqual(['2026-09-01', '2026-09-08', '2026-09-15', '2026-09-20']);
    expect(t.map((p) => p.pv)).toEqual([240, 500, 900, 1000]);
    expect(t.map((p) => p.ev)).toEqual([200, 400, 800, 900]);
    expect(t.map((p) => p.ac)).toEqual([120, null, null, 500]);
    expect(t[1]!.cpi).toBeNull();
    expect(t[1]!.sv).toBe(-100);
    close(t[0]!.cpi, 200 / 120);
    expect(t[3]).toMatchObject({ cv: 400, sv: -100, eac: 500 + 1100, vac: 2000 - 1600 });
  });

  it('بدون ردیف، خروجی خالی', () => {
    expect(computeEvmTrend({ rows: [], snapshots: [], currentAc: 0, bac: 0, method: 'remaining' })).toEqual([]);
  });
});
