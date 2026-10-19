import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { one, withTx } from '../db.ts';
import { badRequest, notFound, versionConflict } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDate, money, posInt, text, version } from '../schemas.ts';
import { loadCosts } from '../services/store.ts';

const fields = {
  date: isoDate,
  taskId: posInt.nullable(),
  description: text(120),
  document: text(60),
  amount: money.gt(0),
};
const createSchema = z.object(fields).partial({ taskId: true, description: true, document: true }).strict();
const patchSchema = z.object(fields).partial().extend({ version }).strict();

export function costsRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  async function assertTask(tx: Db, pid: number, taskId: number | null | undefined): Promise<void> {
    if (taskId === null || taskId === undefined) return;
    const t = await one<{ kind: string }>(tx, 'SELECT kind FROM tasks WHERE project_id = $1 AND id = $2', [pid, taskId]);
    if (!t) throw badRequest('فعالیت انتخاب‌شده وجود ندارد.', undefined, 'UNKNOWN_TASK');
    if (t.kind === 'summary') throw badRequest('هزینه را روی فعالیت‌های خلاصه (گروه) نمی‌توان ثبت کرد؛ یکی از زیرمجموعه‌ها را انتخاب کنید.', undefined, 'SUMMARY_TASK');
  }

  r.post('/costs', base, requireCap('costs.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = createSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      await assertTask(tx, access.id, b.taskId);
      const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'cost']))!.n;
      await tx.query(
        'INSERT INTO cost_entries (project_id, id, entry_date, task_id, description, document, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)',
        [access.id, id, b.date, b.taskId ?? null, b.description ?? '', b.document ?? '', b.amount, actorOf(req).id],
      );
      const created = (await loadCosts(tx, access.id)).find((x) => x.id === id)!;
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'cost.create', entity: 'cost', entityId: id, newValue: created });
      return created;
    });
    res.status(201).json({ item });
  });

  r.patch('/costs/:id', base, requireCap('costs.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    const b = patchSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      const cur = await one<{ version: number }>(tx, 'SELECT version FROM cost_entries WHERE project_id = $1 AND id = $2 FOR UPDATE', [access.id, id]);
      if (!cur) throw notFound('ثبت هزینه پیدا نشد.', 'NOT_FOUND');
      const before = (await loadCosts(tx, access.id)).find((x) => x.id === id)!;
      if (cur.version !== b.version) throw versionConflict(before);
      if (b.taskId !== undefined) await assertTask(tx, access.id, b.taskId);
      await tx.query(
        `UPDATE cost_entries SET entry_date = $3, task_id = $4, description = $5, document = $6, amount = $7, version = version + 1
          WHERE project_id = $1 AND id = $2`,
        [access.id, id, b.date ?? before.date, b.taskId === undefined ? before.taskId : b.taskId, b.description ?? before.description, b.document ?? before.document, b.amount ?? before.amount],
      );
      const after = (await loadCosts(tx, access.id)).find((x) => x.id === id)!;
      const changes = diffFields(before as never, after as never, ['date', 'taskId', 'description', 'document', 'amount']);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'cost.update', entity: 'cost', entityId: id, field: c.field, oldValue: c.from, newValue: c.to })));
      return after;
    });
    res.json({ item });
  });

  r.delete('/costs/:id', base, requireCap('costs.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    await withTx(pool, async (tx) => {
      const before = (await loadCosts(tx, access.id)).find((x) => x.id === id);
      if (!before) throw notFound('ثبت هزینه پیدا نشد.', 'NOT_FOUND');
      await tx.query('DELETE FROM cost_entries WHERE project_id = $1 AND id = $2', [access.id, id]);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'cost.delete', entity: 'cost', entityId: id, oldValue: before });
    });
    res.json({ ok: true });
  });

  return r;
}
