import { useMemo, useState } from 'react';
import { computeUtilization, countOverbooked, levelResources } from '@bistoon/core';
import type { LevelingResult, Resource, ResourceDto, ResourceType } from '@bistoon/core';
import { apiDelete, apiPatch, apiPost } from '../../api/client.ts';
import { faDate, faInt, faMoney, faNum } from '../../lib/fmt.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { useMembers } from '../../state/members.ts';
import { Alert, Badge, Btn, Card, Empty, Kpi, NumberField, PageHead, SelectField, TextField, useAction } from '../../ui/controls.tsx';
import { alertDialog, confirmDialog, openDialog } from '../../ui/dialogs.tsx';

const TYPE_LABELS: Record<ResourceType, string> = { human: 'انسانی', equipment: 'تجهیزات', financial: 'مالی', other: 'سایر' };
const TYPE_OPTIONS = (Object.keys(TYPE_LABELS) as ResourceType[]).map((v) => ({ value: v, label: TYPE_LABELS[v] }));

interface Draft {
  name: string;
  type: ResourceType;
  capacityPercent: number | null;
  dailyRate: number | null;
  userId: number | null;
}

function ResourceForm({ row, close }: { row: ResourceDto | null; close: () => void }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const unit = ps.bundle!.project.finance.unit;
  const { members } = useMembers(pid);
  const [d, setD] = useState<Draft>({
    name: row?.name ?? '',
    type: row?.type ?? 'human',
    capacityPercent: row?.capacityPercent ?? 100,
    dailyRate: row?.dailyRate ?? 0,
    userId: row?.userId ?? null,
  });
  const { busy, run } = useAction();
  const set = <K extends keyof Draft>(k: K, v: Draft[K]): void => setD((s) => ({ ...s, [k]: v }));
  const nameBad = d.name.trim() === '' ? 'نام لازم است.' : /[,،:]/.test(d.name) ? 'نام نباید «,» «،» یا «:» داشته باشد.' : null;
  const invalid = nameBad !== null || d.capacityPercent === null || d.capacityPercent <= 0 || d.dailyRate === null;
  const body = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!row || d.name.trim() !== row.name) out.name = d.name.trim();
    if (!row || d.type !== row.type) out.type = d.type;
    if (!row || d.capacityPercent !== row.capacityPercent) out.capacityPercent = d.capacityPercent;
    if (!row || d.dailyRate !== row.dailyRate) out.dailyRate = d.dailyRate;
    if (!row || d.userId !== row.userId) out.userId = d.userId;
    return out;
  };
  const changed = Object.keys(body()).length > 0;
  const submit = async (): Promise<void> => {
    const ok = await run(async () => {
      if (row) await apiPatch(`/projects/${pid}/resources/${row.id}`, body());
      else await apiPost(`/projects/${pid}/resources`, body());
      await reloadProject();
      return true;
    }, row ? 'منبع به‌روز شد.' : 'منبع افزوده شد.');
    if (ok) close();
  };
  const userOptions = [{ value: '', label: '— بدون اتصال به کاربر —' }, ...(members ?? []).filter((m) => m.isActive || m.userId === row?.userId).map((m) => ({ value: String(m.userId), label: m.displayName }))];
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!invalid && changed) void submit();
      }}
    >
      <div className="body form-grid">
        <TextField label="نام منبع" required wide value={d.name} maxLength={120} onChange={(v) => set('name', v)} autoFocus testId="res-name" error={nameBad && d.name !== '' ? nameBad : null} />
        <SelectField label="نوع" value={d.type} options={TYPE_OPTIONS} onChange={(v) => set('type', v)} />
        <NumberField label="ظرفیت (درصد)" hint="۱۰۰ = یک واحد کامل؛ ۵۰ = نیم‌وقت" value={d.capacityPercent} min={1} max={100000} onChange={(v) => set('capacityPercent', v)} />
        <NumberField label={`نرخ روزانه‌ی یک واحد (${unit})`} value={d.dailyRate} min={0} onChange={(v) => set('dailyRate', v)} />
        <SelectField label="کاربر مرتبط" hint="کارشناسِ متصل می‌تواند پیشرفت فعالیت‌های همین منبع را ثبت کند." value={d.userId === null ? '' : String(d.userId)} options={userOptions} onChange={(v) => set('userId', v === '' ? null : Number(v))} />
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid || !changed} testId="res-save">
          ذخیره
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

