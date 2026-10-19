import type { StageSummary } from '@bistoon/core';
import { faPct } from '../lib/fmt.ts';

/** نوار مراحل: هر مرحله‌ی سطح ۱ یک پاره‌ی نوار است و به‌اندازه‌ی پیشرفتش پر می‌شود. */
export function StageRibbon({ stages }: { stages: readonly StageSummary[] }) {
  if (stages.length === 0) return <p className="muted small">هنوز مرحله‌ای (گروه سطح یک) تعریف نشده است.</p>;
  return (
    <ol className="stagebar" aria-label="پیشرفت مراحل" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {stages.map((s) => (
        <li key={s.id} className="seg1" title={`${s.name}: ${faPct(s.percent, 0)}`}>
          <div className="bar" role="progressbar" aria-valuenow={Math.round(s.percent)} aria-valuemin={0} aria-valuemax={100} aria-label={s.name}>
            <i style={{ width: `${Math.max(0, Math.min(100, s.percent))}%` }} />
          </div>
          <div className="nm">
            {s.name} <span className="num muted">{faPct(s.percent, 0)}</span>
          </div>
        </li>
      ))}
    </ol>
  );
}
