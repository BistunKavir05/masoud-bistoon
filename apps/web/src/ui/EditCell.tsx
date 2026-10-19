import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { faNum, parseNumber } from '../lib/fmt.ts';

interface Props {
  /** متن نمایشی در حالت عادی */
  display: ReactNode;
  value: string | number;
  editable: boolean;
  kind: 'text' | 'number';
  min?: number;
  max?: number;
  integer?: boolean;
  maxLength?: number;
  label: string;
  /** برگرداندن false یعنی ذخیره نشد و ویرایش باز بماند */
  onCommit: (value: string | number) => Promise<boolean | void> | boolean | void;
  align?: 'start' | 'end';
}

/** سلول جدول با ویرایش درجا: کلیک یا Enter، ثبت با Enter یا خروج، لغو با Esc. */
export function EditCell(p: Props) {
  const [editing, setEditing] = useState(false);
  const [text, setText] = useState('');
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const done = useRef(false);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  if (!p.editable) return <span>{p.display}</span>;

  const open = (): void => {
    done.current = false;
    setText(p.kind === 'number' ? faNum(Number(p.value), 4).replace(/٬/g, '') : String(p.value));
    setErr(null);
    setEditing(true);
  };

  const commit = async (): Promise<void> => {
    if (done.current) return;
    let v: string | number;
    if (p.kind === 'number') {
      const n = parseNumber(text);
      if (n === null) return setErr('عدد معتبر وارد کنید.');
      if (p.integer && !Number.isInteger(n)) return setErr('عدد صحیح وارد کنید.');
      if (p.min !== undefined && n < p.min) return setErr(`حداقل ${faNum(p.min)}`);
      if (p.max !== undefined && n > p.max) return setErr(`حداکثر ${faNum(p.max)}`);
      v = n;
    } else {
      v = text.trim();
      if (v === '') return setErr('خالی نمی‌شود.');
    }
    if (v === p.value) {
      done.current = true;
      setEditing(false);
      return;
    }
    done.current = true;
    setBusy(true);
    try {
      const r = await p.onCommit(v);
      if (r === false) {
        done.current = false;
        return;
      }
      setEditing(false);
    } finally {
      setBusy(false);
    }
  };

  if (!editing) {
    return (
      <span
        role="button"
        tabIndex={0}
        className="editable"
        style={{ cursor: 'text', display: 'inline-block', minWidth: 24, borderBottom: '1px dashed var(--line-strong)' }}
        aria-label={`ویرایش ${p.label}`}
        onClick={open}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === 'F2') {
            e.preventDefault();
            open();
          }
        }}
      >
        {p.display}
      </span>
    );
  }
  return (
    <span style={{ display: 'inline-flex', flexDirection: 'column' }}>
      <input
        ref={input}
        className="in"
        style={{ minHeight: 28, padding: '1px 6px', width: p.kind === 'number' ? 72 : 220, textAlign: p.align ?? 'start' }}
        dir={p.kind === 'number' ? 'ltr' : undefined}
        inputMode={p.kind === 'number' ? 'decimal' : undefined}
        aria-label={p.label}
        aria-invalid={err ? true : undefined}
        maxLength={p.maxLength}
        value={text}
        disabled={busy}
        onChange={(e) => {
          setText(e.target.value);
          setErr(null);
        }}
        onBlur={() => void commit()}
        onKeyDown={(e) => {
          if (e.key === 'Enter') {
            e.preventDefault();
            void commit();
          } else if (e.key === 'Escape') {
            e.stopPropagation();
            done.current = true;
            setEditing(false);
          }
        }}
      />
      {err ? (
        <span className="err" role="alert" style={{ fontSize: 11.5, color: 'var(--bad)' }}>
          {err}
        </span>
      ) : null}
    </span>
  );
}
