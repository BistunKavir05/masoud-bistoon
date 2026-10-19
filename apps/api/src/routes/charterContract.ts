import { Router } from 'express';
import type { Request, Response } from 'express';
import type { Pool } from 'pg';
import { z } from 'zod';
import { commissionPayable, contractWarnings } from '@bistoon/core';
import type { Capability } from '@bistoon/core';
import { actorInfo, diffFields, writeAudit } from '../audit.ts';
import { withTx } from '../db.ts';
import { badRequest, forbidden, versionConflict } from '../errors.ts';
import { actorOf, projectOf } from '../http/types.ts';
import { projectAccess, requireCap } from '../middleware.ts';
import { isoDateOrNull, longText, text, version } from '../schemas.ts';
import { loadCharter, loadContract, loadProjectRow, lockProject, redactContract } from '../services/store.ts';

// ───────────────────────── منشور ─────────────────────────

export const CHARTER_COLS: Record<string, string> = {
  client: 'client',
  location: 'location',
  subject: 'subject',
  product: 'product',
  projectManager: 'project_manager',
  salesOwner: 'sales_owner',
  goals: 'goals',
  scope: 'scope',
  assumptions: 'assumptions',
  stakeholders: 'stakeholders',
};
export const charterBody = z
  .object({
    client: text(300),
    location: text(300),
    subject: text(500),
    product: text(300),
    projectManager: text(200),
    salesOwner: text(200),
    goals: longText,
    scope: longText,
    assumptions: longText,
    stakeholders: longText,
  })
  .partial()
  .extend({ version })
  .strict();

// ───────────────────────── قرارداد ─────────────────────────

/** هر فیلد قرارداد و قابلیتی که برای تغییرش لازم است */
export const CONTRACT_FIELDS: Record<string, { col: string; cap: Capability }> = {
  number: { col: 'number', cap: 'contract.edit' },
  date: { col: 'contract_date', cap: 'contract.edit' },
  type: { col: 'type', cap: 'contract.edit' },
  validity: { col: 'validity', cap: 'contract.edit' },
  amount: { col: 'amount', cap: 'contract.edit' },
  advanceDate: { col: 'advance_date', cap: 'contract.edit' },
  advanceGuaranteeSerial: { col: 'advance_guarantee_serial', cap: 'contract.edit' },
  advanceAmount: { col: 'advance_amount', cap: 'contract.edit' },
  performanceGuaranteeSerial: { col: 'performance_guarantee_serial', cap: 'contract.edit' },
  retentionMode: { col: 'retention_mode', cap: 'contract.edit' },
  retentionValue: { col: 'retention_value', cap: 'contract.edit' },
  invoiceNumbers: { col: 'invoice_numbers', cap: 'contract.collection.edit' },
  invoicedTotal: { col: 'invoiced_total', cap: 'contract.collection.edit' },
  collectedTotal: { col: 'collected_total', cap: 'contract.collection.edit' },
  salesCommissionPercent: { col: 'sales_commission_percent', cap: 'commission.edit' },
  retentionCommissionPercent: { col: 'retention_commission_percent', cap: 'commission.edit' },
  salesApproval: { col: 'sales_approval', cap: 'commission.approve' },
};
const rial = z.number().finite().int().min(0).max(9e15);
export const contractBody = z
  .object({
    number: text(100),
    date: isoDateOrNull,
    type: text(100),
    validity: text(200),
    amount: rial,
    advanceDate: isoDateOrNull,
    advanceGuaranteeSerial: text(100),
    advanceAmount: rial,
    performanceGuaranteeSerial: text(100),
    retentionMode: z.enum(['fixed', 'percent']),
    retentionValue: z.number().finite().min(0).max(9e15),
    invoiceNumbers: text(500),
    invoicedTotal: rial,
    collectedTotal: rial,
    salesCommissionPercent: z.number().finite().min(0).max(100),
    retentionCommissionPercent: z.number().finite().min(0).max(100),
    salesApproval: z.enum(['pending', 'approved', 'rejected']).nullable(),
  })
  .partial()
  .extend({ version })
  .strict();

export function charterContractRouter(pool: Pool): Router {
  const r = Router({ mergeParams: true });
  const base = projectAccess(pool);

  r.patch('/charter', base, requireCap('charter.edit'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const { version: expected, ...fields } = charterBody.parse(req.body);
    const given = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
    if (given.length === 0) throw badRequest('هیچ تغییری ارسال نشده است.', undefined, 'EMPTY_PATCH');
    const item = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const before = await loadCharter(tx, access.id);
      if (before.version !== expected) throw versionConflict(before);
      const sets = given.map((g, i) => `${CHARTER_COLS[g]} = $${i + 2}`);
      await tx.query(`UPDATE project_charter SET ${sets.join(', ')}, version = version + 1, updated_at = now(), updated_by = $${given.length + 2} WHERE project_id = $1`, [
        access.id,
        ...given.map((g) => (fields as Record<string, unknown>)[g]),
        actorOf(req).id,
      ]);
      const after = await loadCharter(tx, access.id);
      const changes = diffFields(before as never, after as never, given);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'charter.update', entity: 'charter', field: c.field, oldValue: c.from, newValue: c.to })));
      return after;
    });
    res.json({ item });
  });

  /** قرارداد: هر گروه فیلد قابلیت خودش را می‌خواهد؛ اگر حتی یک فیلد مجاز نباشد کل درخواست رد می‌شود. */
  r.patch('/contract', base, requireCap('contract.edit', 'contract.collection.edit', 'commission.edit', 'commission.approve'), async (req: Request, res: Response) => {
    const access = projectOf(req);
    const { version: expected, ...fields } = contractBody.parse(req.body);
    const given = Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined);
    if (given.length === 0) throw badRequest('هیچ تغییری ارسال نشده است.', undefined, 'EMPTY_PATCH');
    const denied = given.filter((g) => !access.capabilities.includes(CONTRACT_FIELDS[g]!.cap));
    if (denied.length) throw forbidden('نقش شما اجازه‌ی تغییر این فیلدهای قرارداد را ندارد.', 'FORBIDDEN', { fields: denied });
    const out = await withTx(pool, async (tx) => {
      await lockProject(tx, access.id);
      const before = await loadContract(tx, access.id);
      if (before.version !== expected) throw versionConflict(redactContract(before, access.capabilities.includes('commission.view')));
      const sets = given.map((g, i) => `${CONTRACT_FIELDS[g]!.col} = $${i + 2}`);
      await tx.query(`UPDATE project_contract SET ${sets.join(', ')}, version = version + 1, updated_at = now(), updated_by = $${given.length + 2} WHERE project_id = $1`, [
        access.id,
        ...given.map((g) => (fields as Record<string, unknown>)[g]),
        actorOf(req).id,
      ]);
      const after = await loadContract(tx, access.id);
      const changes = diffFields(before as never, after as never, given);
      await writeAudit(tx, actorInfo(req), changes.map((c) => ({ projectId: access.id, action: 'contract.update', entity: 'contract', field: c.field, oldValue: c.from, newValue: c.to })));
      const project = await loadProjectRow(tx, access.id);
      return { after, startDate: project.start_date };
    });
    const canCommission = access.capabilities.includes('commission.view');
    const { version: _v, ...plain } = out.after;
    res.json({
      item: redactContract(out.after, canCommission),
      commission: canCommission ? commissionPayable(plain) : undefined,
      warnings: contractWarnings(plain, out.startDate),
    });
  });

  return r;
}
