/**
 * ریسک، مسئله، درخواست تغییر و تصمیم: چهار جدول هم‌شکل با شناسه‌ی پروژه‌ای، نسخه‌ی ردیف و ممیزی.
 * یک سازنده‌ی عمومی هر چهار را می‌سازد تا قواعد (قفل خوش‌بینانه، ممیزی، دسترسی) یکسان بماند.
 */
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { CHANGE_STATUSES, DECISION_STATUSES, ISSUE_PRIORITIES, ISSUE_STATUSES, RISK_CATEGORIES, RISK_STATUSES, RISK_STRATEGIES } from '@bistoon/core';
import type { Capability } from '@bistoon/core';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { one, withTx } from '../db.ts';
import { badRequest, forbidden, notFound, versionConflict } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDateOrNull, text, version } from '../schemas.ts';
import { loadChanges, loadDecisions, loadIssues, loadRisks } from '../services/store.ts';

interface Field {
  dto: string;
  col: string;
  schema: z.ZodTypeAny;
}

interface Spec {
  path: string;
  table: string;
  counter: string;
  entity: string;
  fields: Field[];
  editCaps: Capability[];
  /** فیلدهایی که فقط با قابلیت‌های دیگری قابل تغییرند */
  restricted?: { fields: string[]; caps: Capability[] };
  load: (db: Db, pid: number) => Promise<{ id: number; version: number }[]>;
}

const long = z.string().max(20000);

const SPECS: Spec[] = [
  {
    path: 'risks',
    table: 'risks',
    counter: 'risk',
    entity: 'risk',
    editCaps: ['risks.edit'],
    load: loadRisks,
    fields: [
      { dto: 'title', col: 'title', schema: text(300) },
      { dto: 'category', col: 'category', schema: z.enum(RISK_CATEGORIES).nullable() },
      { dto: 'probability', col: 'probability', schema: z.number().int().min(1).max(5) },
      { dto: 'impact', col: 'impact', schema: z.number().int().min(1).max(5) },
      { dto: 'owner', col: 'owner', schema: text(120) },
      { dto: 'strategy', col: 'strategy', schema: z.enum(RISK_STRATEGIES).nullable() },
      { dto: 'response', col: 'response', schema: long },
      { dto: 'due', col: 'due', schema: isoDateOrNull },
      { dto: 'status', col: 'status', schema: z.enum(RISK_STATUSES) },
    ],
  },
  {
    path: 'issues',
    table: 'issues',
    counter: 'issue',
    entity: 'issue',
    editCaps: ['risks.edit'],
    load: loadIssues,
    fields: [
      { dto: 'title', col: 'title', schema: text(300) },
      { dto: 'owner', col: 'owner', schema: text(120) },
      { dto: 'priority', col: 'priority', schema: z.enum(ISSUE_PRIORITIES) },
      { dto: 'due', col: 'due', schema: isoDateOrNull },
      { dto: 'impact', col: 'impact', schema: long },
      { dto: 'action', col: 'action', schema: long },
      { dto: 'needsDecision', col: 'needs_decision', schema: z.boolean() },
      { dto: 'status', col: 'status', schema: z.enum(ISSUE_STATUSES) },
    ],
  },
  {
    path: 'changes',
    table: 'change_requests',
    counter: 'change',
    entity: 'change',
    editCaps: ['risks.edit', 'changes.approve'],
    restricted: { fields: ['status', 'approvedBy', 'approvedOn'], caps: ['changes.approve'] },
    load: loadChanges,
    fields: [
      { dto: 'title', col: 'title', schema: text(300) },
      { dto: 'requester', col: 'requester', schema: text(120) },
      { dto: 'date', col: 'request_date', schema: isoDateOrNull },
      { dto: 'reason', col: 'reason', schema: long },
      { dto: 'impact', col: 'impact', schema: long },
      { dto: 'previousFinish', col: 'previous_finish', schema: isoDateOrNull },
      { dto: 'newFinish', col: 'new_finish', schema: isoDateOrNull },
      { dto: 'status', col: 'status', schema: z.enum(CHANGE_STATUSES) },
      { dto: 'approvedBy', col: 'approved_by', schema: text(120) },
      { dto: 'approvedOn', col: 'approved_on', schema: isoDateOrNull },
    ],
  },
  {
    path: 'decisions',
    table: 'decisions',
    counter: 'decision',
    entity: 'decision',
    editCaps: ['risks.edit', 'changes.approve'],
    load: loadDecisions,
    fields: [
      { dto: 'topic', col: 'topic', schema: text(300) },
      { dto: 'text', col: 'decision_text', schema: long },
      { dto: 'maker', col: 'maker', schema: text(120) },
      { dto: 'date', col: 'decision_date', schema: isoDateOrNull },
      { dto: 'status', col: 'status', schema: z.enum(DECISION_STATUSES) },
    ],
  },
];

