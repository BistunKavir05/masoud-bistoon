/** داده‌ی نمونه‌ی آزمون: یک پروژه‌ی کوچک ولی واقع‌گرایانه که از API واقعی ساخته می‌شود. */
import type { ApiSession } from './harness.ts';

export interface SeedIds {
  pid: number;
  /** نام فعالیت → شناسه */
  tasks: Record<string, number>;
  resources: Record<string, number>;
}

export interface SeedOptions {
  name?: string;
  start?: string;
  status?: string;
  contractEnd?: string;
  /** ثبت خط مبنا در پایان */
  baseline?: boolean;
}

export async function seedProject(api: ApiSession, opts: SeedOptions = {}): Promise<SeedIds> {
  const created = await api.call<{ project: { id: number } }>(
    'POST',
    '/projects',
    { name: opts.name ?? 'پروژه‌ی نمونه', start: opts.start ?? '2026-09-12', status: opts.status ?? '2026-10-19', contractEnd: opts.contractEnd ?? '2027-03-20', finance: { unit: 'ریال' } },
    201,
  );
  const pid = created.project.id;
  let sv = (await api.call<{ project: { structureVersion: number } }>('GET', `/projects/${pid}`)).project.structureVersion;
  const ids: Record<string, number> = {};

  const add = async (name: string, kind: 'task' | 'summary' | 'milestone', ref: string | null, asChild: boolean): Promise<number> => {
    const r = await api.call<{ newId: number; structureVersion: number }>('POST', `/projects/${pid}/tasks`, { referenceId: ref ? ids[ref]! : null, asChild, kind, name, structureVersion: sv });
    sv = r.structureVersion;
    ids[name] = r.newId;
    return r.newId;
  };
  const patch = async (name: string, p: Record<string, unknown>): Promise<void> => {
    const m = await api.call<{ tasks: { id: number; version: number }[] }>('GET', `/projects/${pid}/model`);
    const t = m.tasks.find((x) => x.id === ids[name])!;
    await api.call('PATCH', `/projects/${pid}/tasks/${ids[name]}`, { version: t.version, patch: p });
  };

  // مرحله ۱: مهندسی
  await add('مهندسی', 'summary', null, false);
  await add('طراحی مفهومی', 'task', 'مهندسی', true);
  await add('طراحی تفصیلی', 'task', 'طراحی مفهومی', false);
  await add('تأیید طراحی', 'milestone', 'طراحی تفصیلی', false);
  // مرحله ۲: تأمین و ساخت
  await add('ساخت', 'summary', 'مهندسی', false);
  await add('تأمین مواد', 'task', 'ساخت', true);
  await add('ساخت قطعات', 'task', 'تأمین مواد', false);
  await add('مونتاژ', 'task', 'ساخت قطعات', false);
  await add('تحویل نهایی', 'milestone', 'ساخت', false);

  const res: Record<string, number> = {};
  for (const r of [
    { name: 'مهندس طراح', type: 'human', capacityPercent: 100, dailyRate: 2_000_000 },
    { name: 'تکنسین ساخت', type: 'human', capacityPercent: 100, dailyRate: 1_200_000 },
    { name: 'دستگاه CNC', type: 'equipment', capacityPercent: 100, dailyRate: 500_000 },
  ]) {
    const x = await api.call<{ item: { id: number } }>('POST', `/projects/${pid}/resources`, r, 201);
    res[r.name] = x.item.id;
  }

  await patch('طراحی مفهومی', { duration: 10, weight: 10, assignments: [{ resourceId: res['مهندس طراح']!, units: 100 }] });
  await patch('طراحی تفصیلی', { duration: 20, weight: 20, dependencies: [{ predecessorId: ids['طراحی مفهومی']!, type: 'FS', lag: 0 }], assignments: [{ resourceId: res['مهندس طراح']!, units: 100 }] });
  await patch('تأیید طراحی', { dependencies: [{ predecessorId: ids['طراحی تفصیلی']!, type: 'FS', lag: 0 }] });
  await patch('تأمین مواد', { duration: 15, weight: 15, dependencies: [{ predecessorId: ids['تأیید طراحی']!, type: 'FS', lag: 0 }], directCosts: [{ name: 'ورق فولاد', amount: 40_000_000 }] });
  await patch('ساخت قطعات', { duration: 25, weight: 25, dependencies: [{ predecessorId: ids['تأمین مواد']!, type: 'FS', lag: 0 }], assignments: [{ resourceId: res['تکنسین ساخت']!, units: 100 }, { resourceId: res['دستگاه CNC']!, units: 100 }] });
  await patch('مونتاژ', { duration: 10, weight: 10, dependencies: [{ predecessorId: ids['ساخت قطعات']!, type: 'FS', lag: 0 }], assignments: [{ resourceId: res['تکنسین ساخت']!, units: 100 }] });
  await patch('تحویل نهایی', { dependencies: [{ predecessorId: ids['مونتاژ']!, type: 'FS', lag: 0 }] });

  if (opts.baseline) await api.call('POST', `/projects/${pid}/baseline`, { label: 'خط مبنای اولیه' }, 201);
  return { pid, tasks: ids, resources: res };
}
