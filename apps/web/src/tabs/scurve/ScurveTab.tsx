import { useMemo } from 'react';
import { buildSnapshotRows, explainDrop, snapshotTaskProgress, summarizeBaseline } from '@bistoon/core';
import type { SnapshotRow } from '@bistoon/core';
import { apiDelete, apiPost } from '../../api/client.ts';
import { faDate, faInt, faMoney, faPct, faSignedPct } from '../../lib/fmt.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { Alert, Badge, Btn, Card, Empty, Kpi, PageHead, useAction } from '../../ui/controls.tsx';
import { confirmDialog, openDialog, toast } from '../../ui/dialogs.tsx';
import { openBaselineDialog } from './BaselineDialog.tsx';
import { ScurveChart } from './ScurveChart.tsx';

const KIND: Record<SnapshotRow['kind'], { label: string; badge: '' | 'ok' | 'accent' | 'brand' }> = {
  recorded: { label: 'ثبت‌شده', badge: 'ok' },
  estimated: { label: 'تخمینی', badge: '' },
  current: { label: 'وضعیت فعلی (هنوز ثبت نشده)', badge: 'accent' },
};

export function ScurveTab() {
  const ps = useProjectState();
  const can = useCan();
  const { busy, run } = useAction();
  const b = ps.bundle!;
  const a = ps.analysis;
  const model = ps.model;
  const manage = can('baseline.manage') && !b.project.archived;

  const rows = useMemo(() => {
    if (!a || !model) return [];
    const { scurve, schedule, progress } = a;
    return buildSnapshotRows({
      snapshots: model.snapshots,
      tasks: model.tasks,
      status: model.status,
      current: { actual: progress.actual, planned: progress.planned, tasks: snapshotTaskProgress(model.tasks, schedule) },
      plannedAt: (s) => scurve.planned[schedule.axis.onOrAfter(s.date) + 1]?.[1] ?? 0,
    });
  }, [a, model]);

  if (!a || !model) {
    return (
      <>
        <PageHead title="منحنی S" />
        {ps.scheduleFailure ? (
          <Alert kind="bad">وابستگی‌ها دور (حلقه) دارند و برنامه محاسبه نمی‌شود؛ منحنی S تا اصلاح برنامه در دسترس نیست.</Alert>
        ) : (
          <Card>
            <Empty title="منحنی S در دسترس نیست">نقش شما به برنامه‌ی زمانی دسترسی ندارد.</Empty>
          </Card>
        )}
      </>
    );
  }

  const { schedule, progress, scurve } = a;
  const axis = schedule.axis;
  const taskName = (id: number): string => model.tasks.find((t) => t.id === id)?.name ?? `فعالیت ${faInt(id)}`;
  const endDate = (idxExclusive: number): string | null => (idxExclusive > 0 ? axis.dateAt(idxExclusive - 1) : null);
  const gap = progress.actual - progress.planned;
  const hasBaseline = Object.keys(model.baseline).length > 0;
  const baseSum = summarizeBaseline(model.tasks, schedule, model.baseline, model.resources);
  const unit = b.project.finance.unit;
  const late = model.tasks.filter((t) => t.kind !== 'summary' && hasBaseline && !model.baseline[t.id]);
  const estimatedCount = model.snapshots.filter((s) => s.estimated).length;
  const recordedToday = model.snapshots.some((s) => s.date === model.status && !s.estimated);
  const pid = b.project.id;
  const stale = rows.find((r) => r.staleAgainstLive);

  const explain = (row: SnapshotRow): void => {
    const prev = rows.find((r) => r.date === row.dropFrom);
    if (!prev) return;
    const e = explainDrop(prev, row, model.tasks);
    void openDialog(
      'چرا پیشرفت کمتر شده است؟',
      (close) => (
        <>
          <div className="body stack" data-testid="drop-explain">
            <p style={{ margin: 0 }}>
              گزارش <strong className="num">{faDate(row.date)}</strong> نسبت به گزارش <strong className="num">{faDate(prev.date)}</strong> پیشرفت کمتری دارد: {faPct(prev.actual)} ← {faPct(row.actual)}.
            </p>
            {!e.available ? (
              <Alert kind="info">{e.message}</Alert>
            ) : e.items.length === 0 ? (
              <Alert kind="info">هیچ فعالیتی پیشرفت کمتر ندارد؛ تفاوت فقط از تغییر وزن‌ها یا حذف فعالیت‌هاست (هر دو گزارش با وزن‌های فعلی محاسبه می‌شوند).</Alert>
            ) : (
              <>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>فعالیت</th>
                        <th className="n">پیشرفت قبلی</th>
                        <th className="n">پیشرفت جدید</th>
                        <th className="n">سهم در افت</th>
                      </tr>
                    </thead>
                    <tbody>
                      {e.items.map((i) => (
                        <tr key={i.taskId}>
                          <td>{i.name}</td>
                          <td className="n">{faPct(i.from)}</td>
                          <td className="n">{faPct(i.to)}</td>
                          <td className="n">{faSignedPct(-i.impact)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="small muted" style={{ margin: 0 }}>این فعالیت‌ها در گزارش جدید پیشرفت کمتری دارند (کاهش دستی درصد، یا گزارش قبلیِ تخمینی).</p>
              </>
            )}
          </div>
          <footer>
            <Btn kind="primary" onClick={() => close()}>
              بستن
            </Btn>
          </footer>
        </>
      ),
      { wide: true },
    );
  };

  const record = async (): Promise<void> => {
    if (recordedToday) {
      const ok = await confirmDialog({
        title: 'جایگزینی گزارش این تاریخ',
        message: `برای تاریخ وضعیت (${faDate(model.status)}) قبلاً گزارش ثبت شده است. با مقادیر فعلی جایگزین شود؟`,
        confirmLabel: 'جایگزین شود',
      });
      if (!ok) return;
    }
    await run(async () => {
      await apiPost(`/projects/${pid}/snapshots`);
      await reloadProject();
    }, 'گزارش پیشرفت ثبت شد.');
  };

  const estimate = async (): Promise<void> => {
    if (estimatedCount > 0) {
      const ok = await confirmDialog({
        title: 'بازسازی گزارش‌های تخمینی',
        message: `${faInt(estimatedCount)} گزارش تخمینی فعلی با بازسازی تازه جایگزین می‌شود. گزارش‌های ثبت‌شده دست‌نخورده می‌مانند.`,
        confirmLabel: 'بازسازی شود',
      });
      if (!ok) return;
    }
    const r = await run(async () => {
      const res = await apiPost<{ snapshots: { estimated: boolean }[] }>(`/projects/${pid}/snapshots/estimate`);
      await reloadProject();
      return res.snapshots.filter((s) => s.estimated).length;
    });
    if (r === undefined) return;
    if (r === 0) toast.info('فعالیتی با تاریخ واقعیِ شروع یا پایان نیست؛ گزارش تخمینی ساخته نشد.');
    else toast.ok(`${faInt(r)} گزارش تخمینی از تاریخ‌های واقعی ساخته شد.`);
  };

  const remove = async (row: SnapshotRow): Promise<void> => {
    const ok = await confirmDialog({
      title: 'حذف گزارش پیشرفت',
      message: `گزارش ${faDate(row.date)} (${KIND[row.kind].label}) حذف شود؟ این کار برگشت‌پذیر نیست.`,
      confirmLabel: 'حذف شود',
      danger: true,
    });
    if (!ok) return;
    await run(async () => {
      await apiDelete(`/projects/${pid}/snapshots/${row.date}`);
      await reloadProject();
    }, 'گزارش حذف شد.');
  };

  return (
    <>
      <PageHead title="منحنی S">
        {manage ? (
          <>
            <Btn icon="plus" kind="primary" busy={busy} onClick={record} testId="sc-record">
              ثبت گزارش پیشرفت امروز
            </Btn>
            <Btn icon="refresh" busy={busy} onClick={estimate} testId="sc-estimate">
              بازسازی تخمینی
            </Btn>
          </>
        ) : null}
      </PageHead>
      <div className="stack gap-l">
        {!hasBaseline ? <Alert kind="info">خط مبنا ثبت نشده است؛ منحنی برنامه‌ایِ زیر از برنامه‌ی فعلی ساخته شده و با تغییر برنامه تغییر می‌کند. برای سنجش واقعی انحراف، خط مبنا را ثبت کنید.</Alert> : null}
        {stale ? <Alert kind="warn">پیشرفت پروژه بعد از ثبتِ گزارش {faDate(stale.date)} تغییر کرده است؛ برای به‌روز شدن منحنی دوباره ثبت کنید.</Alert> : null}

        <Card>
          <div className="grid cols-4" data-testid="sc-kpis">
            <Kpi label="پیشرفت واقعی" value={faPct(progress.actual)} tone={gap < -10 ? 'bad' : gap < -3 ? 'warn' : 'ok'} sub={`تا ${faDate(model.status)}`} />
            <Kpi label="پیشرفت برنامه‌ای" value={faPct(progress.planned)} sub={hasBaseline ? 'نسبت به خط مبنا' : 'نسبت به برنامه‌ی فعلی'} />
            <Kpi label="انحراف" value={faSignedPct(gap)} tone={gap < -10 ? 'bad' : gap < -3 ? 'warn' : 'ok'} sub="واقعی − برنامه‌ای (واحد درصد)" />
            <Kpi
              label="پایان پیش‌بینی"
              value={<span className="num">{faDate(endDate(progress.forecastFinish))}</span>}
              tone={progress.delay > 0 ? 'bad' : 'ok'}
              sub={hasBaseline ? `پایان خط مبنا: ${faDate(endDate(progress.baselineFinish))} — ${progress.delay > 0 ? `${faInt(progress.delay)} روز کاری تأخیر` : 'بدون تأخیر'}` : 'خط مبنا ثبت نشده'}
            />
          </div>
        </Card>

        <Card title="نمودار پیشرفت تجمعی">
          <ScurveChart curve={scurve} axis={axis} />
        </Card>

        <Card title="گزارش‌های پیشرفت">
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl" data-testid="sc-table">
              <thead>
                <tr>
                  <th>تاریخ گزارش</th>
                  <th className="n">پیشرفت واقعی</th>
                  <th className="n">پیشرفت برنامه‌ای</th>
                  <th className="n">انحراف</th>
                  <th>نوع</th>
                  {manage ? <th /> : null}
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={`${r.date}-${r.kind}`} data-testid={`sc-row-${r.date}`}>
                    <td>
                      <span className="num">{faDate(r.date)}</span>
                    </td>
                    <td className="n">{faPct(r.actual)}</td>
                    <td className="n">{faPct(r.planned)}</td>
                    <td className="n" style={r.deviation < -0.05 ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                      {faSignedPct(r.deviation)}
                    </td>
                    <td>
                      <span className="row wrap">
                        <Badge kind={KIND[r.kind].badge}>{KIND[r.kind].label}</Badge>
                        {r.dropFrom ? (
                          <>
                            <Badge kind="bad">کمتر از گزارش قبلی</Badge>
                            <Btn size="sm" onClick={() => explain(r)} testId={`sc-why-${r.date}`}>
                              علت؟
                            </Btn>
                          </>
                        ) : null}
                        {r.staleAgainstLive ? <Badge kind="warn">پس از ثبت تغییر کرده</Badge> : null}
                      </span>
                    </td>
                    {manage ? (
                      <td className="c">
                        {r.kind !== 'current' ? <Btn size="sm" kind="danger" icon="trash" iconOnly label={`حذف گزارش ${faDate(r.date)}`} onClick={() => remove(r)} testId={`sc-del-${r.date}`} /> : null}
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ marginBottom: 0 }}>
            «ثبت‌شده» عکس لحظه‌ای از پیشرفت همان روز است. «تخمینی» از تاریخ‌های واقعی شروع/پایان فعالیت‌ها بازسازی می‌شود و دقت گزارش ثبت‌شده را ندارد. درصدها همه با وزن‌های فعلی فعالیت‌ها محاسبه می‌شوند.
          </p>
        </Card>

        <Card
          title="خط مبنا"
          actions={
            manage ? (
              <Btn icon="edit" onClick={() => openBaselineDialog(taskName)} testId="sc-baseline">
                {hasBaseline ? 'تعریف خط مبنای جدید' : 'ثبت خط مبنا'}
              </Btn>
            ) : null
          }
        >
          {!hasBaseline ? (
            <Empty title="خط مبنا ثبت نشده است">بعد از نهایی شدن برنامه، خط مبنا را ثبت کنید تا پیشرفت برنامه‌ای، تأخیر و بودجه‌ی مبنا نسبت به آن سنجیده شود.</Empty>
          ) : (
            <div className="stack">
              <dl className="facts" data-testid="sc-baseline-facts">
                <div>
                  <dt>عنوان</dt>
                  <dd>{b.baseline?.label || 'بدون عنوان'}</dd>
                </div>
                <div>
                  <dt>ثبت‌شده در تاریخ وضعیت</dt>
                  <dd>
                    <span className="num">{faDate(b.baseline?.statusDate)}</span>
                  </dd>
                </div>
                <div>
                  <dt>فعالیت‌های دارای مبنا</dt>
                  <dd>{faInt(baseSum.tasks)}</dd>
                </div>
                <div>
                  <dt>پایان برنامه‌ای</dt>
                  <dd>
                    <span className="num">{faDate(baseSum.finish)}</span>
                  </dd>
                </div>
                <div>
                  <dt>بودجه‌ی مبنا (BAC)</dt>
                  <dd>{faMoney(baseSum.bac, unit)}</dd>
                </div>
              </dl>
              {late.length > 0 ? (
                <Alert kind="warn">
                  {faInt(late.length)} فعالیت بعد از ثبت خط مبنا افزوده شده و مبنا ندارد (در سنجش برنامه‌ای با برنامه‌ی فعلی خودشان مقایسه می‌شوند): {late.slice(0, 5).map((t) => t.name).join('، ')}
                  {late.length > 5 ? ` و ${faInt(late.length - 5)} مورد دیگر` : ''}. برای شمول آن‌ها خط مبنای جدید تعریف کنید.
                </Alert>
              ) : null}
            </div>
          )}
          {model.baselineHistory.length > 0 ? (
            <div style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 14, margin: '0 0 8px' }}>خط مبناهای بایگانی‌شده</h3>
              <div className="tbl-wrap">
                <table className="tbl" data-testid="sc-history">
                  <thead>
                    <tr>
                      <th>عنوان</th>
                      <th>ثبت در تاریخ وضعیت</th>
                      <th>بایگانی در</th>
                      <th className="n">فعالیت‌ها</th>
                      <th className="n">پایان برنامه‌ای</th>
                      <th className="n">بودجه‌ی مبنا</th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...(b.baselineHistory ?? [])].reverse().map((h) => {
                      const s = summarizeBaseline(model.tasks, schedule, h.items, model.resources);
                      return (
                        <tr key={h.id}>
                          <td>{h.label || `خط مبنای ${faInt(h.id)}`}</td>
                          <td>
                            <span className="num">{faDate(h.statusDate)}</span>
                          </td>
                          <td>
                            <span className="num">{faDate(h.archivedOn)}</span>
                          </td>
                          <td className="n">{faInt(s.tasks)}</td>
                          <td className="n">
                            <span className="num">{faDate(s.finish)}</span>
                          </td>
                          <td className="n">{faMoney(s.bac, unit)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            </div>
          ) : null}
        </Card>
      </div>
    </>
  );
}
