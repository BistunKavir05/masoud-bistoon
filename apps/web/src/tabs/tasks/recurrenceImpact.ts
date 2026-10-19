/** اثر ویرایش الگوی تکرار روی رخدادهای موجود؛ بدون React تا قابل آزمون باشد. */
import type { RecurrenceResult, Task } from '@bistoon/core';

export interface RemovedOccurrence {
  id: number;
  name: string;
  /** درصد پیشرفت یا تاریخ واقعی ثبت شده دارد */
  hasProgress: boolean;
  /** تعداد ثبت‌های هزینه‌ی وصل به آن */
  costCount: number;
}

export interface RecurrenceImpact {
  added: number;
  kept: number;
  removed: RemovedOccurrence[];
  /** رخدادهای حذف‌شده‌ای که پیشرفت دارند */
  removedWithProgress: RemovedOccurrence[];
  /** رخدادهای حذف‌شده‌ای که هزینه دارند (سرور اجازه‌ی حذف نمی‌دهد) */
  removedWithCosts: RemovedOccurrence[];
  /** فعالیت‌هایی (بیرون از گروه) که پیش‌نیازشان یکی از رخدادهای حذف‌شده بود و آن وابستگی پاک می‌شود */
  dependentsCleared: number;
}

export function recurrenceImpact(before: readonly Task[], result: Extract<RecurrenceResult, { ok: true }>, costs: readonly { taskId: number | null }[]): RecurrenceImpact {
  const byId = new Map(before.map((t) => [t.id, t]));
  const gone = new Set(result.removedIds);
  const removed: RemovedOccurrence[] = result.removedIds.map((id) => {
    const t = byId.get(id);
    return {
      id,
      name: t?.name ?? '',
      hasProgress: t ? t.percentComplete > 0 || t.actualStart !== null || t.actualFinish !== null : false,
      costCount: costs.filter((c) => c.taskId === id).length,
    };
  });
  const dependentsCleared = before.filter((t) => !gone.has(t.id) && t.dependencies.some((d) => gone.has(d.predecessorId))).length;
  return {
    added: result.addedIds.length,
    kept: result.keptIds.length,
    removed,
    removedWithProgress: removed.filter((r) => r.hasProgress),
    removedWithCosts: removed.filter((r) => r.costCount > 0),
    dependentsCleared,
  };
}
