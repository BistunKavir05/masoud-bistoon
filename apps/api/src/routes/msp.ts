/**
 * ورود فایل Microsoft Project XML.
 *  - POST /import/msp                          پروژه‌ی جدید از فایل (ادمین سیستم)؛ با dryRun فقط پیش‌نمایش
 *  - POST /projects/:pid/import/msp/preview    پیش‌نمایش ورود به پروژه‌ی موجود: نگاشت، تفاوت‌ها، اثر بر هر دسته از داده، مانع‌ها
 *  - POST /projects/:pid/import/msp            اعمال یکپارچه (همه یا هیچ) با نشانه‌ی تأیید پیش‌نمایش
 * منطق تبدیل و برنامه‌ی ورود در هسته است (packages/core/src/msp*.ts)؛ این‌جا فقط دسترسی، تراکنش و ذخیره‌سازی است.
 */
import { createHash } from 'node:crypto';
import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { modelFromMsp, parseMspXml, planMspImport, suggestMapping } from '@bistoon/core';
import type { MspMapping, MspParsed, MspPlan, MspPreviewDto, ProjectModel } from '@bistoon/core';
import { actorInfo, writeAudit } from '../audit.ts';
import type { Db } from '../db.ts';
import { one, poolDb, withTx } from '../db.ts';
import { badRequest, conflict } from '../errors.ts';
import { actorOf, projectOf } from '../http/types.ts';
import { projectAccess, requireCap, requireSystemAdmin } from '../middleware.ts';
import { text } from '../schemas.ts';
import { persistModel } from '../services/persist.ts';
import { loadFullModel, lockProject, saveTasks } from '../services/store.ts';
import { insertProjectShell } from './projects.ts';

const todayIso = (): string => new Date().toISOString().slice(0, 10);

const fileBody = z.object({
  xml: z.string().min(20).max(40_000_000),
  /** ساعت هر «روز» برای تبدیل مدت‌ها؛ پیش‌فرض MinutesPerDay فایل */
  hoursPerDay: z.number().min(0.25).max(24).optional(),
});
const planBody = fileBody.extend({
  mapping: z.enum(['auto', 'id', 'name', 'none']).default('auto'),
  keepProgress: z.boolean().default(false),
  keepStart: z.boolean().default(false),
});
const applyBody = planBody.extend({ token: z.string().length(32), confirm: z.literal(true) });
const newBody = fileBody.extend({ name: text(200).optional(), unit: text(24).optional(), dryRun: z.boolean().default(false) });

type Warn = { code: string; message: string; taskId?: number; uid?: number };

function parseOrThrow(xml: string, opts: Parameters<typeof parseMspXml>[1]): MspParsed {
  const r = parseMspXml(xml, opts);
  if (!r.ok) throw badRequest(r.error, undefined, 'MSP_INVALID');
  return r.value;
}

const fileDto = (p: MspParsed) => ({ name: p.name, start: p.start, status: p.status, minutesPerDay: p.minutesPerDay, hoursPerDay: p.hoursPerDay, counts: p.counts, calendarFromFile: p.calendarFromFile });
const cap = <T>(list: readonly T[], n: number): { count: number; items: T[] } => ({ count: list.length, items: list.slice(0, n) });

/** شناسه‌ی بعدیِ شمارنده‌ی فعالیت‌ها بدون جلو بردنِ آن؛ شناسه‌های کوچک‌تر قبلاً استفاده شده‌اند. */
async function nextTaskSeq(db: Db, pid: number): Promise<number> {
  const row = await one<{ next_value: number }>(db, "SELECT next_value FROM project_counters WHERE project_id = $1 AND kind = 'task'", [pid]);
  return row?.next_value ?? 1;
}

/** نشانه‌ی تأیید: خلاصه‌ی دقیق آنچه اعمال می‌شود؛ اگر پروژه بین پیش‌نمایش و اعمال تغییر کند فرق می‌کند. */
function planToken(plan: MspPlan): string {
  return createHash('sha256')
    .update(JSON.stringify({ tasks: plan.tasks, baseline: plan.baseline, replaceBaseline: plan.replaceBaseline, start: plan.start }))
    .digest('hex')
    .slice(0, 32);
}

