import { useMemo, useState } from 'react';
import { previewBaseline } from '@bistoon/core';
import type { BaselineBuildIssue, BaselineSummary } from '@bistoon/core';
import { apiPost } from '../../api/client.ts';
import { DASH, faDate, faInt, faMoney } from '../../lib/fmt.ts';
import { reloadProject, useProjectState } from '../../state/project.ts';
import { Alert, Btn, TextField, useAction } from '../../ui/controls.tsx';
import { alertDialog, openDialog } from '../../ui/dialogs.tsx';

function Cell({ s, unit }: { s: BaselineSummary | null; unit: string }) {
  return s ? (
    <>
      <td className="n">{faInt(s.tasks)}</td>
      <td className="n">
        <span className="num">{faDate(s.finish)}</span>
      </td>
      <td className="n">{faMoney(s.bac, unit)}</td>
    </>
  ) : (
    <>
      <td className="n">{DASH}</td>
      <td className="n">{DASH}</td>
      <td className="n">{DASH}</td>
    </>
  );
}

function BaselineForm({ close }: { close: (r?: BaselineBuildIssue[]) => void }) {
  const ps = useProjectState();
  const b = ps.bundle!;
  const model = ps.model!;
  const schedule = ps.analysis!.schedule;
  const [label, setLabel] = useState('');
  const { busy, run } = useAction();
  const impact = useMemo(() => previewBaseline({ tasks: model.tasks, schedule, resources: model.resources, current: model.baseline }), [model, schedule]);
  const unit = b.project.finance.unit;
  const { before, after } = impact;
  // تفاوت پایان برنامه‌ای (روز کاری)؛ مثبت = پایان جدید دیرتر
  const shift = before?.finish && after.finish ? schedule.axis.onOrAfter(after.finish) - schedule.axis.onOrAfter(before.finish) : 0;

  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void run(async () => {
          const r = await apiPost<{ issues: BaselineBuildIssue[] }>(`/projects/${b.project.id}/baseline`, { label: label.trim() });
          await reloadProject();
          close(r.issues);
        }, 'خط مبنا ثبت شد.');
      }}
    >
      <div className="body stack">
        {before ? (
          <Alert kind="warn">
            خط مبنای فعلی بایگانی می‌شود و از این پس «پیشرفت برنامه‌ای»، تأخیر و شاخص‌های مالی نسبت به خط مبنای جدید سنجیده می‌شوند. این کار برگشت‌پذیر نیست؛ خط مبنای بایگانی‌شده فقط قابل مشاهده است.
          </Alert>
        ) : (
          <Alert kind="info">این اولین خط مبنای پروژه است. تاریخ‌ها و هزینه‌ی برآوردیِ فعلی هر فعالیت به‌عنوان مبنا ثبت می‌شود.</Alert>
        )}
        <TextField label="عنوان خط مبنا" hint="مثلاً «مبنای اولیه» یا «پس از الحاقیه ۱»؛ اختیاری" value={label} maxLength={120} onChange={setLabel} autoFocus testId="baseline-label" />
        <div className="tbl-wrap">
          <table className="tbl" data-testid="baseline-impact">
            <thead>
              <tr>
                <th />
                <th className="n">فعالیت‌ها</th>
                <th className="n">پایان برنامه‌ای</th>
                <th className="n">بودجه‌ی مبنا (BAC)</th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <th>خط مبنای فعلی</th>
                <Cell s={before} unit={unit} />
              </tr>
              <tr>
                <th>خط مبنای جدید</th>
                <Cell s={after} unit={unit} />
              </tr>
            </tbody>
          </table>
        </div>
        {before ? (
          <p className="small muted" style={{ margin: 0 }}>
            نسبت به خط مبنای فعلی: {faInt(impact.changed)} فعالیت تغییر کرده، {faInt(impact.added)} فعالیت تازه و {faInt(impact.removed)} فعالیت حذف‌شده است.
          </p>
        ) : null}
        {shift > 0 ? <Alert kind="warn">پایان برنامه‌ای {faInt(shift)} روز کاری دیرتر می‌شود؛ این تأخیر پس از ثبت دیگر در شاخص «تأخیر نسبت به خط مبنا» دیده نمی‌شود.</Alert> : null}
        {shift < 0 ? <Alert kind="info">پایان برنامه‌ای {faInt(-shift)} روز کاری زودتر می‌شود.</Alert> : null}
        {impact.issues.length > 0 ? <Alert kind="warn">{faInt(impact.issues.length)} فعالیت تاریخی بیرون از افق محاسبه دارند و در خط مبنا نمی‌آیند.</Alert> : null}
        <p className="small muted" style={{ margin: 0 }}>گزارش‌های پیشرفتِ ثبت‌شده‌ی قبلی دست‌نخورده می‌مانند و درصد برنامه‌ایِ همان زمان را نگه می‌دارند.</p>
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} testId="baseline-submit">
          {before ? 'ثبت خط مبنای جدید' : 'ثبت خط مبنا'}
        </Btn>
        <Btn onClick={() => close()}>انصراف</Btn>
      </footer>
    </form>
  );
}

/** دیالوگ تعریف/بازتعریف خط مبنا با پیش‌نمایش اثر؛ مشکلات ساخت (فعالیت‌های خارج از افق) را بعد از ثبت اعلام می‌کند. */
export async function openBaselineDialog(taskName: (id: number) => string): Promise<void> {
  const issues = await openDialog<BaselineBuildIssue[]>('تعریف خط مبنا', (close) => <BaselineForm close={close} />, { wide: true });
  if (issues && issues.length > 0) {
    await alertDialog(
      'برخی فعالیت‌ها در خط مبنا نیامدند',
      <ul style={{ margin: 0, paddingInlineStart: 20 }}>
        {issues.map((i) => (
          <li key={i.taskId}>
            {taskName(i.taskId)}: {i.message}
          </li>
        ))}
      </ul>,
    );
  }
}
