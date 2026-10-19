import { useMemo, useState } from 'react';
import { CHANGE_STATUS_LABELS, CHANGE_STATUSES, DECISION_STATUSES, DECISION_STATUS_LABELS, ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS, ISSUE_STATUSES, ISSUE_STATUS_LABELS, RISK_CATEGORIES, RISK_CATEGORY_LABELS, RISK_LEVEL_LABELS, RISK_PROBABILITY_LABELS, RISK_STATUSES, RISK_STATUS_LABELS, RISK_STRATEGIES, RISK_STRATEGY_LABELS, openRisks, riskLevel, riskScore } from '@bistoon/core';
import type { ChangeRequestDto, DecisionDto, IssueDto, RiskDto, RiskLevel } from '@bistoon/core';
import { faDate, faInt, todayIso } from '../../lib/fmt.ts';
import { useCan, useProjectState } from '../../state/project.ts';
import { sessionStore } from '../../state/session.ts';
import { useStore } from '../../state/store.ts';
import { Alert, Badge, Btn, Card, PageHead, TabBar } from '../../ui/controls.tsx';
import { RecordTable } from './RecordTable.tsx';
import type { RecordConfig } from './RecordTable.tsx';

const opts = <K extends string>(keys: readonly K[], labels: Record<K, string>): { value: K; label: string }[] => keys.map((k) => ({ value: k, label: labels[k] }));
const LEVEL_KIND: Record<RiskLevel, 'bad' | 'warn' | 'accent' | ''> = { critical: 'bad', high: 'warn', medium: 'accent', low: '' };
const dash = (s: string | null | undefined): string => (s && s.trim() ? s : '—');

// ───── ریسک ─────

function riskConfig(canEdit: boolean): RecordConfig<RiskDto> {
  return {
    path: 'risks',
    noun: 'ریسک',
    testPrefix: 'risk',
    canEdit,
    titleOf: (r) => r.title,
    emptyHint: canEdit ? 'با «ریسک جدید» اولین ریسک پروژه را ثبت کنید.' : 'ریسک‌ها را مدیر پروژه ثبت می‌کند.',
    blank: () => ({ title: '', category: null, probability: 3, impact: 3, owner: '', strategy: null, response: '', due: null, status: 'open' }),
    fields: [
      { key: 'title', label: 'عنوان ریسک', kind: 'text', required: true, wide: true },
      { key: 'category', label: 'دسته‌بندی', kind: 'select', options: opts(RISK_CATEGORIES, RISK_CATEGORY_LABELS), emptyLabel: '— بدون دسته —' },
      { key: 'probability', label: 'احتمال (۱ تا ۵)', kind: 'int', min: 1, max: 5, required: true, hint: '۱ خیلی کم … ۵ خیلی زیاد' },
      { key: 'impact', label: 'اثر (۱ تا ۵)', kind: 'int', min: 1, max: 5, required: true },
      { key: 'strategy', label: 'راهبرد پاسخ', kind: 'select', options: opts(RISK_STRATEGIES, RISK_STRATEGY_LABELS), emptyLabel: '— تعیین نشده —' },
      { key: 'owner', label: 'مسئول', kind: 'text', maxLength: 120 },
      { key: 'due', label: 'موعد اقدام', kind: 'date' },
      { key: 'status', label: 'وضعیت', kind: 'select', options: opts(RISK_STATUSES, RISK_STATUS_LABELS) },
      { key: 'response', label: 'اقدام پاسخ', kind: 'long', wide: true },
    ],
    columns: [
      { header: 'ریسک', cell: (r) => <strong>{r.title}</strong> },
      { header: 'دسته', cell: (r) => (r.category ? RISK_CATEGORY_LABELS[r.category] : '—') },
      { header: 'احتمال', className: 'n', cell: (r) => faInt(r.probability) },
      { header: 'اثر', className: 'n', cell: (r) => faInt(r.impact) },
      { header: 'امتیاز', className: 'n', cell: (r) => faInt(riskScore(r)) },
      { header: 'سطح', cell: (r) => <Badge kind={LEVEL_KIND[riskLevel(riskScore(r))]}>{RISK_LEVEL_LABELS[riskLevel(riskScore(r))]}</Badge> },
      { header: 'راهبرد', cell: (r) => (r.strategy ? RISK_STRATEGY_LABELS[r.strategy] : '—') },
      { header: 'مسئول', cell: (r) => dash(r.owner) },
      { header: 'اقدام', cell: (r) => <span className="small">{dash(r.response)}</span> },
      { header: 'موعد', className: 'num', cell: (r) => faDate(r.due) },
      { header: 'وضعیت', cell: (r) => <Badge kind={r.status === 'closed' ? 'ok' : r.status === 'in_progress' ? 'brand' : ''}>{RISK_STATUS_LABELS[r.status]}</Badge> },
    ],
  };
}

