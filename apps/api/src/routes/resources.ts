import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { one, withTx } from '../db.ts';
import { badRequest, conflict, notFound } from '../errors.ts';
import { intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { loadResources, lockProject } from '../services/store.ts';

const fields = {
  name: z
    .string()
    .trim()
    .min(1)
    .max(120)
    .refine((s) => !/[,،:]/.test(s), 'نام منبع نباید شامل «,» «،» یا «:» باشد.'),
  type: z.enum(['human', 'equipment', 'financial', 'other']),
  capacityPercent: z.number().finite().gt(0).max(100000),
  dailyRate: z.number().finite().min(0).max(9e12),
  userId: z.number().int().min(1).nullable(),
};
const createSchema = z.object(fields).partial().required({ name: true }).strict();
const patchSchema = z.object(fields).partial().strict();

export function resourcesRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  r.post('/resources', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = createSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      await assertUserIsMember(tx, access.id, b.userId);
      const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'resource']))!.n;
      await tx.query(
        'INSERT INTO resources (project_id, id, name, type, capacity_percent, daily_rate, user_id) VALUES ($1,$2,$3,$4,$5,$6,$7)',
        [access.id, id, b.name, b.type ?? 'human', b.capacityPercent ?? 100, b.dailyRate ?? 0, b.userId ?? null],
      );
      const created = (await loadResources(tx, access.id)).find((x) => x.id === id)!;
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'resource.create', entity: 'resource', entityId: id, newValue: created });
      return created;
    });
    res.status(201).json({ item });
  });

  r.patch('/resources/:id', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    const b = patchSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const before = (await loadResources(tx, access.id)).find((x) => x.id === id);
      if (!before) throw notFound('منبع پیدا نشد.', 'NO_RESOURCE');
      if (b.userId !== undefined) await assertUserIsMember(tx, access.id, b.userId);
      await tx.query(
        `UPDATE resources SET name = $3, type = $4, capacity_percent = $5, daily_rate = $6, user_id = $7 WHERE project_id = $1 AND id = $2`,
        [access.id, id, b.name ?? before.name, b.type ?? before.type, b.capacityPercent ?? before.capacityPercent, b.dailyRate ?? before.dailyRate, b.userId === undefined ? before.userId : b.userId],
      );
      const after = (await loadResources(tx, access.id)).find((x) => x.id === id)!;
      const changes = diffFields(before as never, after as never);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'resource.update', entity: 'resource', entityId: id, field: c.field, oldValue: c.from, newValue: c.to })));
      return after;
    });
    res.json({ item });
  });

  r.delete('/resources/:id', base, requireCap('schedule.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const before = (await loadResources(tx, access.id)).find((x) => x.id === id);
      if (!before) throw notFound('منبع پیدا نشد.', 'NO_RESOURCE');
      const used = await one<{ n: number }>(tx, 'SELECT count(*)::int AS n FROM task_assignments WHERE project_id = $1 AND resource_id = $2', [access.id, id]);
      if (used && used.n > 0) throw conflict(`این منبع به ${used.n} فعالیت تخصیص دارد؛ ابتدا تخصیص‌ها را بردارید.`, 'RESOURCE_IN_USE', { assignments: used.n });
      await tx.query('DELETE FROM resources WHERE project_id = $1 AND id = $2', [access.id, id]);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'resource.delete', entity: 'resource', entityId: id, oldValue: before });
    });
    res.json({ ok: true });
  });

  return r;
}

async function assertUserIsMember(tx: Db, pid: number, userId: number | null | undefined): Promise<void> {
  if (userId === null || userId === undefined) return;
  const m = await one(tx, 'SELECT 1 FROM project_members WHERE project_id = $1 AND user_id = $2 LIMIT 1', [pid, userId]);
  if (!m) throw badRequest('کاربر انتخاب‌شده عضو این پروژه نیست.', undefined, 'NOT_A_MEMBER');
}
