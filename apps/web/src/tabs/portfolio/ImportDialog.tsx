import { PORTFOLIO_STATUS_LABELS, MAX_PORTFOLIO_IMPORT_ROWS, portfolioImportUpdates, portfolioTemplateRows, previewPortfolioImport, toCsv } from '@bistoon/core';
import type { PortfolioImportPreview, PortfolioItem, PortfolioRowStatus } from '@bistoon/core';
import { apiPost } from '../../api/client.ts';
import { MIME_CSV, downloadFile } from '../../lib/download.ts';
import { faInt } from '../../lib/fmt.ts';
import { TableFileError, readTableFile } from '../../lib/readTable.ts';
import { Alert, Badge, Btn, useAction } from '../../ui/controls.tsx';
import { alertDialog, openDialog } from '../../ui/dialogs.tsx';

const KIND: Record<PortfolioRowStatus, '' | 'ok' | 'warn' | 'bad' | 'brand' | 'accent'> = {
  ok: 'ok',
  warn: 'warn',
  empty: '',
  nomatch: 'bad',
  ambiguous: 'bad',
  dup: 'warn',
  archived: 'warn',
};

export function downloadPortfolioTemplate(): void {
  downloadFile('bistoon-projects-template.csv', toCsv(portfolioTemplateRows()), MIME_CSV);
}

/** فایل را می‌خواند و پیش‌نمایش را نشان می‌دهد؛ تا «ورود اطلاعات» چیزی ثبت نمی‌شود. */
export async function startPortfolioImport(file: File, items: readonly PortfolioItem[], onDone: () => Promise<void>): Promise<void> {
  let rows: unknown[][];
  let note: string;
  try {
    ({ rows, note } = await readTableFile(file));
  } catch (e) {
    await alertDialog(e instanceof TableFileError ? e.title : 'خواندن فایل ممکن نشد', e instanceof Error ? e.message : 'فایل خوانده نشد.');
    return;
  }
  const r = previewPortfolioImport(rows, items);
  if (!r.ok) {
    void openDialog('فایل قابل ورود نیست', (close) => (
      <>
        <div className="body">{r.error}</div>
        <footer>
          <Btn onClick={downloadPortfolioTemplate}>دانلود قالب</Btn>
          <Btn kind="primary" onClick={() => close()}>
            بسیار خوب
          </Btn>
        </footer>
      </>
    ));
    return;
  }
  void openDialog('ورود اطلاعات قرارداد از فایل', (close) => <Preview preview={r.preview} note={note} onDone={onDone} close={() => close()} />, { wide: true });
}

function Preview({ preview, note, onDone, close }: { preview: PortfolioImportPreview; note: string; onDone: () => Promise<void>; close: () => void }) {
  const { busy, run } = useAction();
  const updates = portfolioImportUpdates(preview);
  const c = preview.counts;
  const apply = async (): Promise<void> => {
    const res = await run(async () => {
      const r = await apiPost<{ changedProjects: number }>('/portfolio/import', { updates });
      await onDone();
      return r;
    });
    if (res) {
      close();
      await alertDialog('ورود انجام شد', res.changedProjects > 0 ? `اطلاعات ${faInt(res.changedProjects)} پروژه به‌روز شد.` : 'مقدار همه‌ی سلول‌ها با داده‌ی فعلی یکی بود؛ چیزی تغییر نکرد.');
    }
  };
  return (
    <>
      <div className="body stack">
        <div className="row" data-testid="pimport-counts">
          {(Object.keys(PORTFOLIO_STATUS_LABELS) as PortfolioRowStatus[])
            .filter((k) => c[k] > 0)
            .map((k) => (
              <Badge key={k} kind={KIND[k]}>
                {PORTFOLIO_STATUS_LABELS[k]}: {faInt(c[k])}
              </Badge>
            ))}
        </div>
        <p className="small muted" style={{ margin: 0 }}>
          هر ردیف با «نام پروژه» (یا در نبود آن «شماره قرارداد») به یک پروژه‌ی موجود وصل می‌شود. فقط سلول‌های پر به‌روز می‌شوند؛ سلول خالی چیزی را پاک نمی‌کند. تاریخ شروع و ستون‌های محاسبه‌ای نادیده گرفته می‌شوند؛ تاریخ پایان فقط برای پروژه‌ای که پایان ندارد ثبت می‌شود. پروژه‌ی جدید با این فایل ساخته نمی‌شود. اگر یک ردیف مشکل سرور داشته باشد، هیچ‌کدام ثبت نمی‌شود.
        </p>
        {note ? <Alert kind="info">{note}</Alert> : null}
        {preview.truncated ? <Alert kind="warn">فقط {faInt(MAX_PORTFOLIO_IMPORT_ROWS)} ردیف اول فایل بررسی شد.</Alert> : null}
        {preview.ignoredColumns.length > 0 ? <Alert kind="info">ستون‌های ناشناخته‌ی نادیده‌گرفته‌شده: {preview.ignoredColumns.join('، ')}</Alert> : null}
        <div className="tbl-wrap" style={{ maxHeight: 340 }}>
          <table className="tbl" data-testid="pimport-table">
            <thead>
              <tr>
                <th className="c">ردیف فایل</th>
                <th>پروژه (فایل)</th>
                <th>پروژه‌ی متناظر</th>
                <th className="c">سلول به‌روز</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 300).map((r) => (
                <tr key={r.line}>
                  <td className="c num muted">{faInt(r.line)}</td>
                  <td>{r.name || '—'}</td>
                  <td>{r.projectName || '—'}</td>
                  <td className="c">{faInt(r.fieldCount)}</td>
                  <td>
                    <Badge kind={KIND[r.status]}>{PORTFOLIO_STATUS_LABELS[r.status]}</Badge>
                    {r.bad.length > 0 ? <div className="small bad-text">نامعتبر و نادیده: {r.bad.join('، ')}</div> : null}
                    {r.notes.map((n) => (
                      <div key={n} className="small muted">
                        {n}
                      </div>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.rows.length > 300 ? <p className="small muted">{faInt(preview.rows.length - 300)} ردیف بعدی در جدول نمایش داده نمی‌شود ولی در ورود لحاظ می‌شود.</p> : null}
        <p data-testid="pimport-summary">
          اطلاعات <strong>{faInt(updates.length)}</strong> پروژه به‌روز خواهد شد. ردیف‌های دارای وضعیت دیگر وارد نمی‌شوند.
        </p>
      </div>
      <footer>
        <Btn kind="primary" busy={busy} disabled={updates.length === 0} onClick={apply} testId="pimport-apply">
          ورود اطلاعات {faInt(updates.length)} پروژه
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}