const CELL_BG: Record<RiskLevel, string> = { critical: 'var(--bad-soft)', high: 'var(--warn-soft)', medium: 'var(--accent-soft)', low: 'var(--surface-2)' };

/** ماتریس ۵×۵ احتمال × اثر؛ هر خانه تعداد ریسک‌های باز آن را نشان می‌دهد. */
export function RiskMatrix({ risks }: { risks: readonly RiskDto[] }) {
  const open = openRisks(risks);
  const cell = (p: number, i: number): RiskDto[] => open.filter((r) => r.probability === p && r.impact === i);
  return (
    <div role="table" aria-label="ماتریس ریسک" style={{ display: 'grid', gridTemplateColumns: 'auto repeat(5, minmax(44px, 1fr))', gap: 3, maxWidth: 440 }} data-testid="risk-matrix">
      {[5, 4, 3, 2, 1].map((impact) => (
        <div key={impact} style={{ display: 'contents' }} role="row">
          <div className="small muted" style={{ alignSelf: 'center', paddingInlineEnd: 6 }} role="rowheader">
            اثر {faInt(impact)}
          </div>
          {[1, 2, 3, 4, 5].map((prob) => {
            const items = cell(prob, impact);
            const lv = riskLevel(prob * impact);
            return (
              <div key={prob} role="cell" aria-label={items.length ? `${faInt(items.length)} ریسک (${RISK_LEVEL_LABELS[lv]}): ${items.map((r) => r.title).join('، ')}` : `${RISK_LEVEL_LABELS[lv]}، بدون ریسک`} title={items.map((r) => r.title).join('، ') || undefined} style={{ background: CELL_BG[lv], border: '1px solid var(--line)', borderRadius: 4, minHeight: 40, display: 'grid', placeItems: 'center', fontWeight: 700 }}>
                {items.length ? faInt(items.length) : ''}
              </div>
            );
          })}
        </div>
      ))}
      <div />
      {RISK_PROBABILITY_LABELS.map((l, i) => (
        <div key={l} className="small muted" style={{ textAlign: 'center' }} role="columnheader">
          {faInt(i + 1)}
          <br />
          {l}
        </div>
      ))}
    </div>
  );
}

// ───── مسئله ─────

function issueConfig(canEdit: boolean): RecordConfig<IssueDto> {
  return {
    path: 'issues',
    noun: 'مسئله',
    testPrefix: 'issue',
    canEdit,
    titleOf: (r) => r.title,
    emptyHint: canEdit ? 'با «مسئله جدید» مسائل جاری پروژه را ثبت کنید.' : 'مسائل را مدیر پروژه ثبت می‌کند.',
    blank: () => ({ title: '', owner: '', priority: 'medium', due: null, impact: '', action: '', needsDecision: false, status: 'open' }),
    fields: [
      { key: 'title', label: 'عنوان مسئله', kind: 'text', required: true, wide: true },
      { key: 'owner', label: 'مسئول', kind: 'text', maxLength: 120 },
      { key: 'priority', label: 'اولویت', kind: 'select', options: opts(ISSUE_PRIORITIES, ISSUE_PRIORITY_LABELS) },
      { key: 'due', label: 'موعد', kind: 'date' },
      { key: 'status', label: 'وضعیت', kind: 'select', options: opts(ISSUE_STATUSES, ISSUE_STATUS_LABELS) },
      { key: 'needsDecision', label: 'نیاز به تصمیم دارد', kind: 'bool' },
      { key: 'impact', label: 'اثر', kind: 'long', wide: true },
      { key: 'action', label: 'اقدام', kind: 'long', wide: true },
    ],
    columns: [
      { header: 'مسئله', cell: (r) => <strong>{r.title}</strong> },
      { header: 'اولویت', cell: (r) => <Badge kind={r.priority === 'high' ? 'bad' : r.priority === 'medium' ? 'warn' : ''}>{ISSUE_PRIORITY_LABELS[r.priority]}</Badge> },
      { header: 'مسئول', cell: (r) => dash(r.owner) },
      { header: 'اثر', cell: (r) => <span className="small">{dash(r.impact)}</span> },
      { header: 'اقدام', cell: (r) => <span className="small">{dash(r.action)}</span> },
      { header: 'موعد', className: 'num', cell: (r) => faDate(r.due) },
      { header: 'نیاز به تصمیم', className: 'c', cell: (r) => (r.needsDecision ? <Badge kind="warn">بله</Badge> : '—') },
      { header: 'وضعیت', cell: (r) => <Badge kind={r.status === 'resolved' ? 'ok' : r.status === 'in_progress' ? 'brand' : ''}>{ISSUE_STATUS_LABELS[r.status]}</Badge> },
    ],
  };
}

