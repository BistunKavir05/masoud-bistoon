/**
 * خواندن کل مدل پروژه از پایگاه‌داده و نوشتن فعالیت‌ها.
 * مدل خوانده‌شده همان ProjectModel هسته است تا سرور و کلاینت با یک کد محاسبه کنند.
 */
import type {
  Assignment,
  Baseline,
  BaselineHistoryDto,
  BaselineDto,
  Charter,
  CharterDto,
  ChangeRequestDto,
  Contract,
  ContractDto,
  CostEntryDto,
  DecisionDto,
  DocumentDto,
  IssueDto,
  IsoDate,
  ProjectModel,
  Resource,
  ResourceDto,
  RiskDto,
  Snapshot,
  Task,
  TaskDto,
  WorkCalendar,
} from '@bistoon/core';
import type { Db } from '../db.ts';
import { many, one } from '../db.ts';
import { conflict, notFound } from '../errors.ts';
import type { ProjectRow } from '../routes/projects.ts';
import { PROJECT_COLS } from '../routes/projects.ts';

// ───────────────────────── قفل و ردیف پروژه ─────────────────────────

/** ردیف پروژه را قفل می‌کند؛ نوشتن‌های ساختاری یک پروژه پشت سر هم اجرا می‌شوند. */
export async function lockProject(db: Db, pid: number): Promise<ProjectRow> {
  const row = await one<ProjectRow>(db, `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1 FOR UPDATE`, [pid]);
  if (!row) throw notFound('پروژه پیدا نشد.', 'NO_PROJECT');
  return row;
}

export async function loadProjectRow(db: Db, pid: number): Promise<ProjectRow> {
  const row = await one<ProjectRow>(db, `SELECT ${PROJECT_COLS} FROM projects WHERE id = $1`, [pid]);
  if (!row) throw notFound('پروژه پیدا نشد.', 'NO_PROJECT');
  return row;
}

// ───────────────────────── تقویم ─────────────────────────

export async function loadCalendar(db: Db, pid: number): Promise<WorkCalendar> {
  const days = await many<{ weekday: number; working: boolean; from_time: string; to_time: string }>(
    db,
    'SELECT weekday, working, from_time, to_time FROM project_workdays WHERE project_id = $1 ORDER BY weekday',
    [pid],
  );
  const holidays = await many<{ holiday_date: IsoDate; title: string }>(db, 'SELECT holiday_date, title FROM project_holidays WHERE project_id = $1 ORDER BY holiday_date', [pid]);
  return {
    days: days.map((d) => ({ working: d.working, from: d.from_time.slice(0, 5), to: d.to_time.slice(0, 5) })),
    holidays: holidays.map((h) => ({ date: h.holiday_date, title: h.title })),
  };
}

// ───────────────────────── فعالیت‌ها ─────────────────────────

interface TaskRow {
  id: number;
  name: string;
  level: number;
  kind: Task['kind'];
  duration: number;
  weight: number;
  percent_complete: number;
  actual_start: IsoDate | null;
  actual_finish: IsoDate | null;
  work: number;
  start_no_earlier_than: IsoDate | null;
  start_no_earlier_source: Task['startNoEarlierSource'];
  deadline: IsoDate | null;
  level_of_effort: boolean;
  legacy_actual_cost: number | null;
  cost_tracked: boolean;
  version: number;
}

