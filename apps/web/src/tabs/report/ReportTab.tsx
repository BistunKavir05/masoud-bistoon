import { useEffect, useMemo, useState } from 'react';
import { ISSUE_PRIORITY_LABELS, ISSUE_STATUS_LABELS, RISK_LEVEL_LABELS, computeDashboard, isOverdue, reportLists, riskLevel, riskScore } from '@bistoon/core';
import { faDate, faDateTime, faInt, faMoney, faNum, faPct, faRatio } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { sessionStore } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Alert, Badge, Btn, Card, CheckField, Empty, Kpi, PageHead, ProgressBar, TextAreaField } from '../../ui/controls.tsx';
import { HEALTH } from '../../ui/health.ts';
import { StageRibbon } from '../../ui/StageRibbon.tsx';
import { RiskMatrix } from '../records/RisksTab.tsx';
import { ScurveChart } from '../scurve/ScurveChart.tsx';

interface Sections {
  finance: boolean;
  contract: boolean;
  scurve: boolean;
  risks: boolean;
  items: boolean;
}

export function ReportTab() {
  const ps = useProjectState();
  const can = useCan();
  const me = useStore(sessionStore, (s) => s.user);
  const b = ps.bundle!;
  const sum = b.summary;
  const a = ps.analysis;
  const model = ps.model;
  const unit = b.project.finance.unit;
  const [inc, setInc] = useState<Sections>({ finance: true, contract: true, scurve: true, risks: true, items: true });
  const [notes, setNotes] = useState('');
  const [printedAt] = useState(() => new Date());

  const dash = useMemo(() => (model && a ? computeDashboard(model, a) : null), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const lists = useMemo(() => reportLists({ risks: b.risks ?? [], issues: b.issues ?? [], decisions: b.decisions ?? [], changes: b.changes ?? [] }), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps

  // نام پیش‌فرض فایل PDF از عنوان صفحه می‌آید
  useEffect(() => {
    const title = document.title;
    const before = (): void => {
      document.title = `گزارش وضعیت - ${b.project.name} - ${faDate(sum.status)}`;
    };
    const after = (): void => {
      document.title = title;
    };
    window.addEventListener('beforeprint', before);
    window.addEventListener('afterprint', after);
    return () => {
      window.removeEventListener('beforeprint', before);
      window.removeEventListener('afterprint', after);
      document.title = title;
    };
  }, [b.project.name, sum.status]);

  const h = HEALTH[sum.health];
  const gap = sum.actual - sum.planned;
  const showFin = inc.finance && can('costs.view') && a !== null;
  const c = b.contract;
  const showContract = inc.contract && can('contract.view') && c !== undefined && c !== null;
  const showRisks = inc.risks && can('risks.view');
  const showItems = inc.items && can('risks.view');
  const risksAll = b.risks ?? [];
  const toggle = (k: keyof Sections) => (v: boolean) => setInc((s) => ({ ...s, [k]: v }));
  const hasAnyRisk = risksAll.some((r) => r.status !== 'closed');

  return (
    <>
      <PageHead title="گزارش وضعیت">
        <Btn icon="print" kind="primary" onClick={() => window.print()} testId="rep-print">
          چاپ / ذخیره به‌صورت PDF
        </Btn>
      </PageHead>

      <div className="card no-print" data-testid="rep-options">
        <div className="stack">
          <div className="row wrap">
            <strong>بخش‌های گزارش:</strong>
            <CheckField label="مالی (EVM)" checked={inc.finance} onChange={toggle('finance')} disabled={!can('costs.view')} />
            <CheckField label="قرارداد و وصول" checked={inc.contract} onChange={toggle('contract')} disabled={!can('contract.view')} />
            <CheckField label="منحنی S" checked={inc.scurve} onChange={toggle('scurve')} disabled={a === null} />
            <CheckField label="ریسک‌ها" checked={inc.risks} onChange={toggle('risks')} disabled={!can('risks.view')} />
            <CheckField label="مسائل، تصمیم‌ها و تغییرها" checked={inc.items} onChange={toggle('items')} disabled={!can('risks.view')} />
          </div>
          <TextAreaField label="یادداشت مدیر پروژه (فقط در همین گزارش چاپ می‌شود و ذخیره نمی‌شود)" value={notes} onChange={setNotes} rows={3} maxLength={3000} />
          <p className="small muted" style={{ margin: 0 }}>
            برای PDF، در پنجره‌ی چاپ مرورگر مقصد را «Save as PDF» بگذارید؛ متن گزارش در PDF قابل انتخاب و جست‌وجو می‌ماند. بخش‌هایی که داده ندارند یا نقش شما به آن‌ها دسترسی ندارد چاپ نمی‌شوند.
          </p>
        </div>
      </div>

      <article className="report" data-testid="report" aria-label={`گزارش وضعیت ${b.project.name}`}>
        <header className="rep-head">
          <div>
            <h1>گزارش وضعیت پروژه</h1>
            <h2>{b.project.name}</h2>
          </div>
          <Badge kind={h.kind}>{h.label}</Badge>
        </header>
        <dl className="facts rep-facts">
          <div>
            <dt>تاریخ وضعیت</dt>
            <dd>
              <span className="num">{faDate(sum.status)}</span>
            </dd>
          </div>
          <div>
            <dt>شروع پروژه</dt>
            <dd>
              <span className="num">{faDate(sum.start)}</span>
            </dd>
          </div>
          <div>
            <dt>پایان قرارداد</dt>
            <dd>
              <span className="num">{faDate(sum.contractEnd)}</span>
            </dd>
          </div>
          {b.charter?.client ? (
            <div>
              <dt>کارفرما</dt>
              <dd>{b.charter.client}</dd>
            </div>
          ) : null}
          {b.charter?.projectManager ? (
            <div>
              <dt>مدیر پروژه</dt>
              <dd>{b.charter.projectManager}</dd>
            </div>
          ) : null}
          {can('contract.view') && c?.number ? (
            <div>
              <dt>شماره قرارداد</dt>
              <dd>
                <span className="num">{c.number}</span>
              </dd>
            </div>
          ) : null}
        </dl>

        <section>
          <h3>وضعیت کلی</h3>
          <div className="grid cols-4 rep-kpis">
            <Kpi label="پیشرفت واقعی" value={faPct(sum.actual)} tone={gap < -10 ? 'bad' : gap < -3 ? 'warn' : 'ok'} sub={<ProgressBar actual={sum.actual} planned={sum.planned} />} />
            <Kpi label="پیشرفت برنامه‌ای" value={faPct(sum.planned)} sub={`انحراف: ${faNum(gap, 1)} واحد درصد`} />
            <Kpi label="پایان پیش‌بینی" value={<span className="num">{faDate(sum.forecastFinish)}</span>} tone={sum.delayWorkingDays > 0 ? 'bad' : 'ok'} sub={sum.baselineFinish ? `پایان خط مبنا: ${faDate(sum.baselineFinish)}` : 'خط مبنا ثبت نشده'} />
            <Kpi label="تأخیر نسبت به خط مبنا" value={`${faInt(Math.max(0, sum.delayWorkingDays))} روز کاری`} tone={sum.delayWorkingDays > 0 ? 'bad' : 'ok'} sub={dash && sum.contractEnd ? `${(dash.reserveWorkingDays ?? 0) >= 0 ? 'ذخیره تا پایان قرارداد' : 'کسری نسبت به پایان قرارداد'}: ${faInt(Math.abs(dash.reserveWorkingDays ?? 0))} روز کاری` : undefined} />
          </div>
          <div style={{ marginTop: 10 }}>
            <StageRibbon stages={sum.stages} />
          </div>
          <p className="small muted">
            {faInt(sum.counts.total)} فعالیت: {faInt(sum.counts.done)} تمام‌شده، {faInt(sum.counts.inProgress)} در حال انجام، {faInt(sum.counts.notStarted)} شروع‌نشده.
            {dash ? ` ${faInt(dash.criticalCount)} فعالیت بحرانی.` : ''}
          </p>
        </section>

        {notes.trim() ? (
          <section data-testid="rep-notes">
            <h3>یادداشت مدیر پروژه</h3>
            <p style={{ whiteSpace: 'pre-wrap', margin: 0 }}>{notes}</p>
          </section>
        ) : null}

        {dash && dash.alerts.some((x) => x.severity !== 'info') ? (
          <section>
            <h3>هشدارها</h3>
            <ul className="rep-list">
              {dash.alerts
                .filter((x) => x.severity !== 'info')
                .map((x) => (
                  <li key={x.code + x.message}>{x.message}</li>
                ))}
            </ul>
          </section>
        ) : null}

        {showFin && a ? (
          <section data-testid="rep-finance">
            <h3>وضعیت مالی (ارزش کسب‌شده)</h3>
            <table className="tbl rep-tbl">
              <tbody>
                <tr>
                  <th>بودجه‌ی خط مبنا (BAC)</th>
                  <td className="n"><span className="num">{faNum(a.finance.bac)}</span></td>
                  <th>ارزش برنامه‌ای (PV)</th>
                  <td className="n"><span className="num">{faNum(a.finance.pv)}</span></td>
                </tr>
                <tr>
                  <th>ارزش کسب‌شده (EV)</th>
                  <td className="n"><span className="num">{faNum(a.finance.ev)}</span></td>
                  <th>هزینه‌ی واقعی (AC)</th>
                  <td className="n"><span className="num">{faNum(a.finance.ac)}</span></td>
                </tr>
                <tr>
                  <th>پیش‌بینی نهایی (EAC)</th>
                  <td className="n"><span className="num">{faNum(a.finance.eac)}</span></td>
                  <th>انحراف در پایان (VAC)</th>
                  <td className="n"><span className="num">{faNum(a.finance.vac)}</span></td>
                </tr>
                <tr>
                  <th>انحراف هزینه (CV)</th>
                  <td className="n"><span className="num">{faNum(a.finance.cv)}</span></td>
                  <th>انحراف زمان (SV)</th>
                  <td className="n"><span className="num">{faNum(a.finance.sv)}</span></td>
                </tr>
                <tr>
                  <th>شاخص هزینه (CPI)</th>
                  <td className="n"><span className="num">{faRatio(a.finance.cpi)}</span></td>
                  <th>شاخص زمان (SPI)</th>
                  <td className="n"><span className="num">{faRatio(a.finance.spi)}</span></td>
                </tr>
              </tbody>
            </table>
            <p className="small muted">واحد پول: {unit}. سربار ثبت‌شده: {faNum(a.finance.overhead)}.</p>
          </section>
        ) : null}

        {showContract && c ? (
          <section data-testid="rep-contract">
            <h3>قرارداد و وصول</h3>
            <table className="tbl rep-tbl">
              <tbody>
                <tr>
                  <th>مبلغ قرارداد</th>
                  <td className="n"><span className="num">{faMoney(c.amount, unit)}</span></td>
                  <th>فاکتورشده</th>
                  <td className="n"><span className="num">{faMoney(c.invoicedTotal, unit)}</span></td>
                </tr>
                <tr>
                  <th>وصول‌شده</th>
                  <td className="n"><span className="num">{faMoney(c.collectedTotal, unit)}</span></td>
                  <th>مانده‌ی وصول از قرارداد</th>
                  <td className="n"><span className="num">{faMoney(Math.max(0, c.amount - c.collectedTotal), unit)}</span></td>
                </tr>
                {can('commission.view') && b.commission ? (
                  <tr>
                    <th>پورسانت قابل پرداخت (بر مبنای وصول)</th>
                    <td className="n"><span className="num">{faMoney(b.commission.payable, unit)}</span></td>
                    <th>پورسانت معوق</th>
                    <td className="n"><span className="num">{faMoney(b.commission.pending, unit)}</span></td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </section>
        ) : null}

        {inc.scurve && a ? (
          <section data-testid="rep-scurve" className="rep-keep">
            <h3>منحنی S (برنامه‌ای، واقعی و پیش‌بینی)</h3>
            <ScurveChart curve={a.scurve} axis={a.schedule.axis} />
          </section>
        ) : null}

        {dash && dash.upcomingMilestones.length > 0 ? (
          <section data-testid="rep-milestones">
            <h3>مایلستون‌های پیش‌رو</h3>
            <table className="tbl rep-tbl">
              <thead>
                <tr><th>WBS</th><th>مایلستون</th><th>تاریخ پیش‌بینی</th></tr>
              </thead>
              <tbody>
                {dash.upcomingMilestones.map((m) => (
                  <tr key={m.id}><td className="num">{m.wbs}</td><td>{m.name}</td><td><span className="num">{faDate(m.date)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {dash && dash.delayedTasks.length > 0 ? (
          <section data-testid="rep-delayed">
            <h3>فعالیت‌های دارای بیشترین تأخیر</h3>
            <table className="tbl rep-tbl">
              <thead>
                <tr><th>WBS</th><th>فعالیت</th><th className="n">پیشرفت</th><th>پایان مبنا</th><th>پایان پیش‌بینی</th><th className="n">تأخیر (روز کاری)</th></tr>
              </thead>
              <tbody>
                {dash.delayedTasks.slice(0, 10).map((d) => (
                  <tr key={d.id}>
                    <td className="num">{d.wbs}</td>
                    <td>{d.name}</td>
                    <td className="n">{faPct(d.percent, 0)}</td>
                    <td><span className="num">{faDate(d.baselineFinish)}</span></td>
                    <td><span className="num">{faDate(d.forecastFinish)}</span></td>
                    <td className="n"><strong>{faInt(d.delayDays)}</strong></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {showRisks && hasAnyRisk ? (
          <section data-testid="rep-risks" className="rep-keep">
            <h3>ماتریس و ریسک‌های مهم</h3>
            <RiskMatrix risks={risksAll} />
            {lists.topRisks.length > 0 ? (
              <table className="tbl rep-tbl" style={{ marginTop: 10 }}>
                <thead>
                  <tr><th>ریسک</th><th>مسئول</th><th>سررسید</th><th className="n">امتیاز</th><th>سطح</th></tr>
                </thead>
                <tbody>
                  {lists.topRisks.map((r) => {
                    const lv = riskLevel(riskScore(r));
                    return (
                      <tr key={r.id}>
                        <td>{r.title}</td>
                        <td>{r.owner || '—'}</td>
                        <td><span className="num">{faDate(r.due)}</span></td>
                        <td className="n">{faInt(riskScore(r))}</td>
                        <td><Badge kind={lv === 'critical' ? 'bad' : lv === 'high' ? 'warn' : ''}>{RISK_LEVEL_LABELS[lv]}</Badge></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            ) : null}
          </section>
        ) : null}

        {showItems && lists.openIssues.length > 0 ? (
          <section data-testid="rep-issues">
            <h3>مسائل باز</h3>
            <table className="tbl rep-tbl">
              <thead>
                <tr><th>مسئله</th><th>مسئول</th><th>اولویت</th><th>سررسید</th><th>وضعیت</th></tr>
              </thead>
              <tbody>
                {lists.openIssues.map((i) => (
                  <tr key={i.id}>
                    <td>{i.title}{i.needsDecision ? <> <Badge kind="warn">نیازمند تصمیم</Badge></> : null}</td>
                    <td>{i.owner || '—'}</td>
                    <td>{ISSUE_PRIORITY_LABELS[i.priority]}</td>
                    <td>
                      <span className="num">{faDate(i.due)}</span> {isOverdue(i.due, sum.status) ? <Badge kind="bad">سررسیدگذشته</Badge> : null}
                    </td>
                    <td>{ISSUE_STATUS_LABELS[i.status]}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {showItems && lists.pendingDecisions.length > 0 ? (
          <section data-testid="rep-decisions">
            <h3>تصمیم‌های لازم</h3>
            <table className="tbl rep-tbl">
              <thead>
                <tr><th>موضوع</th><th>تصمیم‌گیرنده</th><th>تاریخ</th></tr>
              </thead>
              <tbody>
                {lists.pendingDecisions.map((d) => (
                  <tr key={d.id}><td>{d.topic}</td><td>{d.maker || '—'}</td><td><span className="num">{faDate(d.date)}</span></td></tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        {showItems && lists.pendingChanges.length > 0 ? (
          <section data-testid="rep-changes">
            <h3>درخواست‌های تغییر در انتظار</h3>
            <table className="tbl rep-tbl">
              <thead>
                <tr><th>درخواست</th><th>درخواست‌کننده</th><th>تاریخ</th><th>پایان فعلی</th><th>پایان پیشنهادی</th></tr>
              </thead>
              <tbody>
                {lists.pendingChanges.map((x) => (
                  <tr key={x.id}>
                    <td>{x.title}</td>
                    <td>{x.requester || '—'}</td>
                    <td><span className="num">{faDate(x.date)}</span></td>
                    <td><span className="num">{faDate(x.previousFinish)}</span></td>
                    <td><span className="num">{faDate(x.newFinish)}</span></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        ) : null}

        <footer className="rep-foot">
          تهیه‌شده در {faDateTime(printedAt)} توسط {me?.displayName ?? '—'} — بیستون، گزارش وضعیت بر پایه‌ی داده‌ی تاریخ وضعیت {faDate(sum.status)}.
        </footer>
      </article>

      {a === null && !ps.scheduleFailure ? (
        <Card>
          <Empty title="گزارش کامل در دسترس نیست">نقش شما فقط خلاصه‌ی وضعیت را می‌بیند؛ بخش‌های برنامه‌ی زمانی در گزارش نمی‌آید.</Empty>
        </Card>
      ) : null}
      {ps.scheduleFailure ? <Alert kind="bad">وابستگی‌ها دور (حلقه) دارند و برنامه محاسبه نمی‌شود؛ بخش‌های زمان‌بندی گزارش تا اصلاح برنامه خالی است.</Alert> : null}
    </>
  );
}