export function RisksTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const [sub, setSub] = useState<'risks' | 'issues'>('risks');
  const edit = can('risks.edit');
  const risks = b.risks ?? [];
  const issues = b.issues ?? [];
  const riskCfg = useMemo(() => riskConfig(edit), [edit]);
  const issueCfg = useMemo(() => issueConfig(edit), [edit]);
  const top = openRisks(risks).sort((a, c) => riskScore(c) - riskScore(a) || a.id - c.id).slice(0, 5);
  const open = issues.filter((i) => i.status !== 'resolved').length;
  return (
    <>
      <PageHead title="ریسک و مسئله" />
      <TabBar label="ریسک یا مسئله" value={sub} onChange={setSub} options={[{ value: 'risks', label: `ریسک‌ها (${faInt(risks.length)})` }, { value: 'issues', label: `مسائل (${faInt(issues.length)}، باز: ${faInt(open)})` }]} />
      {sub === 'risks' ? (
        <div className="stack">
          <div className="grid cols-2">
            <Card title="ماتریس ریسک (ریسک‌های باز)">
              <RiskMatrix risks={risks} />
              <p className="small muted" style={{ marginTop: 8 }}>امتیاز = احتمال × اثر. بحرانی از ۱۵، بالا از ۱۰، متوسط از ۵، وگرنه پایین.</p>
            </Card>
            <Card title="ریسک‌های با اولویت بالا">
              {top.length === 0 ? <p className="muted">ریسک بازی نداریم.</p> : (
                <ol style={{ margin: 0, paddingInlineStart: 20 }}>
                  {top.map((r) => (
                    <li key={r.id}>{r.title} <Badge kind={LEVEL_KIND[riskLevel(riskScore(r))]}>{faInt(riskScore(r))}</Badge></li>
                  ))}
                </ol>
              )}
            </Card>
          </div>
          <RecordTable cfg={riskCfg} rows={risks} />
        </div>
      ) : (
        <RecordTable cfg={issueCfg} rows={issues} />
      )}
    </>
  );
}

// ───── درخواست تغییر ─────

