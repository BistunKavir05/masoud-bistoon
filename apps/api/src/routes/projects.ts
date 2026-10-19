import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { ROLES, defaultCalendar } from '@bistoon/core';
import type { Role } from '@bistoon/core';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { many, one, poolDb, withTx } from '../db.ts';
import { badRequest, notFound, versionConflict } from '../errors.ts';
import { actorOf, intParam, projectOf } from '../http/types.ts';
import { projectAccess, requireCap, requireSystemAdmin } from '../middleware.ts';
import { isoDate, isoDateOrNull, money, text, version } from '../schemas.ts';
import { listProjectsFor } from './auth.ts';

export interface ProjectRow {
  id: number;
  name: string;
  start_date: string;
  status_date: string;
  contract_end: string | null;
  finance_unit: string;
  finance_budget: number;
  eac_method: 'remaining' | 'cpi' | 'both';
  structure_version: number;
  version: number;
  archived_at: Date | null;
}

export const PROJECT_COLS = 'id, name, start_date, status_date, contract_end, finance_unit, finance_budget, eac_method, structure_version, version, archived_at';

export const projectDto = (r: ProjectRow) => ({
  id: r.id,
  name: r.name,
  start: r.start_date,
  status: r.status_date,
  contractEnd: r.contract_end,
  finance: { unit: r.finance_unit, budget: r.finance_budget, eacMethod: r.eac_method },
  structureVersion: r.structure_version,
  version: r.version,
  archived: r.archived_at !== null,
});

export interface NewProject {
  name: string;
  start: string;
  status: string;
  contractEnd: string | null;
  finance: { unit: string; budget: number; eacMethod: 'remaining' | 'cpi' | 'both' };
}

/** ردیف پروژه + تقویم پیش‌فرض + منشور و قرارداد خالی. شناسه‌ی پروژه را برمی‌گرداند. */
export async function insertProjectShell(db: Db, p: NewProject, userId: number): Promise<number> {
  const row = await one<{ id: number }>(
    db,
    `INSERT INTO projects (name, start_date, status_date, contract_end, finance_unit, finance_budget, eac_method, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8) RETURNING id`,
    [p.name, p.start, p.status, p.contractEnd, p.finance.unit, p.finance.budget, p.finance.eacMethod, userId],
  );
  const id = row!.id;
  const cal = defaultCalendar();
  for (let d = 0; d < 7; d++) {
    const day = cal.days[d]!;
    await db.query('INSERT INTO project_workdays (project_id, weekday, working, from_time, to_time) VALUES ($1,$2,$3,$4,$5)', [id, d, day.working, day.from, day.to]);
  }
  await db.query('INSERT INTO project_charter (project_id) VALUES ($1)', [id]);
  await db.query('INSERT INTO project_contract (project_id) VALUES ($1)', [id]);
  return id;
}

const financeSchema = z.object({ unit: text(24).min(1), budget: money, eacMethod: z.enum(['remaining', 'cpi', 'both']) });

const createBody = z.object({
  name: text(200).min(1),
  start: isoDate,
  status: isoDate.optional(),
  contractEnd: isoDateOrNull.optional(),
  finance: financeSchema.partial().optional(),
  members: z.array(z.object({ userId: z.number().int().min(1), roles: z.array(z.enum(ROLES)).min(1).max(ROLES.length) })).max(200).optional(),
});

const settingsBody = z
  .object({
    name: text(200).min(1),
    start: isoDate,
    status: isoDate,
    contractEnd: isoDateOrNull,
    finance: financeSchema.partial(),
    archived: z.boolean(),
    version,
  })
  .partial()
  .required({ version: true })
  .strict();

const memberBody = z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length) });

