import { PAYMENT_STATUSES, PAYMENT_STATUS_LABELS, paymentReceivable, paymentTotals } from '@bistoon/core';
import type { PaymentDto } from '@bistoon/core';
import { faDate, faNum } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { Alert, Badge, Card, Kpi, PageHead } from '../../ui/controls.tsx';
import { RecordTable } from '../records/RecordTable.tsx';
import type { RecordConfig } from '../records/RecordTable.tsx';

const STATUS_OPTIONS = PAYMENT_STATUSES.map((v) => ({ value: v, label: PAYMENT_STATUS_LABELS[v] }));
const STATUS_KIND: Record<PaymentDto['status'], 'ok' | 'brand' | 'accent' | ''> = { paid: 'ok', approved: 'brand', sent: 'accent', preparing: '' };
const dash = (s: string | null | undefined): string => (s && s.trim() ? s : '—');

function config(canEdit: boolean): RecordConfig<PaymentDto> {
  return {
    path: 'payments',
    noun: 'صورت‌وضعیت',
    testPrefix: 'pay',
    canEdit,
    titleOf: (r) => `صورت‌وضعیت ${r.number || r.title || r.id}`,
    emptyHint: canEdit ? 'با «صورت‌وضعیت جدید» پیش‌پرداخت و صورت‌وضعیت‌های ارسالی به کارفرما و دریافتی‌ها را ثبت کنید.' : 'صورت‌وضعیت‌ها را مالی ثبت می‌کند.',
    blank: () => ({ number: '', title: '', sentDate: null, sentAmount: 0, approvedAmount: null, receivedAmount: 0, receivedDate: null, status: 'preparing', notes: '' }),
    fields: [
      { key: 'number', label: 'شماره', kind: 'text', required: true, maxLength: 40, hint: 'مثلاً «۱»، «۲» یا «پیش‌پرداخت»' },
      { key: 'status', label: 'وضعیت', kind: 'select', options: STATUS_OPTIONS },
      { key: 'title', label: 'شرح', kind: 'text', wide: true, maxLength: 200 },
      { key: 'sentDate', label: 'تاریخ ارسال', kind: 'date' },
      { key: 'sentAmount', label: 'مبلغ ارسالی', kind: 'num', min: 0, required: true },
      { key: 'approvedAmount', label: 'مبلغ تأییدشده', kind: 'num', min: 0, nullable: true, hint: 'تا وقتی کارفرما تأیید نکرده خالی بماند.' },
      { key: 'receivedAmount', label: 'مبلغ دریافتی', kind: 'num', min: 0, required: true },
      { key: 'receivedDate', label: 'تاریخ دریافت', kind: 'date' },
      { key: 'notes', label: 'توضیحات', kind: 'long', wide: true },
    ],
    columns: [
      { header: 'شماره', cell: (r) => <strong>{dash(r.number)}</strong> },
      { header: 'شرح', cell: (r) => dash(r.title) },
      { header: 'تاریخ ارسال', className: 'num', cell: (r) => faDate(r.sentDate) },
      { header: 'مبلغ ارسالی', className: 'n', cell: (r) => faNum(r.sentAmount) },
      { header: 'مبلغ تأییدشده', className: 'n', cell: (r) => (r.approvedAmount === null ? '—' : faNum(r.approvedAmount)) },
      { header: 'مبلغ دریافتی', className: 'n', cell: (r) => faNum(r.receivedAmount) },
      { header: 'تاریخ دریافت', className: 'num', cell: (r) => faDate(r.receivedDate) },
      { header: 'مانده‌ی مطالبات', className: 'n', cell: (r) => (r.status === 'preparing' ? '—' : <strong>{faNum(paymentReceivable(r))}</strong>) },
      { header: 'وضعیت', cell: (r) => <Badge kind={STATUS_KIND[r.status]}>{PAYMENT_STATUS_LABELS[r.status]}</Badge> },
      { header: 'توضیحات', cell: (r) => <span className="small">{dash(r.notes)}</span> },
    ],
  };
}

export function PaymentsTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const rows = b.payments ?? [];
  const unit = b.project.finance.unit;
  const t = paymentTotals(rows);
  const contract = b.contract;
  const mismatch = contract && (Math.round(contract.invoicedTotal) !== Math.round(t.sent) || Math.round(contract.collectedTotal) !== Math.round(t.received));
  return (
    <>
      <PageHead title="صورت‌وضعیت‌ها و دریافتی‌ها" />
      <div className="stack gap-l">
        <Card title="جمع‌ها">
          <div className="grid cols-4" data-testid="pay-totals">
            <Kpi label="جمع ارسالی" value={faNum(t.sent)} sub={unit} />
            <Kpi label="جمع تأییدشده" value={faNum(t.approved)} sub={unit} />
            <Kpi label="جمع دریافتی" value={faNum(t.received)} sub={unit} />
            <Kpi label="مانده‌ی مطالبات" value={faNum(t.receivable)} tone={t.receivable > 0 ? 'warn' : 'ok'} sub="تأییدشده (یا ارسالی) − دریافتی؛ بدون «در حال تهیه»" />
          </div>
        </Card>
        {mismatch && contract ? (
          <Alert kind="info">
            جمع‌های فاکتور و وصول در برگه‌ی «منشور و قرارداد» (فاکتورشده {faNum(contract.invoicedTotal)}، وصول‌شده {faNum(contract.collectedTotal)}) جداگانه و دستی ثبت می‌شوند و با این جدول خودکار هم‌گام نمی‌شوند؛ پورسانت از همان مقدارهای قرارداد حساب می‌شود.
          </Alert>
        ) : null}
        <RecordTable cfg={config(can('payments.edit'))} rows={rows} />
      </div>
    </>
  );
}
