import { useMemo, useState } from 'react';
import { CALENDAR_TEMPLATES, JALALI_MONTHS, daysInJalaliMonth, formatJalaliLong, fromJalali, toJalali, toPersianDigits, validateCalendar, weekday, weeklyHours } from '@bistoon/core';
import type { Holiday, IsoDate, WorkCalendar, WorkDay } from '@bistoon/core';
import { apiDelete, apiPut } from '../../api/client.ts';
import { faDate, faInt, faNum, todayIso } from '../../lib/fmt.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { Alert, Btn, Card, Empty, PageHead, SelectField, TextField, TimeField, useAction } from '../../ui/controls.tsx';
import { DateField } from '../../ui/DateField.tsx';
import { Icon } from '../../ui/icons.tsx';
import { confirmDialog, openDialog } from '../../ui/dialogs.tsx';
import { ImpactNote } from './ImpactNote.tsx';
import { openBulkDialog } from './BulkHolidays.tsx';

/** نام روز هفته به ترتیب اندیس جاوااسکریپتی (۰ یکشنبه … ۶ شنبه) */
const DAY_NAMES = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];
/** ترتیب نمایش هفته‌ی ایرانی: شنبه تا جمعه */
const DISPLAY_ORDER = [6, 0, 1, 2, 3, 4, 5];
const DOW_SHORT = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

const toMin = (s: string): number => Number(s.slice(0, 2)) * 60 + Number(s.slice(3, 5));
const hoursOf = (d: WorkDay): number => (d.working ? Math.max(0, toMin(d.to) - toMin(d.from)) / 60 : 0);
const sameDays = (a: readonly WorkDay[], b: readonly WorkDay[]): boolean => a.every((d, i) => d.working === b[i]!.working && d.from === b[i]!.from && d.to === b[i]!.to);

export function CalendarTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const cal = b.calendar;
  const canEdit = can('schedule.edit') && !b.project.archived;
  if (!cal) {
    return (
      <>
        <PageHead title="تقویم کاری" />
        <Card>
          <Empty title="تقویم در دسترس نیست">نقش شما به برنامه‌ی زمانی دسترسی ندارد.</Empty>
        </Card>
      </>
    );
  }
  return (
    <>
      <PageHead title="تقویم کاری" />
      {ps.scheduleFailure ? <Alert kind="warn">وابستگی‌ها دور (حلقه) دارند؛ اثر تغییر تقویم بر برنامه تا اصلاح آن‌ها نشان داده نمی‌شود.</Alert> : null}
      <div className="stack gap-l">
        <WeekCard key={JSON.stringify(cal.days)} cal={cal} canEdit={canEdit} />
        <HolidaysCard cal={cal} canEdit={canEdit} />
      </div>
    </>
  );
}

// ───── هفته‌ی کاری ─────