export function projectsRouter(pool: Pool): Router {
  const r = Router();

  r.get('/projects', async (req: Request, res: Response) => {
    res.json({ projects: await listProjectsFor(poolDb(pool), actorOf(req)) });
  });

  r.post('/projects', requireSystemAdmin, async (req: Request, res: Response) => {
    const b = createBody.parse(req.body);
    const user = actorOf(req);
    const id = await withTx(pool, async (tx) => {
      const pid = await insertProjectShell(
        tx,
        {
          name: b.name,
          start: b.start,
          status: b.status ?? b.start,
          contractEnd: b.contractEnd ?? null,
          finance: { unit: b.finance?.unit ?? 'ریال', budget: b.finance?.budget ?? 0, eacMethod: b.finance?.eacMethod ?? 'remaining' },
        },
        user.id,
      );
      for (const m of b.members ?? []) {
        const exists = await one(tx, 'SELECT 1 FROM users WHERE id = $1 AND is_active', [m.userId]);
        if (!exists) throw badRequest(`کاربر ${m.userId} پیدا نشد یا غیرفعال است.`, undefined, 'NO_USER');
        for (const role of new Set(m.roles)) await tx.query('INSERT INTO project_members (project_id, user_id, role, granted_by) VALUES ($1,$2,$3,$4)', [pid, m.userId, role, user.id]);
      }
      await writeAudit(tx, actorInfo(req), { projectId: pid, action: 'project.create', entity: 'project', entityId: pid, newValue: { name: b.name } });
      return pid;
    });
    const row = await one<ProjectRow>(poolDb(pool), `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`, [id]);
    res.status(201).json({ project: projectDto(row!) });
  });

  const one_ = Router({ mergeParams: true });

  one_.get('/', projectAccess(pool), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const row = await one<ProjectRow>(poolDb(pool), `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`, [access.id]);
    if (!row) throw notFound('پروژه پیدا نشد.', 'NO_PROJECT');
    res.json({ project: projectDto(row), me: { roles: access.roles, capabilities: access.capabilities, isSystemAdmin: access.isSystemAdmin, ownResourceIds: access.ownResourceIds } });
  });

  one_.patch('/', projectAccess(pool, { allowArchivedWrites: true }), requireCap('project.settings'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = settingsBody.parse(req.body);
    const row = await withTx(pool, async (tx) => {
      const before = await one<ProjectRow>(tx, `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1 FOR UPDATE`, [access.id]);
      if (!before) throw notFound('پروژه پیدا نشد.', 'NO_PROJECT');
      if (before.version !== b.version) throw versionConflict(projectDto(before));
      const archivedNow = before.archived_at !== null;
      const onlyUnarchive = Object.keys(b).every((k) => k === 'version' || k === 'archived') && b.archived === false;
      if (archivedNow && !onlyUnarchive) throw badRequest('پروژه‌ی بایگانی‌شده را باید ابتدا از بایگانی خارج کنید.', undefined, 'ARCHIVED');
      const fin = { unit: b.finance?.unit ?? before.finance_unit, budget: b.finance?.budget ?? before.finance_budget, eacMethod: b.finance?.eacMethod ?? before.eac_method };
      const after = await one<ProjectRow>(
        tx,
        `UPDATE projects SET name = $2, start_date = $3, status_date = $4, contract_end = $5,
                finance_unit = $6, finance_budget = $7, eac_method = $8,
                archived_at = CASE WHEN $9::boolean IS NULL THEN archived_at WHEN $9::boolean THEN COALESCE(archived_at, now()) ELSE NULL END,
                version = version + 1, updated_at = now(), updated_by = $10
          WHERE id = $1 RETURNING ${PROJECT_COLS}`,
        [
          access.id,
          b.name ?? before.name,
          b.start ?? before.start_date,
          b.status ?? before.status_date,
          b.contractEnd === undefined ? before.contract_end : b.contractEnd,
          fin.unit,
          fin.budget,
          fin.eacMethod,
          b.archived ?? null,
          actorOf(req).id,
        ],
      );
      const changes = diffFields(projectDto(before) as never, projectDto(after!) as never, ['name', 'start', 'status', 'contractEnd', 'finance', 'archived']);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'project.update', entity: 'project', entityId: access.id, field: c.field, oldValue: c.from, newValue: c.to })));
      return after!;
    });
    res.json({ project: projectDto(row) });
  });

  one_.delete('/', projectAccess(pool, { allowArchivedWrites: true }), requireSystemAdmin, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const confirm = z.object({ confirmName: z.string() }).parse(req.body);
    await withTx(pool, async (tx) => {
      const row = await one<{ name: string }>(tx, 'SELECT name FROM projects WHERE id = $1 FOR UPDATE', [access.id]);
      if (!row) throw notFound('پروژه پیدا نشد.', 'NO_PROJECT');
      if (row.name !== confirm.confirmName) throw badRequest('نام واردشده با نام پروژه یکی نیست.', undefined, 'NAME_MISMATCH');
      // ممیزی بی‌کلید خارجی است و پس از حذف می‌ماند
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'project.delete', entity: 'project', entityId: access.id, oldValue: { name: row.name } });
      await tx.query('DELETE FROM projects WHERE id = $1', [access.id]);
    });
    res.json({ ok: true });
  });

  one_.get('/members', projectAccess(pool), requireCap('summary.view'), async (req: Request, res: Response) => {
    const rows = await many<{ user_id: number; username: string; display_name: string; is_active: boolean; roles: string[] }>(
      poolDb(pool),
      `SELECT u.id AS user_id, u.username, u.display_name, u.is_active, array_agg(m.role ORDER BY m.role) AS roles
         FROM project_members m JOIN users u ON u.id = m.user_id
        WHERE m.project_id = $1 GROUP BY u.id ORDER BY u.display_name, u.id`,
      [projectOf(req).id],
    );
    res.json({ members: rows.map((m) => ({ userId: m.user_id, username: m.username, displayName: m.display_name, isActive: m.is_active, roles: m.roles as Role[] })) });
  });

  /** نقش‌های یک کاربر در این پروژه را یکجا تعیین می‌کند؛ آرایه‌ی خالی یعنی حذف از پروژه. */
  one_.put('/members/:userId', projectAccess(pool), requireCap('members.manage'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const userId = intParam(req, 'userId');
    const b = memberBody.parse(req.body);
    const want = [...new Set(b.roles)].sort();
    const result = await withTx(pool, async (tx) => {
      await tx.query('SELECT 1 FROM projects WHERE id = $1 FOR UPDATE', [access.id]);
      const user = await one<{ is_active: boolean }>(tx, 'SELECT is_active FROM users WHERE id = $1', [userId]);
      if (!user) throw notFound('کاربر پیدا نشد.', 'NO_USER');
      if (!user.is_active && want.length > 0) throw badRequest('کاربر غیرفعال را نمی‌توان عضو کرد.', undefined, 'INACTIVE_USER');
      const before = (await many<{ role: string }>(tx, 'SELECT role FROM project_members WHERE project_id = $1 AND user_id = $2 ORDER BY role', [access.id, userId])).map((x) => x.role);
      await tx.query('DELETE FROM project_members WHERE project_id = $1 AND user_id = $2 AND NOT (role = ANY($3::text[]))', [access.id, userId, want]);
      for (const role of want) {
        await tx.query('INSERT INTO project_members (project_id, user_id, role, granted_by) VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING', [access.id, userId, role, actorOf(req).id]);
      }
      if (want.length === 0) await tx.query('UPDATE resources SET user_id = NULL WHERE project_id = $1 AND user_id = $2', [access.id, userId]);
      if (JSON.stringify(before) !== JSON.stringify(want)) {
        await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'member.set', entity: 'member', entityId: userId, field: 'roles', oldValue: before, newValue: want });
      }
      return want;
    });
    res.json({ userId, roles: result });
  });

  r.use('/projects/:pid', one_);
  return r;
}