export async function loadTasks(db: Db, pid: number): Promise<TaskDto[]> {
  const rows = await many<TaskRow>(
    db,
    `SELECT id, name, level, kind, duration, weight, percent_complete, actual_start, actual_finish, work,
            start_no_earlier_than, start_no_earlier_source, deadline, level_of_effort, legacy_actual_cost, cost_tracked, version
       FROM tasks WHERE project_id = $1 ORDER BY position`,
    [pid],
  );
  const deps = await many<{ task_id: number; predecessor_id: number; dep_type: 'FS' | 'SS' | 'FF' | 'SF'; lag: number }>(
    db,
    'SELECT task_id, predecessor_id, dep_type, lag FROM task_dependencies WHERE project_id = $1 ORDER BY task_id, predecessor_id',
    [pid],
  );
  const assigns = await many<{ task_id: number; resource_id: number; units: number }>(
    db,
    'SELECT task_id, resource_id, units FROM task_assignments WHERE project_id = $1 ORDER BY task_id, resource_id',
    [pid],
  );
  const costs = await many<{ task_id: number; name: string; amount: number }>(
    db,
    'SELECT task_id, name, amount FROM task_direct_costs WHERE project_id = $1 ORDER BY task_id, line_no',
    [pid],
  );
  const group = <T extends { task_id: number }>(list: T[]): Map<number, T[]> => {
    const m = new Map<number, T[]>();
    for (const x of list) {
      const a = m.get(x.task_id);
      if (a) a.push(x);
      else m.set(x.task_id, [x]);
    }
    return m;
  };
  const dm = group(deps);
  const am = group(assigns);
  const cm = group(costs);
  return rows.map((r) => ({
    id: r.id,
    name: r.name,
    level: r.level,
    kind: r.kind,
    duration: r.duration,
    dependencies: (dm.get(r.id) ?? []).map((d) => ({ predecessorId: d.predecessor_id, type: d.dep_type, lag: d.lag })),
    weight: r.weight,
    percentComplete: r.percent_complete,
    actualStart: r.actual_start,
    actualFinish: r.actual_finish,
    work: r.work,
    assignments: (am.get(r.id) ?? []).map((a): Assignment => ({ resourceId: a.resource_id, units: a.units })),
    startNoEarlierThan: r.start_no_earlier_than,
    startNoEarlierSource: r.start_no_earlier_source,
    deadline: r.deadline,
    levelOfEffort: r.level_of_effort,
    directCosts: (cm.get(r.id) ?? []).map((c) => ({ name: c.name, amount: c.amount })),
    legacyActualCost: r.legacy_actual_cost,
    costTracked: r.cost_tracked,
    version: r.version,
  }));
}

/** امضای قطعی محتوای یک فعالیت (به‌همراه جایگاهش) برای تشخیص تغییر */
function taskSignature(t: Task, position: number): string {
  return JSON.stringify([
    position,
    t.name,
    t.level,
    t.kind,
    t.duration,
    t.weight,
    t.percentComplete,
    t.actualStart,
    t.actualFinish,
    t.work,
    t.startNoEarlierThan,
    t.startNoEarlierSource,
    t.deadline,
    t.levelOfEffort,
    t.legacyActualCost,
    t.costTracked,
    [...t.dependencies].sort((a, b) => a.predecessorId - b.predecessorId).map((d) => [d.predecessorId, d.type, d.lag]),
    [...t.assignments].sort((a, b) => a.resourceId - b.resourceId).map((a) => [a.resourceId, a.units]),
    t.directCosts.map((c) => [c.name, c.amount]),
  ]);
}

export interface TaskSaveResult {
  inserted: number[];
  updated: number[];
  deleted: number[];
}

/**
 * فهرست فعالیت‌ها را از وضعیت `before` به `after` می‌برد: فقط ردیف‌های تغییرکرده نوشته می‌شوند و نسخه‌شان بالا می‌رود.
 * فعالیت دارای هزینه‌ی ثبت‌شده حذف نمی‌شود (برخلاف برنامه‌ی قبلی که هزینه را بی‌صدا «سربار» می‌کرد).
 */
