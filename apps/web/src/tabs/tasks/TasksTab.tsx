import { useMemo, useState } from 'react';
import { ROLE_LABELS } from '@bistoon/core';
import type { TaskDto } from '@bistoon/core';
import { apiDelete, apiPatch, apiPost } from '../../api/client.ts';
import { DASH, faDate, faInt, faNum, faPct } from '../../lib/fmt.ts';
import { patchTaskLocal, projectStore, reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { openMspImportDialog } from '../../dataio/ImportMspDialog.tsx';
import { Alert, Badge, Btn, Empty, PageHead, ProgressBar, SelectField, TextField, useAction } from '../../ui/controls.tsx';
import { EditCell } from '../../ui/EditCell.tsx';
import { confirmDialog, openDialog, toast } from '../../ui/dialogs.tsx';
import { Icon } from '../../ui/icons.tsx';
import { openTaskDialog } from './TaskDialog.tsx';
import { FILTER_LABELS, buildRows, visibleRows } from './rows.ts';
import type { RowFilter, TaskRow } from './rows.ts';
import { formatDependencies } from '@bistoon/core';

const KIND_LABEL: Record<TaskDto['kind'], string> = { task: 'فعالیت', summary: 'گروه', milestone: 'مایلستون' };

export function TasksTab() {
  const ps = useProjectState();
  const can = useCan();
  const bundle = ps.bundle!;
  const pid = bundle.project.id;
  const archived = bundle.project.archived;
  const tasks = bundle.tasks ?? [];
  const resources = bundle.resources ?? [];
  const resName = useMemo(() => new Map(resources.map((r) => [r.id, r.name])), [resources]);
  const rows = useMemo(() => buildRows(tasks, ps.analysis, resources, bundle.baseline?.items ?? null), [ps.rev]); // eslint-disable-line react-hooks/exhaustive-deps
  const [selected, setSelected] = useState<number | null>(null);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<RowFilter>('all');
  const { busy, run } = useAction();

  const canEdit = can('schedule.edit') && !archived;
  const showCost = can('costs.view');
  const own = new Set(bundle.me.ownResourceIds);
  const canProgress = (t: TaskDto): boolean => !archived && t.kind !== 'summary' && (can('schedule.edit') || can('progress.update') || (can('progress.update.own') && t.assignments.some((a) => own.has(a.resourceId))));

  const shown = useMemo(() => visibleRows(rows, collapsed, query, filter), [rows, collapsed, query, filter]);
  const sel = rows.find((r) => r.t.id === selected) ?? null;
  const sv = bundle.project.structureVersion;
  const unit = bundle.project.finance.unit;

  const patchField = async (t: TaskDto, patch: Record<string, unknown>): Promise<boolean> => {
    const r = await run(() => apiPatch<{ task: TaskDto; notes: string[] }>(`/projects/${pid}/tasks/${t.id}`, { version: t.version, patch }));
    if (!r) return false;
    patchTaskLocal(r.task);
    void reloadProject().catch(() => undefined);
    for (const n of r.notes) toast.info(n);
    return true;
  };

  const structural = async (path: string, body: Record<string, unknown> = {}, ok?: string): Promise<{ newId?: number } | undefined> => {
    const r = await run(async () => {
      const out = await apiPost<{ newId?: number }>(`/projects/${pid}/tasks${path}`, { structureVersion: sv, ...body });
      await reloadProject();
      return out;
    }, ok);
    return r;
  };

  const addTask = async (): Promise<void> => {
    const res = await openDialog<{ name: string; kind: TaskDto['kind']; asChild: boolean }>('فعالیت جدید', (close) => <AddTaskForm hasSelection={!!sel} selectedName={sel?.t.name ?? ''} close={close} />);
    if (!res) return;
    // بدون انتخاب: بعد از آخرین فعالیت سطح یک
    const lastRoot = [...tasks].reverse().find((t) => t.level === 1)?.id ?? null;
    const r = await structural('', { referenceId: sel ? sel.t.id : lastRoot, asChild: sel ? res.asChild : false, kind: res.kind, name: res.name }, 'فعالیت اضافه شد.');
    if (r?.newId) setSelected(r.newId);
  };

  const deleteTask = async (): Promise<void> => {
    if (!sel) return;
    const i = tasks.findIndex((t) => t.id === sel.t.id);
    const ids = new Set<number>([sel.t.id]);
    for (let j = i + 1; j < tasks.length && tasks[j]!.level > sel.t.level; j++) ids.add(tasks[j]!.id);
    const costs = (bundle.costs ?? []).filter((c) => c.taskId !== null && ids.has(c.taskId));
    const docs = (bundle.documents ?? []).filter((d) => d.taskId !== null && ids.has(d.taskId));
    const dependents = tasks.filter((t) => !ids.has(t.id) && t.dependencies.some((d) => ids.has(d.predecessorId)));
    const inBaseline = bundle.baseline ? [...ids].filter((id) => bundle.baseline!.items[id] !== undefined).length : 0;
    let moveCosts = false;
    if (costs.length > 0) {
      if (!can('costs.edit')) {
        toast.bad(`این فعالیت ${faInt(costs.length)} ثبت هزینه دارد و شما اجازه‌ی تغییر هزینه‌ها را ندارید؛ ابتدا از مالی یا مدیر پروژه بخواهید هزینه‌ها را جابه‌جا کنند.`);
        return;
      }
      const choice = await openDialog<'move'>('این فعالیت هزینه‌ی ثبت‌شده دارد', (close) => (
        <>
          <div className="body stack">
            <Alert kind="warn">
              {faInt(costs.length)} ثبت هزینه (مجموع {faNum(costs.reduce((a, c) => a + c.amount, 0))} {unit}) به «{sel.t.name}» یا زیرمجموعه‌اش وصل است. هزینه‌ها پاک نمی‌شوند.
            </Alert>
            <p>برای حذف فعالیت باید این هزینه‌ها به «سربار عمومی» منتقل شوند (فعالیتِ مرتبط‌شان در ثبت هزینه خالی می‌شود و در گزارش تغییرات می‌ماند). ادامه می‌دهید؟</p>
          </div>
          <footer>
            <Btn kind="dangerSolid" onClick={() => close('move')}>انتقال هزینه‌ها به سربار و حذف فعالیت</Btn>
            <Btn onClick={() => close()}>انصراف</Btn>
          </footer>
        </>
      ));
      if (choice !== 'move') return;
      moveCosts = true;
    } else {
      const ok = await confirmDialog({
        title: 'حذف فعالیت',
        danger: true,
        confirmLabel: 'حذف',
        message: (
          <div className="stack gap-s">
            <p>«{sel.t.name}»{ids.size > 1 ? ` و ${faInt(ids.size - 1)} زیرمجموعه‌اش` : ''} حذف می‌شود.</p>
            <ul style={{ margin: 0, paddingInlineStart: 18 }}>
              {dependents.length > 0 ? <li>پیش‌نیاز {faInt(dependents.length)} فعالیت دیگر بود؛ این وابستگی‌ها پاک می‌شوند.</li> : null}
              {docs.length > 0 ? <li>{faInt(docs.length)} مستند به این فعالیت وصل است؛ خود مستندات می‌مانند.</li> : null}
              {inBaseline > 0 ? <li>{faInt(inBaseline)} مورد در خط مبنا ثبت شده است؛ خط مبنا دست‌نخورده می‌ماند.</li> : null}
              {dependents.length + docs.length + inBaseline === 0 ? <li>هیچ داده‌ی وابسته‌ای ندارد.</li> : null}
            </ul>
          </div>
        ),
      });
      if (!ok) return;
    }
    const r = await run(async () => {
      if (moveCosts) for (const c of costs) await apiPatch(`/projects/${pid}/costs/${c.id}`, { version: c.version, taskId: null });
      const out = await apiDelete(`/projects/${pid}/tasks/${sel.t.id}`, { structureVersion: moveCosts ? (await refreshSv()) : sv });
      await reloadProject();
      return out;
    }, 'فعالیت حذف شد.');
    if (r) setSelected(null);
  };

  /** جابه‌جایی هزینه‌ها ساختار را عوض نمی‌کند، ولی نسخه‌ی ساختار را از مدل تازه می‌خوانیم تا مطمئن باشیم. */
  const refreshSv = async (): Promise<number> => {
    await reloadProject();
    return projectStore.get().bundle!.project.structureVersion;
  };

  const toggle = (id: number): void =>
    setCollapsed((c) => {
      const n = new Set(c);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const groups = rows.filter((r) => r.hasChildren).map((r) => r.t.id);

  const warnings = ps.analysis?.schedule.warnings ?? [];

  return (
    <>
      <PageHead title="فعالیت‌ها">
        <span className="muted small">{faInt(tasks.filter((t) => t.kind !== 'summary').length)} فعالیت در {faInt(groups.length)} گروه</span>
      </PageHead>

      {ps.scheduleFailure ? (
        <Alert kind="bad">
          <strong>برنامه محاسبه نشد: وابستگی‌ها دور (حلقه) ایجاد کرده‌اند.</strong>
          <div>فعالیت‌های درگیر: {ps.scheduleFailure.taskIds.map((id) => (
            <button key={id} type="button" className="btn sm" style={{ marginInlineEnd: 4 }} onClick={() => setSelected(id)}>
              {faNum(id)} {tasks.find((t) => t.id === id)?.name}
            </button>
          ))}</div>
          <div className="small">پیش‌نیاز یکی از آن‌ها را اصلاح کنید؛ داده‌های دیگر پروژه دست‌نخورده‌اند.</div>
        </Alert>
      ) : null}
      {warnings.length > 0 ? (
        <Alert kind="warn">
          <strong>هشدار محاسبه</strong>
          <ul>
            {warnings.slice(0, 5).map((w, i) => (
              <li key={i}>{w.message}</li>
            ))}
            {warnings.length > 5 ? <li>و {faInt(warnings.length - 5)} هشدار دیگر…</li> : null}
          </ul>
        </Alert>
      ) : null}

      <div className="row wrap no-print" style={{ margin: '10px 0' }}>
        {canEdit ? (
          <>
            <Btn kind="primary" icon="plus" onClick={addTask} testId="add-task" disabled={busy}>
              افزودن
            </Btn>
            <span className="seg" role="group" aria-label="جابه‌جایی">
              <button type="button" disabled={!sel || busy} aria-label="انتقال به بالا" title="انتقال به بالا" onClick={() => void structural(`/${sel!.t.id}/move`, { dir: -1 })} data-testid="move-up">
                <Icon name="up" />
              </button>
              <button type="button" disabled={!sel || busy} aria-label="انتقال به پایین" title="انتقال به پایین" onClick={() => void structural(`/${sel!.t.id}/move`, { dir: 1 })} data-testid="move-down">
                <Icon name="down" />
              </button>
              <button type="button" disabled={!sel || busy} aria-label="تورفتگی (زیرمجموعه‌ی بالایی)" title="تورفتگی" onClick={() => void structural(`/${sel!.t.id}/indent`)} data-testid="indent">
                <Icon name="indent" />
              </button>
              <button type="button" disabled={!sel || busy} aria-label="بیرون‌آوردن از گروه" title="بیرون‌آوردن" onClick={() => void structural(`/${sel!.t.id}/outdent`)} data-testid="outdent">
                <Icon name="outdent" />
              </button>
            </span>
            <Btn icon="edit" disabled={!sel || busy} onClick={() => { if (sel) openTaskDialog(sel.t.id, 'full'); }} testId="edit-task">
              ویرایش
            </Btn>
            <Btn kind="danger" icon="trash" disabled={!sel || busy} onClick={deleteTask} testId="delete-task">
              حذف
            </Btn>
          </>
        ) : (
          <>
            <Btn icon="edit" disabled={!sel || !canProgress(sel.t)} onClick={() => { if (sel) openTaskDialog(sel.t.id, 'progress'); }} testId="progress-task">
              ثبت پیشرفت
            </Btn>
            {can('progress.update.own') && !can('progress.update') && !can('schedule.edit') ? <span className="muted small">فقط فعالیت‌هایی که منبع شما به آن‌ها تخصیص دارد قابل ثبت‌اند ({bundle.me.roles.map((r) => ROLE_LABELS[r]).join('، ')}).</span> : null}
          </>
        )}
        {can('data.import') && !bundle.project.archived ? (
          <Btn icon="upload" onClick={openMspImportDialog} testId="msp-import">
            ورود از MS Project
          </Btn>
        ) : null}
        <span className="grow" />
        <div style={{ width: 200 }}>
          <TextField label="جست‌وجو" value={query} onChange={setQuery} placeholder="نام، WBS یا کد" testId="task-search" />
        </div>
        <div style={{ width: 150 }}>
          <SelectField label="نمایش" value={filter} onChange={setFilter} options={(Object.keys(FILTER_LABELS) as RowFilter[]).map((v) => ({ value: v, label: FILTER_LABELS[v] }))} />
        </div>
        <Btn size="sm" onClick={() => setCollapsed(new Set(groups))}>بستن گروه‌ها</Btn>
        <Btn size="sm" onClick={() => setCollapsed(new Set())}>بازکردن گروه‌ها</Btn>
      </div>

      {tasks.length === 0 ? (
        <div className="card">
          <Empty title="این پروژه هنوز فعالیتی ندارد">{canEdit ? 'با «افزودن» اولین فعالیت یا گروه را بسازید.' : 'برنامه‌ریز پروژه باید فعالیت‌ها را تعریف کند.'}</Empty>
        </div>
      ) : (
        <div className="tbl-wrap" style={{ maxHeight: 'calc(100vh - 250px)' }}>
          <table className="tbl" data-testid="tasks-table">
            <thead>
              <tr>
                <th className="c" title="کد پایدار؛ برای پیش‌نیاز از این کد استفاده می‌شود">کد</th>
                <th>WBS</th>
                <th style={{ minWidth: 220 }}>نام</th>
                <th>نوع</th>
                <th className="n">مدت</th>
                <th>پیش‌نیاز</th>
                <th className="n">وزن</th>
                <th style={{ minWidth: 130 }}>پیشرفت</th>
                <th>شروع واقعی</th>
                <th>پایان واقعی</th>
                <th>منابع</th>
                {showCost ? <th className="n">هزینه‌ی برنامه‌ای</th> : null}
                <th>شروع</th>
                <th>پایان</th>
                <th className="n">شناوری</th>
              </tr>
            </thead>
            <tbody>
              {shown.length === 0 ? (
                <tr className="empty-row">
                  <td colSpan={showCost ? 15 : 14}>هیچ فعالیتی با این جست‌وجو یا فیلتر پیدا نشد.</td>
                </tr>
              ) : null}
              {shown.map((r) => (
                <Row key={r.t.id} r={r} selected={selected === r.t.id} collapsed={collapsed.has(r.t.id)} onToggle={() => toggle(r.t.id)} onSelect={() => setSelected(r.t.id)} canEdit={canEdit} canProgress={canProgress(r.t)} showCost={showCost} resName={resName} patchField={patchField} onOpen={() => openTaskDialog(r.t.id, canEdit ? 'full' : 'progress')} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p className="tbl-foot">
        WBS خودکار از ترتیب و سطح ساخته می‌شود و قابل ویرایش نیست. تاریخ‌های شروع و پایان محاسبه‌شده‌اند. {ps.analysis ? <>پایان پیش‌بینی پروژه: <strong className="num">{faDate(ps.analysis.schedule.axis.days[ps.analysis.schedule.projectFinish - 1] ?? null)}</strong>.</> : null}
        {ps.analysis && bundle.baseline === null ? ' خط مبنا ثبت نشده است؛ انحراف و «برنامه‌ای» هنوز با برنامه‌ی جاری سنجیده می‌شوند.' : ''}
      </p>
      {rows.some((r) => r.afterBaseline) ? <Alert kind="info">فعالیت‌های با نشان «پس از خط مبنا» بعد از ثبت خط مبنا ساخته شده‌اند؛ برای آن‌ها برنامه‌ی جاری مبنای محاسبه است، پس انحراف صفر نمایش داده می‌شود.</Alert> : null}
    </>
  );
}

function Row({ r, selected, collapsed, onToggle, onSelect, canEdit, canProgress, showCost, resName, patchField, onOpen }: {
  r: TaskRow;
  selected: boolean;
  collapsed: boolean;
  onToggle: () => void;
  onSelect: () => void;
  canEdit: boolean;
  canProgress: boolean;
  showCost: boolean;
  resName: ReadonlyMap<number, string>;
  patchField: (t: TaskDto, patch: Record<string, unknown>) => Promise<boolean>;
  onOpen: () => void;
}) {
  const { t, s } = r;
  const summary = t.kind === 'summary';
  const pct = s?.percent ?? t.percentComplete;
  const cls = [selected ? 'sel' : '', summary ? 'summary' : '', s?.critical && !summary ? 'crit' : ''].filter(Boolean).join(' ');
  return (
    <tr className={cls} onClick={onSelect} onDoubleClick={onOpen} aria-selected={selected} data-testid={`task-row-${t.id}`}>
      <td className="c num muted">{faNum(t.id)}</td>
      <td className="num">{r.wbs}</td>
      <td>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, paddingInlineStart: (t.level - 1) * 18 }}>
          {r.hasChildren ? (
            <button type="button" className="btn ghost icon sm" style={{ width: 22, minHeight: 22 }} aria-label={collapsed ? 'باز کردن گروه' : 'بستن گروه'} aria-expanded={!collapsed} onClick={(e) => { e.stopPropagation(); onToggle(); }}>
              <Icon name={collapsed ? 'left' : 'down'} size={14} />
            </button>
          ) : (
            <span style={{ width: 22 }} />
          )}
          <EditCell kind="text" value={t.name} display={t.name} editable={canEdit} maxLength={300} label={`نام فعالیت ${t.name}`} onCommit={(v) => patchField(t, { name: String(v) })} />
          {r.afterBaseline ? <Badge kind="warn">پس از خط مبنا</Badge> : null}
        </span>
      </td>
      <td>
        {KIND_LABEL[t.kind]}
        {t.levelOfEffort ? <> <Badge kind="accent">پشتیبان</Badge></> : null}
      </td>
      <td className="n">
        {summary ? faNum(s?.duration) : t.kind === 'milestone' ? '۰' : <EditCell kind="number" integer min={1} value={t.duration} display={faNum(t.duration)} editable={canEdit && !(t.work > 0 && t.assignments.length > 0)} label={`مدت ${t.name}`} onCommit={(v) => patchField(t, { duration: Number(v) })} align="end" />}
      </td>
      <td className="num small">{t.dependencies.length ? formatDependencies(t.dependencies) : DASH}</td>
      <td className="n">{summary ? DASH : <EditCell kind="number" min={0} value={t.weight} display={faNum(t.weight, 2)} editable={canEdit} label={`وزن ${t.name}`} onCommit={(v) => patchField(t, { weight: Number(v) })} align="end" />}</td>
      <td>
        <div className="row gap-s">
          <div style={{ flex: 1, minWidth: 60 }}>
            <ProgressBar actual={pct} />
          </div>
          {summary ? <span className="num" style={{ minWidth: 38 }}>{faPct(pct, 0)}</span> : (
            <EditCell kind="number" min={0} max={100} value={t.percentComplete} display={<span className="num" style={{ minWidth: 38, display: 'inline-block' }}>{faPct(pct, 0)}</span>} editable={canProgress} label={`درصد پیشرفت ${t.name}`} onCommit={(v) => patchField(t, { percentComplete: Number(v) })} align="end" />
          )}
        </div>
      </td>
      <td className="num">{summary ? DASH : faDate(t.actualStart)}</td>
      <td className="num">{summary ? DASH : faDate(t.actualFinish)}</td>
      <td className="small res" title={t.assignments.map((a) => resName.get(a.resourceId) ?? '').join('، ')}>{t.assignments.length ? t.assignments.map((a) => `${resName.get(a.resourceId) ?? '؟'}${a.units !== 100 ? ` (${faNum(a.units)}٪)` : ''}`).join('، ') : DASH}</td>
      {showCost ? <td className="n">{summary ? DASH : faNum(r.plannedCost)}</td> : null}
      <td className="num">{s ? (s.startDate ? faDate(s.startDate) : 'خارج از افق') : DASH}</td>
      <td className="num">{s ? (s.finishDate ? faDate(s.finishDate) : 'خارج از افق') : DASH}</td>
      <td className="n">{summary || !s ? DASH : <span style={s.critical ? { color: 'var(--bad)', fontWeight: 700 } : undefined}>{faNum(s.totalFloat)}</span>}</td>
    </tr>
  );
}

function AddTaskForm({ hasSelection, selectedName, close }: { hasSelection: boolean; selectedName: string; close: (r?: { name: string; kind: TaskDto['kind']; asChild: boolean }) => void }) {
  const [name, setName] = useState('');
  const [kind, setKind] = useState<TaskDto['kind']>('task');
  const [place, setPlace] = useState<'after' | 'child'>('after');
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (name.trim()) close({ name: name.trim(), kind, asChild: hasSelection && place === 'child' });
      }}
    >
      <div className="body stack">
        <TextField label="نام" value={name} onChange={setName} maxLength={300} required autoFocus testId="add-name" />
        <SelectField label="نوع" value={kind} onChange={setKind} options={[{ value: 'task', label: 'فعالیت' }, { value: 'summary', label: 'گروه (فعالیت خلاصه)' }, { value: 'milestone', label: 'مایلستون' }]} />
        {hasSelection ? (
          <SelectField label={`محل (نسبت به «${selectedName}»)`} value={place} onChange={setPlace} options={[{ value: 'after', label: 'بعد از آن، هم‌سطح' }, { value: 'child', label: 'به‌عنوان زیرمجموعه‌ی آن' }]} hint="اگر فعالیتی که زیرمجموعه می‌گیرد اطلاعات برنامه‌ای داشته باشد، به گروه تبدیل می‌شود." />
        ) : (
          <p className="muted small">فعالیتی انتخاب نشده؛ در انتهای فهرست اضافه می‌شود.</p>
        )}
      </div>
      <footer>
        <Btn type="submit" kind="primary" disabled={!name.trim()} testId="add-submit">
          افزودن
        </Btn>
        <Btn onClick={() => close()}>انصراف</Btn>
      </footer>
    </form>
  );
}

