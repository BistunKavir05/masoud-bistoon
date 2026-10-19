import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { many, poolDb } from '../db.ts';
import { projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';

const query = z.object({
  limit: z.coerce.number().int().min(1).max(500).default(100),
  before: z.coerce.number().int().min(1).optional(),
  entity: z.string().max(40).optional(),
  entityId: z.string().max(40).optional(),
  actorId: z.coerce.number().int().min(1).optional(),
  action: z.string().max(60).optional(),
});

interface Row {
  id: number;
  at: Date;
  actor_id: number | null;
  actor_name: string;
  action: string;
  entity: string;
  entity_id: string;
  field: string;
  old_value: unknown;
  new_value: unknown;
  ip: string | null;
  request_id: string;
  details: unknown;
}

export function auditRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  r.get('/audit', projectAccess(pool), requireCap('audit.view'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const q = query.parse(req.query);
    const where = ['project_id = $1'];
    const params: unknown[] = [access.id];
    const add = (sql: string, v: unknown): void => {
      params.push(v);
      where.push(sql.replace('?', `$${params.length}`));
    };
    if (q.before) add('id < ?', q.before);
    if (q.entity) add('entity = ?', q.entity);
    if (q.entityId) add('entity_id = ?', q.entityId);
    if (q.actorId) add('actor_id = ?', q.actorId);
    if (q.action) add('action = ?', q.action);
    params.push(q.limit);
    const rows = await many<Row>(
      poolDb(pool),
      `SELECT id, at, actor_id, actor_name, action, entity, entity_id, field, old_value, new_value, host(ip) AS ip, request_id, details
         FROM audit_log WHERE ${where.join(' AND ')} ORDER BY id DESC LIMIT $${params.length}`,
      params,
    );
    res.json({
      entries: rows.map((e) => ({
        id: e.id,
        at: e.at,
        actorId: e.actor_id,
        actorName: e.actor_name,
        action: e.action,
        entity: e.entity,
        entityId: e.entity_id,
        field: e.field,
        oldValue: e.old_value,
        newValue: e.new_value,
        ip: e.ip,
        requestId: e.request_id,
        details: e.details,
      })),
      nextBefore: rows.length === q.limit ? rows[rows.length - 1]!.id : null,
    });
  });
  return r;
}
