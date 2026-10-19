import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { applyTaskPatch, computeSchedule, deleteSubtree, guardCycle, indentTask, insertTask, moveTask, outdentTask } from '@bistoon/core';
import type { Capability, StructureResult, Task, TaskDto, TaskPatch } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import type { AuditEntry } from '../audit.ts';
import type { Db } from '../db.ts';
import { many, one, withTx } from '../db.ts';
import { badRequest, conflict, forbidden, notFound, versionConflict } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDateOrNull, posInt, text, version } from '../schemas.ts';
import { loadCalendar, loadTasks, lockProject, saveTasks } from '../services/store.ts';

const depSchema = z.object({ predecessorId: posInt, type: z.enum(['FS', 'SS', 'FF', 'SF']), lag: z.number().int().min(-10000).max(10000) });
const num = z.number().finite();

const patchSchema = z
  .object({
    name: z.string().max(300),
    duration: num,
    weight: num,
    percentComplete: num,
    actualStart: isoDateOrNull,
    actualFinish: isoDateOrNull,
    dependencies: z.array(depSchema).max(200),
    isMilestone: z.boolean(),
    work: num,
    assignments: z.array(z.object({ resourceId: posInt, units: num })).max(100),
    startNoEarlierThan: isoDateOrNull,
    deadline: isoDateOrNull,
    levelOfEffort: z.boolean(),
    directCosts: z.array(z.object({ name: z.string().max(80), amount: num })).max(100),
    legacyActualCost: num.nullable(),
    costTracked: z.boolean(),
  })
  .partial()
  .strict();

const patchBody = z.object({ version, patch: patchSchema });
const structureVersion = z.object({ structureVersion: version });
const insertBody = z.object({
  referenceId: posInt.nullable(),
  asChild: z.boolean(),
  kind: z.enum(['task', 'summary', 'milestone']),
  name: text(300),
  structureVersion: version,
});
const moveBody = z.object({ dir: z.union([z.literal(-1), z.literal(1)]), structureVersion: version });

const PROGRESS_FIELDS = new Set<keyof TaskPatch>(['percentComplete', 'actualStart', 'actualFinish']);

/** آیا این کاربر مجاز است این فیلدها را روی این فعالیت ویرایش کند؟ در غیر این‌صورت 403. */
function assertMayPatch(caps: readonly Capability[], ownResourceIds: readonly number[], task: Task, fields: string[]): void {
  const has = (c: Capability): boolean => caps.includes(c);
  if (has('schedule.edit')) return;
  const onlyProgress = fields.length > 0 && fields.every((f) => PROGRESS_FIELDS.has(f as keyof TaskPatch));
  if (onlyProgress && has('progress.update')) return;
  if (onlyProgress && has('progress.update.own')) {
    if (task.assignments.some((a) => ownResourceIds.includes(a.resourceId))) return;
    throw forbidden('فقط پیشرفت فعالیت‌هایی را که منبع شما به آن‌ها تخصیص دارد می‌توانید ثبت کنید.', 'NOT_YOUR_TASK');
  }
  throw forbidden('نقش شما اجازه‌ی ویرایش این بخش از فعالیت را ندارد.', 'FORBIDDEN', { fields });
}

