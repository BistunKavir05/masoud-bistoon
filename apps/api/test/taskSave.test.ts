import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { newTask } from '@bistoon/core';
import type { Task } from '@bistoon/core';
import { poolDb, withTx } from '../src/db.ts';
import { loadTasks, saveTasks } from '../src/services/store.ts';
import { buildWorld, startEnv } from './helpers.ts';
import type { TestEnv, World } from './helpers.ts';

let env: TestEnv;
let w: World;
let adminId = 0;
beforeAll(async () => {
  env = await startEnv();
  w = await buildWorld(env);
  adminId = Number((await env.pool.query<{ id: number }>('SELECT id FROM users ORDER BY id LIMIT 1')).rows[0]!.id);
  await env.pool.query('DELETE FROM tasks WHERE project_id = $1', [w.pid]);
});
afterAll(async () => env.close());

const db = () => poolDb(env.pool);
/** یکتایی جایگاه تا پایان «تراکنش» به تعویق می‌افتد؛ مسیرهای واقعی همیشه داخل تراکنش ذخیره می‌کنند */
const save = (before: readonly Task[], after: readonly Task[]) => withTx(env.pool, (tx) => saveTasks(tx, w.pid, before, after, adminId));

/** ۹۰۰ فعالیت: ۹ گروه × (۱ خلاصه + ۹۹ فعالیت)؛ فعالیت‌ها زنجیره‌ی وابستگی، تخصیص و هزینه‌ی مستقیم دارند (بیش از دو دسته‌ی درج ۴۰۰تایی) */
function bigList(): Task[] {
  const list: Task[] = [];
  let id = 0;
  for (let g = 0; g < 9; g++) {
    const head = newTask(++id, 1, 'summary', `گروه ${g + 1}`);
    list.push(head);
    for (let k = 0; k < 99; k++) {
      const t = newTask(++id, 2, 'task', `فعالیت ${g + 1}-${k + 1}`);
      t.duration = 1 + (k % 5);
      if (k > 0) t.dependencies = [{ predecessorId: id - 1, type: 'FS', lag: k % 3 }];
      if (k % 10 === 0) t.assignments = [{ resourceId: w.expResourceId, units: 50 }];
      if (k % 25 === 0) t.directCosts = [{ name: 'مصالح', amount: 1000 + k }, { name: 'حمل', amount: 250 }];
      list.push(t);
    }
  }
  return list;
}

const strip = (t: { version?: number } & Record<string, unknown>) => {
  const { version: _v, ...rest } = t;
  return rest;
};