export async function saveTasks(db: Db, pid: number, before: readonly Task[], after: readonly Task[], userId: number): Promise<TaskSaveResult> {
  const beforeIds = new Map(before.map((t, i) => [t.id, { t, i }]));
  const afterIds = new Set(after.map((t) => t.id));
  const deleted = before.filter((t) => !afterIds.has(t.id)).map((t) => t.id);
  if (deleted.length) {
    const used = await one<{ n: number }>(db, 'SELECT count(*)::int AS n FROM cost_entries WHERE project_id = $1 AND task_id = ANY($2::int[])', [pid, deleted]);
    if (used && used.n > 0) {
      throw conflict('برای این فعالیت (یا زیرمجموعه‌اش) هزینه ثبت شده است؛ ابتدا هزینه‌ها را به فعالیت دیگری منتقل یا حذف کنید.', 'TASK_HAS_COSTS');
    }
    await db.query('DELETE FROM tasks WHERE project_id = $1 AND id = ANY($2::int[])', [pid, deleted]);
  }

  const inserted: number[] = [];
  const updated: number[] = [];
  const rewriteChildren: Task[] = [];
  for (let i = 0; i < after.length; i++) {
    const t = after[i]!;
    const prev = beforeIds.get(t.id);
    const position = i + 1;
    const isSummary = t.kind === 'summary';
    const params = [
      pid,
      t.id,
      position,
      t.name,
      t.level,
      t.kind,
      isSummary ? 0 : t.duration,
      isSummary ? 0 : t.weight,
      isSummary ? 0 : t.percentComplete,
      isSummary ? null : t.actualStart,
      isSummary ? null : t.actualFinish,
      isSummary ? 0 : t.work,
      isSummary ? null : t.startNoEarlierThan,
      isSummary ? null : t.startNoEarlierSource,
      isSummary ? null : t.deadline,
      isSummary ? false : t.levelOfEffort,
      isSummary ? null : t.legacyActualCost,
      t.costTracked,
      userId,
    ];
    if (!prev) {
      await db.query(
        `INSERT INTO tasks (project_id, id, position, name, level, kind, duration, weight, percent_complete, actual_start, actual_finish, work,
                            start_no_earlier_than, start_no_earlier_source, deadline, level_of_effort, legacy_actual_cost, cost_tracked, updated_by)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)`,
        params,
      );
      inserted.push(t.id);
      rewriteChildren.push(t);
    } else if (taskSignature(prev.t, prev.i + 1) !== taskSignature(t, position)) {
      await db.query(
        `UPDATE tasks SET position = $3, name = $4, level = $5, kind = $6, duration = $7, weight = $8, percent_complete = $9,
                actual_start = $10, actual_finish = $11, work = $12, start_no_earlier_than = $13, start_no_earlier_source = $14,
                deadline = $15, level_of_effort = $16, legacy_actual_cost = $17, cost_tracked = $18,
                version = version + 1, updated_at = now(), updated_by = $19
          WHERE project_id = $1 AND id = $2`,
        params,
      );
      updated.push(t.id);
      rewriteChildren.push(t);
    }
  }

  // وابستگی، تخصیص و هزینه‌ی مستقیمِ فعالیت‌های تغییرکرده را از نو می‌نویسیم. ابتدا همه‌ی ردیف‌ها (بالا) تا کلید خارجی پیش‌نیاز برقرار باشد.
  for (const t of rewriteChildren) {
    await db.query('DELETE FROM task_dependencies WHERE project_id = $1 AND task_id = $2', [pid, t.id]);
    await db.query('DELETE FROM task_assignments WHERE project_id = $1 AND task_id = $2', [pid, t.id]);
    await db.query('DELETE FROM task_direct_costs WHERE project_id = $1 AND task_id = $2', [pid, t.id]);
  }
  for (const t of rewriteChildren) {
    for (const d of [...t.dependencies].sort((a, b) => a.predecessorId - b.predecessorId)) {
      await db.query('INSERT INTO task_dependencies (project_id, task_id, predecessor_id, dep_type, lag) VALUES ($1,$2,$3,$4,$5)', [pid, t.id, d.predecessorId, d.type, d.lag]);
    }
    if (t.kind === 'summary') continue;
    for (const a of [...t.assignments].sort((x, y) => x.resourceId - y.resourceId)) {
      await db.query('INSERT INTO task_assignments (project_id, task_id, resource_id, units) VALUES ($1,$2,$3,$4)', [pid, t.id, a.resourceId, a.units]);
    }
    let line = 1;
    for (const c of t.directCosts) {
      await db.query('INSERT INTO task_direct_costs (project_id, task_id, line_no, name, amount) VALUES ($1,$2,$3,$4,$5)', [pid, t.id, line++, c.name, c.amount]);
    }
  }
  return { inserted, updated, deleted };
}

// ───────────────────────── منابع ─────────────────────────

export async function loadResources(db: Db, pid: number): Promise<ResourceDto[]> {
  const rows = await many<{ id: number; name: string; type: Resource['type']; capacity_percent: number; daily_rate: number; user_id: number | null }>(
    db,
    'SELECT id, name, type, capacity_percent, daily_rate, user_id FROM resources WHERE project_id = $1 ORDER BY id',
    [pid],
  );
  return rows.map((r) => ({ id: r.id, name: r.name, type: r.type, capacityPercent: r.capacity_percent, dailyRate: r.daily_rate, userId: r.user_id }));
}

// ───────────────────────── خط مبنا و اسنپ‌شات ─────────────────────────

