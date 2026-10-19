import { useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createStore, useStore } from '../state/store.ts';
import { Icon } from './icons.tsx';

interface DialogEntry {
  id: number;
  render: (close: (result?: unknown) => void) => ReactNode;
  resolve: (result: unknown) => void;
  title: string;
  wide: boolean;
  dismissible: boolean;
}

const dialogs = createStore<DialogEntry[]>([]);
let nextId = 1;

/** باز کردن دیالوگ داخلی؛ نتیجه با close(result) برمی‌گردد و با Esc/پس‌زمینه undefined است. */
export function openDialog<R = undefined>(title: string, render: (close: (result?: R) => void) => ReactNode, opts: { wide?: boolean; dismissible?: boolean } = {}): Promise<R | undefined> {
  return new Promise((resolve) => {
    const entry: DialogEntry = {
      id: nextId++,
      title,
      render: render as DialogEntry['render'],
      resolve: resolve as (r: unknown) => void,
      wide: opts.wide ?? false,
      dismissible: opts.dismissible ?? true,
    };
    dialogs.set((d) => [...d, entry]);
  });
}

function closeEntry(id: number, result?: unknown): void {
  const entry = dialogs.get().find((d) => d.id === id);
  if (!entry) return;
  dialogs.set((d) => d.filter((x) => x.id !== id));
  entry.resolve(result);
}

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  /** اگر داده شود کاربر باید دقیقاً همین متن را تایپ کند (برای عملیات بسیار خطرناک) */
  typeToConfirm?: string;
}

export function confirmDialog(o: ConfirmOptions): Promise<boolean> {
  return openDialog<boolean>(o.title, (close) => <ConfirmBody o={o} close={close} />).then((r) => r === true);
}

function ConfirmBody({ o, close }: { o: ConfirmOptions; close: (r?: boolean) => void }) {
  const [typed, setTyped] = useState('');
  const ok = o.typeToConfirm === undefined || typed.trim() === o.typeToConfirm;
  return (
    <>
      <div className="body stack">
        <div>{o.message}</div>
        {o.typeToConfirm !== undefined && (
          <div className="field">
            <label htmlFor="confirm-typed">برای تأیید، این متن را دقیقاً بنویسید: <strong>{o.typeToConfirm}</strong></label>
            <input id="confirm-typed" className="in" value={typed} onChange={(e) => setTyped(e.target.value)} autoComplete="off" />
          </div>
        )}
      </div>
      <footer>
        <button type="button" className={`btn ${o.danger ? 'danger solid' : 'primary'}`} disabled={!ok} onClick={() => close(true)}>
          {o.confirmLabel ?? 'تأیید'}
        </button>
        <button type="button" className="btn" onClick={() => close(false)} autoFocus={o.danger}>
          {o.cancelLabel ?? 'انصراف'}
        </button>
      </footer>
    </>
  );
}

export function alertDialog(title: string, message: ReactNode): Promise<void> {
  return openDialog<void>(title, (close) => (
    <>
      <div className="body">{message}</div>
      <footer>
        <button type="button" className="btn primary" onClick={() => close()} autoFocus>
          بسیار خوب
        </button>
      </footer>
    </>
  )).then(() => undefined);
}

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function Modal({ entry }: { entry: DialogEntry }) {
  const ref = useRef<HTMLDivElement>(null);
  const prev = useRef<Element | null>(null);
  useEffect(() => {
    prev.current = document.activeElement;
    const el = ref.current;
    if (el && !el.contains(document.activeElement)) {
      const first = el.querySelector<HTMLElement>('[autofocus], input, select, textarea') ?? el.querySelector<HTMLElement>(FOCUSABLE);
      (first ?? el).focus();
    }
    return () => {
      if (prev.current instanceof HTMLElement) prev.current.focus();
    };
  }, []);
  const onKey = (e: React.KeyboardEvent): void => {
    if (e.key === 'Escape' && entry.dismissible) {
      e.stopPropagation();
      closeEntry(entry.id);
      return;
    }
    if (e.key !== 'Tab' || !ref.current) return;
    const items = [...ref.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((x) => x.offsetParent !== null);
    if (items.length === 0) return;
    const first = items[0]!;
    const last = items[items.length - 1]!;
    if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  };
  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && entry.dismissible && closeEntry(entry.id)}>
      <div ref={ref} className={`dialog${entry.wide ? ' wide' : ''}`} role="dialog" aria-modal="true" aria-label={entry.title} tabIndex={-1} onKeyDown={onKey}>
        <header>
          <h2>{entry.title}</h2>
          {entry.dismissible && (
            <button type="button" className="btn ghost icon sm" aria-label="بستن" onClick={() => closeEntry(entry.id)}>
              <Icon name="x" />
            </button>
          )}
        </header>
        {entry.render((r) => closeEntry(entry.id, r))}
      </div>
    </div>
  );
}

// ───── اعلان‌ها ─────

interface Toast {
  id: number;
  kind: 'info' | 'ok' | 'bad';
  text: string;
}
const toasts = createStore<Toast[]>([]);
let toastId = 1;

function pushToast(kind: Toast['kind'], text: string): void {
  const id = toastId++;
  toasts.set((t) => [...t.slice(-3), { id, kind, text }]);
  setTimeout(() => toasts.set((t) => t.filter((x) => x.id !== id)), kind === 'bad' ? 9000 : 4500);
}
export const toast = {
  info: (t: string) => pushToast('info', t),
  ok: (t: string) => pushToast('ok', t),
  bad: (t: string) => pushToast('bad', t),
};

export function DialogHost() {
  const list = useStore(dialogs, (d) => d);
  const ts = useStore(toasts, (t) => t);
  return (
    <>
      {list.map((e) => (
        <Modal key={e.id} entry={e} />
      ))}
      <div className="toasts" role="status" aria-live="polite">
        {ts.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'info' ? '' : t.kind}`}>
            <span>{t.text}</span>
            <button type="button" aria-label="بستن اعلان" onClick={() => toasts.set((x) => x.filter((y) => y.id !== t.id))}>
              <Icon name="x" size={14} />
            </button>
          </div>
        ))}
      </div>
    </>
  );
}
