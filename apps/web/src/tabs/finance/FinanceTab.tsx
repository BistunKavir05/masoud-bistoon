import { useMemo, useState } from 'react';
import { actualCost, baselineCost, forecastTaskCost, plannedCost, wbsMap } from '@bistoon/core';
import type { EacMethod, ProjectDto } from '@bistoon/core';
import { apiPatch } from '../../api/client.ts';
import { faInt, faMoney, faNum, faPct, faRatio } from '../../lib/fmt.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { Alert, Badge, Btn, Card, Empty, Kpi, NumberField, PageHead, SelectField, TabBar, TextField, useAction } from '../../ui/controls.tsx';
import { openDialog } from '../../ui/dialogs.tsx';
import { Ledger } from './Ledger.tsx';

const EAC_LABELS: Record<EacMethod, string> = {
  remaining: 'هزینه‌ی واقعی + باقی‌مانده‌ی بودجه (پیش‌فرض)',
  cpi: 'بودجه ÷ CPI (روند فعلی ادامه می‌یابد)',
  both: 'واقعی + باقی‌مانده ÷ (CPI × SPI)',
};

function SettingsForm({ project, close }: { project: ProjectDto; close: () => void }) {
  const [unit, setUnit] = useState(project.finance.unit);
  const [budget, setBudget] = useState<number | null>(project.finance.budget);
  const [method, setMethod] = useState<EacMethod>(project.finance.eacMethod);
  const { busy, run } = useAction();
  const changed = unit.trim() !== project.finance.unit || budget !== project.finance.budget || method !== project.finance.eacMethod;
  const invalid = unit.trim() === '' || budget === null || budget < 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !changed) return;
        void run(async () => {
          await apiPatch(`/projects/${project.id}`, { version: project.version, finance: { unit: unit.trim(), budget, eacMethod: method } });
          await reloadProject();
          close();
        }, 'تنظیمات مالی ذخیره شد.');
      }}
    >
      <div className="body form-grid">
        <TextField label="واحد پول" hint="فقط یک برچسب است؛ تبدیل ارز انجام نمی‌شود." value={unit} maxLength={24} onChange={setUnit} testId="fin-unit" />
        <NumberField label="بودجه‌ی مصوب پروژه" hint="۰ = تعریف نشده" value={budget} min={0} integer onChange={setBudget} />
        <SelectField label="روش پیش‌بینی هزینه‌ی نهایی (EAC)" wide value={method} options={(Object.keys(EAC_LABELS) as EacMethod[]).map((v) => ({ value: v, label: EAC_LABELS[v] }))} onChange={setMethod} />
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid || !changed} testId="fin-settings-save">
          ذخیره
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

