/**
 * ساخت و ویرایش «فعالیت تکرارشونده» (جلسه‌ی هفتگی، گزارش ماهانه، …).
 * فرم الگو را می‌گیرد، تاریخ رخدادها را زنده پیش‌نمایش می‌کند و ـ در ویرایش ـ اثر تغییر را روی رخدادهای موجود
 * (حفظ/افزوده/حذف، پیشرفت و هزینه‌ی در خطر) پیش از ذخیره نشان می‌دهد. محاسبه همان توابع هسته است که سرور اجرا می‌کند.
 */
import { useMemo, useState } from 'react';
import { JALALI_MONTHS, RECURRENCE_LIMITS, RECURRENCE_TYPE_LABELS, WEEKDAY_NAMES, createRecurrence, defaultRecurrence, recurrenceText, updateRecurrence, validateRecurrence } from '@bistoon/core';
import type { RecurrencePattern, RecurrenceType } from '@bistoon/core';
import { apiPost, apiPut } from '../../api/client.ts';
import { faDate, faDateLong, faInt } from '../../lib/fmt.ts';
import { reloadProject, useProjectState } from '../../state/project.ts';
import { Alert, Btn, CheckField, NumberField, SelectField, Segmented, TextField, useAction } from '../../ui/controls.tsx';
import { DateField } from '../../ui/DateField.tsx';
import { openDialog, toast } from '../../ui/dialogs.tsx';
import { recurrenceImpact } from './recurrenceImpact.ts';

export type RecurrenceDialogOpts = { mode: 'create'; selectedId: number | null; selectedName: string } | { mode: 'edit'; groupId: number };

/** شناسه‌ی گروه ساخته‌شده/ویرایش‌شده را برمی‌گرداند؛ با انصراف undefined */
export function openRecurrenceDialog(o: RecurrenceDialogOpts): Promise<number | undefined> {
  return openDialog<number>(o.mode === 'edit' ? 'ویرایش الگوی تکرار' : 'فعالیت تکرارشونده', (close) => <RecurrenceForm o={o} close={close} />, { wide: true });
}

/** هفته از شنبه شروع می‌شود (اندیس جاوااسکریپت) */
const WEEK_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;
const TYPE_OPTIONS = (Object.keys(RECURRENCE_TYPE_LABELS) as RecurrenceType[]).map((v) => ({ value: v, label: RECURRENCE_TYPE_LABELS[v] }));
const EVERY_UNIT: Record<RecurrenceType, string> = { daily: 'روز کاری', weekly: 'هفته', monthly: 'ماه', yearly: 'سال' };
const ORDINALS = [
  { value: '1', label: 'اولین' },
  { value: '2', label: 'دومین' },
  { value: '3', label: 'سومین' },
  { value: '4', label: 'چهارمین' },
  { value: '5', label: 'آخرین' },
] as const;
const PREVIEW_HEAD = 6;

