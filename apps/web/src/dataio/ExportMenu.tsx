/**
 * منوی «خروجی» نوار بالا. هر مورد فقط برای نقشی که قابلیت لازم را دارد دیده می‌شود:
 *  - پشتیبان کامل JSON و فایل MS Project (XML): قابلیت data.export (ادمین و مدیر پروژه)
 *  - CSVها: هر نقش فقط دسته‌هایی را که می‌تواند ببیند؛ خروجی همان داده‌ای است که در صفحه می‌بیند.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { CSV_KINDS, CSV_KIND_LABELS, MSP_EXPORT_OMITS, buildCsv, buildMspXml, csvFileName } from '@bistoon/core';
import type { Capability, CsvKind } from '@bistoon/core';
import { apiGet, errorMessage } from '../api/client.ts';
import { MIME_CSV, downloadFile } from '../lib/download.ts';
import { faInt } from '../lib/fmt.ts';
import { useCan, useProjectState } from '../state/project.ts';
import { Alert, Btn } from '../ui/controls.tsx';
import { openDialog, toast } from '../ui/dialogs.tsx';
import { Icon } from '../ui/icons.tsx';

const CSV_GATE: Record<CsvKind, Capability> = {
  tasks: 'schedule.view',
  risks: 'risks.view',
  issues: 'risks.view',
  changes: 'risks.view',
  decisions: 'risks.view',
  documents: 'documents.view',
  costs: 'costs.view',
};

const MIME_JSON = 'application/json;charset=utf-8';
const MIME_XML = 'application/xml;charset=utf-8';

/** دانلود پشتیبان کامل پروژه (برای ورود پیش از تغییرات بزرگ هم استفاده می‌شود) */
export async function downloadBackup(pid: number, statusDate: string): Promise<void> {
  const doc = await apiGet<unknown>(`/projects/${pid}/export`);
  downloadFile(`bistoon-backup-${pid}-${statusDate}.json`, JSON.stringify(doc), MIME_JSON);
}

