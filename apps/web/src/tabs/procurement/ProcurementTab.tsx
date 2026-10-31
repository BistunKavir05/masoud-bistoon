import { useMemo } from 'react';
import { PROCUREMENT_STATUSES, PROCUREMENT_STATUS_LABELS, isProcurementLate, procurementDelayDays, procurementTotals, wbsMap } from '@bistoon/core';
import type { ProcurementItemDto } from '@bistoon/core';
import { faDate, faInt, faNum } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { Badge, Card, Kpi, PageHead } from '../../ui/controls.tsx';
import { RecordTable } from '../records/RecordTable.tsx';
import type { RecordConfig } from '../records/RecordTable.tsx';

const STATUS_OPTIONS = PROCUREMENT_STATUSES.map((v) => ({ value: v, label: PROCUREMENT_STATUS_LABELS[v] }));
const dash = (s: string | null | undefined): string => (s && s.trim() ? s : '—');

export function ProcurementTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const rows = b.procurement ?? [];
  const unit = b.project.finance.unit;
  const status = b.project.status;
  const tasks = b.tasks ?? [];
  const wbs = useMemo(() => wbsMap(tasks), [tasks]);
  const taskLabel = (id: number | null): string => {
    if (id === null) return '—';
    const t = tasks.find((x) => x.id === id);
    return t ? `${wbs.get(id) ?? ''} ${t.name}`.trim() : `فعالیت ${faInt(id)}`;
  };
  const totals = procurementTotals(rows, status);

  const cfg: RecordConfig<ProcurementItemDto> = {
    path: 'procurement',
    noun: 'قلم تدارکات',
    testPrefix: 'proc',
    canEdit: can('procurement.edit'),
    titleOf: (r) => r.item || `قلم ${r.id}`,
    emptyHint: can('procurement.edit') ? 'با «قلم تدارکات جدید» کالاها و خدمات خریداری‌شده، تأمین‌کننده و موعد تحویل را ثبت کنید.' : 'اقلام تدارکات را مدیر پروژه ثبت می‌کند.',
    blank: () => ({ item: '', taskId: null, supplier: '', orderNumber: '', amount: 0, orderDate: null, plannedDelivery: null, actualDelivery: null, status: 'requested', notes: '' }),
    fields: [
      { key: 'item', label: 'قلم / خدمت', kind: 'text', required: true, wide: true, maxLength: 200 },
      {
        key: 'taskId',
        label: 'فعالیت مرتبط',
        kind: 'select',
        numeric: true,
        emptyLabel: '— بدون فعالیت —',
        options: tasks.map((t) => ({ value: String(t.id), label: `${wbs.get(t.id) ?? ''} ${t.name}`.trim() })),
        when: tasks.length > 0,
      },
      { key: 'supplier', label: 'تأمین‌کننده', kind: 'text', maxLength: 200 },
      { key: 'orderNumber', label: 'شماره‌ی سفارش', kind: 'text', maxLength: 60 },
      { key: 'amount', label: 'مبلغ', kind: 'num', min: 0, required: true },
      { key: 'status', label: 'وضعیت', kind: 'select', options: STATUS_OPTIONS },
      { key: 'orderDate', label: 'تاریخ سفارش', kind: 'date' },
      { key: 'plannedDelivery', label: 'تحویل برنامه‌ای', kind: 'date' },
      { key: 'actualDelivery', label: 'تحویل واقعی', kind: 'date' },
      { key: 'notes', label: 'توضیحات', kind: 'long', wide: true },
    ],
    columns: [
      { header: 'قلم / خدمت', cell: (r) => <strong>{r.item || '—'}</strong> },
      { header: 'فعالیت', cell: (r) => <span className="small">{taskLabel(r.taskId)}</span> },
      { header: 'تأمین‌کننده', cell: (r) => dash(r.supplier) },
      { header: 'شماره‌ی سفارش', cell: (r) => dash(r.orderNumber) },
      { header: 'مبلغ', className: 'n', cell: (r) => faNum(r.amount) },
      { header: 'تاریخ سفارش', className: 'num', cell: (r) => faDate(r.orderDate) },
      { header: 'تحویل برنامه‌ای', className: 'num', cell: (r) => faDate(r.plannedDelivery) },
      { header: 'تحویل واقعی', className: 'num', cell: (r) => faDate(r.actualDelivery) },
      {
        header: 'تأخیر (روز)',
        className: 'n',
        cell: (r) => {
          const d = procurementDelayDays(r, status);
          if (d === null) return '—';
          return d > 0 ? <Badge kind={isProcurementLate(r, status) ? 'bad' : 'warn'}>{faInt(d)}</Badge> : faInt(0);
        },
      },
      { header: 'وضعیت', cell: (r) => <Badge kind={r.status === 'delivered' ? 'ok' : r.status === 'requested' ? '' : 'brand'}>{PROCUREMENT_STATUS_LABELS[r.status]}</Badge> },
      { header: 'توضیحات', cell: (r) => <span className="small">{dash(r.notes)}</span> },
    ],
  };

  return (
    <>
      <PageHead title="تدارکات و سفارش‌ها" />
      <div className="stack gap-l">
        <Card title="خلاصه">
          <div className="grid cols-4" data-testid="proc-totals">
            <Kpi label="تعداد اقلام" value={faInt(totals.count)} />
            <Kpi label="جمع مبلغ" value={faNum(totals.amount)} sub={unit} />
            <Kpi label="تحویل‌شده" value={faInt(totals.delivered)} tone={totals.count > 0 && totals.delivered === totals.count ? 'ok' : ''} />
            <Kpi label="دارای تأخیر" value={faInt(totals.late)} tone={totals.late > 0 ? 'bad' : 'ok'} sub="تحویل‌نشده و گذشته از موعد" />
          </div>
        </Card>
        <RecordTable cfg={cfg} rows={rows} />
        <p className="small muted">تأخیر به روز تقویمی است و برای قلم تحویل‌نشده از تاریخ وضعیت پروژه حساب می‌شود.</p>
      </div>
    </>
  );
}