export function FinanceTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const [sub, setSub] = useState<'overview' | 'ledger'>('overview');
  const unit = b.project.finance.unit;
  const m = (n: number): string => faMoney(n, unit);
  const a = ps.analysis;
  const f = a?.finance;
  const model = ps.model;
  const wbs = useMemo(() => (model ? wbsMap(model.tasks) : new Map<number, string>()), [model]);

  const rows = useMemo(() => {
    if (!model || !a) return [];
    return model.tasks
      .filter((t) => t.kind !== 'summary')
      .map((t) => {
        const percent = a.schedule.byId.get(t.id)?.percent ?? 0;
        const base = baselineCost(t, model.baseline, model.resources);
        const act = actualCost(t, model.costs);
        const fc = forecastTaskCost(t, percent, model.baseline, model.resources, model.costs);
        const has = base > 0 || act > 0 || plannedCost(t, model.resources) > 0 || t.costTracked || model.costs.some((c) => c.taskId === t.id);
        return { t, percent, base, act, fc, has };
      })
      .filter((r) => r.has);
  }, [model, a]);
  const sum = rows.reduce((s, r) => ({ base: s.base + r.base, act: s.act + r.act, fc: s.fc + r.fc }), { base: 0, act: 0, fc: 0 });
  const hasBaselineCost = model ? Object.values(model.baseline).some((x) => x.cost !== null) : false;
  const budget = b.project.finance.budget;
  const tone = (v: number | null, warnBelow = 1, badBelow = 0.9): '' | 'ok' | 'warn' | 'bad' => (v === null ? '' : v < badBelow ? 'bad' : v < warnBelow ? 'warn' : 'ok');

  return (
    <>
      <PageHead title="مالی">
        {can('project.settings') && !b.project.archived ? (
          <Btn
            icon="edit"
            onClick={() => void openDialog('تنظیمات مالی', (close) => <SettingsForm project={b.project} close={() => close()} />)}
            testId="fin-settings"
          >
            تنظیمات مالی
          </Btn>
        ) : null}
      </PageHead>
      {ps.scheduleFailure ? <Alert kind="bad">وابستگی‌ها دور دارند؛ شاخص‌های مالی تا اصلاح برنامه محاسبه نمی‌شود. دفتر هزینه در دسترس است.</Alert> : null}
      <TabBar label="بخش مالی" value={sub} onChange={setSub} options={[{ value: 'overview', label: 'شاخص‌ها و فعالیت‌ها' }, { value: 'ledger', label: `دفتر هزینه (${faInt(b.costs?.length ?? 0)})` }]} />

      {sub === 'ledger' ? (
        <Ledger />
      ) : !f ? (
        <Card>
          <Empty title="شاخص‌ها در دسترس نیست">برنامه‌ی زمانی محاسبه نشده است.</Empty>
        </Card>
      ) : (
        <div className="stack gap-l">
          {!hasBaselineCost ? (
            <Alert kind="info" >
              خط مبنای هزینه‌دار ثبت نشده است؛ بودجه‌ی مبنا (BAC) از برآورد فعلی فعالیت‌ها (منابع + هزینه‌ی مستقیم) گرفته می‌شود. بعد از ثبت خط مبنا مقدار ثابت می‌شود.
            </Alert>
          ) : null}
          <Card title="شاخص‌های مالی (ارزش کسب‌شده)">
            <div className="grid cols-4" data-testid="evm">
              <Kpi label="بودجه‌ی مبنا (BAC)" value={faNum(f.bac)} sub={unit} />
              <Kpi label="ارزش برنامه‌ای (PV)" value={faNum(f.pv)} sub="تا تاریخ وضعیت" />
              <Kpi label="ارزش کسب‌شده (EV)" value={faNum(f.ev)} sub={`${faPct(f.bac > 0 ? (f.ev / f.bac) * 100 : 0)} بودجه`} />
              <Kpi label="هزینه‌ی واقعی (AC)" value={faNum(f.ac)} sub={`سربار: ${faNum(f.overhead)} — با سربار: ${faNum(f.totalActualWithOverhead)}`} />
              <Kpi label="شاخص عملکرد هزینه (CPI)" value={faRatio(f.cpi)} tone={tone(f.cpi)} sub="EV ÷ AC؛ زیر ۱ = گران‌تر از برنامه" />
              <Kpi label="شاخص عملکرد زمان (SPI)" value={faRatio(f.spi)} tone={tone(f.spi)} sub="EV ÷ PV؛ زیر ۱ = عقب‌تر از برنامه" />
              <Kpi label="انحراف هزینه (CV)" value={faNum(f.cv)} tone={f.cv < 0 ? 'bad' : 'ok'} sub="EV − AC" />
              <Kpi label="انحراف زمان (SV)" value={faNum(f.sv)} tone={f.sv < 0 ? 'bad' : 'ok'} sub="EV − PV" />
              <Kpi label="پیش‌بینی هزینه‌ی نهایی (EAC)" value={faNum(f.eac)} tone={f.eac > f.bac * 1.001 ? 'bad' : 'ok'} sub={`با سربار: ${faNum(f.forecastWithOverhead)}`} />
              <Kpi label="هزینه‌ی باقی‌مانده (ETC)" value={faNum(f.etc)} sub="EAC − AC" />
              <Kpi label="انحراف در پایان (VAC)" value={faNum(f.vac)} tone={f.vac < 0 ? 'bad' : 'ok'} sub="BAC − EAC" />
              <Kpi label="شاخص لازم برای تکمیل (TCPI)" value={faRatio(f.tcpi)} tone={f.tcpi !== null && f.tcpi > 1.1 ? 'warn' : ''} sub="بالای ۱ = باید کم‌هزینه‌تر پیش رفت" />
            </div>
            <p className="small muted" style={{ marginBottom: 0 }}>
              روش EAC: {EAC_LABELS[f.method]}. واحد: {unit}.
              {budget > 0 ? (
                <>
                  {' '}
                  بودجه‌ی مصوب: <strong>{m(budget)}</strong> — پیش‌بینی با سربار {f.forecastWithOverhead > budget ? <Badge kind="bad">بیش از بودجه‌ی مصوب</Badge> : <Badge kind="ok">در محدوده‌ی بودجه‌ی مصوب</Badge>}
                </>
              ) : null}
            </p>
          </Card>

          <Card title="فعالیت‌های دارای هزینه">
            {rows.length === 0 ? (
              <Empty title="هنوز فعالیتی هزینه ندارد">با تخصیص منبع، ثبت هزینه‌ی مستقیم در فعالیت یا ثبت هزینه‌ی واقعی در «دفتر هزینه» اینجا ظاهر می‌شود.</Empty>
            ) : (
              <div className="tbl-wrap" style={{ border: 0 }}>
                <table className="tbl" data-testid="fin-table">
                  <thead>
                    <tr>
                      <th>فعالیت</th>
                      <th className="n">برآورد (مبنا)</th>
                      <th className="n">واقعی</th>
                      <th className="n">پیشرفت</th>
                      <th className="n">پیش‌بینی نهایی</th>
                      <th className="n">انحراف</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map(({ t, percent, base, act, fc }) => {
                      const d = fc - base;
                      return (
                        <tr key={t.id}>
                          <td>
                            <span className="muted num">{wbs.get(t.id)}</span> {t.name}
                          </td>
                          <td className="n">{faInt(base)}</td>
                          <td className="n">{faInt(act)}</td>
                          <td className="n">{faPct(percent)}</td>
                          <td className="n">{faInt(fc)}</td>
                          <td className="n" style={d > Math.max(1, base * 0.001) ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                            {d > 0 ? '+' : ''}
                            {faInt(d)}
                          </td>
                        </tr>
                      );
                    })}
                    {f.overhead > 0 ? (
                      <tr>
                        <td>هزینه‌ی عمومی / بدون فعالیت</td>
                        <td className="n">—</td>
                        <td className="n">{faInt(f.overhead)}</td>
                        <td />
                        <td className="n">{faInt(f.overhead)}</td>
                        <td />
                      </tr>
                    ) : null}
                    <tr>
                      <th>جمع ({unit})</th>
                      <th className="n">{faInt(sum.base)}</th>
                      <th className="n">{faInt(sum.act + f.overhead)}</th>
                      <th />
                      <th className="n">{faInt(sum.fc + f.overhead)}</th>
                      <th className="n">{faInt(sum.fc - sum.base + f.overhead)}</th>
                    </tr>
                  </tbody>
                </table>
              </div>
            )}
            <p className="small muted">پیش‌بینی هر فعالیت = هزینه‌ی ثبت‌شده + باقی‌مانده‌ی برآورد (برآورد × درصدِ پیشرفت‌نکرده)؛ با ۱۰۰٪ پیشرفت، همان هزینه‌ی واقعی است.</p>
          </Card>
        </div>
      )}
    </>
  );
}
