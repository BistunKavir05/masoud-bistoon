import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { commissionPayable } from '@bistoon/core';
import type { Capability, ModelBundle, TaskDto } from '@bistoon/core';
import { poolDb } from '../db.ts';
import { projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { buildSummary, computeAnalysis } from '../services/summary.ts';
import { loadDocuments, loadFullModel, redactContract } from '../services/store.ts';
import type { FullModel } from '../services/store.ts';
import { projectDto } from './projects.ts';

/** پالایش فعالیت برای نقش‌هایی که هزینه نمی‌بینند: مبلغ هزینه‌ی مستقیم و هزینه‌ی واقعی قدیمی حذف می‌شود */
function taskForViewer(t: TaskDto, costs: boolean): TaskDto {
  return costs ? t : { ...t, directCosts: [], legacyActualCost: null };
}

export async function buildBundle(pool: Pool, req: Request): Promise<ModelBundle> {
  const access = projectOf(req);
  const db = poolDb(pool);
  const full: FullModel = await loadFullModel(db, access.id);
  const has = (c: Capability): boolean => access.capabilities.includes(c);
  const analysis = computeAnalysis(full);
  const bundle: ModelBundle = {
    project: projectDto(full.project),
    me: { roles: access.roles, capabilities: access.capabilities, isSystemAdmin: access.isSystemAdmin, ownResourceIds: access.ownResourceIds },
    summary: buildSummary(full, analysis),
  };
  const costs = has('costs.view');
  if (has('schedule.view')) {
    bundle.calendar = full.model.calendar;
    bundle.tasks = full.tasks.map((t) => taskForViewer(t, costs));
    bundle.resources = full.resources.map((r) => (costs ? r : { ...r, dailyRate: 0 }));
    const stripCost = <T extends { items: Record<number, { cost: number | null }> }>(b: T): T =>
      costs ? b : { ...b, items: Object.fromEntries(Object.entries(b.items).map(([k, v]) => [k, { ...v, cost: null }])) };
    bundle.baseline = full.baseline ? (stripCost(full.baseline as never) as never) : null;
    bundle.baselineHistory = full.baselineHistory.map((h) => stripCost(h as never) as never);
    bundle.snapshots = costs ? full.model.snapshots : full.model.snapshots.map(({ actualCost: _c, ...s }) => s);
  }
  if (costs) bundle.costs = full.costs;
  if (has('charter.view')) bundle.charter = full.charterDto;
  const canCommission = has('commission.view');
  if (has('contract.view')) bundle.contract = redactContract(full.contractDto, canCommission);
  if (canCommission) bundle.commission = commissionPayable(full.model.contract);
  if (has('risks.view')) {
    bundle.risks = full.risks;
    bundle.issues = full.issues;
    bundle.changes = full.changes;
    bundle.decisions = full.decisions;
  }
  if (has('documents.view')) bundle.documents = await loadDocuments(db, access.id);
  return bundle;
}

export function modelRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  r.get('/model', projectAccess(pool), requireCap('summary.view'), async (req: Request, res: Response) => {
    res.json(await buildBundle(pool, req));
  });
  r.get('/summary', projectAccess(pool), requireCap('summary.view'), async (req: Request, res: Response) => {
    const b = await buildBundle(pool, req);
    res.json({ project: b.project, summary: b.summary, commission: b.commission ?? null, contract: b.contract ?? null });
  });
  return r;
}
