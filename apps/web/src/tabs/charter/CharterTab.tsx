import type { ReactNode } from 'react';
import { commissionPayable, contractWarnings, emptyContract, retentionAmount, SALES_APPROVAL_LABELS } from '@bistoon/core';
import type { CharterDto, Contract, ContractDto, SalesApproval } from '@bistoon/core';
import { faDate, faMoney, faNum, faPct } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { Alert, Badge, Btn, Card, Empty, Kpi, PageHead, ProgressBar } from '../../ui/controls.tsx';
import { openFormDialog } from '../records/RecordTable.tsx';
import type { FormSpec } from '../records/RecordTable.tsx';


const charterSpec: FormSpec<CharterDto> = {
  path: 'charter',
  noun: 'منشور پروژه',
  testPrefix: 'charter',
  singleton: true,
  fields: [
    { key: 'client', label: 'کارفرما', kind: 'text' },
    { key: 'location', label: 'محل اجرا', kind: 'text' },
    { key: 'subject', label: 'موضوع پروژه', kind: 'text', wide: true, maxLength: 500 },
    { key: 'product', label: 'محصول / خروجی', kind: 'text' },
    { key: 'projectManager', label: 'مدیر پروژه', kind: 'text', maxLength: 200 },
    { key: 'salesOwner', label: 'مسئول فروش', kind: 'text', maxLength: 200 },
    { key: 'goals', label: 'اهداف', kind: 'long' },
    { key: 'scope', label: 'دامنه‌ی کار', kind: 'long' },
    { key: 'assumptions', label: 'فرض‌ها و محدودیت‌ها', kind: 'long' },
    { key: 'stakeholders', label: 'ذی‌نفعان', kind: 'long' },
  ],
};

const contractInfoSpec: FormSpec<ContractDto> = {
  path: 'contract',
  noun: 'اطلاعات قرارداد',
  testPrefix: 'contract',
  singleton: true,
  fields: [
    { key: 'number', label: 'شماره‌ی قرارداد', kind: 'text', maxLength: 100 },
    { key: 'date', label: 'تاریخ انعقاد', kind: 'date' },
    { key: 'type', label: 'نوع قرارداد', kind: 'text', maxLength: 100 },
    { key: 'validity', label: 'مدت اعتبار', kind: 'text', maxLength: 200 },
    { key: 'amount', label: 'مبلغ قرارداد', kind: 'int', min: 0, hint: 'عدد صحیح به واحد پولی پروژه' },
    { key: 'advanceDate', label: 'تاریخ واریز پیش‌پرداخت', kind: 'date' },
    { key: 'advanceAmount', label: 'مبلغ پیش‌پرداخت', kind: 'int', min: 0 },
    { key: 'advanceGuaranteeSerial', label: 'سریال ضمانت‌نامه‌ی پیش‌پرداخت', kind: 'text', maxLength: 100 },
    { key: 'performanceGuaranteeSerial', label: 'سریال ضمانت‌نامه‌ی حسن انجام کار', kind: 'text', maxLength: 100 },
    {
      key: 'retentionMode',
      label: 'حسن انجام کار',
      kind: 'select',
      options: [
        { value: 'fixed', label: 'مبلغ ثابت' },
        { value: 'percent', label: 'درصدی از مبلغ قرارداد' },
      ],
    },
    { key: 'retentionValue', label: 'مقدار حسن انجام کار', kind: 'num', min: 0, hint: 'مبلغ ثابت، یا در حالت درصدی عددی بین ۰ تا ۱۰۰' },
  ],
};

const collectionSpec: FormSpec<ContractDto> = {
  path: 'contract',
  noun: 'فاکتور و وصول',
  testPrefix: 'collection',
  singleton: true,
  fields: [
    { key: 'invoiceNumbers', label: 'شماره‌ی فاکتورها', kind: 'text', wide: true, maxLength: 500, hint: 'با ویرگول جدا کنید' },
    { key: 'invoicedTotal', label: 'جمع مبلغ فاکتورشده', kind: 'int', min: 0 },
    { key: 'collectedTotal', label: 'جمع مبلغ وصول‌شده', kind: 'int', min: 0 },
  ],
};

const commissionSpec: FormSpec<ContractDto> = {
  path: 'contract',
  noun: 'درصد پورسانت',
  testPrefix: 'commission',
  singleton: true,
  fields: [
    { key: 'salesCommissionPercent', label: 'پورسانت فروش (٪ از مبلغ قرارداد)', kind: 'num', min: 0, max: 100 },
    { key: 'retentionCommissionPercent', label: 'پورسانت حسن انجام کار (٪ از مبلغ حسن انجام کار)', kind: 'num', min: 0, max: 100 },
  ],
};

