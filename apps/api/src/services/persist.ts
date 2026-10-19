/**
 * نوشتن یک ProjectModel کامل در پروژه‌ی تازه‌ساخته (برای ورود از نسخه‌ی قدیمی و بازیابی پشتیبان).
 * شناسه‌ها حفظ می‌شوند (وابستگی‌ها و خط مبنا با آن‌ها به فعالیت‌ها ارجاع می‌دهند) و شمارنده‌ها بعد از بیشینه تنظیم می‌شوند.
 */
import type { ProjectModel } from '@bistoon/core';
import type { Db } from '../db.ts';
import { insertSnapshots, saveTasks } from './store.ts';

const maxId = (list: readonly { id: number }[]): number => list.reduce((m, x) => Math.max(m, x.id), 0);

async function bump(db: Db, pid: number, kind: string, ids: readonly { id: number }[]): Promise<void> {
  await db.query('SELECT bump_seq($1, $2, $3)', [pid, kind, maxId(ids) + 1]);
}

export async function persistModel(db: Db, pid: number, m: ProjectModel, userId: number): Promise<void> {
  for (let d = 0; d < 7; d++) {
    const day = m.calendar.days[d]!;
    await db.query('UPDATE project_workdays SET working = $3, from_time = $4, to_time = $5 WHERE project_id = $1 AND weekday = $2', [pid, d, day.working, day.from, day.to]);
  }
  for (const h of m.calendar.holidays) {
    await db.query('INSERT INTO project_holidays (project_id, holiday_date, title) VALUES ($1,$2,$3) ON CONFLICT (project_id, holiday_date) DO UPDATE SET title = EXCLUDED.title', [pid, h.date, h.title]);
  }

  for (const r of m.resources) {
    await db.query('INSERT INTO resources (project_id, id, name, type, capacity_percent, daily_rate) VALUES ($1,$2,$3,$4,$5,$6)', [pid, r.id, r.name, r.type, r.capacityPercent, r.dailyRate]);
  }
  await bump(db, pid, 'resource', m.resources);

  await saveTasks(db, pid, [], m.tasks, userId);
  await bump(db, pid, 'task', m.tasks);

  const ch = m.charter;
  await db.query(
    `UPDATE project_charter SET client = $2, location = $3, subject = $4, product = $5, project_manager = $6, sales_owner = $7,
            goals = $8, scope = $9, assumptions = $10, stakeholders = $11, updated_by = $12 WHERE project_id = $1`,
    [pid, ch.client, ch.location, ch.subject, ch.product, ch.projectManager, ch.salesOwner, ch.goals, ch.scope, ch.assumptions, ch.stakeholders, userId],
  );
  const c = m.contract;
  await db.query(
    `UPDATE project_contract SET number = $2, contract_date = $3, type = $4, validity = $5, amount = $6, advance_date = $7,
            advance_guarantee_serial = $8, advance_amount = $9, invoice_numbers = $10, invoiced_total = $11, collected_total = $12,
            performance_guarantee_serial = $13, retention_mode = $14, retention_value = $15, sales_approval = $16,
            sales_commission_percent = $17, retention_commission_percent = $18, updated_by = $19 WHERE project_id = $1`,
    [pid, c.number, c.date, c.type, c.validity, c.amount, c.advanceDate, c.advanceGuaranteeSerial, c.advanceAmount, c.invoiceNumbers, c.invoicedTotal, c.collectedTotal, c.performanceGuaranteeSerial, c.retentionMode, c.retentionValue, c.salesApproval, c.salesCommissionPercent, c.retentionCommissionPercent, userId],
  );

  // خط مبنا: قدیمی‌ترین بایگانی اول؛ خط مبنای جاری آخر
  const writeBaseline = async (items: ProjectModel['baseline'], label: string, statusDate: string, current: boolean, archivedOn: string | null): Promise<void> => {
    const id = (await db.query<{ n: number }>('SELECT next_seq($1, $2) AS n', [pid, 'baseline'])).rows[0]!.n;
    await db.query('INSERT INTO baselines (project_id, id, label, status_date, is_current, archived_on, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7)', [pid, id, label, statusDate, current, archivedOn, userId]);
    const entries = Object.entries(items);
    if (entries.length) {
      await db.query(
        `INSERT INTO baseline_items (project_id, baseline_id, task_id, start_date, finish_date, zero_duration, cost)
         SELECT $1, $2, t, s, f, z, k FROM unnest($3::int[], $4::date[], $5::date[], $6::boolean[], $7::numeric[]) AS x(t, s, f, z, k)`,
        [pid, id, entries.map(([k]) => Number(k)), entries.map(([, v]) => v.start), entries.map(([, v]) => v.finish), entries.map(([, v]) => v.zeroDuration), entries.map(([, v]) => v.cost)],
      );
    }
  };
  for (const h of m.baselineHistory) await writeBaseline(h.items, '', h.archivedOn, false, h.archivedOn);
  if (Object.keys(m.baseline).length > 0) await writeBaseline(m.baseline, '', m.status, true, null);

  await insertSnapshots(db, pid, m.snapshots, userId);

  for (const e of m.costs) {
    await db.query('INSERT INTO cost_entries (project_id, id, entry_date, task_id, description, document, amount, created_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [pid, e.id, e.date, e.taskId, e.description, e.document, e.amount, userId]);
  }
  await bump(db, pid, 'cost', m.costs);

  for (const r of m.risks) {
    await db.query('INSERT INTO risks (project_id, id, title, category, probability, impact, owner, strategy, response, due, status, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)', [pid, r.id, r.title, r.category, r.probability, r.impact, r.owner, r.strategy, r.response, r.due, r.status, userId]);
  }
  await bump(db, pid, 'risk', m.risks);
  for (const i of m.issues) {
    await db.query('INSERT INTO issues (project_id, id, title, owner, priority, due, impact, action, needs_decision, status, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)', [pid, i.id, i.title, i.owner, i.priority, i.due, i.impact, i.action, i.needsDecision, i.status, userId]);
  }
  await bump(db, pid, 'issue', m.issues);
  for (const x of m.changes) {
    await db.query(
      'INSERT INTO change_requests (project_id, id, title, requester, request_date, reason, impact, previous_finish, new_finish, status, approved_by, approved_on, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)',
      [pid, x.id, x.title, x.requester, x.date, x.reason, x.impact, x.previousFinish, x.newFinish, x.status, x.approvedBy, x.approvedOn, userId],
    );
  }
  await bump(db, pid, 'change', m.changes);
  for (const x of m.decisions) {
    await db.query('INSERT INTO decisions (project_id, id, topic, decision_text, maker, decision_date, status, updated_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [pid, x.id, x.topic, x.text, x.maker, x.date, x.status, userId]);
  }
  await bump(db, pid, 'decision', m.decisions);
  for (const d of m.documents) {
    await db.query('INSERT INTO project_documents (project_id, id, title, doc_type, url, task_id, doc_date, added_by) VALUES ($1,$2,$3,$4,$5,$6,$7,$8)', [pid, d.id, d.title, d.type, d.url, d.taskId, d.date, null]);
  }
  await bump(db, pid, 'document', m.documents);
}
