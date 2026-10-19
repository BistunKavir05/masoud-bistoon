import { useMemo, useState } from 'react';
import { COST_STATUS_LABELS, COST_TEMPLATE_HEADER, COST_TEMPLATE_SAMPLE, MAX_IMPORT_ROWS, entriesToImport, previewCostImport, toCsv } from '@bistoon/core';
import type { CostEntry, CostImportPreview, CostRowStatus, Task } from '@bistoon/core';
import { apiPost } from '../../api/client.ts';
import { MIME_CSV, decodeText, downloadFile } from '../../lib/download.ts';
import { faDate, faInt, faMoney } from '../../lib/fmt.ts';
import { readXlsx } from '../../lib/xlsx.ts';
import { reloadProject } from '../../state/project.ts';
import { Alert, Badge, Btn, CheckField, useAction } from '../../ui/controls.tsx';
import { openDialog } from '../../ui/dialogs.tsx';

const KIND: Record<CostRowStatus, '' | 'ok' | 'warn' | 'bad' | 'brand' | 'accent'> = {
  ok: 'ok',
  overhead: 'brand',
  nomatch: 'warn',
  ambiguous: 'warn',
  dup: '',
  'bad-date': 'bad',
  'bad-amount': 'bad',
};

export function downloadCostTemplate(): void {
  downloadFile('bistoon-actual-cost-template.csv', toCsv([[...COST_TEMPLATE_HEADER], [...COST_TEMPLATE_SAMPLE]]), MIME_CSV);
}

/** فایل را می‌خواند و پیش‌نمایش را در گفتگو نشان می‌دهد؛ تا «تأیید» چیزی ثبت نمی‌شود. */
export async function startCostImport(file: File, ctx: { pid: number; tasks: readonly Task[]; ledger: readonly CostEntry[]; unit: string }): Promise<void> {
  let rows: unknown[][];
  let note = '';
  try {
    const buf = await file.arrayBuffer();
    if (/\.xlsx$/i.test(file.name)) rows = (await readXlsx(buf)).rows;
    else if (/\.(csv|txt)$/i.test(file.name)) {
      const d = decodeText(buf);
      if (d.encoding !== 'utf-8') note = 'کدگذاری فایل UTF-8 نبود و با «ویندوز ۱۲۵۶» خوانده شد؛ اگر حروف درست نیست، فایل را به‌صورت «CSV UTF-8» ذخیره کنید.';
      const { parseCsv } = await import('@bistoon/core');
      rows = parseCsv(d.text);
    } else {
      void openDialog('فایل پشتیبانی نمی‌شود', (close) => (
        <>
          <div className="body">فقط فایل‌های «.xlsx» و «.csv» خوانده می‌شود. اگر فایل «.xls» قدیمی دارید، آن را در Excel با «Save As ← Excel Workbook (.xlsx)» یا «CSV UTF-8» ذخیره کنید.</div>
          <footer>
            <Btn kind="primary" onClick={() => close()}>
              بسیار خوب
            </Btn>
          </footer>
        </>
      ));
      return;
    }
  } catch (e) {
    void openDialog('خواندن فایل ممکن نشد', (close) => (
      <>
        <div className="body">{e instanceof Error ? e.message : 'فایل خوانده نشد.'}</div>
        <footer>
          <Btn kind="primary" onClick={() => close()}>
            بسیار خوب
          </Btn>
        </footer>
      </>
    ));
    return;
  }
  const r = previewCostImport(rows, { tasks: ctx.tasks, ledger: ctx.ledger });
  if (!r.ok) {
    void openDialog('فایل قابل ورود نیست', (close) => (
      <>
        <div className="body">{r.error}</div>
        <footer>
          <Btn onClick={downloadCostTemplate}>دانلود قالب</Btn>
          <Btn kind="primary" onClick={() => close()}>
            بسیار خوب
          </Btn>
        </footer>
      </>
    ));
    return;
  }
  void openDialog('ورود هزینه‌ی واقعی از فایل', (close) => <ImportPreview preview={r.preview} pid={ctx.pid} ledgerSize={ctx.ledger.length} unit={ctx.unit} note={note} close={() => close()} />, { wide: true });
}