const approvalSpec: FormSpec<ContractDto> = {
  path: 'contract',
  noun: 'وضعیت تأیید پورسانت',
  testPrefix: 'approval',
  singleton: true,
  fields: [
    {
      key: 'salesApproval',
      label: 'وضعیت تأیید',
      kind: 'select',
      emptyLabel: '— ثبت نشده —',
      options: (Object.keys(SALES_APPROVAL_LABELS) as SalesApproval[]).map((v) => ({ value: v, label: SALES_APPROVAL_LABELS[v] })),
    },
  ],
};

function Facts({ items }: { items: [string, ReactNode][] }) {
  return (
    <dl className="facts">
      {items.map(([k, v]) => (
        <div key={k}>
          <dt>{k}</dt>
          <dd>{v === '' || v === null || v === undefined ? <span className="muted">—</span> : v}</dd>
        </div>
      ))}
    </dl>
  );
}

const Long = ({ title, text }: { title: string; text: string }) => (
  <div>
    <h4 style={{ margin: '14px 0 4px', fontSize: 13, color: 'var(--ink-2)' }}>{title}</h4>
    {text.trim() ? <p style={{ margin: 0, whiteSpace: 'pre-wrap' }}>{text}</p> : <p className="muted" style={{ margin: 0 }}>—</p>}
  </div>
);