export function tasksRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  /** اجرای یک عملیات ساختاری روی فهرست فعالیت‌ها داخل تراکنش با قفل پروژه و بررسی نسخه‌ی ساختار */
  async function structural(
    req: Request,
    res: Response,
    expectedStructureVersion: number,
    audit: (before: readonly Task[], after: readonly Task[], extra: Record<string, unknown>) => AuditEntry[],
    op: (tasks: readonly Task[], db: Db) => Promise<StructureResult<Record<string, unknown>>>,
  ): Promise<void> {
    const access = projectOf(req);
    const user = actorOf(req);
    const out = await withTx(pool, async (tx) => {
      const project = await lockProject(tx, access.id);
      if (project.structure_version !== expectedStructureVersion) {
        throw conflict('ساختار فعالیت‌ها در این فاصله تغییر کرده است؛ صفحه را تازه کنید.', 'STRUCTURE_CHANGED', { current: project.structure_version });
      }
      const before = await loadTasks(tx, access.id);
      const calendar = await loadCalendar(tx, access.id);
      const raw = await op(before, tx);
      const result = guardCycle(raw as StructureResult<{ tasks: Task[] }> as never, { start: project.start_date, status: project.status_date, calendar }) as StructureResult<Record<string, unknown>>;
      if (!result.ok) throw badRequest(result.message, { reason: result.error }, `STRUCTURE_${result.error}`);
      await saveTasks(tx, access.id, before, result.tasks, user.id);
      const bumped = await one<{ structure_version: number }>(
        tx,
        'UPDATE projects SET structure_version = structure_version + 1, updated_at = now(), updated_by = $2 WHERE id = $1 RETURNING structure_version',
        [access.id, user.id],
      );
      const { tasks: _t, ok: _ok, ...extra } = result;
      await writeAudit(tx, actorInfo(req), audit(before, result.tasks, extra));
      return { tasks: await loadTasks(tx, access.id), structureVersion: bumped!.structure_version, ...extra };
    });
    res.json(out);
  }

  const nameOf = (list: readonly Task[], id: number): string => list.find((t) => t.id === id)?.name ?? '';

  r.post('/tasks', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const b = insertBody.parse(req.body);
    const pid = projectOf(req).id;
    await structural(
      req,
      res,
      b.structureVersion,
      (_before, _after, extra) => [{ projectId: pid, action: 'task.insert', entity: 'task', entityId: String(extra['newId']), newValue: { name: b.name, kind: b.kind, referenceId: b.referenceId, asChild: b.asChild } }],
      async (tasks, tx) => {
        const next = await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [pid, 'task']);
        return insertTask(tasks, { referenceId: b.referenceId, asChild: b.asChild, kind: b.kind, name: b.name, newId: next!.n });
      },
    );
  });

  r.delete('/tasks/:id', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = structureVersion.parse(req.body);
    const pid = projectOf(req).id;
    await structural(
      req,
      res,
      b.structureVersion,
      (before, _after, extra) => {
        const removed = (extra['removedIds'] as number[]) ?? [];
        return [{ projectId: pid, action: 'task.delete', entity: 'task', entityId: id, oldValue: { names: removed.map((x) => nameOf(before, x)), ids: removed } }];
      },
      async (tasks) => deleteSubtree(tasks, id),
    );
  });

  r.post('/tasks/:id/move', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = moveBody.parse(req.body);
    const pid = projectOf(req).id;
    await structural(req, res, b.structureVersion, (before) => [{ projectId: pid, action: 'task.move', entity: 'task', entityId: id, newValue: { dir: b.dir, name: nameOf(before, id) } }], async (tasks) => moveTask(tasks, id, b.dir));
  });

  r.post('/tasks/:id/indent', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = structureVersion.parse(req.body);
    const pid = projectOf(req).id;
    await structural(req, res, b.structureVersion, (before) => [{ projectId: pid, action: 'task.indent', entity: 'task', entityId: id, newValue: { name: nameOf(before, id) } }], async (tasks) => indentTask(tasks, id));
  });

  r.post('/tasks/:id/outdent', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = structureVersion.parse(req.body);
    const pid = projectOf(req).id;
    await structural(req, res, b.structureVersion, (before) => [{ projectId: pid, action: 'task.outdent', entity: 'task', entityId: id, newValue: { name: nameOf(before, id) } }], async (tasks) => outdentTask(tasks, id));
  });

  r.patch('/tasks/:id', base, requireCap('schedule.edit', 'progress.update', 'progress.update.own'), async (req: Request, res: Response) => {
    const id = intParam(req, 'id');
    const b = patchBody.parse(req.body);
    const access = projectOf(req);
    const user = actorOf(req);
    const fields = Object.keys(b.patch).filter((k) => (b.patch as Record<string, unknown>)[k] !== undefined);
    if (fields.length === 0) throw badRequest('هیچ تغییری ارسال نشده است.', undefined, 'EMPTY_PATCH');
    const out = await withTx(pool, async (tx) => {
      const project = await lockProject(tx, access.id);
      const before = await loadTasks(tx, access.id);
      const current = before.find((t) => t.id === id);
      if (!current) throw notFound('فعالیت پیدا نشد.', 'NO_TASK');
      if (current.version !== b.version) throw versionConflict(current);
      assertMayPatch(access.capabilities, access.ownResourceIds, current, fields);

      if (b.patch.assignments) {
        const known = new Set((await many<{ id: number }>(tx, 'SELECT id FROM resources WHERE project_id = $1', [access.id])).map((x) => x.id));
        const missing = b.patch.assignments.filter((a) => !known.has(a.resourceId)).map((a) => a.resourceId);
        if (missing.length) throw badRequest(`منبع ناموجود: ${missing.join('، ')}`, { missing }, 'UNKNOWN_RESOURCE');
      }

      const calendar = await loadCalendar(tx, access.id);
      let plannedStart: string | null = null;
      if (b.patch.percentComplete !== undefined) {
        const sched = computeSchedule({ start: project.start_date, status: project.status_date, calendar, tasks: before });
        if (sched.ok) plannedStart = sched.byId.get(id)?.startDate ?? null;
      }
      const result = applyTaskPatch(current, b.patch as TaskPatch, { taskIds: new Set(before.map((t) => t.id)), plannedStart });
      if (!result.ok) throw badRequest(result.issues[0]?.message ?? 'ویرایش نامعتبر است.', { issues: result.issues }, 'TASK_PATCH_INVALID');
      const next = before.map((t) => (t.id === id ? { ...result.task, version: current.version } : t));
      if (b.patch.dependencies) {
        const s = computeSchedule({ start: project.start_date, status: project.status_date, calendar, tasks: next });
        if (!s.ok) throw badRequest('این وابستگی چرخه (دور) ایجاد می‌کند و ثبت نشد.', { taskIds: s.taskIds }, 'CYCLE');
      }
      if (result.changes.length === 0) return { task: current as TaskDto, notes: result.notes, changed: false };
      await saveTasks(tx, access.id, before, next, user.id);
      await writeAudit(
        tx,
        actorInfo(req),
        result.changes.map((c) => ({ projectId: access.id, action: 'task.update', entity: 'task', entityId: id, field: c.field, oldValue: c.from, newValue: c.to, details: { name: current.name } })),
      );
      const after = (await loadTasks(tx, access.id)).find((t) => t.id === id)!;
      return { task: after, notes: result.notes, changed: true };
    });
    res.json(out);
  });

  return r;
}