function ImportPreview({ preview, pid, ledgerSize, unit, note, close }: { preview: CostImportPreview; pid: number; ledgerSize: number; unit: string; note: string; close: () => void }) {
  const [asOverhead, setAsOverhead] = useState(false);
  const { busy, run } = useAction();
  const plan = useMemo(() => entriesToImport(preview, { nomatchAsOverhead: asOverhead, ledgerSize }), [preview, asOverhead, ledgerSize]);
  const total = plan.entries.reduce((a, e) => a + e.amount, 0);
  const c = preview.counts;
  const apply = async (): Promise<void> => {
    const ok = await run(async () => {
      await apiPost(`/projects/${pid}/costs/import`, { entries: plan.entries });
      await reloadProject();
      return true;
    }, `${faInt(plan.entries.length)} ردیف هزینه ثبت شد.`);
    if (ok) close();
  };
  return (
    <>
      <div className="body stack">
        <div className="row" data-testid="import-counts">
          {(Object.keys(COST_STATUS_LABELS) as CostRowStatus[])
            .filter((k) => c[k] > 0)
            .map((k) => (
              <Badge key={k} kind={KIND[k]}>
                {COST_STATUS_LABELS[k]}: {faInt(c[k])}
              </Badge>
            ))}
        </div>
        {note ? <Alert kind="info">{note}</Alert> : null}
        {preview.truncated ? <Alert kind="warn">فقط {faInt(MAX_IMPORT_ROWS)} ردیف اول فایل بررسی شد؛ بقیه را در فایل دیگری وارد کنید.</Alert> : null}
        {c.nomatch > 0 ? <CheckField label={`ردیف‌های «فعالیت پیدا نشد» (${faInt(c.nomatch)}) به‌صورت هزینه‌ی عمومی (بدون فعالیت) وارد شوند`} checked={asOverhead} onChange={setAsOverhead} /> : null}
        {c.ambiguous > 0 ? <Alert kind="warn">ردیف‌هایی که با چند فعالیت مطابقت دارند وارد نمی‌شوند؛ ستون «کد WBS» را در فایل بنویسید.</Alert> : null}
        {plan.skippedForCapacity > 0 ? <Alert kind="warn">دفتر هزینه حداکثر ۵۰۰۰ ردیف دارد؛ {faInt(plan.skippedForCapacity)} ردیف جا نمی‌شود و وارد نخواهد شد.</Alert> : null}
        <div className="tbl-wrap" style={{ maxHeight: 340 }}>
          <table className="tbl" data-testid="import-table">
            <thead>
              <tr>
                <th className="c">ردیف فایل</th>
                <th className="num">تاریخ</th>
                <th>فعالیت (WBS / نام)</th>
                <th>شرح</th>
                <th className="n">مبلغ</th>
                <th>وضعیت</th>
              </tr>
            </thead>
            <tbody>
              {preview.rows.slice(0, 300).map((r) => (
                <tr key={r.line}>
                  <td className="c num muted">{faInt(r.line)}</td>
                  <td className="num">{r.date ? faDate(r.date) : '—'}</td>
                  <td>{r.ref || '—'}</td>
                  <td className="small">{r.description}</td>
                  <td className="n">{r.amount === null ? '—' : faInt(r.amount)}</td>
                  <td>
                    <Badge kind={KIND[r.status]}>{COST_STATUS_LABELS[r.status]}</Badge>
                    {r.detail ? <div className="small muted">{r.detail}</div> : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {preview.rows.length > 300 ? <p className="small muted">{faInt(preview.rows.length - 300)} ردیف بعدی در جدول نمایش داده نمی‌شود ولی در ورود لحاظ می‌شود.</p> : null}
        <p data-testid="import-summary">
          <strong>{faInt(plan.entries.length)}</strong> ردیف به مبلغ <strong>{faMoney(total, unit)}</strong> ثبت خواهد شد. ردیف‌های تکراری و نامعتبر نادیده گرفته می‌شوند.
        </p>
      </div>
      <footer>
        <Btn kind="primary" busy={busy} disabled={plan.entries.length === 0} onClick={apply} testId="import-apply">
          ثبت {faInt(plan.entries.length)} ردیف
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </>
  );
}
