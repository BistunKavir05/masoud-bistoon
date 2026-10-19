import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { buildBaseline, estimateSnapshots, plannedCost, recordSnapshot } from '@bistoon/core';
import type { Analysis } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import { one, withTx } from '../db.ts';
import { badRequest, notFound } from '../errors.ts';
import { actorOf, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDate, text } from '../schemas.ts';
import { insertSnapshots, loadBaselines, loadFullModel, loadSnapshots, lockProject } from '../services/store.ts';
import type { FullModel } from '../services/store.ts';
import { computeAnalysis } from '../services/summary.ts';

const baselineBody = z.object({ label: text(120).default('') }).strict();

function needAnalysis(full: FullModel): Analysis {
  const a = computeAnalysis(full);
  if ('error' in a) throw badRequest(a.error, undefined, 'SCHEDULE_INVALID');
  return a;
}

export function baselinesRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);
  const guard = requireCap('baseline.manage');

  /** ثبت خط مبنا از برنامه‌ی جاری؛ خط مبنای قبلی با تاریخ وضعیت بایگانی می‌شود. */
  r.post('/baseline', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const b = baselineBody.parse(req.body ?? {});
    const out = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const full = await loadFullModel(tx, access.id);
      const analysis = needAnalysis(full);
      const { baseline, issues } = buildBaseline(full.model.tasks, analysis.schedule, (t) => plannedCost(t, full.model.resources));
      await tx.query('UPDATE baselines SET is_current = false, archived_on = $2 WHERE project_id = $1 AND is_current', [access.id, full.project.status_date]);
      const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'baseline']))!.n;
      await tx.query('INSERT INTO baselines (project_id, id, label, status_date, is_current, created_by) VALUES ($1,$2,$3,$4,true,$5)', [access.id, id, b.label, full.project.status_date, actorOf(req).id]);
      const items = Object.entries(baseline);
      if (items.length) {
        await tx.query(
          `INSERT INTO baseline_items (project_id, baseline_id, task_id, start_date, finish_date, zero_duration, cost)
           SELECT $1, $2, t, s, f, z, c FROM unnest($3::int[], $4::date[], $5::date[], $6::boolean[], $7::numeric[]) AS x(t, s, f, z, c)`,
          [access.id, id, items.map(([k]) => Number(k)), items.map(([, v]) => v.start), items.map(([, v]) => v.finish), items.map(([, v]) => v.zeroDuration), items.map(([, v]) => v.cost)],
        );
      }
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'baseline.set', entity: 'baseline', entityId: id, newValue: { label: b.label, statusDate: full.project.status_date, tasks: items.length }, details: issues.length ? { issues } : undefined });
      const { current, history } = await loadBaselines(tx, access.id);
      return { baseline: current, baselineHistory: history, issues };
    });
    res.status(201).json(out);
  });

  /** ثبت اسنپ‌شات پیشرفت در تاریخ وضعیت (برای منحنی S) */
  r.post('/snapshots', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const out = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const full = await loadFullModel(tx, access.id);
      const analysis = needAnalysis(full);
      const status = full.project.status_date;
      const next = recordSnapshot({
        existing: full.model.snapshots,
        status,
        progress: analysis.progress,
        tasks: full.model.tasks,
        schedule: analysis.schedule,
        actualCost: analysis.finance.totalActualWithOverhead,
      });
      const keep = new Set(next.map((s) => s.date));
      // رکوردهایی که recordSnapshot کنار گذاشته (هم‌تاریخ یا تخمینی بعدتر) حذف می‌شوند
      for (const s of full.model.snapshots) if (!keep.has(s.date)) await tx.query('DELETE FROM snapshots WHERE project_id = $1 AND snapshot_date = $2', [access.id, s.date]);
      await tx.query('DELETE FROM snapshots WHERE project_id = $1 AND snapshot_date = $2', [access.id, status]);
      const created = next.find((s) => s.date === status)!;
      await insertSnapshots(tx, access.id, [created], actorOf(req).id);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'snapshot.record', entity: 'snapshot', entityId: status, newValue: { actual: created.actual, planned: created.planned } });
      return { snapshots: await loadSnapshots(tx, access.id) };
    });
    res.status(201).json(out);
  });

  /** بازسازی تخمینی منحنی از تاریخ‌های واقعی؛ اسنپ‌شات‌های ثبت‌شده‌ی واقعی دست‌نخورده می‌مانند. */
  r.post('/snapshots/estimate', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const out = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const full = await loadFullModel(tx, access.id);
      const analysis = needAnalysis(full);
      const recorded = new Set(full.model.snapshots.filter((s) => !s.estimated).map((s) => s.date));
      await tx.query('DELETE FROM snapshots WHERE project_id = $1 AND estimated', [access.id]);
      const fresh = estimateSnapshots(full.model.tasks, analysis.schedule).filter((s) => !recorded.has(s.date));
      await insertSnapshots(tx, access.id, fresh, actorOf(req).id);
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'snapshot.estimate', entity: 'snapshot', newValue: { count: fresh.length } });
      return { snapshots: await loadSnapshots(tx, access.id) };
    });
    res.json(out);
  });

  r.delete('/snapshots/:date', base, guard, async (req: Request, res: Response) => {
    const access = projectOf(req);
    const date = isoDate.parse(req.params['date']);
    await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const del = await tx.query('DELETE FROM snapshots WHERE project_id = $1 AND snapshot_date = $2', [access.id, date]);
      if (!del.rowCount) throw notFound('اسنپ‌شاتی در این تاریخ نیست.', 'NO_SNAPSHOT');
      await writeAudit(tx, actorInfo(req), { projectId: access.id, action: 'snapshot.delete', entity: 'snapshot', entityId: date });
    });
    res.json({ ok: true });
  });

  return r;
}
