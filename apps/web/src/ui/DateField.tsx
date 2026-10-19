import { useEffect, useId, useRef, useState } from 'react';
import { JALALI_MONTHS, daysInJalaliMonth, fromJalali, isIsoDate, toJalali, toPersianDigits, weekday } from '@bistoon/core';
import type { IsoDate } from '@bistoon/core';
import { dateToInput, parseDateInput, todayIso } from '../lib/fmt.ts';
import { Icon } from './icons.tsx';

const DOW = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

export function JalaliCalendar({ value, onPick, holidays }: { value: IsoDate | null; onPick: (iso: IsoDate) => void; holidays?: ReadonlySet<string> }) {
  const base = value && isIsoDate(value) ? value : todayIso();
  const j0 = toJalali(base);
  const [ym, setYm] = useState({ y: j0.jy, m: j0.jm });
  const first = fromJalali(ym.y, ym.m, 1);
  const lead = (weekday(first) + 1) % 7; // شنبه = ۰
  const days = daysInJalaliMonth(ym.y, ym.m);
  const today = todayIso();
  const step = (d: number): void => {
    const idx = ym.y * 12 + (ym.m - 1) + d;
    setYm({ y: Math.floor(idx / 12), m: (idx % 12) + 1 });
  };
  const cells: (number | null)[] = [...Array<null>(lead).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  return (
    <div className="cal">
      <div className="cal-head">
        <button type="button" className="btn ghost icon sm" aria-label="ماه قبل" onClick={() => step(-1)}>
          <Icon name="right" />
        </button>
        <span className="title">
          {JALALI_MONTHS[ym.m - 1]} {toPersianDigits(ym.y)}
        </span>
        <button type="button" className="btn ghost icon sm" aria-label="ماه بعد" onClick={() => step(1)}>
          <Icon name="left" />
        </button>
      </div>
      <div className="cal-grid" role="grid" aria-label="تقویم">
        {DOW.map((d) => (
          <span key={d} className="dow">
            {d}
          </span>
        ))}
        {cells.map((d, i) => {
          if (d === null) return <span key={`e${i}`} />;
          const iso = fromJalali(ym.y, ym.m, d);
          const col = (lead + d - 1) % 7;
          const cls = [iso === today ? 'today' : '', iso === value ? 'sel' : '', col === 6 || holidays?.has(iso) ? 'hol' : ''].filter(Boolean).join(' ');
          return (
            <button key={iso} type="button" className={cls} onClick={() => onPick(iso)} aria-label={`${toPersianDigits(d)} ${JALALI_MONTHS[ym.m - 1]} ${toPersianDigits(ym.y)}`}>
              {toPersianDigits(d)}
            </button>
          );
        })}
      </div>
      <div className="row" style={{ marginTop: 6 }}>
        <button type="button" className="btn sm" onClick={() => onPick(today)}>
          امروز
        </button>
      </div>
    </div>
  );
}

interface Props {
  label: string;
  value: IsoDate | null;
  onChange: (v: IsoDate | null) => void;
  allowEmpty?: boolean;
  disabled?: boolean;
  hint?: string;
  error?: string | null;
  required?: boolean;
  wide?: boolean;
  min?: IsoDate | null;
  max?: IsoDate | null;
  holidays?: ReadonlySet<string>;
  testId?: string;
}

export function DateField(p: Props) {
  const id = useId();
  const [text, setText] = useState(dateToInput(p.value));
  const [local, setLocal] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const last = useRef(p.value);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (p.value !== last.current) {
      last.current = p.value;
      setText(dateToInput(p.value));
      setLocal(null);
    }
  }, [p.value]);

  useEffect(() => {
    if (!open) return;
    const down = (e: MouseEvent): void => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', down);
    document.addEventListener('keydown', key, true);
    return () => {
      document.removeEventListener('mousedown', down);
      document.removeEventListener('keydown', key, true);
    };
  }, [open]);

  const apply = (iso: IsoDate | null): boolean => {
    if (iso === null && !p.allowEmpty) {
      setLocal('تاریخ لازم است.');
      return false;
    }
    if (iso && p.min && iso < p.min) {
      setLocal(`تاریخ باید از ${dateToInput(p.min)} کمتر نباشد.`);
      return false;
    }
    if (iso && p.max && iso > p.max) {
      setLocal(`تاریخ باید از ${dateToInput(p.max)} بیشتر نباشد.`);
      return false;
    }
    setLocal(null);
    last.current = iso;
    p.onChange(iso);
    return true;
  };

  const onText = (t: string): void => {
    setText(t);
    const parsed = parseDateInput(t);
    if (parsed === undefined) setLocal('تاریخ نامعتبر است؛ مثال: ۱۴۰۵/۰۷/۲۸');
    else apply(parsed);
  };

  const err = p.error ?? local;
  return (
    <div className={`field${err ? ' invalid' : ''}${p.wide ? ' wide' : ''}`} ref={box}>
      <label htmlFor={id}>
        {p.label}
        {p.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      <div className="datebox">
        <input id={id} className="in date" dir="ltr" inputMode="numeric" placeholder="۱۴۰۵/۰۱/۰۱" value={text} disabled={p.disabled} aria-invalid={err ? true : undefined} aria-describedby={err ? `${id}-e` : undefined} onChange={(e) => onText(e.target.value)} onBlur={() => local === null && setText(dateToInput(last.current))} data-testid={p.testId} />
        <button type="button" className="btn icon" aria-label={`انتخاب تاریخ: ${p.label}`} disabled={p.disabled} onClick={() => setOpen((o) => !o)}>
          <Icon name="calendar" />
        </button>
        {open && (
          <div className="popover" style={{ insetBlockStart: 'calc(100% + 4px)', insetInlineStart: 0 }}>
            <JalaliCalendar
              value={p.value}
              holidays={p.holidays}
              onPick={(iso) => {
                if (apply(iso)) {
                  setText(dateToInput(iso));
                  setOpen(false);
                }
              }}
            />
          </div>
        )}
      </div>
      {err ? (
        <span className="err" id={`${id}-e`} role="alert">
          {err}
        </span>
      ) : p.hint ? (
        <span className="hint">{p.hint}</span>
      ) : null}
    </div>
  );
}