export async function loadBaselines(db: Db, pid: number): Promise<{ current: BaselineDto | null; history: BaselineHistoryDto[] }> {
  const heads = await many<{ id: number; label: string; status_date: IsoDate; is_current: boolean; archived_on: IsoDate | null }>(
    db,
    'SELECT id, label, status_date, is_current, archived_on FROM baselines WHERE project_id = $1 ORDER BY id',
    [pid],
  );
  const items = await many<{ baseline_id: number; task_id: number; start_date: IsoDate; finish_date: IsoDate; zero_duration: boolean; cost: number | null }>(
    db,
    'SELECT baseline_id, task_id, start_date, finish_date, zero_duration, cost FROM baseline_items WHERE project_id = $1 ORDER BY baseline_id, task_id',
    [pid],
  );
  const byBaseline = new Map<number, Record<number, Baseline[number]>>();
  for (const it of items) {
    let m = byBaseline.get(it.baseline_id);
    if (!m) byBaseline.set(it.baseline_id, (m = {}));
    m[it.task_id] = { start: it.start_date, finish: it.finish_date, zeroDuration: it.zero_duration, cost: it.cost };
  }
  let current: BaselineDto | null = null;
  const history: BaselineHistoryDto[] = [];
  for (const h of heads) {
    const dto: BaselineDto = { id: h.id, label: h.label, statusDate: h.status_date, items: byBaseline.get(h.id) ?? {} };
    if (h.is_current) current = dto;
    else history.push({ ...dto, archivedOn: h.archived_on ?? h.status_date });
  }
  return { current, history };
}

export async function loadSnapshots(db: Db, pid: number): Promise<Snapshot[]> {
  const heads = await many<{ snapshot_date: IsoDate; actual_percent: number; planned_percent: number | null; estimated: boolean; actual_cost: number | null }>(
    db,
    'SELECT snapshot_date, actual_percent, planned_percent, estimated, actual_cost FROM snapshots WHERE project_id = $1 ORDER BY snapshot_date',
    [pid],
  );
  const rows = await many<{ snapshot_date: IsoDate; task_id: number; percent: number }>(
    db,
    'SELECT snapshot_date, task_id, percent FROM snapshot_tasks WHERE project_id = $1 ORDER BY snapshot_date, task_id',
    [pid],
  );
  const by = new Map<string, Record<number, number>>();
  for (const r of rows) {
    let m = by.get(r.snapshot_date);
    if (!m) by.set(r.snapshot_date, (m = {}));
    m[r.task_id] = r.percent;
  }
  return heads.map((h) => {
    const s: Snapshot = { date: h.snapshot_date, actual: h.actual_percent, estimated: h.estimated };
    if (h.planned_percent !== null) s.planned = h.planned_percent;
    const tasks = by.get(h.snapshot_date);
    if (tasks) s.tasks = tasks;
    if (h.actual_cost !== null) s.actualCost = h.actual_cost;
    return s;
  });
}

export async function insertSnapshots(tx: Db, pid: number, list: readonly Snapshot[], userId: number): Promise<void> {
  for (const s of list) {
    await tx.query(
      `INSERT INTO snapshots (project_id, snapshot_date, actual_percent, planned_percent, estimated, actual_cost, created_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7)`,
      [pid, s.date, s.actual, s.planned ?? null, s.estimated, s.actualCost ?? null, userId],
    );
    const entries = Object.entries(s.tasks ?? {});
    if (entries.length) {
      await tx.query(
        `INSERT INTO snapshot_tasks (project_id, snapshot_date, task_id, percent)
         SELECT $1, $2::date, t, p FROM unnest($3::int[], $4::numeric[]) AS x(t, p)`,
        [pid, s.date, entries.map(([k]) => Number(k)), entries.map(([, v]) => v)],
      );
    }
  }
}

// ───────────────────────── هزینه‌ها ─────────────────────────

export async function loadCosts(db: Db, pid: number): Promise<CostEntryDto[]> {
  const rows = await many<{ id: number; entry_date: IsoDate; task_id: number | null; description: string; document: string; amount: number; version: number }>(
    db,
    'SELECT id, entry_date, task_id, description, document, amount, version FROM cost_entries WHERE project_id = $1 ORDER BY entry_date, id',
    [pid],
  );
  return rows.map((r) => ({ id: r.id, date: r.entry_date, taskId: r.task_id, description: r.description, document: r.document, amount: r.amount, version: r.version }));
}

// ───────────────────────── منشور و قرارداد ─────────────────────────

