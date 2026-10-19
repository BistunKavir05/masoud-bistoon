import { useState } from 'react';
import type { ReactNode } from 'react';
import { apiDelete, apiPatch, apiPost } from '../../api/client.ts';
import { reloadProject, useProjectState } from '../../state/project.ts';
import { Btn, CheckField, Empty, NumberField, SelectField, TextAreaField, TextField, useAction } from '../../ui/controls.tsx';
import { DateField } from '../../ui/DateField.tsx';
import { confirmDialog, openDialog } from '../../ui/dialogs.tsx';

export type RecordBase = { id: number; version: number };
type Versioned = { version: number };

export interface FieldDef<T extends Versioned> {
  key: Extract<keyof T, string>;
  label: string;
  kind: 'text' | 'long' | 'int' | 'num' | 'date' | 'select' | 'bool';
  options?: readonly { value: string; label: string }[];
  /** برای select: گزینه‌ی خالی (مقدار null) */
  emptyLabel?: string;
  required?: boolean;
  min?: number;
  max?: number;
  maxLength?: number;
  wide?: boolean;
  hint?: string;
  /** فقط با این شرط در فرم دیده می‌شود */
  when?: boolean;
}

export interface ColumnDef<T extends Versioned> {
  header: string;
  cell: (row: T) => ReactNode;
  className?: string;
}

/** مشخصات یک فرم ویرایش: برای ردیف‌های یک جدول یا برای یک «تک‌رکورد» (مثل منشور و قرارداد) */
export interface FormSpec<T extends Versioned> {
  path: string;
  noun: string;
  fields: FieldDef<T>[];
  testPrefix: string;
  /** تک‌رکورد: آدرس بدون شناسه و فقط ویرایش (بدون ایجاد) */
  singleton?: boolean;
  /** مقدار اولیه‌ی فرم ایجاد */
  blank?: () => Partial<T>;
  /** افزودن «ریشه‌ی» ثابت به بدنه‌ی ایجاد (مثلاً وضعیت اولیه) */
  createExtra?: Partial<T>;
}

export interface RecordConfig<T extends RecordBase> extends FormSpec<T> {
  columns: ColumnDef<T>[];
  blank: () => Partial<T>;
  canEdit: boolean;
  /** می‌تواند این ردیف را ویرایش/حذف کند؟ (پیش‌فرض: canEdit) */
  canChange?: (row: T) => boolean;
  rowActions?: (row: T, save: (patch: Partial<T>) => Promise<boolean>) => ReactNode;
  titleOf: (row: T) => string;
  emptyHint: string;
}

function isEmpty(v: unknown): boolean {
  return v === null || v === undefined || (typeof v === 'string' && v.trim() === '');
}

