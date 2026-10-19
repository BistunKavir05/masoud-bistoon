import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { PORTFOLIO_COLUMNS, filterPortfolio, portfolioCell, portfolioChecks, portfolioExportRows, portfolioTotals, toCsv } from '@bistoon/core';
import type { PortfolioColumn, PortfolioItem } from '@bistoon/core';
import { apiGet, errorMessage } from '../../api/client.ts';
import { MIME_CSV, MIME_XLSX, downloadFile } from '../../lib/download.ts';
import { faDate, faInt, faMoney, faNum, faPct } from '../../lib/fmt.ts';
import { writeXlsx } from '../../lib/xlsx.ts';
import { sessionStore, refreshProjects } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Alert, Badge, Btn, Card, CheckField, Empty, Kpi, Loading, PageHead, TextField } from '../../ui/controls.tsx';
import { downloadPortfolioTemplate, startPortfolioImport } from './ImportDialog.tsx';

function renderCell(item: PortfolioItem, col: PortfolioColumn): string {
  const v = portfolioCell(item, col.key);
  if (v === null || v === '') return '—';
  switch (col.type) {
    case 'date':
      return faDate(String(v) as PortfolioItem['start']);
    case 'money':
      return typeof v === 'number' && v === 0 ? '—' : faNum(Number(v));
    case 'percent':
      return typeof v === 'number' && v === 0 ? '—' : faPct(Number(v), 2);
    default:
      return String(v);
  }
}