export async function loadCharter(db: Db, pid: number): Promise<CharterDto> {
  const r = await one<Record<string, string | number>>(db, 'SELECT * FROM project_charter WHERE project_id = $1', [pid]);
  if (!r) throw notFound('منشور پروژه پیدا نشد.', 'NO_CHARTER');
  return {
    client: String(r['client']),
    location: String(r['location']),
    subject: String(r['subject']),
    product: String(r['product']),
    projectManager: String(r['project_manager']),
    salesOwner: String(r['sales_owner']),
    goals: String(r['goals']),
    scope: String(r['scope']),
    assumptions: String(r['assumptions']),
    stakeholders: String(r['stakeholders']),
    version: Number(r['version']),
  };
}

export async function loadContract(db: Db, pid: number): Promise<Contract & { version: number }> {
  const r = await one<Record<string, unknown>>(db, 'SELECT * FROM project_contract WHERE project_id = $1', [pid]);
  if (!r) throw notFound('قرارداد پروژه پیدا نشد.', 'NO_CONTRACT');
  return {
    number: String(r['number']),
    date: (r['contract_date'] as IsoDate | null) ?? null,
    type: String(r['type']),
    validity: String(r['validity']),
    amount: Number(r['amount']),
    advanceDate: (r['advance_date'] as IsoDate | null) ?? null,
    advanceGuaranteeSerial: String(r['advance_guarantee_serial']),
    advanceAmount: Number(r['advance_amount']),
    invoiceNumbers: String(r['invoice_numbers']),
    invoicedTotal: Number(r['invoiced_total']),
    collectedTotal: Number(r['collected_total']),
    performanceGuaranteeSerial: String(r['performance_guarantee_serial']),
    retentionMode: r['retention_mode'] as Contract['retentionMode'],
    retentionValue: Number(r['retention_value']),
    salesApproval: (r['sales_approval'] as Contract['salesApproval']) ?? null,
    salesCommissionPercent: Number(r['sales_commission_percent']),
    retentionCommissionPercent: Number(r['retention_commission_percent']),
    version: Number(r['version']),
  };
}

export function redactContract(c: Contract & { version: number }, canSeeCommission: boolean): ContractDto {
  if (canSeeCommission) return c;
  const { salesApproval: _a, salesCommissionPercent: _b, retentionCommissionPercent: _c, ...rest } = c;
  return rest;
}

// ───────────────────────── ریسک، مسئله، تغییر، تصمیم، اسناد ─────────────────────────

export async function loadRisks(db: Db, pid: number): Promise<RiskDto[]> {
  const rows = await many<Record<string, unknown>>(db, 'SELECT * FROM risks WHERE project_id = $1 ORDER BY id', [pid]);
  return rows.map((r) => ({
    id: Number(r['id']),
    title: String(r['title']),
    category: (r['category'] as RiskDto['category']) ?? null,
    probability: Number(r['probability']),
    impact: Number(r['impact']),
    owner: String(r['owner']),
    strategy: (r['strategy'] as RiskDto['strategy']) ?? null,
    response: String(r['response']),
    due: (r['due'] as IsoDate | null) ?? null,
    status: r['status'] as RiskDto['status'],
    version: Number(r['version']),
  }));
}

export async function loadIssues(db: Db, pid: number): Promise<IssueDto[]> {
  const rows = await many<Record<string, unknown>>(db, 'SELECT * FROM issues WHERE project_id = $1 ORDER BY id', [pid]);
  return rows.map((r) => ({
    id: Number(r['id']),
    title: String(r['title']),
    owner: String(r['owner']),
    priority: r['priority'] as IssueDto['priority'],
    due: (r['due'] as IsoDate | null) ?? null,
    impact: String(r['impact']),
    action: String(r['action']),
    needsDecision: Boolean(r['needs_decision']),
    status: r['status'] as IssueDto['status'],
    version: Number(r['version']),
  }));
}

export async function loadChanges(db: Db, pid: number): Promise<ChangeRequestDto[]> {
  const rows = await many<Record<string, unknown>>(db, 'SELECT * FROM change_requests WHERE project_id = $1 ORDER BY id', [pid]);
  return rows.map((r) => ({
    id: Number(r['id']),
    title: String(r['title']),
    requester: String(r['requester']),
    date: (r['request_date'] as IsoDate | null) ?? null,
    reason: String(r['reason']),
    impact: String(r['impact']),
    previousFinish: (r['previous_finish'] as IsoDate | null) ?? null,
    newFinish: (r['new_finish'] as IsoDate | null) ?? null,
    status: r['status'] as ChangeRequestDto['status'],
    approvedBy: String(r['approved_by']),
    approvedOn: (r['approved_on'] as IsoDate | null) ?? null,
    version: Number(r['version']),
  }));
}