export function ExportMenu() {
  const ps = useProjectState();
  const can = useCan();
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent): void => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        setOpen(false);
        trigger.current?.focus();
      } else if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && wrap.current) {
        const items = [...wrap.current.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')];
        if (items.length === 0) return;
        e.preventDefault();
        const i = items.indexOf(document.activeElement as HTMLButtonElement);
        const next = e.key === 'ArrowDown' ? (i + 1) % items.length : (i <= 0 ? items.length - 1 : i - 1);
        items[next]?.focus();
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key);
    };
  }, [open]);

  const bundle = ps.bundle;
  const model = ps.model;
  if (!bundle || !model) return null;
  const project = bundle.project;
  const countOf: Record<CsvKind, number> = {
    tasks: model.tasks.length,
    risks: model.risks.length,
    issues: model.issues.length,
    changes: model.changes.length,
    decisions: model.decisions.length,
    documents: model.documents.length,
    costs: model.costs.length,
  };
  const csvKinds = CSV_KINDS.filter((k) => can(CSV_GATE[k]));
  const canData = can('data.export');
  if (!canData && csvKinds.length === 0) return null;

  const exportCsv = (kind: CsvKind): void => {
    setOpen(false);
    const out = buildCsv(kind, model, ps.analysis, { canSeeCosts: can('costs.view') });
    if (!out.ok) {
      toast.bad(out.error);
      return;
    }
    downloadFile(csvFileName(kind, project.status), out.text, MIME_CSV);
    toast.ok(`«${CSV_KIND_LABELS[kind]}» با ${faInt(out.rows)} ردیف ذخیره شد.`);
  };

  const backup = async (): Promise<void> => {
    setOpen(false);
    setBusy(true);
    try {
      await downloadBackup(project.id, project.status);
      toast.ok('پشتیبان کامل پروژه ذخیره شد.');
    } catch (e) {
      toast.bad(`پشتیبان گرفته نشد: ${errorMessage(e)}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={wrap} style={{ position: 'relative' }} className="no-print">
      <button ref={trigger} type="button" className="btn" aria-haspopup="menu" aria-expanded={open} disabled={busy} onClick={() => setOpen((o) => !o)} data-testid="export-menu">
        {busy ? <span className="spin" aria-hidden="true" /> : <Icon name="download" />}
        خروجی
      </button>
      {open && (
        <div className="popover menu-pop" role="menu" aria-label="خروجی" style={{ insetBlockStart: 'calc(100% + 4px)', insetInlineEnd: 0 }}>
          {canData ? (
            <>
              <div className="menu-head">پشتیبان و تبادل</div>
              <button type="button" role="menuitem" className="menu-item" onClick={() => void backup()} data-testid="export-backup">
                پشتیبان کامل پروژه <span className="muted small">JSON</span>
              </button>
              <button type="button" role="menuitem" className="menu-item" onClick={() => { setOpen(false); openMspExportDialog(); }} data-testid="export-msp">
                برنامه برای MS Project <span className="muted small">XML</span>
              </button>
            </>
          ) : null}
          {csvKinds.length > 0 ? (
            <>
              <div className="menu-head">جدول‌ها (CSV)</div>
              {csvKinds.map((k) => (
                <button key={k} type="button" role="menuitem" className="menu-item" disabled={countOf[k] === 0} title={countOf[k] === 0 ? 'ردیفی برای خروجی وجود ندارد.' : undefined} onClick={() => exportCsv(k)} data-testid={`export-csv-${k}`}>
                  {CSV_KIND_LABELS[k]} <span className="muted small num">{faInt(countOf[k])}</span>
                </button>
              ))}
            </>
          ) : null}
        </div>
      )}
    </div>
  );
}

// ───── خروجی MS Project ─────

export function openMspExportDialog(): void {
  void openDialog('برنامه برای MS Project (XML)', (close) => <MspExportBody close={() => close()} />, { wide: true });
}

function MspExportBody({ close }: { close: () => void }) {
  const ps = useProjectState();
  const model = ps.model;
  const project = ps.bundle!.project;
  const built = useMemo(() => (model ? buildMspXml(model) : null), [model]);
  return (
    <>
      <div className="body stack">
        <p>
          فایل XML به قالب Microsoft Project (MSPDI) ساخته می‌شود تا برنامه‌ی زمانی را در MS Project یا ابزارهای هم‌قالب باز کنید یا بعداً دوباره در بیستون وارد کنید.
        </p>
        <div className="stack gap-s">
          <strong>آنچه منتقل می‌شود</strong>
          <ul className="plain-list small">
            <li>ساختار سلسله‌مراتب و سطح‌ها، نام، فعالیت/خلاصه/مایلستون</li>
            <li>مدت <strong>برنامه‌ریزی‌شده</strong> هر فعالیت (نه مدت واقعی)، شروع و پایان محاسبه‌شده</li>
            <li>وابستگی‌ها با نوع و تأخیر، قید «شروع نه زودتر» و ضرب‌الاجل</li>
            <li>درصد پیشرفت و تاریخ‌های واقعی فعالیت‌های غیرخلاصه، خط مبنای فعلی، تقویم کاری و تعطیلات</li>
          </ul>
        </div>
        <div className="stack gap-s">
          <strong>آنچه منتقل نمی‌شود</strong>
          <ul className="plain-list small" data-testid="msp-export-omits">
            {MSP_EXPORT_OMITS.map((x) => (
              <li key={x}>{x}</li>
            ))}
          </ul>
        </div>
        <Alert kind="warn">
          سازگاری فایل با نسخه‌های مختلف Microsoft Project آزموده نشده است؛ پس از باز کردن، تاریخ‌ها و پیوندها را با برنامه‌ی بیستون مقایسه کنید. برای پشتیبان کامل از «پشتیبان کامل پروژه (JSON)» استفاده کنید.
        </Alert>
        {built && !built.ok ? <Alert kind="bad">{built.error}</Alert> : null}
      </div>
      <footer>
        <Btn
          kind="primary"
          icon="download"
          disabled={!built || !built.ok}
          testId="msp-export-download"
          onClick={() => {
            if (!built || !built.ok) return;
            downloadFile(`bistoon-project-${project.id}-${project.status}.xml`, built.xml, MIME_XML);
            toast.ok(`فایل XML با ${faInt(built.rows)} ردیف ذخیره شد.`);
            close();
          }}
        >
          دانلود فایل XML
        </Btn>
        <Btn onClick={close}>بستن</Btn>
      </footer>
    </>
  );
}