export function ChangesTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const user = useStore(sessionStore, (s) => s.user)!;
  const approve = can('changes.approve');
  const edit = can('risks.edit') || approve;
  const cfg = useMemo<RecordConfig<ChangeRequestDto>>(
    () => ({
      path: 'changes',
      noun: 'درخواست تغییر',
      testPrefix: 'chg',
      canEdit: edit,
      titleOf: (r) => r.title,
      emptyHint: 'تغییر در دامنه، زمان یا هزینه را اینجا ثبت کنید تا تأیید یا رد شود. تأیید به‌تنهایی برنامه را تغییر نمی‌دهد.',
      blank: () => ({ title: '', requester: user.displayName, date: todayIso(), reason: '', impact: '', previousFinish: null, newFinish: null, status: 'pending', approvedBy: '', approvedOn: null }),
      // تا زمان «در انتظار» قابل ویرایش/حذف است؛ مدیر تأییدکننده همیشه می‌تواند
      canChange: (r) => r.status === 'pending' || approve,
      fields: [
        { key: 'title', label: 'عنوان', kind: 'text', required: true, wide: true },
        { key: 'requester', label: 'درخواست‌کننده', kind: 'text', maxLength: 120 },
        { key: 'date', label: 'تاریخ درخواست', kind: 'date' },
        { key: 'reason', label: 'دلیل', kind: 'long', wide: true },
        { key: 'impact', label: 'اثر (زمان، هزینه، دامنه)', kind: 'long', wide: true },
        { key: 'previousFinish', label: 'پایان قبلی', kind: 'date' },
        { key: 'newFinish', label: 'پایان جدید', kind: 'date' },
        { key: 'status', label: 'وضعیت', kind: 'select', options: opts(CHANGE_STATUSES, CHANGE_STATUS_LABELS), when: approve },
        { key: 'approvedBy', label: 'تأییدکننده', kind: 'text', maxLength: 120, when: approve },
        { key: 'approvedOn', label: 'تاریخ تأیید', kind: 'date', when: approve },
      ],
      columns: [
        { header: 'عنوان', cell: (r) => <strong>{r.title}</strong> },
        { header: 'درخواست‌کننده', cell: (r) => dash(r.requester) },
        { header: 'تاریخ', className: 'num', cell: (r) => faDate(r.date) },
        { header: 'دلیل', cell: (r) => <span className="small">{dash(r.reason)}</span> },
        { header: 'اثر', cell: (r) => <span className="small">{dash(r.impact)}</span> },
        { header: 'پایان قبلی', className: 'num', cell: (r) => faDate(r.previousFinish) },
        { header: 'پایان جدید', className: 'num', cell: (r) => faDate(r.newFinish) },
        { header: 'وضعیت', cell: (r) => <Badge kind={r.status === 'approved' ? 'ok' : r.status === 'rejected' ? 'bad' : 'warn'}>{CHANGE_STATUS_LABELS[r.status]}</Badge> },
        { header: 'تأیید', cell: (r) => (r.approvedBy ? `${r.approvedBy} — ${faDate(r.approvedOn)}` : '—') },
      ],
      rowActions: (r, save) =>
        approve && r.status === 'pending' ? (
          <>
            <Btn size="sm" kind="primary" onClick={async () => void (await save({ status: 'approved', approvedBy: user.displayName, approvedOn: todayIso() }))} testId={`chg-approve-${r.id}`}>
              تأیید
            </Btn>{' '}
            <Btn size="sm" kind="danger" onClick={async () => void (await save({ status: 'rejected', approvedBy: user.displayName, approvedOn: todayIso() }))} testId={`chg-reject-${r.id}`}>
              رد
            </Btn>{' '}
          </>
        ) : null,
    }),
    [edit, approve, user.displayName],
  );
  return (
    <>
      <PageHead title="درخواست تغییر" />
      <Alert kind="info">تأیید درخواست تغییر، خودکار برنامه یا پایان قرارداد را عوض نمی‌کند. اگر پذیرفته شد، تغییر زمان‌بندی را جداگانه و با ثبت در گزارش تغییرات انجام دهید.</Alert>
      <div style={{ height: 12 }} />
      <RecordTable cfg={cfg} rows={b.changes ?? []} />
      {!approve ? <p className="small muted" style={{ marginTop: 8 }}>تأیید یا رد با مدیریت یا ادمین است.</p> : null}
    </>
  );
}

// ───── تصمیم ─────

export function DecisionsTab() {
  const ps = useProjectState();
  const can = useCan();
  const b = ps.bundle!;
  const edit = can('risks.edit') || can('changes.approve');
  const cfg = useMemo<RecordConfig<DecisionDto>>(
    () => ({
      path: 'decisions',
      noun: 'تصمیم',
      testPrefix: 'dec',
      canEdit: edit,
      titleOf: (r) => r.topic,
      emptyHint: 'تصمیم‌های مدیریتی پروژه را با موضوع، تصمیم‌گیرنده و وضعیت ثبت کنید.',
      blank: () => ({ topic: '', text: '', maker: '', date: todayIso(), status: 'pending' }),
      fields: [
        { key: 'topic', label: 'موضوع', kind: 'text', required: true, wide: true },
        { key: 'text', label: 'متن تصمیم', kind: 'long', wide: true },
        { key: 'maker', label: 'تصمیم‌گیرنده', kind: 'text', maxLength: 120 },
        { key: 'date', label: 'تاریخ', kind: 'date' },
        { key: 'status', label: 'وضعیت', kind: 'select', options: opts(DECISION_STATUSES, DECISION_STATUS_LABELS) },
      ],
      columns: [
        { header: 'موضوع', cell: (r) => <strong>{r.topic}</strong> },
        { header: 'متن تصمیم', cell: (r) => <span className="small">{dash(r.text)}</span> },
        { header: 'تصمیم‌گیرنده', cell: (r) => dash(r.maker) },
        { header: 'تاریخ', className: 'num', cell: (r) => faDate(r.date) },
        { header: 'وضعیت', cell: (r) => <Badge kind={r.status === 'implemented' ? 'ok' : r.status === 'decided' ? 'brand' : 'warn'}>{DECISION_STATUS_LABELS[r.status]}</Badge> },
      ],
    }),
    [edit],
  );
  const pending = (b.decisions ?? []).filter((d) => d.status === 'pending').length;
  return (
    <>
      <PageHead title="تصمیم‌ها">
        <span className="muted small">{faInt(pending)} تصمیم در انتظار</span>
      </PageHead>
      <RecordTable cfg={cfg} rows={b.decisions ?? []} />
    </>
  );
}
