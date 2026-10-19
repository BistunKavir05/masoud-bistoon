import { useRef, useState } from 'react';
import type { ReactNode } from 'react';
import type { Capped } from '@bistoon/core';
import { faInt } from '../lib/fmt.ts';
import { Badge, Btn } from '../ui/controls.tsx';

/** انتخاب فایل با دکمه‌ی خودمان؛ ورودی اصلی پنهان است و برای آزمون با testId در دسترس */
export function FilePick({ label, accept, onFile, testId, fileName, disabled }: { label: string; accept: string; onFile: (f: File) => void; testId: string; fileName: string | null; disabled?: boolean }) {
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div className="row wrap">
      <Btn icon="upload" onClick={() => ref.current?.click()} disabled={disabled} testId={`${testId}-btn`}>
        {fileName ? 'انتخاب فایل دیگر' : label}
      </Btn>
      <input
        ref={ref}
        type="file"
        accept={accept}
        hidden
        data-testid={testId}
        aria-label={label}
        onChange={(e) => {
          const f = e.target.files?.[0];
          e.target.value = '';
          if (f) onFile(f);
        }}
      />
      {fileName ? <span className="small ltr" data-testid={`${testId}-name`}>{fileName}</span> : <span className="muted small">فایلی انتخاب نشده است.</span>}
    </div>
  );
}

/** فهرست هشدارهای ورود: چند مورد اول و «نمایش همه» */
export function WarningList({ warnings, testId, initial = 6 }: { warnings: Capped<{ code: string; message: string }>; testId: string; initial?: number }) {
  const [all, setAll] = useState(false);
  if (warnings.count === 0) return null;
  const shown = all ? warnings.items : warnings.items.slice(0, initial);
  const hidden = warnings.count - shown.length;
  return (
    <div className="stack gap-s" data-testid={testId}>
      <strong>
        {faInt(warnings.count)} هشدار <span className="muted small">(ورود انجام می‌شود؛ آن‌ها را بخوانید)</span>
      </strong>
      <ul className="plain-list small">
        {shown.map((w, i) => (
          <li key={i}>{w.message}</li>
        ))}
      </ul>
      {!all && warnings.items.length > initial ? (
        <div>
          <Btn size="sm" onClick={() => setAll(true)}>نمایش {faInt(warnings.items.length - initial)} هشدار دیگر</Btn>
        </div>
      ) : null}
      {hidden > 0 && (all || warnings.items.length <= initial) ? <span className="muted small">و {faInt(hidden)} هشدار دیگر که در گزارش تغییرات ثبت می‌شود.</span> : null}
    </div>
  );
}

/** ردیف «برچسب: مقدار» برای خلاصه‌ها */
export function Facts({ items }: { items: { label: string; value: ReactNode }[] }) {
  return (
    <dl className="facts">
      {items.map((f) => (
        <div key={f.label}>
          <dt>{f.label}</dt>
          <dd>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export const LEVEL_BADGE: Record<'info' | 'warn', ReactNode> = { info: <Badge>اطلاع</Badge>, warn: <Badge kind="warn">توجه</Badge> };
