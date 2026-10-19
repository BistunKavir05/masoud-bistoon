import { useMemo, useRef, useState } from 'react';
import { MAX_LEDGER_ROWS, costCsvRows, toCsv, wbsMap } from '@bistoon/core';
import type { CostEntryDto } from '@bistoon/core';
import { MIME_CSV, MIME_XLSX, downloadFile } from '../../lib/download.ts';
import { faDate, faInt, faMoney } from '../../lib/fmt.ts';
import { writeXlsx } from '../../lib/xlsx.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { Btn, Card, TextField } from '../../ui/controls.tsx';
import { RecordTable } from '../records/RecordTable.tsx';
import type { RecordConfig } from '../records/RecordTable.tsx';
import { downloadCostTemplate, startCostImport } from './ImportDialog.tsx';

const PAGE = 200;

export function Ledger() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const unit = b.project.finance.unit;
  const tasks = b.tasks ?? [];
  const costs = b.costs ?? [];
  const edit = can('costs.edit');
  const [q, setQ] = useState('');
  const [limit, setLimit] = useState(PAGE);
  const fileRef = useRef<HTMLInputElement>(null);

  const wbs = useMemo(() => wbsMap(tasks), [tasks]);
  const label = useMemo(() => new Map(tasks.map((t) => [t.id, `${wbs.get(t.id) ?? ''} ${t.name}`.trim()])), [tasks, wbs]);
  const options = useMemo(() => tasks.filter((t) => t.kind !== 'summary').map((t) => ({ value: String(t.id), label: label.get(t.id) as string })), [tasks, label]);

  const cfg = useMemo<RecordConfig<CostEntryDto>>(
    () => ({
      path: 'costs',
      noun: 'هزینه',
      testPrefix: 'cost',
      canEdit: edit,
      titleOf: (r) => `${r.description || 'هزینه'} (${faInt(r.amount)})`,
      emptyHint: edit ? 'با «هزینه‌ی جدید» یا «ورود از فایل» هزینه‌های واقعی را ثبت کنید.' : 'هزینه‌ها را مالی یا مدیر پروژه ثبت می‌کند.',
      blank: () => ({ date: ps.model?.status ?? b.project.status, taskId: null, description: '', document: '', amount: undefined }),
      fields: [
        { key: 'date', label: 'تاریخ هزینه', kind: 'date', required: true },
        { key: 'amount', label: `مبلغ (${unit})`, kind: 'int', required: true, min: 1 },
        { key: 'taskId', label: 'فعالیت', kind: 'select', options, numeric: true, emptyLabel: 'هزینه‌ی عمومی (بدون فعالیت)', wide: true },
        { key: 'description', label: 'شرح هزینه', kind: 'text', maxLength: 120, wide: true },
        { key: 'document', label: 'شماره‌ی سند / فاکتور', kind: 'text', maxLength: 60 },
      ],
      columns: [
        { header: 'تاریخ', className: 'num', cell: (r) => faDate(r.date) },
        { header: 'فعالیت', cell: (r) => (r.taskId === null ? <span className="muted">عمومی / سربار</span> : (label.get(r.taskId) ?? `فعالیت ${faInt(r.taskId)}`)) },
        { header: 'شرح', cell: (r) => r.description || '—' },
        { header: 'سند', className: 'num', cell: (r) => r.document || '—' },
        { header: `مبلغ (${unit})`, className: 'n', cell: (r) => faInt(r.amount) },
      ],
    }),
    [edit, unit, options, label, ps.model?.status, b.project.status],
  );

  const sorted = useMemo(() => [...costs].sort((a, c) => (a.date < c.date ? 1 : a.date > c.date ? -1 : c.id - a.id)), [costs]);
  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return sorted;
    return sorted.filter((r) => `${r.description} ${r.document} ${r.taskId === null ? 'عمومی سربار' : (label.get(r.taskId) ?? '')} ${faDate(r.date)}`.toLowerCase().includes(t));
  }, [sorted, q, label]);
  const shown = filtered.slice(0, limit);
  const total = filtered.reduce((a, r) => a + r.amount, 0);

  const exportRows = (): (string | number)[][] => costCsvRows(costs, tasks);

  return (
    <Card
      title="دفتر هزینه‌ی واقعی"
      actions={
        <>
          {edit && !b.project.archived ? (
            <>
              <Btn icon="plus" onClick={() => fileRef.current?.click()} testId="cost-import">
                ورود از CSV / Excel
              </Btn>
              <input
                ref={fileRef}
                type="file"
                accept=".csv,.txt,.xlsx"
                hidden
                data-testid="cost-import-input"
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void startCostImport(f, { pid: b.project.id, tasks, ledger: costs, unit });
                }}
              />
              <Btn onClick={downloadCostTemplate}>دانلود قالب</Btn>
            </>
          ) : null}
          {costs.length > 0 ? (
            <>
              <Btn onClick={() => downloadFile('bistoon-actual-costs.csv', toCsv(exportRows()), MIME_CSV)} testId="cost-export-csv">
                خروجی CSV
              </Btn>
              <Btn onClick={() => downloadFile('bistoon-actual-costs.xlsx', writeXlsx([{ name: 'هزینه‌ها', rows: exportRows() }]), MIME_XLSX)}>خروجی Excel</Btn>
            </>
          ) : null}
        </>
      }
    >
      <div className="stack">
        {costs.length > 0 ? (
          <div className="row">
            <TextField label="جست‌وجو" value={q} onChange={(v) => { setQ(v); setLimit(PAGE); }} testId="cost-search" />
            <span className="muted small">
              {faInt(filtered.length)} از {faInt(costs.length)} ردیف (سقف دفتر {faInt(MAX_LEDGER_ROWS)}) — جمع: <strong>{faMoney(total, unit)}</strong>
            </span>
          </div>
        ) : null}
        <RecordTable cfg={cfg} rows={shown} />
        {filtered.length > shown.length ? (
          <Btn onClick={() => setLimit((l) => l + PAGE)}>نمایش {faInt(Math.min(PAGE, filtered.length - shown.length))} ردیف بعدی</Btn>
        ) : null}
      </div>
    </Card>
  );
}