function RecurrenceForm({ o, close }: { o: RecurrenceDialogOpts; close: (id?: number) => void }) {
  const ps = useProjectState();
  const bundle = ps.bundle!;
  const pid = bundle.project.id;
  const tasks = bundle.tasks ?? [];
  const resources = bundle.resources ?? [];
  const costs = bundle.costs ?? [];
  const calendar = bundle.calendar!;
  const projectStart = bundle.project.start;
  const sv = bundle.project.structureVersion;
  const { busy, run } = useAction();

  const group = o.mode === 'edit' ? tasks.find((t) => t.id === o.groupId) : undefined;
  const [p, setP] = useState<RecurrencePattern>(() => (group?.recurrence ? { ...group.recurrence, name: group.name } : defaultRecurrence(projectStart)));
  const [place, setPlace] = useState<'after' | 'child'>('after');
  const set = (patch: Partial<RecurrencePattern>): void => setP((x) => ({ ...x, ...patch }));

  const firstId = useMemo(() => tasks.reduce((m, t) => Math.max(m, t.id + 1), 1), [tasks]);
  const invalid = validateRecurrence(p);

  // پیش‌نمایش با همان توابع سرور
  const outcome = useMemo(() => {
    if (invalid) return null;
    const ctx = { projectStart, calendar };
    if (o.mode === 'edit') return updateRecurrence(tasks, o.groupId, p, { ...ctx, firstId });
    const lastRoot = [...tasks].reverse().find((t) => t.level === 1)?.id ?? null;
    return createRecurrence(tasks, p, { ...ctx, referenceId: o.selectedId ?? lastRoot, asChild: o.selectedId !== null && place === 'child', firstId });
  }, [p, invalid, tasks, o, place, calendar, projectStart, firstId]);

  const okOutcome = outcome && outcome.ok ? outcome : null;
  const failure = outcome && !outcome.ok ? outcome.message : null;
  const impact = useMemo(() => (okOutcome && o.mode === 'edit' ? recurrenceImpact(tasks, okOutcome, costs) : null), [okOutcome, o.mode, tasks, costs]);
  const blocked = impact !== null && impact.removedWithCosts.length > 0;
  const unknownResource = p.resource !== null && !resources.some((r) => r.id === p.resource!.resourceId);

  if (o.mode === 'edit' && (!group || !group.recurrence)) {
    return (
      <>
        <div className="body">
          <Alert kind="warn">این گروه دیگر الگوی تکرار ندارد (احتمالاً کس دیگری آن را تغییر داده است). صفحه را تازه کنید.</Alert>
        </div>
        <footer>
          <Btn onClick={() => close()}>بستن</Btn>
        </footer>
      </>
    );
  }

  const save = async (): Promise<void> => {
    if (!okOutcome || blocked) return;
    const r = await run(async () => {
      const out =
        o.mode === 'edit'
          ? await apiPut<{ summaryId: number }>(`/projects/${pid}/tasks/${o.groupId}/recurring`, { pattern: p, structureVersion: sv })
          : await apiPost<{ summaryId: number }>(`/projects/${pid}/tasks/recurring`, {
              pattern: p,
              referenceId: o.selectedId ?? ([...tasks].reverse().find((t) => t.level === 1)?.id ?? null),
              asChild: o.selectedId !== null && place === 'child',
              structureVersion: sv,
            });
      await reloadProject();
      return out;
    });
    if (!r) return;
    toast.ok(o.mode === 'edit' ? 'الگو ذخیره و رخدادها به‌روز شد.' : `${faInt(okOutcome.addedIds.length)} رخداد ساخته شد.`);
    close(r.summaryId);
  };

  const weekdayToggle = (d: number, on: boolean): void => set({ weekdays: on ? [...new Set([...p.weekdays, d])].sort((a, b) => a - b) : p.weekdays.filter((x) => x !== d) });
  const dates = okOutcome?.dates ?? [];

  return (
    <>
      <div className="body stack">
        <div className="form-grid">
          <TextField label="نام فعالیت" value={p.name} onChange={(v) => set({ name: v })} maxLength={280} required wide autoFocus error={p.name.trim() === '' ? 'نام را وارد کنید.' : null} hint="رخدادها «نام ۱»، «نام ۲»، … نام می‌گیرند." testId="rec-name" />
          <NumberField label="مدت هر رخداد (روز کاری)" value={p.duration} onChange={(v) => v !== null && set({ duration: v })} integer min={1} max={RECURRENCE_LIMITS.maxDuration} testId="rec-duration" />
        </div>

        <fieldset className="card" style={{ margin: 0 }}>
          <legend className="small muted">الگوی تکرار</legend>
          <div className="stack">
            <Segmented label="نوع تکرار" value={p.type} onChange={(v) => set({ type: v })} options={TYPE_OPTIONS} />
            <div className="row wrap">
              <div style={{ width: 140 }}>
                <NumberField label={`هر چند ${EVERY_UNIT[p.type]}`} value={p.every} onChange={(v) => v !== null && set({ every: v })} integer min={1} max={RECURRENCE_LIMITS.maxEvery} testId="rec-every" />
              </div>
              <span className="muted small" style={{ alignSelf: 'end', paddingBottom: 8 }}>
                {p.every === 1 ? `هر ${EVERY_UNIT[p.type]}` : `یک‌بار در هر ${faInt(p.every)} ${EVERY_UNIT[p.type]}`}
              </span>
            </div>

            {p.type === 'weekly' ? (
              <div role="group" aria-label="روزهای هفته" className="row wrap" data-testid="rec-weekdays">
                {WEEK_ORDER.map((d) => (
                  <CheckField key={d} label={WEEKDAY_NAMES[d]} checked={p.weekdays.includes(d)} onChange={(on) => weekdayToggle(d, on)} />
                ))}
              </div>
            ) : null}
            {p.type === 'weekly' && p.weekdays.length === 0 ? <span className="err" role="alert">حداقل یک روز هفته را انتخاب کنید.</span> : null}

            {p.type === 'monthly' ? (
              <div className="stack gap-s">
                <Segmented
                  label="روش ماهانه"
                  value={p.monthMode}
                  onChange={(v) => set({ monthMode: v })}
                  options={[
                    { value: 'day', label: 'روز مشخصی از ماه' },
                    { value: 'ordinal', label: 'یک روز هفته‌ی مشخص' },
                  ]}
                />
                {p.monthMode === 'day' ? (
                  <div style={{ width: 160 }}>
                    <NumberField label="روز ماه (شمسی)" value={p.monthDay} onChange={(v) => v !== null && set({ monthDay: v })} integer min={1} max={31} hint="در ماه‌های کوتاه‌تر به آخر ماه می‌رود." testId="rec-monthday" />
                  </div>
                ) : (
                  <div className="row wrap">
                    <div style={{ width: 160 }}>
                      <SelectField label="کدام" value={String(p.monthOrdinal)} onChange={(v) => set({ monthOrdinal: Number(v) })} options={ORDINALS} />
                    </div>
                    <div style={{ width: 160 }}>
                      <SelectField label="روز هفته" value={String(p.monthWeekday)} onChange={(v) => set({ monthWeekday: Number(v) })} options={WEEK_ORDER.map((d) => ({ value: String(d), label: WEEKDAY_NAMES[d] }))} />
                    </div>
                  </div>
                )}
              </div>
            ) : null}

            {p.type === 'yearly' ? (
              <div className="row wrap">
                <div style={{ width: 160 }}>
                  <SelectField label="ماه (شمسی)" value={String(p.yearMonth)} onChange={(v) => set({ yearMonth: Number(v) })} options={JALALI_MONTHS.map((m, i) => ({ value: String(i + 1), label: m }))} />
                </div>
                <div style={{ width: 120 }}>
                  <NumberField label="روز" value={p.yearDay} onChange={(v) => v !== null && set({ yearDay: v })} integer min={1} max={31} />
                </div>
              </div>
            ) : null}
          </div>
        </fieldset>

        <fieldset className="card" style={{ margin: 0 }}>
          <legend className="small muted">بازه‌ی تکرار</legend>
          <div className="row wrap">
            <div style={{ minWidth: 180 }}>
              <DateField label="شروع بازه" value={p.start} onChange={(v) => v && set({ start: v })} required testId="rec-start" />
            </div>
            <Segmented
              label="پایان بازه"
              value={p.endMode}
              onChange={(v) => set({ endMode: v, ...(v === 'date' && p.endDate === null ? { endDate: p.start } : {}) })}
              options={[
                { value: 'count', label: 'بعد از چند رخداد' },
                { value: 'date', label: 'تا تاریخ' },
              ]}
            />
            {p.endMode === 'count' ? (
              <div style={{ width: 150 }}>
                <NumberField label="تعداد رخدادها" value={p.count} onChange={(v) => v !== null && set({ count: v })} integer min={1} max={RECURRENCE_LIMITS.maxOccurrences} testId="rec-count" />
              </div>
            ) : (
              <div style={{ minWidth: 180 }}>
                <DateField label="پایان بازه" value={p.endDate} onChange={(v) => set({ endDate: v })} required min={p.start} testId="rec-end" />
              </div>
            )}
          </div>
        </fieldset>

        <fieldset className="card" style={{ margin: 0 }}>
          <legend className="small muted">منبع و محاسبه</legend>
          <div className="stack gap-s">
            <div className="row wrap">
              <div style={{ flex: '1 1 220px' }}>
                <SelectField
                  label="منبع هر رخداد (اختیاری)"
                  value={p.resource ? String(p.resource.resourceId) : ''}
                  onChange={(v) => set({ resource: v === '' ? null : { resourceId: Number(v), units: p.resource?.units ?? 100 } })}
                  options={[{ value: '', label: 'بدون منبع' }, ...resources.map((r) => ({ value: String(r.id), label: r.name }))]}
                />
              </div>
              {p.resource ? (
                <div style={{ width: 130 }}>
                  <NumberField label="درصد تخصیص" value={p.resource.units} onChange={(v) => v !== null && p.resource && set({ resource: { ...p.resource, units: v } })} min={1} max={1000} maxFraction={1} />
                </div>
              ) : null}
            </div>
            {unknownResource ? <span className="err" role="alert">منبع انتخاب‌شده دیگر در پروژه نیست؛ منبع دیگری برگزینید یا «بدون منبع» را بزنید.</span> : null}
            <CheckField label="در درصد پیشرفت وزنی پروژه لحاظ شود" checked={p.weighted} onChange={(v) => set({ weighted: v })} hint="وزن هر رخداد برابر مدت آن می‌شود؛ وگرنه صفر است و جلسه‌ها پیشرفت پروژه را عوض نمی‌کنند." />
            <CheckField label="فعالیت پشتیبانی (LOE)" checked={p.levelOfEffort} onChange={(v) => set({ levelOfEffort: v })} hint="در پایان پروژه و مسیر بحرانی دخالت ندارد؛ مناسب جلسه و پایش." />
          </div>
        </fieldset>

        {o.mode === 'create' ? (
          o.selectedId !== null ? (
            <SelectField label={`محل (نسبت به «${o.selectedName}»)`} value={place} onChange={setPlace} options={[{ value: 'after', label: 'بعد از آن، هم‌سطح' }, { value: 'child', label: 'به‌عنوان زیرمجموعه‌ی آن' }]} />
          ) : (
            <p className="muted small">فعالیتی انتخاب نشده؛ گروه در انتهای فهرست ساخته می‌شود.</p>
          )
        ) : null}

        <div className="card" style={{ margin: 0 }} data-testid="rec-preview" aria-live="polite">
          <strong>پیش‌نمایش</strong>
          {invalid ? (
            <p className="err" role="alert" style={{ margin: '6px 0 0' }}>{invalid}</p>
          ) : failure ? (
            <Alert kind="warn">{failure}</Alert>
          ) : (
            <div className="stack gap-s" style={{ marginTop: 6 }}>
              <span>
                {faInt(dates.length)} رخداد — {recurrenceText(p)}
              </span>
              <ol className="small" style={{ margin: 0, paddingInlineStart: 20 }}>
                {dates.slice(0, PREVIEW_HEAD).map((d, i) => (
                  <li key={d}>
                    {p.name.trim()} {i + 1} — <span className="num">{faDateLong(d)}</span>
                  </li>
                ))}
              </ol>
              {dates.length > PREVIEW_HEAD ? (
                <span className="small muted">
                  … و {faInt(dates.length - PREVIEW_HEAD)} رخداد دیگر؛ آخرین: <span className="num">{faDateLong(dates[dates.length - 1])}</span>
                </span>
              ) : null}
              <span className="small muted">اگر روزی تعطیل باشد، رخداد به نخستین روز کاری بعد می‌رود.</span>
            </div>
          )}
        </div>

        {impact ? (
          <div className="stack gap-s" data-testid="rec-impact">
            <Alert kind="info">
              {faInt(impact.kept)} رخداد حفظ می‌شود (شناسه، پیش‌نیاز، پیشرفت و منبع‌شان می‌ماند)
              {impact.added > 0 ? `، ${faInt(impact.added)} رخداد تازه ساخته می‌شود` : ''}
              {impact.removed.length > 0 ? `، ${faInt(impact.removed.length)} رخداد آخر حذف می‌شود` : ''}.
            </Alert>
            {impact.removedWithCosts.length > 0 ? (
              <Alert kind="bad">
                این رخدادها هزینه‌ی ثبت‌شده دارند و حذف نمی‌شوند: {impact.removedWithCosts.map((r) => `«${r.name}»`).join('، ')}. تعداد را کمتر نکنید یا ابتدا هزینه‌ها را جابه‌جا کنید.
              </Alert>
            ) : null}
            {impact.removedWithProgress.length > 0 ? <Alert kind="warn">پیشرفت ثبت‌شده‌ی این رخدادها با حذف از بین می‌رود: {impact.removedWithProgress.map((r) => `«${r.name}»`).join('، ')}.</Alert> : null}
            {impact.dependentsCleared > 0 ? <Alert kind="warn">پیش‌نیازِ {faInt(impact.dependentsCleared)} فعالیت دیگر یکی از رخدادهای حذف‌شده است؛ آن وابستگی‌ها پاک می‌شود.</Alert> : null}
          </div>
        ) : null}
      </div>
      <footer>
        <Btn kind="primary" onClick={save} busy={busy} disabled={busy || !okOutcome || blocked || unknownResource} testId="rec-save">
          {o.mode === 'edit' ? 'ذخیره‌ی الگو' : 'ساخت فعالیت‌های تکرارشونده'}
        </Btn>
        <Btn onClick={() => close()}>انصراف</Btn>
        <span className="muted small" aria-live="polite" data-testid="rec-footer-note">
          {invalid ? invalid : failure ? failure : `${faInt(dates.length)} رخداد؛ نخستین ${faDate(dates[0])}، آخرین ${faDate(dates[dates.length - 1])}`}
        </span>
      </footer>
    </>
  );
}