function checkRestricted(spec: Spec, caps: readonly Capability[], given: string[]): void {
  if (!spec.restricted) return;
  const touched = given.filter((f) => spec.restricted!.fields.includes(f));
  if (touched.length && !spec.restricted.caps.some((c) => caps.includes(c))) {
    throw forbidden('تأیید یا رد تغییر فقط با نقش مجاز (مدیریت یا ادمین) ممکن است.', 'FORBIDDEN', { fields: touched });
  }
}

export function recordsRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  for (const spec of SPECS) {
    const shape: Record<string, z.ZodTypeAny> = {};
    for (const f of spec.fields) shape[f.dto] = f.schema;
    const createSchema = z.object(shape).partial().strict();
    const patchSchema = z.object(shape).partial().extend({ version }).strict();
    const colOf = new Map(spec.fields.map((f) => [f.dto, f.col]));

    r.post(`/${spec.path}`, base, requireCap(...spec.editCaps), async (req: Request, res: Response) => {
      const access = projectOf(req);
      const body = createSchema.parse(req.body) as Record<string, unknown>;
      const given = Object.keys(body).filter((k) => body[k] !== undefined);
      checkRestricted(spec, access.capabilities, given);
      const item = await withTx(pool, async (tx) => {
        const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, spec.counter]))!.n;
        const cols = ['project_id', 'id', 'updated_by', ...given.map((g) => colOf.get(g)!)];
        const vals = [access.id, id, actorOf(req).id, ...given.map((g) => body[g])];
        await tx.query(`INSERT INTO ${spec.table} (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})`, vals);
        const created = (await spec.load(tx, access.id)).find((x) => x.id === id)!;
        await writeAudit(tx, actorInfo(req), { projectId: access.id, action: `${spec.entity}.create`, entity: spec.entity, entityId: id, newValue: created });
        return created;
      });
      res.status(201).json({ item });
    });

    r.patch(`/${spec.path}/:id`, base, requireCap(...spec.editCaps), async (req: Request, res: Response) => {
      const access = projectOf(req);
      const id = intParam(req, 'id');
      const { version: expected, ...body } = patchSchema.parse(req.body) as { version: number } & Record<string, unknown>;
      const given = Object.keys(body).filter((k) => body[k] !== undefined);
      if (given.length === 0) throw badRequest('هیچ تغییری ارسال نشده است.', undefined, 'EMPTY_PATCH');
      checkRestricted(spec, access.capabilities, given);
      const item = await withTx(pool, async (tx) => {
        const cur = await one<{ version: number }>(tx, `SELECT version FROM ${spec.table} WHERE project_id = $1 AND id = $2 FOR UPDATE`, [access.id, id]);
        if (!cur) throw notFound('مورد پیدا نشد.', 'NOT_FOUND');
        const before = (await spec.load(tx, access.id)).find((x) => x.id === id)!;
        if (cur.version !== expected) throw versionConflict(before);
        const sets = given.map((g, i) => `${colOf.get(g)} = $${i + 3}`);
        const vals = [access.id, id, ...given.map((g) => body[g])];
        await tx.query(
          `UPDATE ${spec.table} SET ${sets.join(', ')}, version = version + 1, updated_at = now(), updated_by = $${vals.length + 1} WHERE project_id = $1 AND id = $2`,
          [...vals, actorOf(req).id],
        );
        const after = (await spec.load(tx, access.id)).find((x) => x.id === id)!;
        const changes = diffFields(before as never, after as never, given);
        await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: `${spec.entity}.update`, entity: spec.entity, entityId: id, field: c.field, oldValue: c.from, newValue: c.to })));
        return after;
      });
      res.json({ item });
    });

    r.delete(`/${spec.path}/:id`, base, requireCap(...spec.editCaps), async (req: Request, res: Response) => {
      const access = projectOf(req);
      const id = intParam(req, 'id');
      await withTx(pool, async (tx) => {
        const before = (await spec.load(tx, access.id)).find((x) => x.id === id);
        if (!before) throw notFound('مورد پیدا نشد.', 'NOT_FOUND');
        await tx.query(`DELETE FROM ${spec.table} WHERE project_id = $1 AND id = $2`, [access.id, id]);
        await writeAudit(tx, actorInfo(req), { projectId: access.id, action: `${spec.entity}.delete`, entity: spec.entity, entityId: id, oldValue: before });
      });
      res.json({ ok: true });
    });
  }
  return r;
}
