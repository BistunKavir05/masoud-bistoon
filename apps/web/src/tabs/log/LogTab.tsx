import { useCallback, useEffect, useMemo, useState } from 'react';
import { toCsv } from '@bistoon/core';
import { apiGet, errorMessage } from '../../api/client.ts';
import { MIME_CSV, downloadFile } from '../../lib/download.ts';
import { ENTITY_LABELS, actionLabel, fieldLabel, flatEntries, formatAuditValue, summarizeAuditValue } from '../../lib/auditLabels.ts';
import { faDateTime, faInt } from '../../lib/fmt.ts';
import { useMembers } from '../../state/members.ts';
import { useProjectState } from '../../state/project.ts';
import { Alert, Btn, Card, Empty, Loading, PageHead, SelectField, TextField } from '../../ui/controls.tsx';
import { openDialog } from '../../ui/dialogs.tsx';

interface Entry {
  id: number;
  at: string;
  actorId: number | null;
  actorName: string;
  action: string;
  entity: string;
  entityId: string;
  field: string;
  oldValue: unknown;
  newValue: unknown;
  ip: string | null;
  requestId: string;
  details: unknown;
}

const PAGE = 100;

function ValueView({ v }: { v: unknown }) {
  const flat = flatEntries(v);
  if (flat && flat.length > 0) {
    return (
      <dl className="audit-kv">
        {flat.map(([k, x]) => (
          <div key={k}>
            <dt>{fieldLabel(k)}</dt>
            <dd dir="auto">{formatAuditValue(x, 300)}</dd>
          </div>
        ))}
      </dl>
    );
  }
  const text = v === null || v === undefined ? '—' : typeof v === 'string' ? v : JSON.stringify(v, null, 2);
  return (
    <pre className="audit-json" dir="auto">
      {text}
    </pre>
  );
}

function Detail({ e, close }: { e: Entry; close: () => void }) {
  return (
    <>
      <div className="body stack">
        <dl className="facts">
          <div>
            <dt>زمان</dt>
            <dd>{faDateTime(e.at)}</dd>
          </div>
          <div>
            <dt>کاربر</dt>
            <dd>{e.actorName || '—'}</dd>
          </div>
          <div>
            <dt>رخداد</dt>
            <dd>{actionLabel(e.action, e.entity)}</dd>
          </div>
          <div>
            <dt>موضوع</dt>
            <dd>
              {ENTITY_LABELS[e.entity] ?? e.entity} {e.entityId}
            </dd>
          </div>
          <div>
            <dt>فیلد</dt>
            <dd>{e.field ? fieldLabel(e.field) : '—'}</dd>
          </div>
          <div>
            <dt>نشانی شبکه (IP)</dt>
            <dd className="num">{e.ip ?? '—'}</dd>
          </div>
          <div className="wide">
            <dt>شناسه‌ی درخواست (برای پیگیری فنی)</dt>
            <dd className="num">{e.requestId || '—'}</dd>
          </div>
        </dl>
        <div className="grid cols-2">
          <div className="field">
            <label>مقدار قبلی</label>
            <ValueView v={e.oldValue} />
          </div>
          <div className="field">
            <label>مقدار جدید</label>
            <ValueView v={e.newValue} />
          </div>
        </div>
        {e.details ? (
          <div className="field">
            <label>جزئیات</label>
            <ValueView v={e.details} />
          </div>
        ) : null}
      </div>
      <footer>
        <Btn kind="primary" onClick={close}>
          بستن
        </Btn>
      </footer>
    </>
  );
}