function RecordForm<T extends Versioned>({ cfg, row, close }: { cfg: FormSpec<T>; row: T | null; close: () => void }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const fields = cfg.fields.filter((f) => f.when !== false);
  const [vals, setVals] = useState<Record<string, unknown>>(() => {
    const base = row ? ({ ...row } as Record<string, unknown>) : ({ ...(cfg.blank?.() ?? {}) } as Record<string, unknown>);
    return base;
  });
  const { busy, run } = useAction();
  const set = (k: string, v: unknown): void => setVals((s) => ({ ...s, [k]: v }));
  const invalid = fields.some((f) => f.required && isEmpty(vals[f.key]));
  const changedKeys = fields.filter((f) => JSON.stringify(vals[f.key] ?? null) !== JSON.stringify((row as Record<string, unknown> | null)?.[f.key] ?? null)).map((f) => f.key);
  const submit = async (): Promise<void> => {
    const ok = await run(async () => {
      if (row) {
        const patch: Record<string, unknown> = { version: row.version };
        for (const k of changedKeys) patch[k] = normalize(vals[k]);
        await apiPatch(cfg.singleton ? `/projects/${pid}/${cfg.path}` : `/projects/${pid}/${cfg.path}/${(row as unknown as RecordBase).id}`, patch);
      } else {
        const body: Record<string, unknown> = { ...(cfg.createExtra as Record<string, unknown> | undefined) };
        for (const f of fields) if (vals[f.key] !== undefined) body[f.key] = normalize(vals[f.key]);
        await apiPost(`/projects/${pid}/${cfg.path}`, body);
      }
      await reloadProject();
      return true;
    }, row ? 'تغییرات ذخیره شد.' : `${cfg.noun} ثبت شد.`);
    if (ok) close();
  };
  return (
    <form onSubmit={(e) => { e.preventDefault(); if (!invalid && (row === null || changedKeys.length > 0)) void submit(); }}>
      <div className="body form-grid">
        {fields.map((f, i) => {
          const v = vals[f.key];
          const common = { label: f.label, wide: f.wide, required: f.required, hint: f.hint };
          switch (f.kind) {
            case 'text':
              return <TextField key={f.key} {...common} value={String(v ?? '')} maxLength={f.maxLength ?? 300} onChange={(x) => set(f.key, x)} autoFocus={i === 0} testId={`${cfg.testPrefix}-${f.key}`} error={f.required && isEmpty(v) ? 'لازم است.' : null} />;
            case 'long':
              return <TextAreaField key={f.key} {...common} wide value={String(v ?? '')} maxLength={20000} onChange={(x) => set(f.key, x)} />;
            case 'int':
              return <NumberField key={f.key} {...common} value={typeof v === 'number' ? v : null} integer min={f.min} max={f.max} onChange={(x) => set(f.key, x)} />;
            case 'num':
              return <NumberField key={f.key} {...common} value={typeof v === 'number' ? v : null} min={f.min} max={f.max} maxFraction={2} onChange={(x) => set(f.key, x)} />;
            case 'date':
              return <DateField key={f.key} {...common} value={(v as string | null) ?? null} allowEmpty onChange={(x) => set(f.key, x)} />;
            case 'bool':
              return <CheckField key={f.key} label={f.label} hint={f.hint} checked={Boolean(v)} onChange={(x) => set(f.key, x)} />;
            case 'select': {
              const opts = [...(f.emptyLabel ? [{ value: '', label: f.emptyLabel }] : []), ...(f.options ?? [])];
              return <SelectField key={f.key} {...common} value={String(v ?? '')} options={opts} onChange={(x) => set(f.key, x === '' ? null : x)} />;
            }
          }
        })}
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid || (row !== null && changedKeys.length === 0)} testId={`${cfg.testPrefix}-save`}>
          ذخیره
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

/** باز کردن فرم ویرایش (یا ایجاد، وقتی row = null) در گفتگوی درون‌برنامه */
export function openFormDialog<T extends Versioned>(cfg: FormSpec<T>, row: T | null): void {
  void openDialog(row ? `ویرایش ${cfg.noun}` : `${cfg.noun} جدید`, (close) => <RecordForm cfg={cfg} row={row} close={() => close()} />, { wide: true });
}

function normalize(v: unknown): unknown {
  return typeof v === 'string' ? v.trim() : v;
}

export function RecordTable<T extends RecordBase>({ cfg, rows }: { cfg: RecordConfig<T>; rows: readonly T[] }) {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const archived = ps.bundle!.project.archived;
  const { busy, run } = useAction();
  const edit = !archived && cfg.canEdit;

  const openForm = (row: T | null): void => openFormDialog(cfg, row);
  const remove = async (row: T): Promise<void> => {
    const ok = await confirmDialog({ title: `حذف ${cfg.noun}`, danger: true, confirmLabel: 'حذف', message: <>«{cfg.titleOf(row)}» برای همیشه حذف می‌شود (در گزارش تغییرات می‌ماند). ادامه می‌دهید؟</> });
    if (!ok) return;
    await run(async () => {
      await apiDelete(`/projects/${pid}/${cfg.path}/${row.id}`);
      await reloadProject();
    }, `${cfg.noun} حذف شد.`);
  };
  const quickSave = (row: T) => async (patch: Partial<T>): Promise<boolean> => {
    const r = await run(async () => {
      await apiPatch(`/projects/${pid}/${cfg.path}/${row.id}`, { version: row.version, ...patch });
      await reloadProject();
      return true;
    });
    return r === true;
  };

  return (
    <div className="stack">
      {edit ? (
        <div className="row no-print">
          <Btn kind="primary" icon="plus" onClick={() => openForm(null)} testId={`${cfg.testPrefix}-add`}>
            {cfg.noun} جدید
          </Btn>
        </div>
      ) : null}
      {rows.length === 0 ? (
        <div className="card">
          <Empty title={`هنوز ${cfg.noun}ی ثبت نشده است`}>{cfg.emptyHint}</Empty>
        </div>
      ) : (
        <div className="tbl-wrap">
          <table className="tbl" data-testid={`${cfg.testPrefix}-table`}>
            <thead>
              <tr>
                <th className="c">کد</th>
                {cfg.columns.map((c) => (
                  <th key={c.header} className={c.className}>
                    {c.header}
                  </th>
                ))}
                {edit || cfg.rowActions ? <th className="no-print">عملیات</th> : null}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => {
                const may = edit && (cfg.canChange ? cfg.canChange(r) : true);
                return (
                  <tr key={r.id} data-testid={`${cfg.testPrefix}-row-${r.id}`}>
                    <td className="c num muted">{r.id}</td>
                    {cfg.columns.map((c) => (
                      <td key={c.header} className={c.className}>
                        {c.cell(r)}
                      </td>
                    ))}
                    {edit || cfg.rowActions ? (
                      <td className="no-print nowrap">
                        {cfg.rowActions ? cfg.rowActions(r, quickSave(r)) : null}
                        {may ? <Btn size="sm" kind="ghost" iconOnly icon="edit" label={`ویرایش ${cfg.titleOf(r)}`} onClick={() => openForm(r)} disabled={busy} /> : null}
                        {may ? <Btn size="sm" kind="ghost" iconOnly icon="trash" label={`حذف ${cfg.titleOf(r)}`} onClick={() => remove(r)} disabled={busy} /> : null}
                      </td>
                    ) : null}
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
