import type { Request } from 'express';
import type { Db } from './db.ts';

export interface Actor {
  id: number | null;
  name: string;
  ip: string | null;
  requestId: string;
}

export function actorInfo(req: Request): Actor {
  const u = req.ctx.user;
  return { id: u?.id ?? null, name: u?.displayName ?? '', ip: req.ctx.ip, requestId: req.ctx.requestId };
}

export interface AuditEntry {
  projectId?: number | null;
  action: string;
  entity?: string;
  entityId?: string | number;
  field?: string;
  oldValue?: unknown;
  newValue?: unknown;
  details?: unknown;
}

const json = (v: unknown): string | null => (v === undefined ? null : JSON.stringify(v));

/** ثبت یک یا چند رویداد ممیزی در همان تراکنش تغییر؛ اگر تغییر برگردد، ممیزی هم برمی‌گردد. */
export async function writeAudit(db: Db, actor: Actor, entries: AuditEntry | AuditEntry[]): Promise<void> {
  const list = Array.isArray(entries) ? entries : [entries];
  if (list.length === 0) return;
  const COLS = 12;
  const params: unknown[] = [];
  const rows = list.map((e, i) => {
    params.push(
      e.projectId ?? null,
      actor.id,
      actor.name,
      e.action,
      e.entity ?? '',
      e.entityId === undefined ? '' : String(e.entityId),
      e.field ?? '',
      json(e.oldValue),
      json(e.newValue),
      actor.ip,
      actor.requestId,
      json(e.details),
    );
    const b = i * COLS;
    return `($${b + 1},$${b + 2},$${b + 3},$${b + 4},$${b + 5},$${b + 6},$${b + 7},$${b + 8}::jsonb,$${b + 9}::jsonb,$${b + 10}::inet,$${b + 11},$${b + 12}::jsonb)`;
  });
  await db.query(
    `INSERT INTO audit_log (project_id, actor_id, actor_name, action, entity, entity_id, field, old_value, new_value, ip, request_id, details)
     VALUES ${rows.join(',')}`,
    params,
  );
}

/** تفاوت دو شیء تخت: فقط فیلدهایی که واقعاً عوض شده‌اند */
export function diffFields(before: Record<string, unknown>, after: Record<string, unknown>, only?: readonly string[]): { field: string; from: unknown; to: unknown }[] {
  const out: { field: string; from: unknown; to: unknown }[] = [];
  const keys = only ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  for (const k of keys) {
    const a = before[k];
    const b = after[k];
    if (JSON.stringify(a ?? null) !== JSON.stringify(b ?? null)) out.push({ field: k, from: a ?? null, to: b ?? null });
  }
  return out;
}