export function LogTab() {
  const ps = useProjectState();
  const pid = ps.bundle!.project.id;
  const { members } = useMembers(pid);
  const [entity, setEntity] = useState('');
  const [actor, setActor] = useState('');
  const [q, setQ] = useState('');
  const [rows, setRows] = useState<Entry[] | null>(null);
  const [next, setNext] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const query = useCallback(
    (before?: number): string => {
      const p = new URLSearchParams({ limit: String(PAGE) });
      if (entity) p.set('entity', entity);
      if (actor) p.set('actorId', actor);
      if (before) p.set('before', String(before));
      return `/projects/${pid}/audit?${p.toString()}`;
    },
    [pid, entity, actor],
  );

  useEffect(() => {
    const ctl = new AbortController();
    setRows(null);
    setError(null);
    apiGet<{ entries: Entry[]; nextBefore: number | null }>(query(), ctl.signal)
      .then((r) => {
        setRows(r.entries);
        setNext(r.nextBefore);
      })
      .catch((e) => !ctl.signal.aborted && setError(errorMessage(e)));
    return () => ctl.abort();
  }, [query, ps.rev]);

  const more = async (): Promise<void> => {
    if (next === null) return;
    setBusy(true);
    try {
      const r = await apiGet<{ entries: Entry[]; nextBefore: number | null }>(query(next));
      setRows((cur) => [...(cur ?? []), ...r.entries]);
      setNext(r.nextBefore);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!rows || needle === '') return rows ?? [];
    return rows.filter((r) => `${actionLabel(r.action, r.entity)} ${r.actorName} ${r.entityId} ${fieldLabel(r.field)} ${formatAuditValue(r.oldValue, 300)} ${formatAuditValue(r.newValue, 300)}`.toLowerCase().includes(needle));
  }, [rows, q]);

  const exportCsv = (): void => {
    const header = ['زمان', 'کاربر', 'رخداد', 'موضوع', 'شناسه', 'فیلد', 'مقدار قبلی', 'مقدار جدید', 'IP', 'شناسه‌ی درخواست'];
    const body = shown.map((r) => [faDateTime(r.at), r.actorName, actionLabel(r.action, r.entity), ENTITY_LABELS[r.entity] ?? r.entity, r.entityId, r.field ? fieldLabel(r.field) : '', formatAuditValue(r.oldValue, 2000), formatAuditValue(r.newValue, 2000), r.ip ?? '', r.requestId]);
    downloadFile(`audit-${pid}.csv`, toCsv([header, ...body]), MIME_CSV);
  };

  return (
    <>
      <PageHead title="گزارش تغییرات">
        <Btn icon="download" onClick={exportCsv} disabled={shown.length === 0} testId="log-export">
          خروجی CSV
        </Btn>
      </PageHead>
      <Card>
        <div className="stack">
          <div className="row wrap" role="search">
            <div style={{ minWidth: 170 }}>
              <SelectField label="موضوع" value={entity} options={[{ value: '', label: 'همه' }, ...Object.entries(ENTITY_LABELS).map(([value, label]) => ({ value, label }))]} onChange={setEntity} />
            </div>
            <div style={{ minWidth: 190 }}>
              <SelectField label="کاربر" value={actor} options={[{ value: '', label: 'همه' }, ...(members ?? []).map((m) => ({ value: String(m.userId), label: m.displayName }))]} onChange={setActor} />
            </div>
            <div style={{ flex: '1 1 200px' }}>
              <TextField label="جست‌وجو در موارد بارگذاری‌شده" value={q} onChange={setQ} testId="log-search" />
            </div>
          </div>
          {error ? <Alert kind="bad">{error}</Alert> : null}
          {rows === null && !error ? (
            <Loading />
          ) : rows !== null && rows.length === 0 ? (
            <Empty title="رخدادی ثبت نشده است">با این فیلتر هنوز تغییری ثبت نشده است.</Empty>
          ) : (
            <>
              <div className="tbl-wrap" style={{ maxHeight: '64vh', overflow: 'auto' }}>
                <table className="tbl" data-testid="log-table">
                  <thead>
                    <tr>
                      <th>زمان</th>
                      <th>کاربر</th>
                      <th>رخداد</th>
                      <th>موضوع</th>
                      <th>فیلد</th>
                      <th>قبل</th>
                      <th>بعد</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((r) => (
                      <tr key={r.id} data-testid={`log-row-${r.id}`}>
                        <td style={{ whiteSpace: 'nowrap' }}>{faDateTime(r.at)}</td>
                        <td>{r.actorName || '—'}</td>
                        <td>{actionLabel(r.action, r.entity)}</td>
                        <td>
                          {ENTITY_LABELS[r.entity] ?? r.entity} <span className="muted num">{r.entityId}</span>
                        </td>
                        <td>{r.field ? fieldLabel(r.field) : <span className="muted">—</span>}</td>
                        <td className="cell-val" dir="auto">{summarizeAuditValue(r.oldValue)}</td>
                        <td className="cell-val" dir="auto">{summarizeAuditValue(r.newValue)}</td>
                        <td className="c">
                          <Btn size="sm" onClick={() => void openDialog('جزئیات رخداد', (close) => <Detail e={r} close={() => close()} />, { wide: true })} testId={`log-detail-${r.id}`}>
                            جزئیات
                          </Btn>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="row wrap">
                <span className="small muted">
                  {faInt(shown.length)} رخداد نمایش داده شد{q.trim() ? ` (از ${faInt(rows?.length ?? 0)} بارگذاری‌شده)` : ''}.
                </span>
                {next !== null ? (
                  <Btn onClick={more} busy={busy} testId="log-more">
                    رخدادهای قدیمی‌تر
                  </Btn>
                ) : (
                  <span className="small muted">همه‌ی رخدادها بارگذاری شد.</span>
                )}
              </div>
            </>
          )}
        </div>
      </Card>
    </>
  );
}
