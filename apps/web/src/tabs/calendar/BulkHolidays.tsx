import { useMemo, useRef, useState } from 'react';
import type { Holiday, WorkCalendar } from '@bistoon/core';
import { apiPost } from '../../api/client.ts';
import { faDate, faInt } from '../../lib/fmt.ts';
import { MAX_HOLIDAY_ROWS, parseHolidayText } from '../../lib/holidays.ts';
import { reloadProject, useProjectState } from '../../state/project.ts';
import { Alert, Btn, useAction } from '../../ui/controls.tsx';
import { openDialog } from '../../ui/dialogs.tsx';
import { ImpactNote } from './ImpactNote.tsx';

function BulkForm({ cal, close }: { cal: WorkCalendar; close: () => void }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const [text, setText] = useState('');
  const [replace, setReplace] = useState(false);
  const file = useRef<HTMLInputElement>(null);
  const { busy, run } = useAction();
  const existing = useMemo(() => new Set(cal.holidays.map((h) => h.date)), [cal.holidays]);
  const parsed = useMemo(() => parseHolidayText(text, existing), [text, existing]);
  const merged: Holiday[] = useMemo(() => {
    const m = new Map<string, Holiday>(replace ? [] : cal.holidays.map((h) => [h.date, h]));
    for (const r of parsed.rows) m.set(r.date, r);
    return [...m.values()];
  }, [parsed.rows, replace, cal.holidays]);
  const removed = replace ? cal.holidays.filter((h) => !parsed.rows.some((r) => r.date === h.date)).length : 0;
  const next: WorkCalendar = { days: cal.days, holidays: merged };
  const empty = parsed.rows.length === 0;
  const blocked = empty || parsed.tooMany || parsed.errors.length > 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (blocked) return;
        void run(async () => {
          await apiPost(`/projects/${pid}/calendar/holidays`, { holidays: parsed.rows, replace });
          await reloadProject();
          close();
        }, `${faInt(parsed.rows.length)} تعطیلی ثبت شد.`);
      }}
    >
      <div className="body stack">
        <div className="field wide">
          <label htmlFor="hol-bulk-text">فهرست تعطیلات (هر خط یک تعطیلی: تاریخ و عنوان)</label>
          <textarea id="hol-bulk-text" className="ta" rows={8} dir="auto" placeholder={'۱۴۰۶/۰۱/۰۱ نوروز\n۱۴۰۶/۰۱/۰۲، عید نوروز\n2027-04-01'} value={text} onChange={(e) => setText(e.target.value)} data-testid="hol-bulk-text" />
          <span className="hint">تاریخ شمسی یا میلادی (ISO). حداکثر {faInt(MAX_HOLIDAY_ROWS)} ردیف. می‌توانید فایل متنی یا CSV هم بخوانید.</span>
        </div>
        <div className="row wrap">
          <input
            ref={file}
            type="file"
            accept=".csv,.txt,text/csv,text/plain"
            hidden
            data-testid="hol-bulk-file"
            onChange={(e) => {
              const f = e.target.files?.[0];
              e.target.value = '';
              if (!f) return;
              if (f.size > 1_000_000) return void setText('');
              void f.text().then(setText);
            }}
          />
          <Btn icon="upload" onClick={() => file.current?.click()}>
            خواندن از فایل
          </Btn>
          <label className="chk">
            <input type="checkbox" checked={replace} onChange={(e) => setReplace(e.target.checked)} data-testid="hol-bulk-replace" />
            جایگزین کل فهرست فعلی شود
          </label>
        </div>
        {replace ? <Alert kind="warn">با «جایگزینی»، {faInt(removed)} تعطیلیِ موجود که در این فهرست نیست حذف می‌شود.</Alert> : null}
        {text.trim() !== '' ? (
          <div className="stack" data-testid="hol-bulk-summary">
            <p style={{ margin: 0 }}>
              <strong>{faInt(parsed.rows.length)}</strong> تعطیلی معتبر
              {parsed.overwrites > 0 ? `، ${faInt(parsed.overwrites)} مورد عنوان تعطیلیِ موجود را جایگزین می‌کند` : ''}
              {parsed.duplicates > 0 ? `، ${faInt(parsed.duplicates)} ردیف تکراری در متن (آخری می‌ماند)` : ''}
              {parsed.rows.length > 0 ? ` — از ${faDate(parsed.rows[0]!.date)} تا ${faDate(parsed.rows[parsed.rows.length - 1]!.date)}` : ''}.
            </p>
            {parsed.tooMany ? <Alert kind="bad">بیش از {faInt(MAX_HOLIDAY_ROWS)} ردیف است؛ فهرست را کوتاه‌تر کنید.</Alert> : null}
            {parsed.errors.length > 0 ? (
              <Alert kind="bad">
                <strong>{faInt(parsed.errors.length)} خط خطا دارد؛ تا اصلاح، ثبت نمی‌شود:</strong>
                <ul style={{ margin: '6px 0 0', paddingInlineStart: 20 }}>
                  {parsed.errors.slice(0, 6).map((er) => (
                    <li key={er.line}>
                      خط {faInt(er.line)}: {er.reason}
                    </li>
                  ))}
                  {parsed.errors.length > 6 ? <li>و {faInt(parsed.errors.length - 6)} خطای دیگر…</li> : null}
                </ul>
              </Alert>
            ) : null}
            {!empty && !parsed.tooMany ? <ImpactNote next={next} /> : null}
          </div>
        ) : null}
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={blocked} testId="hol-bulk-apply">
          {replace ? 'جایگزین کن' : 'افزودن'}
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

export function openBulkDialog(cal: WorkCalendar): Promise<unknown> {
  return openDialog('افزودن گروهی تعطیلات', (close) => <BulkForm cal={cal} close={() => close()} />, { wide: true });
}
