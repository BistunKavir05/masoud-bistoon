import { useMemo } from 'react';
import { previewCalendarChange } from '@bistoon/core';
import type { WorkCalendar } from '@bistoon/core';
import { faDate, faInt, faNum } from '../../lib/fmt.ts';
import { useProjectState } from '../../state/project.ts';
import { Alert } from '../../ui/controls.tsx';

/** اثر زنده‌ی یک تقویم پیشنهادی بر برنامه: پایان پروژه، فعالیت‌های جابه‌جاشده و ساعت هفتگی. */
export function ImpactNote({ next }: { next: WorkCalendar }) {
  const ps = useProjectState();
  const model = ps.model;
  const impact = useMemo(() => (model ? previewCalendarChange(model, next) : null), [model, next]);
  if (!impact) return null;
  if (!impact.computable) return <Alert kind="warn">اثر بر برنامه محاسبه نشد؛ احتمالاً وابستگی‌ها دور دارند.</Alert>;
  const shift = impact.finishShiftDays ?? 0;
  return (
    <div className="stack" data-testid="calendar-impact">
      <p style={{ margin: 0 }}>
        پایان پروژه: <strong className="num">{faDate(impact.finishBefore)}</strong> ← <strong className="num">{faDate(impact.finishAfter)}</strong>{' '}
        {shift === 0 ? <span className="muted">(بدون تغییر)</span> : <span className={shift > 0 ? 'bad-text' : 'ok-text'}>({faNum(Math.abs(shift))} روز تقویمی {shift > 0 ? 'دیرتر' : 'زودتر'})</span>}
      </p>
      <p style={{ margin: 0 }}>{impact.moved === 0 ? 'تاریخ هیچ فعالیتی جابه‌جا نمی‌شود.' : `تاریخ شروع یا پایان ${faInt(impact.moved)} فعالیت جابه‌جا می‌شود.`}</p>
      {impact.weeklyHoursBefore !== impact.weeklyHoursAfter ? (
        <p className="small muted" style={{ margin: 0 }}>
          ساعت نمایشی هفته: {faNum(impact.weeklyHoursBefore, 1)} ← {faNum(impact.weeklyHoursAfter, 1)}
        </p>
      ) : null}
      {impact.outOfHorizon > 0 ? <Alert kind="warn">{faInt(impact.outOfHorizon)} فعالیت با این تقویم از افق محاسبه (۱۵۰۰ روز تقویمی) بیرون می‌افتد.</Alert> : null}
    </div>
  );
}