describe('ذخیره‌ی دسته‌ای فعالیت‌ها', () => {
  let saved: Awaited<ReturnType<typeof loadTasks>> = [];

  it('درج دسته‌ای ۹۰۰ فعالیت با وابستگی، تخصیص و هزینه‌ی مستقیم، و خواندن همان داده', async () => {
    const list = bigList();
    const r = await save([], list);
    expect(r.inserted.length).toBe(900);
    saved = await loadTasks(db(), w.pid);
    expect(saved.length).toBe(900);
    expect(saved.map((t) => t.id)).toEqual(list.map((t) => t.id));
    const t11 = saved.find((t) => t.id === 11)!; // k = 9 در گروه اول
    expect(t11.dependencies).toEqual([{ predecessorId: 10, type: 'FS', lag: 0 }]);
    const t2 = saved.find((t) => t.id === 2)!; // k = 0
    expect(t2.assignments).toEqual([{ resourceId: w.expResourceId, units: 50 }]);
    expect(t2.directCosts).toEqual([{ name: 'مصالح', amount: 1000 }, { name: 'حمل', amount: 250 }]);
    expect(saved.every((t) => t.version === 1)).toBe(true);
  });

  it('درج در ابتدای فهرست: جایگاه همه جابه‌جا می‌شود ولی داده‌ی فرزند و نسخه‌ی ردیف‌های جابه‌جاشده دست‌نخورده می‌ماند', async () => {
    const before = await loadTasks(db(), w.pid);
    const fresh = newTask(901, 1, 'task', 'تازه در ابتدا');
    const after = [fresh, ...before.map(asTask)];
    const r = await save(before.map(asTask), after);
    expect(r.inserted).toEqual([901]);
    expect(r.updated).toEqual([]);
    const now = await loadTasks(db(), w.pid);
    expect(now.length).toBe(901);
    expect(now[0]!.id).toBe(901);
    expect(now.slice(1).map((t) => t.id)).toEqual(before.map((t) => t.id));
    // محتوا و نسخه‌ی ردیف‌های جابه‌جاشده تغییر نکرده است
    expect(now.slice(1).map((t) => strip(t as never))).toEqual(before.map((t) => strip(t as never)));
    expect(now.slice(1).every((t) => t.version === 1)).toBe(true);
    // جایگاه‌ها پیوسته‌اند
    const pos = await env.pool.query<{ p: number }>('SELECT position AS p FROM tasks WHERE project_id = $1 ORDER BY position', [w.pid]);
    expect(pos.rows.map((x) => Number(x.p))).toEqual(Array.from({ length: 901 }, (_, i) => i + 1));
    saved = now;
  });

  it('تغییر محتوا نسخه را بالا می‌برد و وابستگی/تخصیص/هزینه را از نو می‌نویسد؛ بقیه دست نمی‌خورند', async () => {
    const before = saved.map(asTask);
    const after = before.map((t) => ({ ...t }));
    const i = after.findIndex((t) => t.id === 2);
    after[i] = { ...after[i]!, name: 'نام تازه', assignments: [], directCosts: [{ name: 'فقط یکی', amount: 5 }], dependencies: [{ predecessorId: 3, type: 'SS', lag: 2 }] };
    const j = after.findIndex((t) => t.id === 12);
    after[j] = { ...after[j]!, dependencies: [] };
    const r = await save(before, after);
    expect(r.updated.slice().sort((x, y) => x - y)).toEqual([2, 12]);
    const now = await loadTasks(db(), w.pid);
    const t2 = now.find((t) => t.id === 2)!;
    expect(t2.name).toBe('نام تازه');
    expect(t2.version).toBe(2);
    expect(t2.assignments).toEqual([]);
    expect(t2.directCosts).toEqual([{ name: 'فقط یکی', amount: 5 }]);
    expect(t2.dependencies).toEqual([{ predecessorId: 3, type: 'SS', lag: 2 }]);
    expect(now.find((t) => t.id === 12)!.dependencies).toEqual([]);
    // فعالیتی دیگر با تخصیص همچنان دست‌نخورده است
    const t22 = now.find((t) => t.id === 22)!;
    expect(t22.version).toBe(1);
    expect(t22.assignments).toEqual([{ resourceId: w.expResourceId, units: 50 }]);
    saved = now;
  });

  it('حذف زیردرخت و درج هم‌زمان در همان ذخیره: جایگاه‌ها پیوسته و وابستگی‌های معلق پاک می‌شوند', async () => {
    const before = saved.map(asTask);
    // گروه اول (شناسه‌ی ۱) و زیردرختش حذف می‌شود؛ یک فعالیت تازه وسط گروه سوم درج می‌شود
    const keep = before.filter((t) => !(t.id >= 1 && t.id <= 100));
    const at = keep.findIndex((t) => t.id === 250);
    const fresh = newTask(902, 2, 'task', 'درج میانی');
    const after = [...keep.slice(0, at), fresh, ...keep.slice(at)];
    const r = await save(before, after);
    expect(r.deleted.length).toBe(100);
    expect(r.inserted).toEqual([902]);
    const now = await loadTasks(db(), w.pid);
    expect(now.length).toBe(after.length);
    expect(now.map((t) => t.id)).toEqual(after.map((t) => t.id));
    const pos = await env.pool.query<{ p: number }>('SELECT position AS p FROM tasks WHERE project_id = $1 ORDER BY position', [w.pid]);
    expect(pos.rows.map((x) => Number(x.p))).toEqual(Array.from({ length: after.length }, (_, i) => i + 1));
    const deps = await env.pool.query<{ n: number }>('SELECT count(*)::int AS n FROM task_dependencies WHERE project_id = $1 AND (task_id <= 100 OR predecessor_id <= 100)', [w.pid]);
    expect(deps.rows[0]!.n).toBe(0);
  });
});

/** TaskDto → Task (همان ساختار؛ فیلد version اضافه است و نادیده گرفته می‌شود) */
function asTask(t: Awaited<ReturnType<typeof loadTasks>>[number]): Task {
  return t as unknown as Task;
}
