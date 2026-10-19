import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import type { PortfolioItem } from '@bistoon/core';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import type { AuditEntry } from '../audit.ts';
import { many, poolDb, withTx } from '../db.ts';
import type { Db } from '../db.ts';
import { badRequest } from '../errors.ts';
import { actorOf } from '../http/types.ts';
import { requireSystemAdmin } from '../middleware.ts';
import { isoDate, posInt } from '../schemas.ts';
import { loadCharter, loadContract, lockProject } from '../services/store.ts';
import { CHARTER_COLS, CONTRACT_FIELDS, charterBody, contractBody } from './charterContract.ts';
import { PROJECT_COLS } from './projects.ts';
import type { ProjectRow } from './projects.ts';

const SOURCE = { source: 'portfolio.import' };

const updateSchema = z
  .object({
    projectId: posInt,
    charter: charterBody.omit({ version: true }).optional(),
    contract: contractBody.omit({ version: true }).optional(),
    contractEnd: isoDate.optional(),
  })
  .strict();
const importBody = z.object({ updates: z.array(updateSchema).min(1).max(1000) }).strict();

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a ?? null) === JSON.stringify(b ?? null);

/**
 * فیلدهای داده‌شده‌ی یک جدول (منشور یا قرارداد) را فقط در صورت تفاوت واقعی می‌نویسد و تعداد فیلد تغییرکرده را برمی‌گرداند.
 * نسخه‌ی ردیف فقط وقتی تغییری هست بالا می‌رود تا ورودِ بی‌اثر لاگ و نسخه‌ی اضافه نسازد.
 */
async function applyFields(
  tx: Db,
  opts: { table: 'project_charter' | 'project_contract'; cols: Record<string, string>; action: string; entity: string; pid: number; userId: number },
  patch: Record<string, unknown>,
  load: () => Promise<Record<string, unknown>>,
  audits: AuditEntry[],
): Promise<number> {
  const given = Object.keys(patch).filter((k) => patch[k] !== undefined);
  if (given.length === 0) return 0;
  const before = await load();
  const diff = given.filter((k) => !same(before[k], patch[k]));
  if (diff.length === 0) return 0;
  const sets = diff.map((g, i) => `${opts.cols[g]} = $${i + 2}`);
  await tx.query(`UPDATE ${opts.table} SET ${sets.join(', ')}, version = version + 1, updated_at = now(), updated_by = $${diff.length + 2} WHERE project_id = $1`, [opts.pid, ...diff.map((g) => patch[g]), opts.userId]);
  const after = await load();
  for (const c of diffFields(before, after, diff)) {
    audits.push({ projectId: opts.pid, action: opts.action, entity: opts.entity, field: c.field, oldValue: c.from, newValue: c.to, details: SOURCE });
  }
  return diff.length;
}

export function portfolioRouter(pool: Pool): Router {
  const r = Router();

  /** جدول یکپارچه‌ی همه‌ی پروژه‌ها (منشور و قرارداد) — فقط ادمین سیستم */
  r.get('/portfolio', requireSystemAdmin, async (_req: Request, res: Response) => {
    const db = poolDb(pool);
    const projects = await many<ProjectRow>(db, `SELECT ${PROJECT_COLS} FROM projects ORDER BY lower(name), id`);
    const items: PortfolioItem[] = [];
    for (const p of projects) {
      const ch = await loadCharter(db, p.id);
      const { version: _v, ...contract } = await loadContract(db, p.id);
      items.push({
        id: p.id,
        name: p.name,
        start: p.start_date as PortfolioItem['start'],
        status: p.status_date as PortfolioItem['status'],
        contractEnd: p.contract_end as PortfolioItem['contractEnd'],
        archived: p.archived_at !== null,
        unit: p.finance_unit,
        charter: { client: ch.client, location: ch.location, subject: ch.subject, product: ch.product, projectManager: ch.projectManager, salesOwner: ch.salesOwner },
        contract,
      });
    }
    res.json({ items });
  });

  /**
   * ورود گروهی اطلاعات قرارداد/منشور (پیش‌نمایش در کلاینت انجام شده). همه‌چیز در یک تراکنش است: اگر یک پروژه رد شود هیچ‌کدام نوشته نمی‌شود.
   * فقط فیلدهای داده‌شده نوشته می‌شود (هیچ مقداری پاک نمی‌شود)؛ پایان قرارداد فقط برای پروژه‌ی بدون پایان؛ پروژه‌ی بایگانی‌شده رد می‌شود.
   */
  r.post('/portfolio/import', requireSystemAdmin, async (req: Request, res: Response) => {
    const { updates } = importBody.parse(req.body);
    const ids = updates.map((u) => u.projectId);
    if (new Set(ids).size !== ids.length) throw badRequest('یک پروژه بیش از یک‌بار در درخواست آمده است.', undefined, 'DUPLICATE_PROJECT');
    const sorted = [...updates].sort((a, b) => a.projectId - b.projectId);
    const user = actorOf(req);
    const results = await withTx(pool, async (tx) => {
      const out: { projectId: number; changed: number; contractEndSkipped: boolean }[] = [];
      for (const u of sorted) {
        const p = await lockProject(tx, u.projectId);
        if (p.archived_at !== null) throw badRequest(`پروژه‌ی «${p.name}» بایگانی شده است و ورود اطلاعات به آن ممکن نیست.`, undefined, 'ARCHIVED');
        const audits: AuditEntry[] = [];
        let changed = 0;
        changed += await applyFields(
          tx,
          { table: 'project_charter', cols: CHARTER_COLS, action: 'charter.update', entity: 'charter', pid: p.id, userId: user.id },
          (u.charter ?? {}) as Record<string, unknown>,
          async () => (await loadCharter(tx, p.id)) as unknown as Record<string, unknown>,
          audits,
        );
        changed += await applyFields(
          tx,
          { table: 'project_contract', cols: Object.fromEntries(Object.entries(CONTRACT_FIELDS).map(([k, v]) => [k, v.col])), action: 'contract.update', entity: 'contract', pid: p.id, userId: user.id },
          (u.contract ?? {}) as Record<string, unknown>,
          async () => (await loadContract(tx, p.id)) as unknown as Record<string, unknown>,
          audits,
        );
        let endSkipped = false;
        if (u.contractEnd !== undefined) {
          if (p.contract_end !== null) endSkipped = p.contract_end !== u.contractEnd;
          else {
            await tx.query('UPDATE projects SET contract_end = $2, version = version + 1, updated_at = now(), updated_by = $3 WHERE id = $1', [p.id, u.contractEnd, user.id]);
            audits.push({ projectId: p.id, action: 'project.update', entity: 'project', entityId: p.id, field: 'contractEnd', oldValue: null, newValue: u.contractEnd, details: SOURCE });
            changed += 1;
          }
        }
        await writeAudit(tx, actorInfo(req), audits);
        out.push({ projectId: p.id, changed, contractEndSkipped: endSkipped });
      }
      await writeAudit(tx, actorInfo(req), { action: 'portfolio.import', entity: 'project', details: { projects: out.length, changedProjects: out.filter((x) => x.changed > 0).length, fields: out.reduce((a, x) => a + x.changed, 0) } });
      return out;
    });
    res.json({ results, changedProjects: results.filter((x) => x.changed > 0).length });
  });

  return r;
}
