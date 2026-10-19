import { useMemo } from 'react';
import { RISK_LEVEL_LABELS, computeDashboard, riskLevel, riskScore } from '@bistoon/core';
import { faDate, faInt, faMoney, faNum, faPct, faRatio } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { hrefOf } from '../../state/route.ts';
import { Alert, Badge, Card, Empty, Kpi, PageHead, ProgressBar } from '../../ui/controls.tsx';
import { HEALTH } from '../../ui/health.ts';
import { StageRibbon } from '../../ui/StageRibbon.tsx';

export function DashboardTab() {
  const ps = useProjectState();
  const can = useCan();
  const bundle = ps.bundle!;
  const pid = bundle.project.id;
  const sum = bundle.summary;
  const unit = bundle.project.finance.unit;
  const dash = useMemo(() => (ps.model && ps.analysis ? computeDashboard(ps.model, ps.analysis) : null), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const a = ps.analysis;
  const h = HEALTH[sum.health];
  const showFin = can('costs.view') && a !== null;
  const gap = sum.actual - sum.planned;
  const c = bundle.contract;
  const link = (tab: 'tasks' | 'res' | 'ri' | 'chg' | 'dec' | 'fin' | 'chr' | 'scurve'): string => hrefOf({ pid, tab });

  return (
    <>
      <PageHead title="داشبورد">
        <Badge kind={h.kind}>{h.label}</Badge>
        {ps.analysis === null && !ps.scheduleFailure ? <span className="muted small">نقش شما فقط خلاصه‌ی وضعیت را می‌بیند.</span> : null}
      </PageHead>

      {sum.scheduleError ? <Alert kind="bad">برنامه محاسبه نشد: {sum.scheduleError} <a href={link('tasks')}>رفتن به فعالیت‌ها</a></Alert> : null}
      {ps.scheduleFailure ? <Alert kind="bad">وابستگی‌ها دور (حلقه) دارند و برنامه محاسبه نمی‌شود. <a href={link('tasks')}>اصلاح در فعالیت‌ها</a></Alert> : null}

      <div className="stack gap-l">
        <Card title="وضعیت و مراحل پروژه">
          <div className="grid cols-4">
            <Kpi label="پیشرفت واقعی" value={faPct(sum.actual)} tone={gap < -10 ? 'bad' : gap < -3 ? 'warn' : 'ok'} sub={<ProgressBar actual={sum.actual} planned={sum.planned} />} />
            <Kpi label="پیشرفت برنامه‌ای (تا تاریخ وضعیت)" value={faPct(sum.planned)} sub={`انحراف: ${faNum(gap, 1)} واحد درصد`} />
            <Kpi label="پایان پیش‌بینی" value={<span className="num">{faDate(sum.forecastFinish)}</span>} tone={sum.delayWorkingDays > 0 ? 'bad' : 'ok'} sub={sum.baselineFinish ? `پایان خط مبنا: ${faDate(sum.baselineFinish)}` : 'خط مبنا ثبت نشده'} />
            <Kpi label="تأخیر نسبت به خط مبنا" value={`${faInt(Math.max(0, sum.delayWorkingDays))} روز کاری`} tone={sum.delayWorkingDays > 0 ? 'bad' : 'ok'} sub={dash ? `${faInt(Math.max(0, dash.delayCalendarDays))} روز تقویمی` : undefined} />
          </div>
          <div style={{ marginTop: 14 }}>
            <StageRibbon stages={sum.stages} />
          </div>
          <p className="small muted" style={{ marginTop: 10 }}>
            {faInt(sum.counts.total)} فعالیت: {faInt(sum.counts.done)} تمام‌شده، {faInt(sum.counts.inProgress)} در حال انجام، {faInt(sum.counts.notStarted)} شروع‌نشده.
          </p>
        </Card>

        {dash && a ? (
          <>
            <div className="grid cols-4">
              <Card><Kpi label="فعالیت‌های بحرانی" value={faInt(dash.criticalCount)} sub={<a href={link('tasks')}>مشاهده</a>} /></Card>
              <Card><Kpi label="فعالیت‌های ناتمام دارای تأخیر" value={`${faInt(dash.delayedTasks.length)} از ${faInt(dash.unfinishedCount)}`} tone={dash.delayedTasks.length ? 'bad' : 'ok'} sub={`حداکثر تأخیر یک فعالیت: ${faInt(dash.maxTaskDelay)} روز`} /></Card>
              <Card><Kpi label="منابع بیش‌تخصیص (هفته)" value={faInt(dash.overbooked.length)} tone={dash.overbooked.length ? 'bad' : 'ok'} sub={<a href={link('res')}>بار منابع</a>} /></Card>
              <Card><Kpi label="پیشرفت خارج از توالی" value={faInt(dash.outOfSequence.length)} tone={dash.outOfSequence.length ? 'warn' : 'ok'} /></Card>
              {sum.contractEnd ? (
                <Card><Kpi label={(dash.reserveWorkingDays ?? 0) >= 0 ? 'ذخیره تا پایان قرارداد (روز کاری)' : 'کسری نسبت به پایان قرارداد (روز کاری)'} value={faInt(Math.abs(dash.reserveWorkingDays ?? 0))} tone={(dash.reserveWorkingDays ?? 0) < 0 ? 'bad' : 'ok'} sub={`پایان قرارداد: ${faDate(sum.contractEnd)}`} /></Card>
              ) : null}
              {can('risks.view') ? (
                <>
                  <Card><Kpi label="ریسک‌های بحرانی" value={faInt(dash.criticalRisks)} tone={dash.criticalRisks ? 'bad' : 'ok'} sub={<a href={link('ri')}>{faInt(dash.openRisks)} ریسک باز</a>} /></Card>
                  <Card><Kpi label="مسائل باز" value={faInt(dash.openIssues)} sub={<a href={link('ri')}>مشاهده</a>} /></Card>
                  <Card><Kpi label="تصمیم‌های در انتظار" value={faInt(dash.pendingDecisions)} sub={<a href={link('dec')}>مشاهده</a>} /></Card>
                  <Card><Kpi label="درخواست‌های تغییر در انتظار" value={faInt(dash.pendingChanges)} sub={<a href={link('chg')}>مشاهده</a>} /></Card>
                </>
              ) : null}
            </div>

            <Card title="هشدارها">
              {dash.alerts.length === 0 ? <p className="muted">هشداری وجود ندارد.</p> : (
                <div className="stack gap-s">
                  {dash.alerts.map((al) => (
                    <Alert key={al.code + al.message} kind={al.severity}>{al.message}</Alert>
                  ))}
                </div>
              )}
              <p className="small muted" style={{ marginTop: 8 }}>تأخیر پروژه = پایان پیش‌بینی (از وابستگی‌ها، تقویم، تاریخ‌های واقعی و مدت باقی‌مانده) منهای پایان خط مبنا؛ فقط پایان کل پروژه را می‌سنجد.</p>
            </Card>

            <div className="grid cols-2">
              <Card title="فعالیت‌های دارای بیشترین تأخیر">
                {dash.delayedTasks.length === 0 ? (
                  <Empty title="فعالیت دیرکرددار نداریم">{dash.hasBaseline ? 'همه‌ی فعالیت‌های ناتمام طبق خط مبنا پیش می‌روند.' : 'پس از ثبت خط مبنا، تأخیرها اینجا دیده می‌شوند.'}</Empty>
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead>
                        <tr><th>WBS</th><th>فعالیت</th><th className="n">پیشرفت</th><th>پایان مبنا</th><th>پایان پیش‌بینی</th><th className="n">تأخیر (روز کاری)</th></tr>
                      </thead>
                      <tbody>
                        {dash.delayedTasks.slice(0, 8).map((d) => (
                          <tr key={d.id}>
                            <td className="num">{d.wbs}</td>
                            <td>{d.name}</td>
                            <td className="n">{faPct(d.percent, 0)}</td>
                            <td className="num">{faDate(d.baselineFinish)}</td>
                            <td className="num">{faDate(d.forecastFinish)}</td>
                            <td className="n" style={{ color: 'var(--bad)', fontWeight: 700 }}>{faInt(d.delayDays)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
              <Card title="مایلستون‌های پیش‌رو">
                {dash.upcomingMilestones.length === 0 ? (
                  <Empty title="مایلستون باقی‌مانده‌ای نیست" />
                ) : (
                  <div className="tbl-wrap">
                    <table className="tbl">
                      <thead><tr><th>WBS</th><th>مایلستون</th><th>تاریخ پیش‌بینی</th></tr></thead>
                      <tbody>
                        {dash.upcomingMilestones.map((m) => (
                          <tr key={m.id}><td className="num">{m.wbs}</td><td>{m.name}</td><td className="num">{faDate(m.date)}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </Card>
            </div>

            {dash.overbooked.length > 0 ? (
              <Card title="اضافه‌تخصیص منابع" actions={<a href={link('res')}>بار منابع</a>}>
                <ul style={{ margin: 0, paddingInlineStart: 18 }}>
                  {dash.overbooked.slice(0, 6).map((o) => (
                    <li key={`${o.resourceId}-${o.weekStart}`}>{o.name} در هفته‌ی {faDate(o.weekStart)} با {faPct(o.load, 0)} ظرفیت</li>
                  ))}
                  {dash.overbooked.length > 6 ? <li className="muted">و {faInt(dash.overbooked.length - 6)} مورد دیگر…</li> : null}
                </ul>
              </Card>
            ) : null}

            {can('risks.view') && ps.model && ps.model.risks.some((r) => r.status !== 'closed') ? (
              <Card title="ریسک‌های مهم" actions={<a href={link('ri')}>همه‌ی ریسک‌ها</a>}>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead><tr><th>ریسک</th><th>مسئول</th><th className="n">امتیاز</th><th>سطح</th></tr></thead>
                    <tbody>
                      {[...ps.model.risks].filter((r) => r.status !== 'closed').sort((x, y) => riskScore(y) - riskScore(x)).slice(0, 5).map((r) => {
                        const lv = riskLevel(riskScore(r));
                        return (
                          <tr key={r.id}>
                            <td>{r.title}</td>
                            <td>{r.owner || '—'}</td>
                            <td className="n">{faInt(riskScore(r))}</td>
                            <td><Badge kind={lv === 'critical' ? 'bad' : lv === 'high' ? 'warn' : ''}>{RISK_LEVEL_LABELS[lv]}</Badge></td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </Card>
            ) : null}
          </>
        ) : null}

        {showFin && a ? (
          <Card title="شاخص‌های مالی" actions={<a href={link('fin')}>جزئیات مالی</a>}>
            <div className="grid cols-4">
              <Kpi label="بودجه‌ی خط مبنا (BAC)" value={faNum(a.finance.bac)} sub={unit} />
              <Kpi label="هزینه‌ی واقعی (AC)" value={faNum(a.finance.ac)} sub={`سربار: ${faNum(a.finance.overhead)} ${unit}`} />
              <Kpi label="ارزش کسب‌شده (EV)" value={faNum(a.finance.ev)} sub={`ارزش برنامه‌ای (PV): ${faNum(a.finance.pv)}`} />
              <Kpi label="پیش‌بینی هزینه‌ی نهایی (EAC)" value={faNum(a.finance.eac)} tone={a.finance.eac > a.finance.bac * 1.001 ? 'bad' : 'ok'} sub={`VAC: ${faNum(a.finance.vac)}`} />
              <Kpi label="شاخص عملکرد هزینه (CPI)" value={faRatio(a.finance.cpi)} tone={a.finance.cpi !== null && a.finance.cpi < 1 ? 'bad' : 'ok'} />
              <Kpi label="شاخص عملکرد زمان (SPI)" value={faRatio(a.finance.spi)} tone={a.finance.spi !== null && a.finance.spi < 1 ? 'bad' : 'ok'} />
              <Kpi label="انحراف هزینه (CV)" value={faNum(a.finance.cv)} tone={a.finance.cv < 0 ? 'bad' : 'ok'} />
              <Kpi label="انحراف زمان (SV)" value={faNum(a.finance.sv)} tone={a.finance.sv < 0 ? 'bad' : 'ok'} />
            </div>
          </Card>
        ) : null}

        {can('contract.view') && c ? (
          <Card title="قرارداد و وصول" actions={<a href={link('chr')}>منشور و قرارداد</a>}>
            <div className="grid cols-4">
              <Kpi label="مبلغ قرارداد" value={faMoney(c.amount, unit)} sub={c.number ? `شماره: ${c.number}` : 'شماره قرارداد ثبت نشده'} />
              <Kpi label="فاکتورشده" value={faMoney(c.invoicedTotal, unit)} sub={c.amount ? faPct((c.invoicedTotal / c.amount) * 100, 0) : undefined} />
              <Kpi label="وصول‌شده" value={faMoney(c.collectedTotal, unit)} tone="ok" sub={c.amount ? faPct((c.collectedTotal / c.amount) * 100, 0) : undefined} />
              <Kpi label="مانده‌ی وصول از قرارداد" value={faMoney(Math.max(0, c.amount - c.collectedTotal), unit)} />
              {can('commission.view') && bundle.commission ? (
                <>
                  <Kpi label="پورسانت قابل پرداخت (بر مبنای وصول)" value={faMoney(bundle.commission.payable, unit)} tone="ok" />
                  <Kpi label="پورسانت معوق (هنوز مستحق نشده)" value={faMoney(bundle.commission.pending, unit)} />
                </>
              ) : null}
            </div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