export function PortfolioTab() {
  const isAdmin = useStore(sessionStore, (s) => s.user?.isSystemAdmin ?? false);
  const [items, setItems] = useState<PortfolioItem[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [archived, setArchived] = useState(true);
  const file = useRef<HTMLInputElement>(null);

  const load = useCallback(async (): Promise<void> => {
    try {
      const r = await apiGet<{ items: PortfolioItem[] }>('/portfolio');
      setItems(r.items);
      setError(null);
    } catch (e) {
      setError(errorMessage(e));
    }
  }, []);
  useEffect(() => {
    void load();
  }, [load]);

  const visible = useMemo(() => (items ?? []).filter((x) => archived || !x.archived), [items, archived]);
  const shown = useMemo(() => filterPortfolio(visible, q), [visible, q]);
  const totals = useMemo(() => portfolioTotals(shown), [shown]);
  const checks = useMemo(() => portfolioChecks(items ?? []), [items]);
  const multiUnit = totals.length > 1;

  const exportCsv = (): void => downloadFile('bistoon-projects.csv', toCsv(portfolioExportRows(shown)), MIME_CSV);
  const exportXlsx = (): void => downloadFile('bistoon-projects.xlsx', writeXlsx([{ name: 'پروژه‌ها', rows: portfolioExportRows(shown) }]), MIME_XLSX);
  const onDone = async (): Promise<void> => {
    await load();
    await refreshProjects();
  };

  if (!isAdmin) return <Alert kind="warn">این بخش فقط برای ادمین سیستم در دسترس است.</Alert>;

  return (
    <>
      <PageHead title="مدیریت پروژه‌ها">
        <Btn icon="download" onClick={exportCsv} disabled={shown.length === 0} testId="port-csv">
          خروجی CSV
        </Btn>
        <Btn icon="download" onClick={exportXlsx} disabled={shown.length === 0} testId="port-xlsx">
          خروجی Excel
        </Btn>
        <Btn icon="download" onClick={downloadPortfolioTemplate} testId="port-template">
          دانلود قالب ورود
        </Btn>
        <Btn icon="upload" kind="primary" onClick={() => file.current?.click()} disabled={items === null || items.length === 0} testId="port-import">
          ورود از فایل
        </Btn>
        <input
          ref={file}
          type="file"
          accept=".xlsx,.csv,.txt"
          hidden
          data-testid="port-file"
          aria-label="فایل اطلاعات قرارداد"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = '';
            if (f && items) void startPortfolioImport(f, items, onDone);
          }}
        />
      </PageHead>
      {error ? <Alert kind="bad">{error}</Alert> : null}
      {items === null && !error ? (
        <Loading />
      ) : items !== null && items.length === 0 ? (
        <Card>
          <Empty title="پروژه‌ای ساخته نشده است">با «پروژه‌ی جدید» در نوار بالا شروع کنید.</Empty>
        </Card>
      ) : items !== null ? (
        <div className="stack">
          {!multiUnit && totals[0] ? (
            <div className="grid cols-3" data-testid="port-kpis">
              <Kpi label="تعداد پروژه" value={faInt(totals[0].count)} />
              <Kpi label={`جمع مبلغ قراردادها (${totals[0].unit})`} value={faNum(totals[0].amount)} />
              <Kpi label="جمع فاکتورشده" value={faNum(totals[0].invoiced)} />
              <Kpi label="جمع وصول‌شده" value={faNum(totals[0].collected)} />
              <Kpi label="مانده‌ی وصول‌نشده‌ی فاکتورها" value={faNum(totals[0].uncollected)} tone={totals[0].uncollected > 0 ? 'warn' : 'ok'} />
              <Kpi label="جمع پورسانت" value={faNum(totals[0].commission)} sub={`قابل پرداخت (بر مبنای وصول): ${faNum(totals[0].payable)}`} />
            </div>
          ) : null}
          {multiUnit ? (
            <Alert kind="warn">
              پروژه‌ها واحد پولی متفاوت دارند ({checks.units.join('، ')})؛ جمع واحدهای مختلف بی‌معناست، پس جمع‌ها جدا و به‌تفکیک واحد آمده است.
            </Alert>
          ) : null}
          {checks.missing.length > 0 ? (
            <Alert kind="warn">
              <span data-testid="port-missing">
                {faInt(checks.missing.length)} پروژه‌ی فعال نام کارفرما یا شماره قرارداد ندارد: {checks.missing.map((m) => m.name).join('، ')}. آن را باز کنید و در «منشور و قرارداد» تکمیل کنید.
              </span>
            </Alert>
          ) : null}
          {checks.duplicateNumbers.length > 0 ? <Alert kind="warn">شماره قرارداد تکراری: {checks.duplicateNumbers.join('، ')}</Alert> : null}
          <Card>
            <div className="stack">
              <div className="row wrap" role="search">
                <div style={{ flex: '1 1 260px' }}>
                  <TextField label="جست‌وجو (پروژه، مشتری، قرارداد، محل…)" value={q} onChange={setQ} testId="port-search" />
                </div>
                <CheckField label="نمایش پروژه‌های بایگانی‌شده" checked={archived} onChange={setArchived} />
              </div>
              <div className="tbl-wrap" style={{ maxHeight: '60vh' }}>
                <table className="tbl port-tbl" data-testid="port-table">
                  <thead>
                    <tr>
                      <th className="c">ردیف</th>
                      <th>پروژه</th>
                      {PORTFOLIO_COLUMNS.map((c) => (
                        <th key={c.key} className={c.type === 'money' || c.type === 'percent' ? 'n' : ''}>
                          {c.label}
                        </th>
                      ))}
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.length === 0 ? (
                      <tr className="empty-row">
                        <td colSpan={PORTFOLIO_COLUMNS.length + 3}>پروژه‌ای پیدا نشد.</td>
                      </tr>
                    ) : (
                      shown.map((it, i) => (
                        <tr key={it.id} data-testid={`port-row-${it.id}`}>
                          <td className="c muted">{faInt(i + 1)}</td>
                          <td style={{ whiteSpace: 'nowrap' }}>
                            <strong>{it.name}</strong> {it.archived ? <Badge>بایگانی</Badge> : null}
                          </td>
                          {PORTFOLIO_COLUMNS.map((c) => (
                            <td key={c.key} className={c.type === 'money' || c.type === 'percent' ? 'n' : ''}>
                              <span className={c.type === 'text' ? '' : 'num'}>{renderCell(it, c)}</span>
                            </td>
                          ))}
                          <td className="c" style={{ whiteSpace: 'nowrap' }}>
                            <a className="btn sm" href={`#/p/${it.id}/chr`} data-testid={`port-open-${it.id}`}>
                              باز کردن / ویرایش
                            </a>
                          </td>
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </Card>
          <Card title="جمع کل (به‌تفکیک واحد پول)">
            <div className="tbl-wrap">
              <table className="tbl" data-testid="port-totals">
                <thead>
                  <tr>
                    <th>واحد پول</th>
                    <th className="n">تعداد</th>
                    <th className="n">مبلغ قرارداد</th>
                    <th className="n">پیش‌پرداخت</th>
                    <th className="n">فاکتورشده</th>
                    <th className="n">وصول‌شده</th>
                    <th className="n">مانده‌ی وصول‌نشده</th>
                    <th className="n">حسن انجام کار</th>
                    <th className="n">پورسانت فروش</th>
                    <th className="n">پورسانت حسن انجام کار</th>
                    <th className="n">جمع پورسانت</th>
                    <th className="n">قابل پرداخت</th>
                  </tr>
                </thead>
                <tbody>
                  {totals.map((t) => (
                    <tr key={t.unit}>
                      <td>{t.unit}</td>
                      <td className="n">
                        <span className="num">{faInt(t.count)}</span>
                      </td>
                      {[t.amount, t.advance, t.invoiced, t.collected, t.uncollected, t.retention, t.commissionSales, t.commissionRetention, t.commission, t.payable].map((v, i) => (
                        <td key={i} className="n">
                          <span className="num">{faMoney(v, '').trim()}</span>
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              هر پروژه اطلاعات خود را در «منشور و قرارداد» نگه می‌دارد و این جدول از همان‌ها جمع می‌شود. «قابل پرداخت» پورسانتی است که بر مبنای وصول مطالبات قابل پرداخت شده است.
            </p>
          </Card>
        </div>
      ) : null}
    </>
  );
}
