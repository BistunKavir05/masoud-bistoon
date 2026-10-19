import { describe, expect, it } from 'vitest';
import { buildSnapshotRows, explainDrop } from '../src/snapshots.ts';
import type { Snapshot } from '../src/types.ts';
import { task } from './fixtures.ts';

const tasks = [task({ id: 1, name: 'الف', weight: 4 }), task({ id: 2, name: 'ب', weight: 6 }), task({ id: 3, name: 'گروه', kind: 'summary' })];
const snap = (date: string, per: Record<number, number> | undefined, estimated = false, extra: Partial<Snapshot> = {}): Snapshot => ({
  date: date as Snapshot['date'],
  actual: 0,
  estimated,
  ...(per ? { tasks: per } : {}),
  ...extra,
});
const current = { actual: 30, planned: 40, tasks: { 1: 50, 2: 16.7 } };

describe('جدول اسنپ‌شات‌ها', () => {
  it('ردیف «وضعیت فعلی» اضافه می‌شود و به ترتیب تاریخ است', () => {
    const rows = buildSnapshotRows({
      snapshots: [snap('2026-09-10', { 1: 100, 2: 0 }), snap('2026-09-05', { 1: 50, 2: 0 }, true)],
      tasks,
      status: '2026-09-15',
      current,
      plannedAt: () => 12,
    });
    expect(rows.map((r) => [r.date, r.kind])).toEqual([
      ['2026-09-05', 'estimated'],
      ['2026-09-10', 'recorded'],
      ['2026-09-15', 'current'],
    ]);
    expect(rows[0]!.actual).toBeCloseTo(20, 9);
    expect(rows[1]!.actual).toBeCloseTo(40, 9);
    expect(rows[0]!.planned).toBe(12);
    expect(rows[2]!.deviation).toBe(-10);
  });

  it('اگر در تاریخ وضعیت گزارش ثبت‌شده هست، ردیف فعلی نمی‌آید؛ تغییر بعد از ثبت علامت می‌خورد', () => {
    const rows = buildSnapshotRows({
      snapshots: [snap('2026-09-15', { 1: 100, 2: 0 }, false, { planned: 35 })],
      tasks,
      status: '2026-09-15',
      current,
      plannedAt: () => 99,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]!.planned).toBe(35);
    expect(rows[0]!.staleAgainstLive).toBe(true);
    const same = buildSnapshotRows({ snapshots: [snap('2026-09-15', { 1: 50, 2: 16.7 })], tasks, status: '2026-09-15', current, plannedAt: () => 0 });
    expect(same[0]!.staleAgainstLive).toBe(false);
  });

  it('افت پیشرفت نسبت به گزارش قبلی علامت می‌خورد؛ کاهش ناچیز نه', () => {
    const rows = buildSnapshotRows({
      snapshots: [snap('2026-09-05', { 1: 100, 2: 50 }), snap('2026-09-10', { 1: 100, 2: 20 }), snap('2026-09-12', { 1: 100, 2: 19.99 })],
      tasks,
      status: '2026-09-20',
      current: { actual: 70, planned: 70, tasks: { 1: 100, 2: 50 } },
      plannedAt: () => 0,
    });
    expect(rows.map((r) => r.dropFrom)).toEqual([null, '2026-09-05', null, null]);
  });

  it('گزارش بدون جزئیات: مقدار ثبت‌شده به‌کار می‌رود و tasks تهی است', () => {
    const rows = buildSnapshotRows({ snapshots: [snap('2026-09-05', undefined, false, { actual: 33 })], tasks, status: '2026-09-20', current, plannedAt: () => 0 });
    expect(rows[0]!.actual).toBe(33);
    expect(rows[0]!.tasks).toBeNull();
  });
});

describe('علت افت پیشرفت', () => {
  it('فعالیت‌های کم‌شده به ترتیب سهم در افت می‌آیند', () => {
    const e = explainDrop({ date: '2026-09-05', tasks: { 1: 100, 2: 50 } }, { date: '2026-09-10', tasks: { 1: 90, 2: 20 } }, tasks);
    expect(e.available).toBe(true);
    if (!e.available) return;
    expect(e.items.map((i) => i.taskId)).toEqual([2, 1]);
    expect(e.items[0]!.impact).toBeCloseTo(18, 9);
    expect(e.items[1]!.impact).toBeCloseTo(4, 9);
    expect(e.fromActual).toBeCloseTo(70, 9);
    expect(e.toActual).toBeCloseTo(48, 9);
  });

  it('بدون جزئیات: پیام روشن و نه خطا', () => {
    const e = explainDrop({ date: '2026-09-05', tasks: null }, { date: '2026-09-10', tasks: { 1: 1 } }, tasks);
    expect(e.available).toBe(false);
    if (e.available) return;
    expect(e.message).toContain('جزئیات');
  });

  it('افت فقط از تغییر وزن: فهرست خالی ولی available', () => {
    const changed = [task({ id: 1, name: 'الف', weight: 10 }), task({ id: 2, name: 'ب', weight: 1 })];
    const e = explainDrop({ date: '2026-09-05', tasks: { 1: 10, 2: 100 } }, { date: '2026-09-10', tasks: { 1: 10, 2: 100 } }, changed);
    expect(e.available && e.items.length).toBe(0);
  });

  it('فعالیت حذف‌شده یا خلاصه در توضیح نمی‌آید', () => {
    const e = explainDrop({ date: '2026-09-05', tasks: { 1: 50, 2: 0, 3: 80, 9: 100 } }, { date: '2026-09-10', tasks: { 1: 50, 2: 0 } }, tasks);
    expect(e.available && e.items).toEqual([]);
  });
});