export function CharterTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const unit = b.project.finance.unit;
  const archived = b.project.archived;
  const m = (n: number): string => faMoney(n, unit);

  const ch = b.charter;
  const contract: (Contract & { version: number }) | null = b.contract ? { ...emptyContract(), ...b.contract, version: b.contract.version } : null;
  const showCharter = can('charter.view') && ch !== undefined;
  const showContract = can('contract.view') && contract !== null;
  const pay = b.commission ?? (contract && can('commission.view') ? commissionPayable({ ...emptyContract(), ...contract }) : null);
  const warnings = contract ? contractWarnings(contract, b.project.start) : [];

  return (
    <>
      <PageHead title="منشور و قرارداد" />
      <div className="stack gap-l">
        {showCharter ? (
          <Card
            title="منشور پروژه"
            actions={
              can('charter.edit') && !archived ? (
                <Btn icon="edit" onClick={() => openFormDialog(charterSpec, ch)} testId="charter-edit">
                  ویرایش منشور
                </Btn>
              ) : null
            }
          >
            <Facts
              items={[
                ['کارفرما', ch.client],
                ['محل اجرا', ch.location],
                ['موضوع پروژه', ch.subject],
                ['محصول / خروجی', ch.product],
                ['مدیر پروژه', ch.projectManager],
                ['مسئول فروش', ch.salesOwner],
              ]}
            />
            <Long title="اهداف" text={ch.goals} />
            <Long title="دامنه‌ی کار" text={ch.scope} />
            <Long title="فرض‌ها و محدودیت‌ها" text={ch.assumptions} />
            <Long title="ذی‌نفعان" text={ch.stakeholders} />
          </Card>
        ) : null}

        {showContract ? (
          <Card
            title="قرارداد"
            actions={
              !archived ? (
                <>
                  {can('contract.edit') ? (
                    <Btn icon="edit" onClick={() => openFormDialog(contractInfoSpec, contract)} testId="contract-edit">
                      ویرایش اطلاعات
                    </Btn>
                  ) : null}
                  {can('contract.collection.edit') ? (
                    <Btn icon="edit" onClick={() => openFormDialog(collectionSpec, contract)} testId="collection-edit">
                      ثبت فاکتور و وصول
                    </Btn>
                  ) : null}
                </>
              ) : null
            }
          >
            {warnings.length ? (
              <div style={{ marginBottom: 12 }} data-testid="contract-warnings">
                {warnings.map((w) => (
                  <Alert key={w.code} kind="warn">
                    {w.message}
                  </Alert>
                ))}
              </div>
            ) : null}
            {contract.amount === 0 && !contract.number ? (
              <Empty title="اطلاعات قرارداد هنوز ثبت نشده است">{can('contract.edit') ? 'با «ویرایش اطلاعات» شماره، مبلغ و تاریخ‌ها را وارد کنید.' : 'مدیر پروژه یا مالی اطلاعات قرارداد را ثبت می‌کند.'}</Empty>
            ) : (
              <>
                <div className="grid cols-4">
                  <Kpi label="مبلغ قرارداد" value={m(contract.amount)} />
                  <Kpi label="فاکتورشده" value={m(contract.invoicedTotal)} sub={contract.amount > 0 ? `${faPct((contract.invoicedTotal / contract.amount) * 100)} مبلغ قرارداد` : undefined} />
                  <Kpi label="وصول‌شده" value={m(contract.collectedTotal)} tone={contract.collectedTotal > contract.invoicedTotal ? 'warn' : ''} sub={contract.amount > 0 ? `${faPct((contract.collectedTotal / contract.amount) * 100)} مبلغ قرارداد` : undefined} />
                  <Kpi label="مانده‌ی وصول" value={m(Math.max(0, contract.amount - contract.collectedTotal))} />
                </div>
                {contract.amount > 0 ? (
                  <div style={{ margin: '14px 0' }} aria-label="پیشرفت فاکتور و وصول">
                    <div className="small muted">فاکتورشده</div>
                    <ProgressBar actual={Math.min(100, (contract.invoicedTotal / contract.amount) * 100)} />
                    <div className="small muted" style={{ marginTop: 6 }}>
                      وصول‌شده
                    </div>
                    <ProgressBar actual={Math.min(100, (contract.collectedTotal / contract.amount) * 100)} />
                  </div>
                ) : null}
                <Facts
                  items={[
                    ['شماره‌ی قرارداد', contract.number],
                    ['تاریخ انعقاد', contract.date ? faDate(contract.date) : ''],
                    ['نوع قرارداد', contract.type],
                    ['مدت اعتبار', contract.validity],
                    ['پیش‌پرداخت', contract.advanceAmount ? `${m(contract.advanceAmount)}${contract.advanceDate ? ` — ${faDate(contract.advanceDate)}` : ''}` : ''],
                    ['ضمانت‌نامه‌ی پیش‌پرداخت', contract.advanceGuaranteeSerial],
                    ['حسن انجام کار', contract.retentionValue ? `${m(retentionAmount(contract))}${contract.retentionMode === 'percent' ? ` (${faNum(contract.retentionValue, 2)}٪ مبلغ قرارداد)` : ' (مبلغ ثابت)'}` : ''],
                    ['ضمانت‌نامه‌ی حسن انجام کار', contract.performanceGuaranteeSerial],
                    ['شماره‌ی فاکتورها', contract.invoiceNumbers],
                  ]}
                />
              </>
            )}
          </Card>
        ) : null}

        {pay && contract ? (
          <Card
            title="پورسانت"
            actions={
              !archived ? (
                <>
                  {can('commission.edit') ? (
                    <Btn icon="edit" onClick={() => openFormDialog(commissionSpec, contract)} testId="commission-edit">
                      تعیین درصد
                    </Btn>
                  ) : null}
                  {can('commission.approve') ? (
                    <Btn onClick={() => openFormDialog(approvalSpec, contract)} testId="approval-edit">
                      تأیید پورسانت
                    </Btn>
                  ) : null}
                </>
              ) : null
            }
          >
            <p className="small muted" style={{ marginTop: 0 }}>
              پورسانت با وصول مطالبات قابل پرداخت می‌شود: سهم فروش متناسب با نسبت وصولی به مبلغ قرارداد، و سهم حسن انجام کار فقط پس از وصول حسن انجام کار.
            </p>
            <div className="grid cols-4">
              <Kpi label="کل استحقاق" value={m(pay.total)} />
              <Kpi label="قابل پرداخت تا امروز" value={m(pay.payable)} tone={pay.payable > 0 ? 'ok' : ''} sub={`نسبت وصول: ${faPct(pay.collectedRatio * 100)}`} />
              <Kpi label="باقی‌مانده تا وصول" value={m(pay.pending)} />
              <Kpi label="وضعیت تأیید" value={contract.salesApproval ? SALES_APPROVAL_LABELS[contract.salesApproval] : 'ثبت نشده'} tone={contract.salesApproval === 'approved' ? 'ok' : contract.salesApproval === 'rejected' ? 'bad' : ''} />
            </div>
            <div className="tbl-wrap" style={{ marginTop: 14 }}>
              <table className="tbl" data-testid="commission-table">
                <thead>
                  <tr>
                    <th>نوع</th>
                    <th className="n">درصد</th>
                    <th className="n">استحقاق</th>
                    <th className="n">قابل پرداخت</th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <td>فروش (از مبلغ قرارداد)</td>
                    <td className="n">{faNum(contract.salesCommissionPercent, 2)}٪</td>
                    <td className="n">{m(pay.sales)}</td>
                    <td className="n">{m(pay.payableSales)}</td>
                  </tr>
                  <tr>
                    <td>حسن انجام کار</td>
                    <td className="n">{faNum(contract.retentionCommissionPercent, 2)}٪</td>
                    <td className="n">{m(pay.retention)}</td>
                    <td className="n">{m(pay.payableRetention)}</td>
                  </tr>
                  <tr>
                    <th>جمع</th>
                    <th />
                    <th className="n">{m(pay.total)}</th>
                    <th className="n">{m(pay.payable)}</th>
                  </tr>
                </tbody>
              </table>
            </div>
            {!can('commission.edit') && !can('commission.approve') ? <p className="small muted">پورسانت فقط برای مشاهده است.</p> : null}
          </Card>
        ) : null}

        {!showCharter && !showContract ? <Alert kind="info">اطلاعاتی برای نمایش در دسترس نقش شما نیست.</Alert> : null}
      </div>
    </>
  );
}

export const charterBadge = (c: CharterDto | undefined): ReactNode => (c && c.client ? <Badge kind="ok">تکمیل</Badge> : <Badge>ناقص</Badge>);
