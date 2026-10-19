import { useMemo, useState } from 'react';
import { DOCUMENT_TYPES, DOCUMENT_TYPE_LABELS, wbsMap } from '@bistoon/core';
import type { DocumentDto, DocumentType, IsoDate } from '@bistoon/core';
import { apiDelete, apiPatch, apiPost } from '../../api/client.ts';
import { faDate, faInt, isSafeUrl } from '../../lib/fmt.ts';
import { reloadProject, useCan, useProjectState } from '../../state/project.ts';
import { Alert, Badge, Btn, Card, Empty, PageHead, SelectField, TextField, useAction } from '../../ui/controls.tsx';
import { DateField } from '../../ui/DateField.tsx';
import { confirmDialog, openDialog } from '../../ui/dialogs.tsx';

const TYPE_OPTIONS = DOCUMENT_TYPES.map((v) => ({ value: v, label: DOCUMENT_TYPE_LABELS[v] }));

function host(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function DocForm({ row, close }: { row: DocumentDto | null; close: () => void }) {
  const ps = useProjectState();
  const b = ps.bundle!;
  const pid = b.project.id;
  const tasks = b.tasks ?? [];
  const wbs = useMemo(() => wbsMap(tasks), [tasks]);
  const [title, setTitle] = useState(row?.title ?? '');
  const [url, setUrl] = useState(row?.url ?? '');
  const [type, setType] = useState<DocumentType>(row?.type ?? 'other');
  const [taskId, setTaskId] = useState<string>(row?.taskId === null || row?.taskId === undefined ? '' : String(row.taskId));
  const [date, setDate] = useState<IsoDate | null>(row?.date ?? null);
  const { busy, run } = useAction();
  const urlBad = url.trim() === '' ? 'نشانی لازم است.' : !isSafeUrl(url.trim()) ? 'نشانی باید با http:// یا https:// شروع شود.' : null;
  const invalid = title.trim() === '' || urlBad !== null;
  const patch = (): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    if (!row || title.trim() !== row.title) out.title = title.trim();
    if (!row || url.trim() !== row.url) out.url = url.trim();
    if (!row || type !== row.type) out.type = type;
    const tid = taskId === '' ? null : Number(taskId);
    if (!row || tid !== row.taskId) out.taskId = tid;
    if (!row || date !== row.date) out.date = date;
    return out;
  };
  const changed = Object.keys(patch()).length > 0;
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        if (invalid || !changed) return;
        void run(async () => {
          if (row) await apiPatch(`/projects/${pid}/documents/${row.id}`, patch());
          else await apiPost(`/projects/${pid}/documents`, patch());
          await reloadProject();
          close();
        }, row ? 'سند ذخیره شد.' : 'سند افزوده شد.');
      }}
    >
      <div className="body form-grid">
        <TextField label="عنوان" required wide value={title} maxLength={200} onChange={setTitle} autoFocus testId="doc-title" />
        <TextField label="نشانی (لینک)" required wide ltr hint="فقط لینک http یا https؛ فایل در سرور پروژه ذخیره نمی‌شود." value={url} maxLength={2000} onChange={setUrl} error={url !== '' ? urlBad : null} placeholder="https://…" testId="doc-url" />
        <SelectField label="نوع" value={type} options={TYPE_OPTIONS} onChange={setType} />
        {tasks.length > 0 ? (
          <SelectField
            label="فعالیت مرتبط"
            value={taskId}
            options={[{ value: '', label: 'بدون فعالیت' }, ...tasks.map((t) => ({ value: String(t.id), label: `${wbs.get(t.id) ?? ''} ${t.name}` }))]}
            onChange={setTaskId}
          />
        ) : null}
        <DateField label="تاریخ سند" value={date} allowEmpty onChange={setDate} />
      </div>
      <footer>
        <Btn type="submit" kind="primary" busy={busy} disabled={invalid || !changed} testId="doc-save">
          {row ? 'ذخیره' : 'افزودن'}
        </Btn>
        <Btn onClick={close}>انصراف</Btn>
      </footer>
    </form>
  );
}

