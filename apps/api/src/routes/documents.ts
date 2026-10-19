import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { DOCUMENT_TYPES } from '@bistoon/core';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { one, withTx } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDateOrNull, posInt, text } from '../schemas.ts';
import { loadDocuments } from '../services/store.ts';

const url = z
  .string()
  .trim()
  .max(2000)
  .refine((u) => {
    try {
      const x = new URL(u);
      return x.protocol === 'http:' || x.protocol === 'https:';
    } catch {
      return false;
    }
  }, 'نشانی باید با http:// یا https:// شروع شود.');

const fields = { title: text(200).min(1), type: z.enum(DOCUMENT_TYPES), url, taskId: posInt.nullable(), date: isoDateOrNull };
const createSchema = z.object(fields).partial({ type: true, taskId: true, date: true }).strict();
const patchSchema = z.object(fields).partial().strict();

async function assertTask(tx: Db, pid: number, taskId: number | null | undefined): Promise<void> {
  if (taskId === null || taskId === undefined) return;
  if (!(await one(tx, 'SELECT 1 FROM tasks WHERE project_id = $1 AND id = $2', [pid, taskId]))) throw badRequest('فعالیت انتخاب‌شده وجود ندارد.', undefined, 'UNKNOWN_TASK');
}

export function documentsRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);
  const guard = requireCap('documents.edit');

  r.post('/documents', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = createSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      await assertTask(tx, access.id, b.taskId);
      const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'document']))!.n;
      await tx.query('INSERT INTO project_documents (project_id, id, title, doc_type, url, task_id, doc_date, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [
        access.id,
        id,
        b.title,
        b.type ?? 'other',
        b.url,
        b.taskId ?? null,
        b.date ?? null,
        actorOf(req).id,
      ]);
      const created = (await loadDocuments(tx, access.id)).find((x) => x.id === id)!;
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'document.create', entity: 'document', entityId: id, newValue: created });
      return created;
    });
    res.status(201).json({ item });
  });

  r.patch('/documents/:id', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    const b = patchSchema.parse(req.body);
    const item = await withTx(pool, async (tx) => {
      const before = (await loadDocuments(tx, access.id)).find((x) => x.id === id);
      if (!before) throw notFound('سند پیدا نشد.', 'NOT_FOUND');
      if (b.taskId !== undefined) await assertTask(tx, access.id, b.taskId);
      await tx.query('UPDATE project_documents SET title = $3, doc_type = $4, url = $5, task_id = $6, doc_date = $7 WHERE project_id = $1 AND id = $2', [
        access.id,
        id,
        b.title ?? before.title,
        b.type ?? before.type,
        b.url ?? before.url,
        b.taskId === undefined ? before.taskId : b.taskId,
        b.date === undefined ? before.date : b.date,
      ]);
      const after = (await loadDocuments(tx, access.id)).find((x) => x.id === id)!;
      const changes = diffFields(before as never, after as never, ['title', 'type', 'url', 'taskId', 'date']);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'document.update', entity: 'document', entityId: id, field: c.field, oldValue: c.from, newValue: c.to })));
      return after;
    });
    res.json({ item });
  });

  r.delete('/documents/:id', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const id = intParam(req, 'id');
    await withTx(pool, async (tx) => {
      const before = (await loadDocuments(tx, access.id)).find((x) => x.id === id);
      if (!before) throw notFound('سند پیدا نشد.', 'NOT_FOUND');
      await tx.query('DELETE FROM project_documents WHERE project_id = $1 AND id = $2', [access.id, id]);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'document.delete', entity: 'document', entityId: id, oldValue: before });
    });
    res.json({ ok: true });
  });

  return r;
}
