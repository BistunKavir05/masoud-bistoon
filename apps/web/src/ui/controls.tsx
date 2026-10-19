import { useEffect, useId, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { toPersianDigits } from '@bistoon/core';
import { ApiError, errorMessage } from '../api/client.ts';
import { reloadProject } from '../state/project.ts';
import { DASH, faNum, parseNumber, parseTime } from '../lib/fmt.ts';
import { toast } from './dialogs.tsx';
import { Icon } from './icons.tsx';
import type { IconName } from './icons.tsx';

// ───── دکمه‌ها ─────

interface BtnProps {
  children?: ReactNode;
  onClick?: () => void | Promise<void>;
  kind?: 'primary' | 'danger' | 'ghost' | 'dangerSolid' | '';
  size?: 'sm' | '';
  icon?: IconName;
  iconOnly?: boolean;
  label?: string;
  disabled?: boolean;
  type?: 'button' | 'submit';
  title?: string;
  busy?: boolean;
  testId?: string;
}

export function Btn({ children, onClick, kind = '', size = '', icon, iconOnly, label, disabled, type = 'button', title, busy, testId }: BtnProps) {
  const cls = ['btn', kind === 'dangerSolid' ? 'danger solid' : kind, size, iconOnly ? 'icon' : ''].filter(Boolean).join(' ');
  return (
    <button type={type} className={cls} disabled={disabled || busy} onClick={onClick ? () => void onClick() : undefined} aria-label={iconOnly ? (label ?? title) : undefined} title={title ?? (iconOnly ? label : undefined)} data-testid={testId}>
      {busy ? <span className="spin" aria-hidden="true" /> : icon ? <Icon name={icon} /> : null}
      {!iconOnly && children}
    </button>
  );
}

// ───── اجرای عملیات با مدیریت خطا ─────

/**
 * اجرای یک عملیات سرور: نشانگر «در حال انجام»، اعلان موفقیت، پیام خطای فارسی.
 * اگر ویرایش هم‌زمان رخ داده باشد، پروژه دوباره خوانده می‌شود تا کاربر آخرین داده را ببیند.
 */
export function useAction(): { busy: boolean; run: <T>(fn: () => Promise<T>, okMessage?: string) => Promise<T | undefined> } {
  const [busy, setBusy] = useState(false);
  const alive = useRef(true);
  useEffect(() => {
    alive.current = true;
    return () => void (alive.current = false);
  }, []);
  const run = async <T,>(fn: () => Promise<T>, okMessage?: string): Promise<T | undefined> => {
    setBusy(true);
    try {
      const r = await fn();
      if (okMessage) toast.ok(okMessage);
      return r;
    } catch (e) {
      toast.bad(errorMessage(e));
      if (e instanceof ApiError && (e.isConflict || e.status === 404)) void reloadProject().catch(() => undefined);
      return undefined;
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return { busy, run };
}

// ───── فیلدها ─────

interface FieldShell {
  label: string;
  hint?: string;
  error?: string | null;
  wide?: boolean;
  required?: boolean;
}

function Shell({ id, f, children }: { id: string; f: FieldShell; children: ReactNode }) {
  return (
    <div className={`field${f.error ? ' invalid' : ''}${f.wide ? ' wide' : ''}`}>
      <label htmlFor={id}>
        {f.label}
        {f.required ? <span aria-hidden="true"> *</span> : null}
      </label>
      {children}
      {f.error ? (
        <span className="err" id={`${id}-err`} role="alert">
          {f.error}
        </span>
      ) : f.hint ? (
        <span className="hint" id={`${id}-hint`}>
          {f.hint}
        </span>
      ) : null}
    </div>
  );
}

const describedBy = (id: string, f: FieldShell): string | undefined => (f.error ? `${id}-err` : f.hint ? `${id}-hint` : undefined);

export function TextField(p: FieldShell & { value: string; onChange: (v: string) => void; disabled?: boolean; maxLength?: number; type?: 'text' | 'password' | 'email' | 'url'; autoComplete?: string; ltr?: boolean; placeholder?: string; autoFocus?: boolean; testId?: string }) {
  const id = useId();
  return (
    <Shell id={id} f={p}>
      <input id={id} className={`in${p.ltr ? ' ltr' : ''}`} dir={p.ltr ? 'ltr' : undefined} type={p.type ?? 'text'} value={p.value} maxLength={p.maxLength} disabled={p.disabled} autoComplete={p.autoComplete ?? 'off'} placeholder={p.placeholder} autoFocus={p.autoFocus} aria-invalid={p.error ? true : undefined} aria-describedby={describedBy(id, p)} onChange={(e) => p.onChange(e.target.value)} data-testid={p.testId} />
    </Shell>
  );
}

export function TextAreaField(p: FieldShell & { value: string; onChange: (v: string) => void; disabled?: boolean; maxLength?: number; rows?: number }) {
  const id = useId();
  return (
    <Shell id={id} f={p}>
      <textarea id={id} className="ta" value={p.value} maxLength={p.maxLength} rows={p.rows ?? 3} disabled={p.disabled} aria-describedby={describedBy(id, p)} onChange={(e) => p.onChange(e.target.value)} />
    </Shell>
  );
}

export function SelectField<V extends string>(p: FieldShell & { value: V; onChange: (v: V) => void; options: readonly { value: V; label: string }[]; disabled?: boolean }) {
  const id = useId();
  return (
    <Shell id={id} f={p}>
      <select id={id} className="sel" value={p.value} disabled={p.disabled} aria-describedby={describedBy(id, p)} onChange={(e) => p.onChange(e.target.value as V)}>
        {p.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </Shell>
  );
}

export function CheckField(p: { label: string; checked: boolean; onChange: (v: boolean) => void; disabled?: boolean; hint?: string }) {
  const id = useId();
  return (
    <div className="field">
      <label className="chk" htmlFor={id}>
        <input id={id} type="checkbox" checked={p.checked} disabled={p.disabled} onChange={(e) => p.onChange(e.target.checked)} />
        {p.label}
      </label>
      {p.hint ? <span className="hint">{p.hint}</span> : null}
    </div>
  );
}

/**
 * ورودی عددی: ارقام فارسی/عربی را می‌پذیرد و عدد لاتین برمی‌گرداند.
 * متن خالی → null. مقدار نامعتبر پیام خطای محلی نشان می‌دهد و onChange صدا زده نمی‌شود.
 */
export function NumberField(p: FieldShell & { value: number | null; onChange: (v: number | null) => void; min?: number; max?: number; integer?: boolean; disabled?: boolean; allowEmpty?: boolean; maxFraction?: number; testId?: string }) {
  const id = useId();
  const show = (n: number | null): string => (n === null ? '' : faNum(n, p.maxFraction ?? 2).replace(/٬/g, ''));
  const [text, setText] = useState(show(p.value));
  const [local, setLocal] = useState<string | null>(null);
  const last = useRef(p.value);
  useEffect(() => {
    if (p.value !== last.current) {
      last.current = p.value;
      setText(show(p.value));
      setLocal(null);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [p.value]);
  const commit = (t: string): void => {
    setText(t);
    if (t.trim() === '') {
      if (p.allowEmpty) {
        setLocal(null);
        last.current = null;
        p.onChange(null);
      } else setLocal('مقدار لازم است.');
      return;
    }
    const n = parseNumber(t);
    if (n === null) return setLocal('عدد معتبر وارد کنید.');
    if (p.integer && !Number.isInteger(n)) return setLocal('عدد صحیح وارد کنید.');
    if (p.min !== undefined && n < p.min) return setLocal(`حداقل ${faNum(p.min)} است.`);
    if (p.max !== undefined && n > p.max) return setLocal(`حداکثر ${faNum(p.max)} است.`);
    setLocal(null);
    last.current = n;
    p.onChange(n);
  };
  const f = { ...p, error: p.error ?? local };
  return (
    <Shell id={id} f={f}>
      <input id={id} className="in num" inputMode="decimal" dir="ltr" value={text} disabled={p.disabled} aria-invalid={f.error ? true : undefined} aria-describedby={describedBy(id, f)} onChange={(e) => commit(e.target.value)} onBlur={() => local === null && setText(show(last.current))} data-testid={p.testId} />
    </Shell>
  );
}

/**
 * ورودی ساعت `HH:mm` مستقل از زبان مرورگر (کنترل بومی `type=time` در برخی زبان‌ها ۱۲ساعته و AM/PM است).
 * ارقام فارسی را می‌پذیرد؛ مقدار نامعتبر پیام می‌دهد و onChange صدا زده نمی‌شود.
 */
export function TimeField(p: FieldShell & { value: string; onChange: (v: string) => void; disabled?: boolean; testId?: string; ariaLabel?: string; compact?: boolean }) {
  const id = useId();
  const [text, setText] = useState(toPersianDigits(p.value));
  const [local, setLocal] = useState<string | null>(null);
  const last = useRef(p.value);
  useEffect(() => {
    if (p.value !== last.current) {
      last.current = p.value;
      setText(toPersianDigits(p.value));
      setLocal(null);
    }
  }, [p.value]);
  const commit = (t: string): void => {
    setText(t);
    const v = parseTime(t);
    if (v === null) return setLocal('ساعت را به قالب ۰۷:۳۰ وارد کنید.');
    setLocal(null);
    last.current = v;
    p.onChange(v);
  };
  const f = { ...p, error: p.error ?? local };
  const input = (
    <input id={id} className="in num" inputMode="numeric" dir="ltr" placeholder="۰۷:۳۰" maxLength={5} value={text} disabled={p.disabled} aria-label={p.ariaLabel} aria-invalid={f.error ? true : undefined} aria-describedby={describedBy(id, f)} onChange={(e) => commit(e.target.value)} onBlur={() => local === null && setText(toPersianDigits(last.current))} data-testid={p.testId} style={p.compact ? { width: 96 } : undefined} />
  );
  return p.compact ? (
    <div className={`time-compact${local ? ' invalid' : ''}`}>
      {input}
      {local ? (
        <span className="err" role="alert">
          {local}
        </span>
      ) : null}
    </div>
  ) : (
    <Shell id={id} f={f}>
      {input}
    </Shell>
  );
}

// ───── نمایش‌ها ─────

export function Badge({ children, kind = '' }: { children: ReactNode; kind?: '' | 'ok' | 'warn' | 'bad' | 'brand' | 'accent' }) {
  return <span className={`badge ${kind}`}>{children}</span>;
}

export function Loading({ text = 'در حال بارگذاری…' }: { text?: string }) {
  return (
    <div className="loading" role="status">
      <span className="spin" aria-hidden="true" />
      {text}
    </div>
  );
}

export function Empty({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="empty">
      <strong>{title}</strong>
      {children}
    </div>
  );
}

export function Alert({ kind = 'info', children }: { kind?: 'info' | 'ok' | 'warn' | 'bad'; children: ReactNode }) {
  return (
    <div className={`alert ${kind}`} role={kind === 'bad' ? 'alert' : undefined}>
      {children}
    </div>
  );
}

export function Card({ title, actions, children, className }: { title?: ReactNode; actions?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`card${className ? ` ${className}` : ''}`}>
      {title || actions ? (
        <div className="card-head">
          {title ? <h2>{title}</h2> : <span className="grow" />}
          {actions}
        </div>
      ) : null}
      {children}
    </section>
  );
}

export function Kpi({ label, value, sub, tone = '' }: { label: string; value: ReactNode; sub?: ReactNode; tone?: '' | 'ok' | 'warn' | 'bad' }) {
  return (
    <div className={`kpi ${tone}`}>
      <span className="l">{label}</span>
      <span className="v">{value}</span>
      {sub ? <span className="s">{sub}</span> : null}
    </div>
  );
}

export function PageHead({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="page-head">
      <h1>{title}</h1>
      {children}
    </div>
  );
}

export function ProgressBar({ actual, planned }: { actual: number; planned?: number | null }) {
  const a = Math.max(0, Math.min(100, Number.isFinite(actual) ? actual : 0));
  return (
    <div className={`progress${planned != null ? ' plan' : ''}`} role="progressbar" aria-valuenow={Math.round(a)} aria-valuemin={0} aria-valuemax={100}>
      <i style={{ width: `${a}%` }} />
      {planned != null ? <b style={{ insetInlineStart: `${Math.max(0, Math.min(100, planned))}%` }} /> : null}
    </div>
  );
}

export function Segmented<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: readonly { value: V; label: string }[]; label: string }) {
  return (
    <div className="seg" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function TabBar<V extends string>({ value, onChange, options, label }: { value: V; onChange: (v: V) => void; options: readonly { value: V; label: string }[]; label: string }) {
  return (
    <div className="tabs" role="tablist" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} role="tab" type="button" aria-selected={o.value === value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export const fa = (n: number | string): string => toPersianDigits(n);
export { DASH };