export function DocsTab() {
  const ps = useProjectState();
  const can = useCan();
  const { busy, run } = useAction();
  const b = ps.bundle!;
  const docs = b.documents ?? [];
  const canEdit = can('documents.edit') && !b.project.archived;
  const [q, setQ] = useState('');
  const [type, setType] = useState<'all' | DocumentType>('all');
  const [task, setTask] = useState('all');
  const wbs = useMemo(() => wbsMap(b.tasks ?? []), [b.tasks]);
  const taskName = (id: number | null): string | null => {
    if (id === null) return null;
    const t = b.tasks?.find((x) => x.id === id);
    return t ? `${wbs.get(id) ?? ''} ${t.name}` : `فعالیت ${faInt(id)}`;
  };
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return docs
      .filter((d) => (type === 'all' || d.type === type) && (task === 'all' || (task === 'none' ? d.taskId === null : String(d.taskId) === task)) && (needle === '' || d.title.toLowerCase().includes(needle) || d.url.toLowerCase().includes(needle)))
      .sort((x, y) => (y.date ?? '').localeCompare(x.date ?? '') || y.id - x.id);
  }, [docs, q, type, task]);
  const taskOptions = useMemo(() => {
    const ids = [...new Set(docs.map((d) => d.taskId).filter((x): x is number => x !== null))];
    return [{ value: 'all', label: 'همه‌ی فعالیت‌ها' }, { value: 'none', label: 'بدون فعالیت' }, ...ids.map((id) => ({ value: String(id), label: taskName(id) ?? '' }))];
  }, [docs, b.tasks]); // eslint-disable-line react-hooks/exhaustive-deps

  const open = (row: DocumentDto | null): void => void openDialog(row ? 'ویرایش سند' : 'افزودن سند', (close) => <DocForm row={row} close={() => close()} />);
  const remove = async (d: DocumentDto): Promise<void> => {
    const ok = await confirmDialog({ title: 'حذف سند', message: `سند «${d.title}» از فهرست حذف شود؟ فقط پیوند حذف می‌شود؛ فایل اصلی دست‌نخورده می‌ماند.`, confirmLabel: 'حذف شود', danger: true });
    if (!ok) return;
    await run(async () => {
      await apiDelete(`/projects/${b.project.id}/documents/${d.id}`);
      await reloadProject();
    }, 'سند حذف شد.');
  };

  return (
    <>
      <PageHead title="مستندات">
        {canEdit ? (
          <Btn icon="plus" kind="primary" onClick={() => open(null)} testId="doc-add">
            افزودن سند
          </Btn>
        ) : null}
      </PageHead>
      <Card>
        {docs.length === 0 ? (
          <Empty title="هنوز سندی ثبت نشده است">{canEdit ? 'لینک قرارداد، نقشه، صورتجلسه و گزارش‌های پروژه را با «افزودن سند» ثبت کنید.' : 'سندی برای این پروژه ثبت نشده است.'}</Empty>
        ) : (
          <div className="stack">
            <div className="row wrap" role="search">
              <div style={{ flex: '1 1 220px' }}>
                <TextField label="جست‌وجو در عنوان و نشانی" value={q} onChange={setQ} testId="doc-search" />
              </div>
              <div style={{ minWidth: 160 }}>
                <SelectField label="نوع" value={type} options={[{ value: 'all' as const, label: 'همه' }, ...TYPE_OPTIONS]} onChange={setType} />
              </div>
              {b.tasks ? (
                <div style={{ minWidth: 200 }}>
                  <SelectField label="فعالیت" value={task} options={taskOptions} onChange={setTask} />
                </div>
              ) : null}
            </div>
            <div className="tbl-wrap">
              <table className="tbl" data-testid="doc-table">
                <thead>
                  <tr>
                    <th>عنوان</th>
                    <th>نوع</th>
                    {b.tasks ? <th>فعالیت</th> : null}
                    <th>تاریخ</th>
                    <th>افزوده‌شده توسط</th>
                    {canEdit ? <th /> : null}
                  </tr>
                </thead>
                <tbody>
                  {shown.length === 0 ? (
                    <tr className="empty-row">
                      <td colSpan={6}>سندی با این فیلتر پیدا نشد.</td>
                    </tr>
                  ) : (
                    shown.map((d) => (
                      <tr key={d.id} data-testid={`doc-row-${d.id}`}>
                        <td>
                          {isSafeUrl(d.url) ? (
                            <a href={d.url} target="_blank" rel="noopener noreferrer">
                              {d.title}
                            </a>
                          ) : (
                            <>
                              {d.title} <Badge kind="bad">نشانی نامعتبر</Badge>
                            </>
                          )}
                          <div className="small muted ltr" style={{ textAlign: 'start' }}>
                            {host(d.url)}
                          </div>
                        </td>
                        <td>
                          <Badge>{DOCUMENT_TYPE_LABELS[d.type]}</Badge>
                        </td>
                        {b.tasks ? <td>{taskName(d.taskId) ?? <span className="muted">—</span>}</td> : null}
                        <td>
                          <span className="num">{faDate(d.date)}</span>
                        </td>
                        <td>{d.addedBy || '—'}</td>
                        {canEdit ? (
                          <td className="c" style={{ whiteSpace: 'nowrap' }}>
                            <Btn size="sm" iconOnly icon="edit" label={`ویرایش ${d.title}`} onClick={() => open(d)} testId={`doc-edit-${d.id}`} />{' '}
                            <Btn size="sm" kind="danger" iconOnly icon="trash" label={`حذف ${d.title}`} busy={busy} onClick={() => remove(d)} testId={`doc-del-${d.id}`} />
                          </td>
                        ) : null}
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
            <p className="small muted" style={{ margin: 0 }}>
              {faInt(shown.length)} از {faInt(docs.length)} سند. پیوندها در زبانه‌ی تازه باز می‌شوند.
            </p>
          </div>
        )}
      </Card>
      {docs.some((d) => !isSafeUrl(d.url)) ? <Alert kind="warn">برخی اسناد نشانی معتبر (http/https) ندارند و به‌عنوان لینک نمایش داده نمی‌شوند؛ آن‌ها را ویرایش کنید.</Alert> : null}
    </>
  );
}