const cellStyle = (pct: number): React.CSSProperties => {
  if (pct > 100.0001) return { background: 'var(--bad-soft)', color: 'var(--bad)', fontWeight: 700 };
  if (pct >= 85) return { background: 'var(--warn-soft)', color: 'var(--warn)' };
  return { background: 'var(--ok-soft)', color: 'var(--ok)' };
};

export function ResourcesTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const pid = b.project.id;
  const archived = b.project.archived;
  const edit = can('schedule.edit') && !archived;
  const resources = b.resources ?? [];
  const tasks = b.tasks ?? [];
  const { busy, run } = useAction();
  const { members } = useMembers(pid);
  const [plan, setPlan] = useState<LevelingResult | null | 'none'>(null);

  const util = useMemo(() => (ps.analysis && ps.model ? computeUtilization(ps.model.tasks, ps.analysis.schedule, resources) : null), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const overbooked = useMemo(() => (ps.analysis && ps.model ? countOverbooked(ps.model.tasks, ps.analysis.schedule, resources) : 0), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const levelingConstraints = tasks.filter((t) => t.startNoEarlierSource === 'leveling').length;
  const usage = useMemo(() => {
    const m = new Map<number, { tasks: number; work: number }>();
    for (const t of tasks) for (const a of t.assignments) {
      const cur = m.get(a.resourceId) ?? { tasks: 0, work: 0 };
      cur.tasks += 1;
      m.set(a.resourceId, cur);
    }
    return m;
  }, [tasks]);

  const openForm = (row: ResourceDto | null): void => {
    void openDialog(row ? `ویرایش منبع «${row.name}»` : 'منبع جدید', (close) => <ResourceForm row={row} close={() => close()} />);
  };
  const remove = async (r: Resource): Promise<void> => {
    const n = usage.get(r.id)?.tasks ?? 0;
    if (n > 0) {
      await alertDialog('حذف ممکن نیست', <>«{r.name}» به {faInt(n)} فعالیت تخصیص دارد. ابتدا تخصیص‌ها را در فعالیت‌ها بردارید.</>);
      return;
    }
    const ok = await confirmDialog({ title: 'حذف منبع', danger: true, confirmLabel: 'حذف', message: <>منبع «{r.name}» حذف شود؟</> });
    if (!ok) return;
    await run(async () => {
      await apiDelete(`/projects/${pid}/resources/${r.id}`);
      await reloadProject();
    }, 'منبع حذف شد.');
  };

  const finishDate = (idx: number): string | null => (ps.analysis && idx > 0 ? ps.analysis.schedule.axis.dateAt(idx - 1) : null);
  const suggest = (): void => {
    if (!ps.model) return;
    const r = levelResources({ start: ps.model.start, status: ps.model.status, calendar: ps.model.calendar, tasks: ps.model.tasks }, resources);
    setPlan(r && r.suggestions.length ? r : 'none');
  };
  const apply = async (): Promise<void> => {
    if (plan === null || plan === 'none') return;
    const ok = await confirmDialog({
      title: 'اعمال تسطیح',
      confirmLabel: 'اعمال پیشنهاد',
      message: (
        <>
          برای {faInt(plan.suggestions.length)} فعالیت قید «شروع نه زودتر از» ثبت می‌شود و برنامه جابه‌جا می‌شود. هر وقت خواستید با «حذف تأخیرهای تسطیح» فقط همین قیدها برداشته می‌شود.
        </>
      ),
    });
    if (!ok) return;
    const done = await run(async () => {
      await apiPost(`/projects/${pid}/leveling/apply`, { moves: plan.suggestions.map((s) => ({ taskId: s.taskId, startNoEarlierThan: s.startNoEarlierThan })) });
      await reloadProject();
      return true;
    }, 'تسطیح اعمال شد.');
    if (done) setPlan(null);
  };
  const clear = async (): Promise<void> => {
    const ok = await confirmDialog({ title: 'حذف تأخیرهای تسطیح', danger: true, confirmLabel: 'حذف', message: <>قیدهای ایجادشده توسط تسطیح ({faInt(levelingConstraints)} مورد) برداشته می‌شود. قیدهای دستی و واردشده از MSP دست‌نخورده می‌مانند.</> });
    if (!ok) return;
    await run(async () => {
      await apiPost(`/projects/${pid}/leveling/clear`, {});
      await reloadProject();
      setPlan(null);
    }, 'تأخیرهای تسطیح حذف شد.');
  };

  return (
    <>
      <PageHead title="منابع و بارگذاری">
        {edit ? (
          <Btn kind="primary" icon="plus" onClick={() => openForm(null)} testId="res-add">
            منبع جدید
          </Btn>
        ) : null}
      </PageHead>

      {ps.scheduleFailure ? <Alert kind="bad">وابستگی‌ها دور دارند؛ بارگذاری و تسطیح تا اصلاح برنامه محاسبه نمی‌شود.</Alert> : null}

      <div className="stack gap-l">
        <Card>
          <div className="grid cols-4">
            <Kpi label="منابع" value={faInt(resources.length)} />
            <Kpi label="روز-منبع بیش‌تخصیص" value={faInt(overbooked)} tone={overbooked > 0 ? 'bad' : 'ok'} sub={overbooked > 0 ? 'بار روزانه از ظرفیت بیشتر است' : 'تداخلی نیست'} />
            <Kpi label="قید تسطیح فعال" value={faInt(levelingConstraints)} sub={levelingConstraints ? 'فعالیت‌هایی که تسطیح عقب برده است' : 'برنامه تسطیح نشده'} />
          </div>
        </Card>

        {resources.length === 0 ? (
          <Card>
            <Empty title="هنوز منبعی تعریف نشده است">{edit ? 'با «منبع جدید» افراد و تجهیزات پروژه را اضافه کنید، سپس در «فعالیت‌ها» به فعالیت‌ها تخصیص دهید.' : 'منابع را مدیر پروژه تعریف می‌کند.'}</Empty>
          </Card>
        ) : (
          <div className="tbl-wrap">
            <table className="tbl" data-testid="res-table">
              <thead>
                <tr>
                  <th className="c">کد</th>
                  <th>نام</th>
                  <th>نوع</th>
                  <th className="n">ظرفیت</th>
                  <th className="n">نرخ روزانه</th>
                  <th className="n">فعالیت‌ها</th>
                  <th>کاربر مرتبط</th>
                  {edit ? <th className="no-print">عملیات</th> : null}
                </tr>
              </thead>
              <tbody>
                {resources.map((r) => (
                  <ResourceRow key={r.id} r={r} userName={r.userId === null ? null : members?.find((m) => m.userId === r.userId)?.displayName ?? `کاربر ${faInt(r.userId)}`} uses={usage.get(r.id)?.tasks ?? 0} unit={b.project.finance.unit} edit={edit} busy={busy} onEdit={() => openForm(r)} onDelete={() => remove(r)} />
                ))}
              </tbody>
            </table>
          </div>
        )}

        {util && util.weeks.length > 0 ? (
          <Card title="بار هفتگی منابع" actions={<span className="small muted">بیشینه‌ی بار روزانه در هر هفته نسبت به ظرفیت (٪)</span>}>
            <div className="tbl-wrap" style={{ border: 0 }}>
              <table className="tbl" data-testid="res-load">
                <thead>
                  <tr>
                    <th style={{ position: 'sticky', insetInlineStart: 0, background: 'var(--surface)' }}>منبع</th>
                    {util.weeks.map((w) => (
                      <th key={w.week} className="c small" title={`هفته‌ی شروع ${faDate(w.start)}`}>
                        {faDate(w.start).slice(5)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {resources
                    .filter((r) => util.load.has(r.id))
                    .map((r) => (
                      <tr key={r.id}>
                        <th scope="row" style={{ position: 'sticky', insetInlineStart: 0, background: 'var(--surface)', textAlign: 'start' }}>
                          {r.name}
                        </th>
                        {util.weeks.map((w) => {
                          const pct = util.load.get(r.id)?.get(w.week);
                          return (
                            <td key={w.week} className="c num" style={pct === undefined ? undefined : cellStyle(pct)} title={pct === undefined ? undefined : `${r.name}: ${faNum(pct)}٪`}>
                              {pct === undefined ? '' : faNum(pct)}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                </tbody>
              </table>
            </div>
          </Card>
        ) : resources.length > 0 && !ps.scheduleFailure ? (
          <Alert kind="info">هنوز فعالیتی به منبع تخصیص داده نشده است؛ بعد از تخصیص، بار هفتگی اینجا دیده می‌شود.</Alert>
        ) : null}

        {edit && resources.length > 0 ? (
          <Card
            title="تسطیح منابع"
            actions={
              <>
                <Btn onClick={suggest} disabled={busy || !ps.analysis} testId="res-suggest">
                  محاسبه‌ی پیشنهاد
                </Btn>
                {levelingConstraints > 0 ? (
                  <Btn kind="danger" onClick={clear} disabled={busy} testId="res-clear">
                    حذف تأخیرهای تسطیح
                  </Btn>
                ) : null}
              </>
            }
          >
            <p className="small muted">پیشنهاد فقط نمایش داده می‌شود و تا «اعمال» برنامه را تغییر نمی‌دهد. فعالیت‌های شروع‌شده و مایلستون‌ها جابه‌جا نمی‌شوند.</p>
            {plan === 'none' ? <Alert kind="ok">چیزی برای تسطیح نیست: بیش‌تخصیصی وجود ندارد یا با جابه‌جایی فعالیت‌ها قابل حل نیست.</Alert> : null}
            {plan && plan !== 'none' ? (
              <div className="stack" data-testid="res-plan">
                <div className="row">
                  <Badge kind="brand">{faInt(plan.suggestions.length)} فعالیت جابه‌جا می‌شود</Badge>
                  <span className="small">
                    پایان پروژه: {faDate(finishDate(plan.finishBefore))} ← {faDate(finishDate(plan.finishAfter))}
                  </span>
                  {plan.unresolved > 0 ? <Badge kind="warn">{faInt(plan.unresolved)} روز-منبع همچنان بیش‌تخصیص</Badge> : <Badge kind="ok">بیش‌تخصیص باقی نمی‌ماند</Badge>}
                </div>
                <div className="tbl-wrap">
                  <table className="tbl">
                    <thead>
                      <tr>
                        <th>فعالیت</th>
                        <th className="num">شروع فعلی</th>
                        <th className="num">شروع پیشنهادی</th>
                        <th className="n">تأخیر (روز کاری)</th>
                      </tr>
                    </thead>
                    <tbody>
                      {plan.suggestions.map((s) => (
                        <tr key={s.taskId}>
                          <td>{s.name}</td>
                          <td className="num">{faDate(s.from)}</td>
                          <td className="num">{faDate(s.to)}</td>
                          <td className="n">{faInt(s.delayDays)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="row">
                  <Btn kind="primary" onClick={apply} busy={busy} testId="res-apply">
                    اعمال پیشنهاد
                  </Btn>
                  <Btn onClick={() => setPlan(null)}>رد پیشنهاد</Btn>
                </div>
              </div>
            ) : null}
          </Card>
        ) : null}
      </div>
    </>
  );
}

function ResourceRow({ r, userName, uses, unit, edit, busy, onEdit, onDelete }: { r: ResourceDto; userName: string | null; uses: number; unit: string; edit: boolean; busy: boolean; onEdit: () => void; onDelete: () => void }) {
  return (
    <tr data-testid={`res-row-${r.id}`}>
      <td className="c num muted">{r.id}</td>
      <td>
        <strong>{r.name}</strong>
      </td>
      <td>{TYPE_LABELS[r.type]}</td>
      <td className="n">{faNum(r.capacityPercent)}٪</td>
      <td className="n">{faMoney(r.dailyRate, unit)}</td>
      <td className="n">{faInt(uses)}</td>
      <td>{userName ?? '—'}</td>
      {edit ? (
        <td className="no-print nowrap">
          <Btn size="sm" kind="ghost" iconOnly icon="edit" label={`ویرایش ${r.name}`} onClick={onEdit} disabled={busy} />
          <Btn size="sm" kind="ghost" iconOnly icon="trash" label={`حذف ${r.name}`} onClick={onDelete} disabled={busy} />
        </td>
      ) : null}
    </tr>
  );
}