function planDto(parsed: MspParsed, model: ProjectModel, plan: MspPlan, suggested: MspMapping): MspPreviewDto {
  return {
    file: fileDto(parsed),
    project: { start: model.start, taskCount: model.tasks.length },
    mapping: { used: plan.mapping, suggested, stats: plan.stats },
    options: plan.options,
    result: {
      rows: plan.tasks.length,
      matched: plan.matched,
      added: plan.added,
      removed: cap(plan.removed, 100),
      renamed: cap(plan.renamed, 50),
      kindChanged: cap(plan.kindChanged, 50),
      start: plan.start,
      replaceBaseline: plan.replaceBaseline,
      schedule: plan.schedule,
    },
    effects: plan.effects,
    blockers: plan.blockers,
    warnings: cap(plan.warnings, 100),
    token: planToken(plan),
  };
}

export function mspRouter(pool: Pool): Router {
  const r = Router();

  /** پروژه‌ی جدید از فایل MSP (شناسه‌ی فعالیت = UID فایل؛ تقویم از خود فایل) */
  r.post('/import/msp', requireSystemAdmin, async (req: Request, res: Response) => {
    const b = newBody.parse(req.body);
    const parsed = parseOrThrow(b.xml, { useFileCalendar: true, hoursPerDay: b.hoursPerDay });
    const name = (b.name && b.name.length > 0 ? b.name : parsed.name).trim();
    if (!name) throw badRequest('فایل نام پروژه ندارد؛ نام پروژه را وارد کنید.', undefined, 'NAME_REQUIRED');
    const built = modelFromMsp(parsed, { today: todayIso(), name, ...(b.unit ? { unit: b.unit } : {}) });
    if (!built.ok) throw badRequest(built.error, undefined, 'MSP_INVALID');
    const model = built.model;
    const summary = { file: fileDto(parsed), rows: model.tasks.length, baselineItems: Object.keys(model.baseline).length, snapshots: model.snapshots.length, schedule: built.schedule };
    if (b.dryRun) {
      res.json({ dryRun: true, name, summary, warnings: cap(built.warnings as Warn[], 100) });
      return;
    }
    const user = actorOf(req);
    const sha = createHash('sha256').update(b.xml).digest('hex');
    const pid = await withTx(pool, async (tx) => {
      const id = await insertProjectShell(tx, { name: model.name, start: model.start, status: model.status, contractEnd: model.contractEnd, finance: model.finance }, user.id);
      await persistModel(tx, id, model, user.id);
      await writeAudit(tx, actorInfo(req), { projectId: id, action: 'project.import.msp', entity: 'project', entityId: id, newValue: { rows: model.tasks.length, baselineItems: summary.baselineItems, warnings: built.warnings.length, sha256: sha, newProject: true } });
      return id;
    });
    res.status(201).json({ projectId: pid, summary, warnings: cap(built.warnings as Warn[], 100) });
  });

  /** پیش‌نمایش ورود به پروژه‌ی موجود؛ چیزی نوشته نمی‌شود. */
  r.post('/projects/:pid/import/msp/preview', projectAccess(pool, { allowArchivedWrites: true }), requireCap('data.import'), async (req: Request, res: Response) => {
    const b = planBody.parse(req.body);
    const access = projectOf(req);
    const db = poolDb(pool);
    const full = await loadFullModel(db, access.id);
    const parsed = parseOrThrow(b.xml, { calendar: full.model.calendar, hoursPerDay: b.hoursPerDay });
    const suggested = suggestMapping(full.model, parsed);
    const mapping: MspMapping = b.mapping === 'auto' ? suggested : b.mapping;
    const plan = planMspImport(full.model, parsed, { mapping, keepProgress: b.keepProgress, keepStart: b.keepStart, idFloor: await nextTaskSeq(db, access.id) }, full.project.archived_at !== null);
    res.json(planDto(parsed, full.model, plan, suggested));
  });

  /** اعمال ورود: همه یا هیچ. فایل خراب یا مانع‌دار پروژه را نیمه‌تغییر نمی‌دهد. */
  r.post('/projects/:pid/import/msp', projectAccess(pool), requireCap('data.import'), async (req: Request, res: Response) => {
    const b = applyBody.parse(req.body);
    const access = projectOf(req);
    const user = actorOf(req);
    const sha = createHash('sha256').update(b.xml).digest('hex');
    const out = await withTx(pool, async (tx) => {
      const project = await lockProject(tx, access.id);
      const full = await loadFullModel(tx, access.id);
      const parsed = parseOrThrow(b.xml, { calendar: full.model.calendar, hoursPerDay: b.hoursPerDay });
      const suggested = suggestMapping(full.model, parsed);
      const mapping: MspMapping = b.mapping === 'auto' ? suggested : b.mapping;
      const plan = planMspImport(full.model, parsed, { mapping, keepProgress: b.keepProgress, keepStart: b.keepStart, idFloor: await nextTaskSeq(tx, access.id) });
      if (plan.blockers.length > 0) throw conflict(plan.blockers[0]!.message, 'MSP_BLOCKED', { blockers: plan.blockers });
      if (planToken(plan) !== b.token) throw conflict('پروژه از زمان پیش‌نمایش تغییر کرده است؛ پیش‌نمایش را دوباره بگیرید و بررسی کنید.', 'PLAN_CHANGED');

      await saveTasks(tx, access.id, full.model.tasks, plan.tasks, user.id);
      const maxId = plan.tasks.reduce((m, t) => Math.max(m, t.id), 0);
      await tx.query('SELECT bump_seq($1, $2, $3)', [access.id, 'task', maxId + 1]);

      if (plan.replaceBaseline) {
        const items = Object.entries(plan.baseline);
        await tx.query('UPDATE baselines SET is_current = false, archived_on = $2 WHERE project_id = $1 AND is_current', [access.id, full.project.status_date]);
        const id = (await one<{ n: number }>(tx, 'SELECT next_seq($1, $2) AS n', [access.id, 'baseline']))!.n;
        await tx.query('INSERT INTO baselines (project_id, id, label, status_date, is_current, created_by) VALUES ($1,$2,$3,$4,true,$5)', [access.id, id, 'ورود از فایل MS Project', full.project.status_date, user.id]);
        if (items.length) {
          await tx.query(
            `INSERT INTO baseline_items (project_id, baseline_id, task_id, start_date, finish_date, zero_duration, cost)
             SELECT $1, $2, t, s, f, z, c FROM unnest($3::int[], $4::date[], $5::date[], $6::boolean[], $7::numeric[]) AS x(t, s, f, z, c)`,
            [access.id, id, items.map(([k]) => Number(k)), items.map(([, v]) => v.start), items.map(([, v]) => v.finish), items.map(([, v]) => v.zeroDuration), items.map(([, v]) => v.cost)],
          );
        }
      }

      await tx.query(
        `UPDATE projects SET start_date = $2, structure_version = structure_version + 1, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1`,
        [access.id, plan.start, user.id],
      );
      const actor = actorInfo(req);
      const entries = [
        {
          projectId: access.id,
          action: 'project.import.msp',
          entity: 'project',
          entityId: access.id,
          newValue: {
            rows: plan.tasks.length,
            matched: plan.matched,
            added: plan.added,
            removed: plan.removed.length,
            mapping: plan.mapping,
            keepProgress: plan.options.keepProgress,
            keepStart: plan.options.keepStart,
            baselineReplaced: plan.replaceBaseline,
            sha256: sha,
          },
          details: { effects: plan.effects, warnings: (plan.warnings as Warn[]).slice(0, 50), removed: plan.removed.slice(0, 100).map((x) => ({ id: x.id, name: x.name })), renamed: plan.renamed.slice(0, 50) },
        },
        ...(plan.start !== project.start_date ? [{ projectId: access.id, action: 'project.update', entity: 'project', entityId: access.id, field: 'start', oldValue: project.start_date, newValue: plan.start }] : []),
      ];
      await writeAudit(tx, actor, entries);
      return { rows: plan.tasks.length, matched: plan.matched, added: plan.added, removed: plan.removed.length, baselineReplaced: plan.replaceBaseline, start: plan.start };
    });
    res.json({ ok: true, result: out });
  });

  return r;
}