export async function loadDecisions(db: Db, pid: number): Promise<DecisionDto[]> {
  const rows = await many<Record<string, unknown>>(db, 'SELECT * FROM decisions WHERE project_id = $1 ORDER BY id', [pid]);
  return rows.map((r) => ({
    id: Number(r['id']),
    topic: String(r['topic']),
    text: String(r['decision_text']),
    maker: String(r['maker']),
    date: (r['decision_date'] as IsoDate | null) ?? null,
    status: r['status'] as DecisionDto['status'],
    version: Number(r['version']),
  }));
}

export async function loadDocuments(db: Db, pid: number): Promise<DocumentDto[]> {
  const rows = await many<{ id: number; title: string; doc_type: DocumentDto['type']; url: string; task_id: number | null; doc_date: IsoDate | null; added_by_name: string | null }>(
    db,
    `SELECT d.id, d.title, d.doc_type, d.url, d.task_id, d.doc_date, u.display_name AS added_by_name
       FROM project_documents d LEFT JOIN users u ON u.id = d.added_by
      WHERE d.project_id = $1 ORDER BY d.id`,
    [pid],
  );
  return rows.map((r) => ({ id: r.id, title: r.title, type: r.doc_type, url: r.url, taskId: r.task_id, date: r.doc_date, addedBy: r.added_by_name ?? '' }));
}

// ───────────────────────── مدل کامل ─────────────────────────

export interface FullModel {
  project: ProjectRow;
  model: ProjectModel;
  tasks: TaskDto[];
  resources: ResourceDto[];
  baseline: BaselineDto | null;
  baselineHistory: BaselineHistoryDto[];
  charterDto: CharterDto;
  contractDto: Contract & { version: number };
  risks: RiskDto[];
  issues: IssueDto[];
  changes: ChangeRequestDto[];
  decisions: DecisionDto[];
  costs: CostEntryDto[];
}

/** همه‌ی داده‌ی پروژه برای محاسبه (بدون پالایش بر اساس نقش) */
export async function loadFullModel(db: Db, pid: number): Promise<FullModel> {
  const project = await loadProjectRow(db, pid);
  const calendar = await loadCalendar(db, pid);
  const tasks = await loadTasks(db, pid);
  const resources = await loadResources(db, pid);
  const { current, history } = await loadBaselines(db, pid);
  const snapshots = await loadSnapshots(db, pid);
  const costs = await loadCosts(db, pid);
  const charterDto = await loadCharter(db, pid);
  const contractDto = await loadContract(db, pid);
  const risks = await loadRisks(db, pid);
  const issues = await loadIssues(db, pid);
  const changes = await loadChanges(db, pid);
  const decisions = await loadDecisions(db, pid);
  const documents = await loadDocuments(db, pid);
  const { version: _cv, ...charter } = charterDto;
  const { version: _kv, ...contract } = contractDto;
  const stripVersion = <T extends { version: number }>(list: T[]): Omit<T, 'version'>[] => list.map(({ version: _v, ...rest }) => rest);
  const model: ProjectModel = {
    name: project.name,
    start: project.start_date,
    status: project.status_date,
    contractEnd: project.contract_end,
    calendar,
    tasks: stripVersion(tasks) as Task[],
    resources: resources.map(({ userId: _u, ...r }) => r),
    baseline: current?.items ?? {},
    baselineHistory: history.map((h) => ({ id: h.id, archivedOn: h.archivedOn, items: h.items })),
    snapshots,
    costs: stripVersion(costs) as ProjectModel['costs'],
    finance: { unit: project.finance_unit, budget: project.finance_budget, eacMethod: project.eac_method },
    charter: charter as Charter,
    contract: contract as Contract,
    risks: stripVersion(risks) as ProjectModel['risks'],
    issues: stripVersion(issues) as ProjectModel['issues'],
    changes: stripVersion(changes) as ProjectModel['changes'],
    decisions: stripVersion(decisions) as ProjectModel['decisions'],
    documents,
  };
  return { project, model, tasks, resources, baseline: current, baselineHistory: history, charterDto, contractDto, risks, issues, changes, decisions, costs };
}
