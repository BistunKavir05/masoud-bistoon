import { z } from 'zod';
import { CHANGE_STATUSES, DECISION_STATUSES, DOCUMENT_TYPES, ISSUE_PRIORITIES, ISSUE_STATUSES, RISK_CATEGORIES, RISK_STATUSES, RISK_STRATEGIES, emptyContract } from '@bistoon/core';
import type { ProjectModel } from '@bistoon/core';
import { isoDate, isoDateOrNull } from '../schemas.ts';

const num = z.number().finite();
const str = (max = 20000) => z.string().max(max);
const idNum = z.number().int().min(1).max(2_000_000_000);

const dependency = z.object({ predecessorId: idNum, type: z.enum(['FS', 'SS', 'FF', 'SF']), lag: z.number().int() });
const task = z.object({
  id: idNum,
  name: str(300),
  level: z.number().int().min(1).max(9),
  kind: z.enum(['task', 'summary', 'milestone']),
  duration: num,
  dependencies: z.array(dependency).max(500),
  weight: num,
  percentComplete: num,
  actualStart: isoDateOrNull,
  actualFinish: isoDateOrNull,
  work: num,
  assignments: z.array(z.object({ resourceId: idNum, units: num })).max(500),
  startNoEarlierThan: isoDateOrNull,
  startNoEarlierSource: z.enum(['manual', 'msp', 'leveling']).nullable(),
  deadline: isoDateOrNull,
  levelOfEffort: z.boolean(),
  directCosts: z.array(z.object({ name: str(80), amount: num })).max(500),
  legacyActualCost: num.nullable(),
  costTracked: z.boolean(),
});

const baselineItems = z.record(
  z.string().regex(/^\d+$/),
  z.object({ start: isoDate, finish: isoDate, zeroDuration: z.boolean(), cost: num.nullable() }),
);

const contractFields = emptyContract();
const contract = z.object({
  number: str(100).default(''),
  date: isoDateOrNull.default(null),
  type: str(100).default(''),
  validity: str(200).default(''),
  amount: num.default(0),
  advanceDate: isoDateOrNull.default(null),
  advanceGuaranteeSerial: str(100).default(''),
  advanceAmount: num.default(0),
  invoiceNumbers: str(500).default(''),
  invoicedTotal: num.default(0),
  collectedTotal: num.default(0),
  performanceGuaranteeSerial: str(100).default(''),
  retentionMode: z.enum(['fixed', 'percent']).default('fixed'),
  retentionValue: num.default(0),
  salesApproval: z.enum(['pending', 'approved', 'rejected']).nullable().default(contractFields.salesApproval),
  salesCommissionPercent: num.default(0),
  retentionCommissionPercent: num.default(0),
});

const charter = z.object({
  client: str(300).default(''),
  location: str(300).default(''),
  subject: str(500).default(''),
  product: str(300).default(''),
  projectManager: str(200).default(''),
  salesOwner: str(200).default(''),
  goals: str().default(''),
  scope: str().default(''),
  assumptions: str().default(''),
  stakeholders: str().default(''),
});

const modelSchema = z.object({
  name: str(200),
  start: isoDate,
  status: isoDate,
  contractEnd: isoDateOrNull,
  calendar: z.object({
    days: z.array(z.object({ working: z.boolean(), from: z.string().regex(/^\d\d:\d\d$/), to: z.string().regex(/^\d\d:\d\d$/) })).length(7),
    holidays: z.array(z.object({ date: isoDate, title: str(120) })).max(5000),
  }),
  tasks: z.array(task).max(20000),
  resources: z
    .array(z.object({ id: idNum, name: str(120), type: z.enum(['human', 'equipment', 'financial', 'other']), capacityPercent: num, dailyRate: num }))
    .max(5000),
  baseline: baselineItems,
  baselineHistory: z.array(z.object({ id: z.number().int(), archivedOn: isoDate, items: baselineItems })).max(100),
  snapshots: z
    .array(
      z.object({
        date: isoDate,
        actual: num,
        planned: num.optional(),
        estimated: z.boolean(),
        tasks: z.record(z.string().regex(/^\d+$/), num).optional(),
        actualCost: num.optional(),
      }),
    )
    .max(5000),
  costs: z.array(z.object({ id: idNum, date: isoDate, taskId: idNum.nullable(), description: str(120), document: str(60), amount: num })).max(100000),
  finance: z.object({ unit: str(24), budget: num, eacMethod: z.enum(['remaining', 'cpi', 'both']) }),
  charter,
  contract,
  risks: z
    .array(
      z.object({
        id: idNum,
        title: str(300),
        category: z.enum(RISK_CATEGORIES).nullable(),
        probability: num,
        impact: num,
        owner: str(120),
        strategy: z.enum(RISK_STRATEGIES).nullable(),
        response: str(),
        due: isoDateOrNull,
        status: z.enum(RISK_STATUSES),
      }),
    )
    .max(20000),
  issues: z
    .array(
      z.object({
        id: idNum,
        title: str(300),
        owner: str(120),
        priority: z.enum(ISSUE_PRIORITIES),
        due: isoDateOrNull,
        impact: str(),
        action: str(),
        needsDecision: z.boolean(),
        status: z.enum(ISSUE_STATUSES),
      }),
    )
    .max(20000),
  changes: z
    .array(
      z.object({
        id: idNum,
        title: str(300),
        requester: str(120),
        date: isoDateOrNull,
        reason: str(),
        impact: str(),
        previousFinish: isoDateOrNull,
        newFinish: isoDateOrNull,
        status: z.enum(CHANGE_STATUSES),
        approvedBy: str(120),
        approvedOn: isoDateOrNull,
      }),
    )
    .max(20000),
  decisions: z.array(z.object({ id: idNum, topic: str(300), text: str(), maker: str(120), date: isoDateOrNull, status: z.enum(DECISION_STATUSES) })).max(20000),
  documents: z
    .array(
      z.object({
        id: idNum,
        title: str(200),
        type: z.enum(DOCUMENT_TYPES),
        url: str(2000),
        taskId: idNum.nullable(),
        date: isoDateOrNull,
        addedBy: str(100).default(''),
      }),
    )
    .max(20000),
});

export const EXPORT_FORMAT = 'bistoon-project';
export const EXPORT_VERSION = 1;

export const exportDocument = z.object({
  format: z.literal(EXPORT_FORMAT),
  version: z.literal(EXPORT_VERSION),
  exportedAt: z.string().optional(),
  exportedBy: z.string().optional(),
  model: modelSchema,
});

export function parseExport(raw: unknown): ProjectModel {
  return exportDocument.parse(raw).model as unknown as ProjectModel;
}
