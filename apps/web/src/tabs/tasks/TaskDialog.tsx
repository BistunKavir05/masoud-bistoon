import { useMemo, useState } from 'react';
import { formatDependencies, parseDependencies, wbsMap } from '@bistoon/core';
import type { Assignment, Dependency, DependencyType, DirectCostLine, TaskDto } from '@bistoon/core';
import { apiPatch } from '../../api/client.ts';
import { faNum } from '../../lib/fmt.ts';
import { patchTaskLocal, reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { Alert, Btn, CheckField, NumberField, SelectField, TextField, useAction } from '../../ui/controls.tsx';
import { DateField } from '../../ui/DateField.tsx';
import { openDialog, toast } from '../../ui/dialogs.tsx';

const DEP_TYPES: { value: DependencyType; label: string }[] = [
  { value: 'FS', label: 'پایان به شروع (FS)' },
  { value: 'SS', label: 'شروع به شروع (SS)' },
  { value: 'FF', label: 'پایان به پایان (FF)' },
  { value: 'SF', label: 'شروع به پایان (SF)' },
];

type Mode = 'full' | 'progress';

export function openTaskDialog(taskId: number, mode: Mode): void {
  void openDialog(mode === 'progress' ? 'ثبت پیشرفت' : 'ویرایش فعالیت', (close) => <TaskForm taskId={taskId} mode={mode} close={() => close()} />, { wide: true });
}

function sameJson(a: unknown, b: unknown): boolean {
  return JSON.stringify(a) === JSON.stringify(b);
}

function TaskForm({ taskId, mode, close }: { taskId: number; mode: Mode; close: () => void }) {
  const ps = useProjectState();
  const can = useCan();
  const bundle = ps.bundle!;
  const original = bundle.tasks!.find((t) => t.id === taskId)!;
  const resources = bundle.resources ?? [];
  const wbs = useMemo(() => wbsMap(bundle.tasks!), [bundle.tasks]);
  const { busy, run } = useAction();

  const isSummary = original.kind === 'summary';
  const full = mode === 'full';
  const showCosts = full && can('costs.view');

  const [name, setName] = useState(original.name);
  const [milestone, setMilestone] = useState(original.kind === 'milestone');
  const [duration, setDuration] = useState<number | null>(original.duration);
  const [weight, setWeight] = useState<number | null>(original.weight);
  const [work, setWork] = useState<number | null>(original.work);
  const [percent, setPercent] = useState<number | null>(original.percentComplete);
  const [aStart, setAStart] = useState(original.actualStart);
  const [aFinish, setAFinish] = useState(original.actualFinish);
  const [snet, setSnet] = useState(original.startNoEarlierThan);
  const [deadline, setDeadline] = useState(original.deadline);
  const [loe, setLoe] = useState(original.levelOfEffort);
  const [deps, setDeps] = useState<Dependency[]>(original.dependencies);
  const [assign, setAssign] = useState<Assignment[]>(original.assignments);
  const [dcosts, setDcosts] = useState<DirectCostLine[]>(original.directCosts);
  const [legacy, setLegacy] = useState<number | null>(original.legacyActualCost);
  const [tracked, setTracked] = useState(original.costTracked);
  const [quick, setQuick] = useState('');
  const [quickErr, setQuickErr] = useState<string | null>(null);

  const finishBeforeStart = aStart && aFinish && aFinish < aStart ? 'پایان واقعی نمی‌تواند قبل از شروع واقعی باشد.' : null;
  const effortDriven = (work ?? 0) > 0 && assign.some((a) => a.units > 0);
  const durationLocked = isSummary || milestone || effortDriven;

  const patch = useMemo(() => {
    const p: Record<string, unknown> = {};
    if (name.trim() !== original.name) p['name'] = name.trim();
    if (!isSummary) {
      if (full) {
        if (milestone !== (original.kind === 'milestone')) p['isMilestone'] = milestone;
        if (duration !== null && !durationLocked && duration !== original.duration) p['duration'] = duration;
        if (weight !== null && weight !== original.weight) p['weight'] = weight;
        if (work !== null && work !== original.work) p['work'] = work;
        if (snet !== original.startNoEarlierThan) p['startNoEarlierThan'] = snet;
        if (deadline !== original.deadline) p['deadline'] = deadline;
        if (loe !== original.levelOfEffort) p['levelOfEffort'] = loe;
        if (!sameJson(deps, original.dependencies)) p['dependencies'] = deps;
        if (!sameJson(assign, original.assignments)) p['assignments'] = assign;
        if (showCosts) {
          if (!sameJson(dcosts, original.directCosts)) p['directCosts'] = dcosts;
          if (legacy !== original.legacyActualCost) p['legacyActualCost'] = legacy;
          if (tracked !== original.costTracked) p['costTracked'] = tracked;
        }
      }
      if (percent !== null && percent !== original.percentComplete) p['percentComplete'] = percent;
      if (aStart !== original.actualStart) p['actualStart'] = aStart;
      if (aFinish !== original.actualFinish) p['actualFinish'] = aFinish;
    }
    return p;
  }, [name, milestone, duration, weight, work, percent, aStart, aFinish, snet, deadline, loe, deps, assign, dcosts, legacy, tracked, original, isSummary, full, durationLocked, showCosts]);

  const changed = Object.keys(patch).length > 0;
  const invalid = name.trim() === '' || finishBeforeStart !== null || deps.some((d) => !Number.isInteger(d.lag)) || assign.some((a) => !(a.units > 0)) || dcosts.some((c) => !(c.amount > 0));

  const save = async (): Promise<void> => {
    const r = await run(() => apiPatch<{ task: TaskDto; notes: string[] }>(`/projects/${bundle.project.id}/tasks/${taskId}`, { version: original.version, patch }));
    if (!r) return;
    patchTaskLocal(r.task);
    void reloadProject().catch(() => undefined);
    toast.ok('فعالیت ذخیره شد.');
    for (const n of r.notes) toast.info(n);
    close();
  };

  const applyQuick = (): void => {
    const r = parseDependencies(quick);
    if (r.invalid.length) return setQuickErr(`قالب نامعتبر: ${r.invalid.join('، ')} — مثال: 12FS+1,8SS,4FF-2`);
    const known = new Set(bundle.tasks!.map((t) => t.id));
    const unknown = r.dependencies.filter((d) => !known.has(d.predecessorId) || d.predecessorId === taskId);
    if (unknown.length) return setQuickErr(`کد پیش‌نیاز معتبر نیست: ${unknown.map((d) => d.predecessorId).join('، ')}`);
    setDeps(r.dependencies);
    setQuickErr(null);
    setQuick('');
  };

  const predOptions = bundle.tasks!.filter((t) => t.id !== taskId).map((t) => ({ value: String(t.id), label: `${faNum(t.id)} — ${wbs.get(t.id) ?? ''} ${t.name}` }));
  const resOptions = resources.map((r) => ({ value: String(r.id), label: r.name }));

  return (
    <>
      <div className="body stack">
        {isSummary && full ? <Alert kind="info">این فعالیت «گروه» است؛ مدت، پیشرفت و تاریخ‌هایش از زیرمجموعه‌ها محاسبه می‌شود و فقط نام آن قابل ویرایش است.</Alert> : null}
        <div className="form-grid">
          <TextField label="نام فعالیت" value={name} onChange={setName} maxLength={300} required disabled={!full} wide error={name.trim() === '' ? 'نام نمی‌تواند خالی باشد.' : null} testId="td-name" />
          {full && !isSummary ? <CheckField label="مایلستون (مدت صفر)" checked={milestone} onChange={setMilestone} /> : null}
          {full && !isSummary ? <CheckField label="فعالیت پشتیبانی (LOE)" checked={loe} onChange={setLoe} hint="در پایان پروژه و مسیر بحرانی دخالت ندارد." /> : null}
          {!isSummary && full ? (
            <>
              <NumberField label="مدت (روز کاری)" value={durationLocked && !milestone ? original.duration : milestone ? 0 : duration} onChange={setDuration} integer min={milestone ? 0 : 1} disabled={durationLocked} hint={effortDriven ? 'با «کار» و تخصیص منبع، مدت از کار ÷ مجموع واحد تخصیص محاسبه می‌شود.' : undefined} testId="td-duration" />
              <NumberField label="وزن" value={weight} onChange={setWeight} min={0} maxFraction={4} hint="مستقل از مدت؛ در درصد پیشرفت پروژه اثر می‌گذارد." />
              <NumberField label="کار (نفر-روز)" value={work} onChange={setWork} min={0} maxFraction={2} hint="صفر = مدت دستی." />
            </>
          ) : null}
          {!isSummary ? (
            <>
              <NumberField label="درصد پیشرفت" value={percent} onChange={setPercent} min={0} max={100} maxFraction={1} testId="td-percent" />
              <DateField label="شروع واقعی" value={aStart} onChange={setAStart} allowEmpty />
              <DateField label="پایان واقعی" value={aFinish} onChange={setAFinish} allowEmpty error={finishBeforeStart} hint="ثبت پایان واقعی، پیشرفت را ۱۰۰٪ می‌کند." />
            </>
          ) : null}
          {full && !isSummary ? (
            <>
              <DateField label="قید «شروع نه زودتر از»" value={snet} onChange={setSnet} allowEmpty hint={original.startNoEarlierSource === 'leveling' ? 'این قید از تسطیح منابع آمده است.' : original.startNoEarlierSource === 'msp' ? 'این قید از ورود MSP آمده است.' : undefined} />
              <DateField label="ضرب‌الاجل" value={deadline} onChange={setDeadline} allowEmpty />
            </>
          ) : null}
        </div>

        {full && !isSummary ? (
          <fieldset className="card" style={{ margin: 0 }}>
            <legend className="small muted">پیش‌نیازها</legend>
            <div className="stack gap-s">
              {deps.length === 0 ? <span className="muted small">پیش‌نیازی ندارد.</span> : null}
              {deps.map((d, i) => (
                <div key={i} className="row wrap" data-testid="dep-row">
                  <div style={{ flex: '2 1 240px' }}>
                    <SelectField label="پیش‌نیاز" value={String(d.predecessorId)} options={predOptions} onChange={(v) => setDeps(deps.map((x, j) => (j === i ? { ...x, predecessorId: Number(v) } : x)))} />
                  </div>
                  <div style={{ flex: '1 1 160px' }}>
                    <SelectField label="نوع" value={d.type} options={DEP_TYPES} onChange={(v) => setDeps(deps.map((x, j) => (j === i ? { ...x, type: v } : x)))} />
                  </div>
                  <div style={{ flex: '0 1 110px' }}>
                    <NumberField label="تأخیر (روز)" value={d.lag} integer onChange={(v) => v !== null && setDeps(deps.map((x, j) => (j === i ? { ...x, lag: v } : x)))} />
                  </div>
                  <Btn kind="ghost" iconOnly icon="trash" label="حذف پیش‌نیاز" onClick={() => setDeps(deps.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div className="row wrap">
                <Btn size="sm" icon="plus" disabled={predOptions.length === 0} onClick={() => setDeps([...deps, { predecessorId: Number(predOptions[0]!.value), type: 'FS', lag: 0 }])} testId="dep-add">
                  افزودن پیش‌نیاز
                </Btn>
                <div style={{ flex: '1 1 260px' }}>
                  <TextField label="ورود سریع متنی (کد + نوع + تأخیر)" value={quick} onChange={setQuick} ltr placeholder="12FS+1,8SS,4FF-2" error={quickErr} hint={deps.length ? `فعلی: ${formatDependencies(deps)}` : 'کد همان عدد ستون «کد» است. با اعمال، فهرست بالا جایگزین می‌شود.'} />
                </div>
                <Btn size="sm" disabled={!quick.trim()} onClick={applyQuick}>
                  اعمال متن
                </Btn>
              </div>
            </div>
          </fieldset>
        ) : null}

        {full && !isSummary ? (
          <fieldset className="card" style={{ margin: 0 }}>
            <legend className="small muted">تخصیص منابع</legend>
            <div className="stack gap-s">
              {resources.length === 0 ? <span className="muted small">هنوز منبعی تعریف نشده است؛ از بخش «منابع» اضافه کنید.</span> : null}
              {assign.map((a, i) => (
                <div key={i} className="row wrap">
                  <div style={{ flex: '2 1 200px' }}>
                    <SelectField label="منبع" value={String(a.resourceId)} options={resOptions} onChange={(v) => setAssign(assign.map((x, j) => (j === i ? { ...x, resourceId: Number(v) } : x)))} />
                  </div>
                  <div style={{ flex: '0 1 130px' }}>
                    <NumberField label="درصد تخصیص" value={a.units} min={1} maxFraction={1} onChange={(v) => v !== null && setAssign(assign.map((x, j) => (j === i ? { ...x, units: v } : x)))} />
                  </div>
                  <Btn kind="ghost" iconOnly icon="trash" label="حذف تخصیص" onClick={() => setAssign(assign.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div>
                <Btn size="sm" icon="plus" disabled={resources.length === 0 || assign.length >= resources.length} onClick={() => setAssign([...assign, { resourceId: Number(resources.find((r) => !assign.some((a) => a.resourceId === r.id))!.id), units: 100 }])}>
                  افزودن منبع
                </Btn>
              </div>
            </div>
          </fieldset>
        ) : null}

        {showCosts && !isSummary ? (
          <fieldset className="card" style={{ margin: 0 }}>
            <legend className="small muted">هزینه</legend>
            <div className="stack gap-s">
              {dcosts.map((c, i) => (
                <div key={i} className="row wrap">
                  <div style={{ flex: '2 1 200px' }}>
                    <TextField label="شرح هزینه‌ی مستقیم" value={c.name} maxLength={80} onChange={(v) => setDcosts(dcosts.map((x, j) => (j === i ? { ...x, name: v } : x)))} />
                  </div>
                  <div style={{ flex: '1 1 160px' }}>
                    <NumberField label={`مبلغ (${bundle.project.finance.unit})`} value={c.amount} min={1} onChange={(v) => v !== null && setDcosts(dcosts.map((x, j) => (j === i ? { ...x, amount: v } : x)))} />
                  </div>
                  <Btn kind="ghost" iconOnly icon="trash" label="حذف هزینه" onClick={() => setDcosts(dcosts.filter((_, j) => j !== i))} />
                </div>
              ))}
              <div>
                <Btn size="sm" icon="plus" onClick={() => setDcosts([...dcosts, { name: '', amount: 1 }])}>
                  افزودن هزینه‌ی مستقیم
                </Btn>
              </div>
              <div className="form-grid">
                <NumberField label="هزینه‌ی واقعی قدیمی روی فعالیت" value={legacy} allowEmpty min={0} onChange={setLegacy} hint="فقط اگر برای این فعالیت ردیفی در دفتر هزینه نباشد به‌کار می‌رود." />
                <CheckField label="در جدول هزینه‌ها همیشه نشان داده شود" checked={tracked} onChange={setTracked} />
              </div>
            </div>
          </fieldset>
        ) : null}
      </div>
      <footer>
        <Btn kind="primary" busy={busy} disabled={!changed || invalid} onClick={save} testId="td-save">
          ذخیره
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
        {!changed ? <span className="muted small">تغییری برای ذخیره نیست.</span> : null}
      </footer>
    </>
  );
}
