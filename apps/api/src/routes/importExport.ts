import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { importLegacyProject, repairForStorage } from '@bistoon/core';
import type { Contract, LegacyUser, ProjectModel, Role } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import { poolDb, withTx } from '../db.ts';
import { badRequest } from '../errors.ts';
import { actorOf, projectOf } from '../http/types.ts';
import { projectAccess, requireCap, requireSystemAdmin } from '../middleware.ts';
import { EXPORT_FORMAT, EXPORT_VERSION, parseExport } from '../services/modelSchema.ts';
import { persistModel } from '../services/persist.ts';
import { loadFullModel } from '../services/store.ts';
import { insertProjectShell } from './projects.ts';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

/** نقش پیشنهادی برای کاربر نسخه‌ی قدیمی؛ تخصیص واقعی را ادمین انجام می‌دهد. */
const LEGACY_ROLE: Record<LegacyUser['role'], Role> = { admin: 'admin', pm: 'pm', fin: 'finance', user: 'expert' };

function safeFilename(name: string): string {
  const ascii = name.replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '') || 'project';
  return ascii.slice(0, 60);
}

export function importExportRouter(pool: Pool): Router {
  const r = Router();

  /** ورود فایل پشتیبان JSON نسخه‌ی قدیمی (تک‌فایل HTML) به‌عنوان پروژه‌ی جدید */
  r.post('/import/legacy', requireSystemAdmin, async (req: Request, res: Response) => {
    const raw: unknown = req.body;
    const imported = importLegacyProject(raw, { today: todayIso() });
    if ('error' in imported) throw badRequest(imported.error, undefined, 'LEGACY_INVALID');
    const repaired = repairForStorage(imported.model);
    if (!repaired.ok) throw badRequest(repaired.error, undefined, 'LEGACY_INVALID');
    const model = repaired.model;
    const user = actorOf(req);
    const sha = createHash('sha256').update(JSON.stringify(raw)).digest('hex');
    const warnings = [...imported.warnings, ...repaired.warnings];
    const summary = { tasks: model.tasks.length, resources: model.resources.length, costs: model.costs.length, risks: model.risks.length, snapshots: model.snapshots.length, baselineItems: Object.keys(model.baseline).length, legacyLog: imported.log.length };
    const legacyUsers = imported.users.map((u) => ({ ...u, suggestedRole: LEGACY_ROLE[u.role] }));
    // پیش‌نمایش: همه‌ی اعتبارسنجی‌ها اجرا می‌شود ولی چیزی نوشته نمی‌شود
    if (req.query['dryRun'] === '1') {
      res.json({ dryRun: true, name: model.name, start: model.start, summary, warnings, legacyUsers });
      return;
    }
    const pid = await withTx(pool, async (tx) => {
      const id = await insertProjectShell(tx, { name: model.name, start: model.start, status: model.status, contractEnd: model.contractEnd, finance: model.finance }, user.id);
      await persistModel(tx, id, model, user.id);
      await tx.query('INSERT INTO legacy_imports (project_id, imported_by, source_name, source_sha256, warnings, original) VALUES ($1,$2,$3,$4,$5::jsonb,$6::jsonb)', [
        id,
        user.id,
        model.name.slice(0, 200),
        sha,
        JSON.stringify(warnings),
        JSON.stringify(raw),
      ]);
      const actor = actorInfo(req);
      await writeAudit(tx, actor, { projectId: id, action: 'project.import.legacy', entity: 'project', entityId: id, newValue: { tasks: model.tasks.length, warnings: warnings.length, sha256: sha } });
      // سابقه‌ی تغییرات نسخه‌ی قدیمی (حداکثر ۳۰۰ مورد آخر) به‌عنوان ممیزی با برچسب مشخص ثبت می‌شود
      if (imported.log.length) {
        await writeAudit(
          tx,
          { ...actor, name: 'نسخه‌ی قدیمی' },
          imported.log.map((l) => ({ projectId: id, action: 'legacy.change', entity: 'legacy', entityId: l.subject.slice(0, 40), field: l.field.slice(0, 40), oldValue: l.oldValue, newValue: l.newValue, details: { legacyAt: l.at } })),
        );
      }
      return id;
    });
    res.status(201).json({ projectId: pid, summary, warnings, legacyUsers });
  });

  /** بازیابی فایل پشتیبان این سامانه به‌عنوان پروژه‌ی جدید */
  r.post('/import/project', requireSystemAdmin, async (req: Request, res: Response) => {
    const model = parseExport(req.body);
    const repaired = repairForStorage(model);
    if (!repaired.ok) throw badRequest(repaired.error, undefined, 'IMPORT_INVALID');
    const user = actorOf(req);
    const m = repaired.model;
    const summary = { tasks: m.tasks.length, resources: m.resources.length, costs: m.costs.length, risks: m.risks.length, issues: m.issues.length, changes: m.changes.length, decisions: m.decisions.length, documents: m.documents.length, snapshots: m.snapshots.length, baselineItems: Object.keys(m.baseline).length, baselineHistory: m.baselineHistory.length };
    // پیش‌نمایش: اعتبارسنجی کامل ولی بدون نوشتن. بازیابی همیشه پروژه‌ی «جدید» می‌سازد و کاربران/نقش‌ها را وارد نمی‌کند.
    if (req.query['dryRun'] === '1') {
      const doc = (req.body ?? {}) as { exportedAt?: unknown; exportedBy?: unknown; version?: unknown };
      res.json({
        dryRun: true,
        name: m.name,
        start: m.start,
        status: m.status,
        schemaVersion: doc.version,
        exportedAt: typeof doc.exportedAt === 'string' ? doc.exportedAt : null,
        exportedBy: typeof doc.exportedBy === 'string' ? doc.exportedBy : null,
        summary,
        warnings: repaired.warnings,
      });
      return;
    }
    const pid = await withTx(pool, async (tx) => {
      const id = await insertProjectShell(tx, { name: repaired.model.name, start: repaired.model.start, status: repaired.model.status, contractEnd: repaired.model.contractEnd, finance: repaired.model.finance }, user.id);
      await persistModel(tx, id, repaired.model, user.id);
      await writeAudit(tx, actorInfo(req), { projectId: id, action: 'project.import', entity: 'project', entityId: id, newValue: { tasks: repaired.model.tasks.length, warnings: repaired.warnings.length } });
      return id;
    });
    res.status(201).json({ projectId: pid, summary, warnings: repaired.warnings });
  });

  /** پشتیبان کامل پروژه (JSON). بدون دسترسی به پورسانت، فیلدهای پورسانت در پشتیبان صفر می‌شود. */
  r.get('/projects/:pid/export', projectAccess(pool), requireCap('data.export'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const full = await loadFullModel(poolDb(pool), access.id);
    const model: ProjectModel = structuredClone(full.model);
    if (!access.capabilities.includes('commission.view')) {
      const c: Contract = model.contract;
      model.contract = { ...c, salesApproval: null, salesCommissionPercent: 0, retentionCommissionPercent: 0 };
    }
    if (!access.capabilities.includes('costs.view')) {
      model.costs = [];
      model.snapshots = model.snapshots.map(({ actualCost: _c, ...s }) => s);
    }
    await writeAudit(poolDb(pool), actorInfo(req), { projectId: access.id, action: 'project.export', entity: 'project', entityId: access.id });
    const doc = { format: EXPORT_FORMAT, version: EXPORT_VERSION, exportedAt: new Date().toISOString(), exportedBy: actorOf(req).displayName, model };
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="bistoon-${safeFilename(full.project.name)}-${todayIso()}.json"; filename*=UTF-8''${encodeURIComponent(full.project.name)}-${todayIso()}.json`);
    res.send(JSON.stringify(doc));
  });

  return r;
}