function WeekCard({ cal, canEdit }: { cal: WorkCalendar; canEdit: boolean }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const [days, setDays] = useState<WorkDay[]>(cal.days.map((d) => ({ ...d })));
  const [tpl, setTpl] = useState(CALENDAR_TEMPLATES[0]!.key);
  const { busy, run } = useAction();
  const changed = !sameDays(days, cal.days);
  const set = (i: number, p: Partial<WorkDay>): void => setDays((s) => s.map((d, k) => (k === i ? { ...d, ...p } : d)));
  const next: WorkCalendar = { days, holidays: cal.holidays };
  const issues = validateCalendar(next);
  const timeBad = (d: WorkDay): boolean => d.working && toMin(d.to) <= toMin(d.from);
  const problem = issues[0]?.message ?? (days.some(timeBad) ? 'ساعت پایان هر روز کاری باید بعد از ساعت شروع باشد.' : null);

  const save = async (): Promise<void> => {
    const ok = await openDialog<boolean>(
      'ذخیره‌ی هفته‌ی کاری',
      (close) => (
        <>
          <div className="body stack">
            <Alert kind="warn">تغییر هفته‌ی کاری تاریخ فعالیت‌ها را برای همه‌ی کاربران پروژه جابه‌جا می‌کند. خط مبنا با تاریخ‌های ثبت‌شده‌اش ثابت می‌ماند، ولی پیشرفت برنامه‌ای و تأخیرها بر پایه‌ی تقویم تازه محاسبه می‌شوند.</Alert>
            <ImpactNote next={next} />
          </div>
          <footer>
            <Btn kind="primary" onClick={() => close(true)} testId="week-confirm">
              ذخیره
            </Btn>
            <Btn onClick={() => close(false)}>انصراف</Btn>
          </footer>
        </>
      ),
      { wide: true },
    );
    if (!ok) return;
    await run(async () => {
      await apiPut(`/projects/${pid}/calendar/days`, { days });
      await reloadProject();
    }, 'هفته‌ی کاری ذخیره شد.');
  };

  return (
    <Card
      title="هفته‌ی کاری"
      actions={
        <span className="muted small" data-testid="week-hours">
          مجموع ساعت نمایشی هفته: {faNum(weeklyHours(next), 1)}
        </span>
      }
    >
      <div className="tbl-wrap" style={{ border: 0 }}>
        <table className="tbl" data-testid="week-table">
          <thead>
            <tr>
              <th>روز</th>
              <th className="c">کاری</th>
              <th>ساعت شروع</th>
              <th>ساعت پایان</th>
              <th className="n">ساعت</th>
            </tr>
          </thead>
          <tbody>
            {DISPLAY_ORDER.map((i) => {
              const d = days[i]!;
              return (
                <tr key={i} data-testid={`week-day-${i}`}>
                  <th scope="row">{DAY_NAMES[i]}</th>
                  <td className="c">
                    <input type="checkbox" checked={d.working} disabled={!canEdit} aria-label={`${DAY_NAMES[i]} کاری است`} onChange={(e) => set(i, { working: e.target.checked })} style={{ width: 16, height: 16 }} />
                  </td>
                  <td>
                    <TimeField compact label="" value={d.from} disabled={!canEdit || !d.working} ariaLabel={`ساعت شروع ${DAY_NAMES[i]}`} onChange={(v) => set(i, { from: v })} />
                  </td>
                  <td>
                    <TimeField compact label="" value={d.to} disabled={!canEdit || !d.working} ariaLabel={`ساعت پایان ${DAY_NAMES[i]}`} onChange={(v) => set(i, { to: v })} />
                  </td>
                  <td className="n">{d.working ? faNum(hoursOf(d), 1) : 'تعطیل'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="small muted">ساعت‌ها فقط برای نمایش و خروجی‌اند: هر روز کاری، حتی پنجشنبه با ساعت کمتر، یک روز کامل در محاسبه‌ی مدت و برنامه به‌حساب می‌آید.</p>
      {problem && changed ? <Alert kind="bad">{problem}</Alert> : null}
      {canEdit ? (
        <div className="row wrap" style={{ marginTop: 8 }}>
          <div style={{ minWidth: 320, flex: '1 1 320px' }}>
            <SelectField label="الگوی آماده" value={tpl} options={CALENDAR_TEMPLATES.map((t) => ({ value: t.key, label: t.label }))} onChange={setTpl} />
          </div>
          <Btn onClick={() => setDays(CALENDAR_TEMPLATES.find((t) => t.key === tpl)!.days.map((d) => ({ ...d })))} testId="week-apply-template">
            اعمال الگو در فرم
          </Btn>
          <span className="grow" />
          <Btn onClick={() => setDays(cal.days.map((d) => ({ ...d })))} disabled={!changed} testId="week-reset">
            بازنشانی
          </Btn>
          <Btn kind="primary" busy={busy} disabled={!changed || problem !== null} onClick={save} testId="week-save">
            بررسی اثر و ذخیره
          </Btn>
        </div>
      ) : null}
    </Card>
  );
}

// ───── تعطیلات ─────

function HolidaysCard({ cal, canEdit }: { cal: WorkCalendar; canEdit: boolean }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const { busy, run } = useAction();
  const map = useMemo(() => new Map(cal.holidays.map((h) => [h.date, h.title])), [cal.holidays]);
  const sorted = useMemo(() => [...cal.holidays].sort((a, b) => (a.date < b.date ? -1 : 1)), [cal.holidays]);

  const withHoliday = (list: readonly Holiday[], h: Holiday): Holiday[] => [...list.filter((x) => x.date !== h.date), h];

  const edit = async (date: IsoDate): Promise<void> => {
    const existing = map.get(date);
    const isHoliday = existing !== undefined;
    await openDialog(
      isHoliday ? 'ویرایش تعطیلی' : 'افزودن تعطیلی',
      (close) => <HolidayForm date={date} existing={isHoliday ? existing : null} cal={cal} pid={pid} close={() => close()} withHoliday={withHoliday} />,
      { wide: true },
    );
  };

  const add = (): void => {
    void openDialog(
      'افزودن تعطیلی',
      (close) => <HolidayForm date={null} existing={null} cal={cal} pid={pid} close={() => close()} withHoliday={withHoliday} />,
      { wide: true },
    );
  };

  const remove = async (h: Holiday): Promise<void> => {
    const ok = await confirmDialog({ title: 'حذف تعطیلی', message: `تعطیلی ${formatJalaliLong(h.date)}${h.title ? ` (${h.title})` : ''} حذف شود؟ این روز دوباره کاری می‌شود و تاریخ فعالیت‌ها ممکن است جابه‌جا شود.`, confirmLabel: 'حذف شود', danger: true });
    if (!ok) return;
    await run(async () => {
      await apiDelete(`/projects/${pid}/calendar/holidays/${h.date}`);
      await reloadProject();
    }, 'تعطیلی حذف شد.');
  };

  return (
    <Card
      title={`تعطیلات (${faInt(cal.holidays.length)})`}
      actions={
        canEdit ? (
          <span className="row wrap">
            <Btn icon="plus" onClick={add} testId="hol-add">
              افزودن تعطیلی
            </Btn>
            <Btn icon="upload" onClick={() => void openBulkDialog(cal)} testId="hol-bulk">
              افزودن گروهی
            </Btn>
          </span>
        ) : null
      }
    >
      <div className="hol-layout">
        <MonthGrid cal={cal} holidays={map} canEdit={canEdit} onPick={(d) => void edit(d)} status={ps.bundle!.project.status} start={ps.bundle!.project.start} end={ps.bundle!.project.contractEnd} />
        <div>
          {sorted.length === 0 ? (
            <Empty title="تعطیلی ثبت نشده است">جمعه‌ها طبق هفته‌ی کاری تعطیل‌اند. تعطیلات رسمی و مناسبتی را با «افزودن تعطیلی» یا «افزودن گروهی» ثبت کنید تا در برنامه لحاظ شود.</Empty>
          ) : (
            <div className="tbl-wrap" style={{ maxHeight: 360, overflow: 'auto' }}>
              <table className="tbl" data-testid="hol-table">
                <thead>
                  <tr>
                    <th>تاریخ</th>
                    <th>روز</th>
                    <th>عنوان</th>
                    {canEdit ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((h) => (
                    <tr key={h.date} data-testid={`hol-row-${h.date}`}>
                      <td>
                        <span className="num">{faDate(h.date)}</span>
                      </td>
                      <td>{DAY_NAMES[weekday(h.date)]}</td>
                      <td>{h.title || <span className="muted">بدون عنوان</span>}</td>
                      {canEdit ? (
                        <td className="c" style={{ whiteSpace: 'nowrap' }}>
                          <Btn size="sm" iconOnly icon="edit" label={`ویرایش تعطیلی ${faDate(h.date)}`} onClick={() => void edit(h.date)} />{' '}
                          <Btn size="sm" kind="danger" iconOnly icon="trash" label={`حذف تعطیلی ${faDate(h.date)}`} disabled={busy} onClick={() => remove(h)} testId={`hol-del-${h.date}`} />
                        </td>
                      ) : null}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </Card>
  );
}

function HolidayForm({ date, existing, cal, pid, close, withHoliday }: { date: IsoDate | null; existing: string | null; cal: WorkCalendar; pid: number; close: () => void; withHoliday: (l: readonly Holiday[], h: Holiday) => Holiday[] }) {
  const [d, setD] = useState<IsoDate | null>(date);
  const [title, setTitle] = useState(existing ?? '');
  const { busy, run } = useAction();
  const editing = existing !== null;
  const weekOff = d !== null && !cal.days[weekday(d)]!.working;
  const next: WorkCalendar = { days: cal.days, holidays: d ? withHoliday(cal.holidays, { date: d, title: title.trim() }) : cal.holidays };
  const unchanged = editing && title.trim() === existing;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (!d || unchanged) return;
        void run(async () => {
          await apiPut(`/projects/${pid}/calendar/holidays/${d}`, { title: title.trim() });
          await reloadProject();
          close();
        }, editing ? 'تعطیلی ذخیره شد.' : 'تعطیلی افزوده شد.');
      }}
    >
      <div className="body stack">
        <DateField label="تاریخ" value={d} onChange={setD} disabled={date !== null} required testId="hol-date" />
        <TextField label="عنوان" hint="مثلاً «نوروز» یا «تعطیلی کارگاه»؛ اختیاری" value={title} maxLength={120} onChange={setTitle} autoFocus={date !== null} testId="hol-title" />
        {d && weekOff ? <Alert kind="info">{DAY_NAMES[weekday(d)]} در هفته‌ی کاری فعلی تعطیل است؛ ثبت آن اثری روی برنامه ندارد.</Alert> : null}
        {d && !weekOff && !editing && hasHoliday(cal, d) ? <Alert kind="info">این تاریخ قبلاً تعطیل ثبت شده؛ عنوان جایگزین می‌شود.</Alert> : null}
        {d && !weekOff && !editing ? <ImpactNote next={next} /> : null}
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={!d || unchanged} testId="hol-save">
          {editing ? 'ذخیره' : 'افزودن'}
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}
const hasHoliday = (cal: WorkCalendar, d: IsoDate): boolean => cal.holidays.some((h) => h.date === d);

// ───── شبکه‌ی ماه ─────

function MonthGrid({ cal, holidays, canEdit, onPick, status, start, end }: { cal: WorkCalendar; holidays: ReadonlyMap<string, string>; canEdit: boolean; onPick: (d: IsoDate) => void; status: IsoDate; start: IsoDate; end: IsoDate | null }) {
  const j0 = toJalali(status);
  const [ym, setYm] = useState({ y: j0.jy, m: j0.jm });
  const first = fromJalali(ym.y, ym.m, 1);
  const lead = (weekday(first) + 1) % 7; // شنبه = ۰
  const days = daysInJalaliMonth(ym.y, ym.m);
  const today = todayIso();
  const step = (n: number): void => {
    const idx = ym.y * 12 + (ym.m - 1) + n;
    setYm({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="hol-month" data-testid="hol-month">
      <div className="cal-head">
        <button type="button" className="btn ghost icon sm" aria-label="ماه قبل" onClick={() => step(-1)}>
          <Icon name="right" />
        </button>
        <span className="title" aria-live="polite">
          {JALALI_MONTHS[ym.m - 1]} {toPersianDigits(ym.y)}
        </span>
        <button type="button" className="btn ghost icon sm" aria-label="ماه بعد" onClick={() => step(1)}>
          <Icon name="left" />
        </button>
      </div>
      <div className="cal-grid big" role="grid" aria-label="تقویم تعطیلات">
        {DOW_SHORT.map((x) => (
          <span key={x} className="dow">
            {x}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const iso = fromJalali(ym.y, ym.m, d);
          const title = holidays.get(iso);
          const off = !cal.days[weekday(iso)]!.working;
          const marks = [title !== undefined ? `تعطیل${title ? `: ${title}` : ''}` : '', off ? 'تعطیل هفتگی' : '', iso === status ? 'تاریخ وضعیت' : '', iso === start ? 'شروع پروژه' : '', iso === end ? 'پایان قرارداد' : ''].filter(Boolean);
          const cls = ['day', title !== undefined ? 'hol' : '', off ? 'off' : '', iso === today ? 'today' : '', iso === status ? 'status' : '', iso === start || iso === end ? 'edge' : ''].filter(Boolean).join(' ');
          return (
            <button key={iso} type="button" className={cls} disabled={!canEdit} onClick={() => onPick(iso)} aria-label={`${toPersianDigits(d)} ${JALALI_MONTHS[ym.m - 1]} ${toPersianDigits(ym.y)}${marks.length ? ` — ${marks.join('، ')}` : ''}`} title={marks.join('، ') || undefined} data-testid={`day-${iso}`}>
              {toPersianDigits(d)}
            </button>
          );
        })}
      </div>
      <ul className="cal-legend">
        <li>
          <i className="k hol" /> تعطیلی ثبت‌شده
        </li>
        <li>
          <i className="k off" /> تعطیل هفتگی
        </li>
        <li>
          <i className="k status" /> تاریخ وضعیت
        </li>
        <li>
          <i className="k edge" /> شروع / پایان قرارداد
        </li>
      </ul>
      {canEdit ? <p className="small muted" style={{ margin: 0 }}>برای افزودن یا ویرایش تعطیلی روی روز کلیک کنید.</p> : null}
    </div>
  );
}
