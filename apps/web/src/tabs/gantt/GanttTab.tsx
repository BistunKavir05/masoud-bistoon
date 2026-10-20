import { useEffect, useId, useMemo, useRef, useState } from 'react';
import type { MouseEvent } from 'react';
import { baselineIndices } from '@bistoon/core';
import type { TaskDto } from '@bistoon/core';
import { faDate, faInt, faNum, faPct } from '../../lib/fmt.ts';
import { useProjectState } from '../../state/project.ts';
import { Alert, Btn, Card, Empty, PageHead, Segmented } from '../../ui/controls.tsx';
import { Icon } from '../../ui/icons.tsx';
import { buildRows, visibleRows } from '../tasks/rows.ts';
import type { TaskRow } from '../tasks/rows.ts';
import { BAR_H, BASE_H, BASE_Y, HEADER_H, PX_PER_DAY, ROW_H, ZOOM_LABELS, barGeom, barTop, buildLinks, flipX, rowCenter, timeBands } from './layout.ts';
import type { BarGeom, Zoom } from './layout.ts';

const ZOOMS: Zoom[] = ['day', 'week', 'month'];

export function GanttTab() {
  const ps = useProjectState();
  const uid = useId();
  const [zoom, setZoom] = useState<Zoom>('day');
  const [showBase, setShowBase] = useState(true);
  const [showLinks, setShowLinks] = useState(true);
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [selected, setSelected] = useState<number | null>(null);
  const scroller = useRef<HTMLDivElement>(null);
  const b = ps.bundle!;
  const a = ps.analysis;
  const model = ps.model;
  const px = PX_PER_DAY[zoom];

  const rows = useMemo(() => (a && b.tasks ? buildRows(b.tasks, a, model?.resources ?? [], model?.baseline ?? null) : []), [a, b.tasks, model]);
  const shown = useMemo(() => visibleRows(rows, collapsed, '', criticalOnly ? 'critical' : 'all'), [rows, collapsed, criticalOnly]);
  const hasBaseline = model ? Object.keys(model.baseline).length > 0 : false;
  const geoms = useMemo(() => {
    const m = new Map<number, BarGeom>();
    if (!a) return m;
    for (const r of shown) {
      const g = barGeom(r, model?.baseline ?? null, a.schedule.axis, px);
      if (g) m.set(r.t.id, g);
    }
    return m;
  }, [shown, a, model, px]);
  const chartW = a ? a.scurve.length * px : 0;
  const links = useMemo(() => buildLinks(shown, geoms, chartW), [shown, geoms, chartW]);
  const bands = useMemo(() => (a ? timeBands(a.schedule.axis, a.scurve.length, zoom) : { months: [], ticks: [] }), [a, zoom]);

  const statusX = a ? (a.schedule.statusIndex + 1) * px : 0;
  /**
   * نمودار راست‌به‌چپ است: نخستین روز کنار ستون نام‌ها در راست و روزهای بعد به‌سمت چپ. ظرف اسکرول چپ‌به‌راست می‌ماند
   * (scrollLeft همیشه ≥ ۰)؛ تاریخ وضعیت را کمی بیشتر از میانه‌ی بخش نمایان قرار می‌دهیم تا آینده در چپ جا داشته باشد.
   */
  const goStatus = (smooth = true): void => {
    const el = scroller.current;
    if (!el || !a) return;
    const namesW = el.querySelector<HTMLElement>('.gantt-names')?.offsetWidth ?? 0;
    const total = a.scurve.length * px;
    const chartLeft = el.scrollWidth - namesW - total;
    const visible = Math.max(0, el.clientWidth - namesW);
    const target = chartLeft + flipX(total, statusX) - visible * 0.6;
    el.scrollTo({ left: Math.max(0, Math.min(target, el.scrollWidth - el.clientWidth)), behavior: smooth ? 'smooth' : 'auto' });
  };
  // ورود به صفحه یا تغییر بزرگ‌نمایی: تاریخ وضعیت در دید باشد
  useEffect(() => goStatus(false), [zoom, a?.schedule.statusIndex]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!a || !model) {
    return (
      <>
        <PageHead title="گانت" />
        {ps.scheduleFailure ? <Alert kind="bad">وابستگی‌ها دور (حلقه) دارند و برنامه محاسبه نمی‌شود؛ گانت تا اصلاح برنامه در دسترس نیست.</Alert> : <Card><Empty title="گانت در دسترس نیست">نقش شما به برنامه‌ی زمانی دسترسی ندارد.</Empty></Card>}
      </>
    );
  }

  const axis = a.schedule.axis;
  const width = chartW;
  const bodyH = Math.max(ROW_H, shown.length * ROW_H);
  const endX = model.contractEnd ? flipX(width, axis.after(model.contractEnd) * px) : null;
  const sX = flipX(width, statusX);
  const sel = selected !== null ? rows.find((r) => r.t.id === selected) ?? null : null;
  const groupIds = rows.filter((r) => r.hasChildren).map((r) => r.t.id);
  const toggle = (id: number): void =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });

  const onBodyClick = (e: MouseEvent<SVGSVGElement>): void => {
    const r = e.currentTarget.getBoundingClientRect();
    const i = Math.floor((e.clientY - r.top) / ROW_H);
    const row = shown[i];
    if (row) setSelected(row.t.id);
  };

  const hot = (from: number, to: number): boolean => selected !== null && (from === selected || to === selected);

  return (
    <>
      <PageHead title="گانت">
        <Segmented label="بزرگ‌نمایی" value={zoom} onChange={setZoom} options={ZOOMS.map((z) => ({ value: z, label: ZOOM_LABELS[z] }))} />
        <Btn icon="right" onClick={() => goStatus()} testId="gantt-status">
          تاریخ وضعیت
        </Btn>
        {groupIds.length > 0 ? (
          <Btn onClick={() => setCollapsed(collapsed.size > 0 ? new Set() : new Set(groupIds))} testId="gantt-collapse">
            {collapsed.size > 0 ? 'باز کردن همه‌ی گروه‌ها' : 'بستن همه‌ی گروه‌ها'}
          </Btn>
        ) : null}
        <label className="chk">
          <input type="checkbox" checked={criticalOnly} onChange={(e) => setCriticalOnly(e.target.checked)} data-testid="gantt-critical" />
          فقط مسیر بحرانی
        </label>
        <label className="chk">
          <input type="checkbox" checked={showLinks} onChange={(e) => setShowLinks(e.target.checked)} data-testid="gantt-links" />
          ارتباط‌ها
        </label>
        <label className="chk">
          <input type="checkbox" checked={showBase} disabled={!hasBaseline} onChange={(e) => setShowBase(e.target.checked)} data-testid="gantt-base" />
          خط مبنا
        </label>
      </PageHead>

      {!hasBaseline ? <Alert kind="info">خط مبنا ثبت نشده است؛ میله‌های خط مبنا بعد از ثبت آن (در تب «منحنی S») نمایش داده می‌شود.</Alert> : null}

      <div className="stack gap-l">
        {rows.length === 0 ? (
          <Card>
            <Empty title="هنوز فعالیتی تعریف نشده است">در تب «فعالیت‌ها» فعالیت اضافه کنید تا گانت ساخته شود.</Empty>
          </Card>
        ) : shown.length === 0 ? (
          <Card>
            <Empty title="فعالیت بحرانی نیست">با برداشتن «فقط مسیر بحرانی» همه‌ی فعالیت‌ها دیده می‌شود.</Empty>
          </Card>
        ) : (
          <section className="gantt" aria-label="نمودار گانت" data-testid="gantt">
            <div className="gantt-scroll" ref={scroller} data-testid="gantt-scroll">
              <div className="gantt-inner">
                <div className="gantt-chart" style={{ width }}>
                  <svg className="gantt-head" width={width} height={HEADER_H} role="presentation" aria-hidden="true">
                    {bands.months.map((m, i) => (
                      <g key={m.x}>
                        <rect className={`gh-month${i % 2 ? ' alt' : ''}`} x={flipX(width, m.x, m.w)} y={0} width={m.w} height={HEADER_H / 2} />
                        {m.label ? (
                          <text className="gh-text" x={flipX(width, m.x, m.w) + m.w / 2} y={HEADER_H / 4 + 4} textAnchor="middle">
                            {m.label}
                          </text>
                        ) : null}
                      </g>
                    ))}
                    {bands.ticks.map((t) => (
                      <g key={t.x}>
                        <line className="gh-tick" x1={flipX(width, t.x)} x2={flipX(width, t.x)} y1={HEADER_H / 2} y2={HEADER_H} />
                        <text className="gh-text sm" x={flipX(width, t.x) - 3} y={HEADER_H - 8} textAnchor="end">
                          {t.label}
                        </text>
                      </g>
                    ))}
                    <line className="g-status" x1={sX} x2={sX} y1={0} y2={HEADER_H} />
                    <path className="g-status-flag" d={`M${sX - 5},${HEADER_H - 7}h10l-5,7z`} />
                    {endX !== null ? <line className="g-end" x1={endX} x2={endX} y1={0} y2={HEADER_H} /> : null}
                    <line className="gh-base" x1={0} x2={width} y1={HEADER_H - 0.5} y2={HEADER_H - 0.5} />
                  </svg>
                  <svg
                    className="gantt-body"
                    width={width}
                    height={bodyH}
                    viewBox={`0 ${HEADER_H} ${width} ${bodyH}`}
                    role="img"
                    aria-label="میله‌های برنامه‌ی فعالیت‌ها؛ جزئیات هر فعالیت با انتخاب آن در پایین صفحه و در جدول فعالیت‌ها آمده است."
                    onClick={onBodyClick}
                    data-testid="gantt-body"
                  >
                    <defs>
                      <marker id={`${uid}-arr`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M0,0L8,4L0,8z" className="g-arrow" />
                      </marker>
                      <marker id={`${uid}-arr-hot`} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto-start-reverse">
                        <path d="M0,0L8,4L0,8z" className="g-arrow hot" />
                      </marker>
                    </defs>
                    {shown.map((r, i) => (
                      <rect key={r.t.id} className={`g-row${i % 2 ? ' alt' : ''}${selected === r.t.id ? ' sel' : ''}`} x={0} y={HEADER_H + i * ROW_H} width={width} height={ROW_H} />
                    ))}
                    {bands.months.map((m) => (
                      <line key={m.x} className="g-grid" x1={flipX(width, m.x)} x2={flipX(width, m.x)} y1={HEADER_H} y2={HEADER_H + bodyH} />
                    ))}
                    {endX !== null ? <line className="g-end" x1={endX} x2={endX} y1={HEADER_H} y2={HEADER_H + bodyH} /> : null}
                    <line className="g-status" x1={sX} x2={sX} y1={HEADER_H} y2={HEADER_H + bodyH} />

                    {showBase && hasBaseline
                      ? shown.map((r, i) => {
                          const g = geoms.get(r.t.id);
                          if (!g?.base) return null;
                          const y = HEADER_H + i * ROW_H;
                          return g.base.zero ? (
                            <path key={r.t.id} className="g-base" d={`M${flipX(width, g.base.x)},${y + BASE_Y + BASE_H / 2 - 4}l4,4l-4,4l-4,-4z`} />
                          ) : (
                            <rect key={r.t.id} className="g-base" x={flipX(width, g.base.x, g.base.w)} y={y + BASE_Y} width={g.base.w} height={BASE_H} rx={1.5} />
                          );
                        })
                      : null}

                    {showLinks
                      ? links.map((l) => (
                          <path key={l.key} className={`g-link${hot(l.from, l.to) ? ' hot' : selected !== null ? ' dim' : ''}`} d={l.d} markerEnd={`url(#${uid}-arr${hot(l.from, l.to) ? '-hot' : ''})`} />
                        ))
                      : null}

                    {shown.map((r, i) => {
                      const g = geoms.get(r.t.id);
                      if (!g) return null;
                      return <Bar key={r.t.id} r={r} g={g} i={i} total={width} selected={selected === r.t.id} />;
                    })}
                  </svg>
                </div>
                <div className="gantt-names" role="list" aria-label="فعالیت‌ها">
                  <div className="gn-head">فعالیت</div>
                  {shown.map((r) => (
                    <NameRow key={r.t.id} r={r} selected={selected === r.t.id} collapsed={collapsed.has(r.t.id)} onToggle={() => toggle(r.t.id)} onSelect={() => setSelected(r.t.id)} />
                  ))}
                </div>
              </div>
            </div>
            <ul className="gantt-legend" aria-label="راهنمای گانت">
              <li>
                <i className="gl bar" /> برنامه (قسمت پررنگ = انجام‌شده)
              </li>
              <li>
                <i className="gl bar crit" /> مسیر بحرانی
              </li>
              <li>
                <i className="gl sum" /> گروه
              </li>
              <li>
                <i className="gl ms" /> مایلستون
              </li>
              <li>
                <i className="gl base" /> خط مبنا
              </li>
              <li>
                <i className="gl status" /> تاریخ وضعیت
              </li>
              {endX !== null ? (
                <li>
                  <i className="gl end" /> پایان قرارداد
                </li>
              ) : null}
            </ul>
          </section>
        )}

        {sel ? <Details row={sel} rows={rows} /> : shown.length > 0 ? <p className="small muted" style={{ margin: 0 }}>برای دیدن جزئیات و برجسته‌شدن ارتباط‌ها، روی یک فعالیت (نام یا میله) کلیک کنید. زمان در محور افقی از راست به چپ پیش می‌رود و بر حسب روز کاری است (جمعه و تعطیلات حذف می‌شوند).</p> : null}
      </div>
    </>
  );
}

function NameRow({ r, selected, collapsed, onToggle, onSelect }: { r: TaskRow; selected: boolean; collapsed: boolean; onToggle: () => void; onSelect: () => void }) {
  const crit = r.s?.critical === true && (r.s?.percent ?? 0) < 100;
  return (
    <div className={`gn-row${selected ? ' sel' : ''}${r.t.kind === 'summary' ? ' sum' : ''}`} style={{ height: ROW_H, paddingInlineStart: 6 + (r.t.level - 1) * 14 }} role="listitem" data-testid={`gantt-row-${r.t.id}`}>
      {r.hasChildren ? (
        <button type="button" className="gn-toggle" aria-label={collapsed ? `باز کردن گروه ${r.t.name}` : `بستن گروه ${r.t.name}`} aria-expanded={!collapsed} onClick={onToggle}>
          <Icon name={collapsed ? 'left' : 'down'} size={14} />
        </button>
      ) : (
        <span className="gn-toggle" aria-hidden="true" />
      )}
      <button type="button" className="gn-name" aria-pressed={selected} onClick={onSelect} title={r.t.name}>
        <span className="muted num">{r.wbs}</span> <span className={crit ? 'crit' : undefined}>{r.t.name}</span>
      </button>
    </div>
  );
}

function Bar({ r, g, i, total, selected }: { r: TaskRow; g: BarGeom; i: number; total: number; selected: boolean }) {
  const y = barTop(i);
  const s = r.s!;
  const title = `${r.t.name}\n${faDate(s.startDate)} تا ${faDate(s.finishDate)} — ${faInt(s.duration)} روز کاری — ${faPct(s.percent)}`;
  // آغاز میله در راست و پایان آن در چپ است؛ بخش انجام‌شده از لبه‌ی راست (آغاز) پر می‌شود
  const xr = flipX(total, g.x); // لبه‌ی راست = آغاز
  if (g.kind === 'milestone') {
    const cy = rowCenter(i);
    return (
      <path className={`g-ms${g.critical ? ' crit' : ''}${selected ? ' sel' : ''}`} d={`M${xr},${cy - 8}l8,8l-8,8l-8,-8z`}>
        <title>{title}</title>
      </path>
    );
  }
  if (g.kind === 'summary') {
    const h = 7;
    const w = Math.max(g.w, 1);
    return (
      <g className={`g-sum${selected ? ' sel' : ''}`}>
        <title>{title}</title>
        <rect x={xr - w} y={y + 3} width={w} height={h} />
        <path d={`M${xr},${y + 3 + h}l0,6l-6,-6z`} />
        <path d={`M${xr - g.w},${y + 3 + h}l0,6l6,-6z`} />
        {g.doneW > 0 ? <rect className="g-sum-done" x={xr - g.doneW} y={y + 3} width={g.doneW} height={h} /> : null}
      </g>
    );
  }
  const w = Math.max(g.w, 2);
  return (
    <g className={`g-task${g.critical ? ' crit' : ''}${selected ? ' sel' : ''}`}>
      <title>{title}</title>
      <rect className="g-bar" x={xr - w} y={y} width={w} height={BAR_H} rx={3} />
      {g.doneW > 0 ? <rect className="g-done" x={xr - g.doneW} y={y} width={g.doneW} height={BAR_H} rx={3} /> : null}
    </g>
  );
}

function Details({ row, rows }: { row: TaskRow; rows: readonly TaskRow[] }) {
  const ps = useProjectState();
  const a = ps.analysis!;
  const model = ps.model!;
  const t = row.t as TaskDto;
  const s = row.s;
  const name = (id: number): string => rows.find((x) => x.t.id === id)?.t.name ?? `فعالیت ${faInt(id)}`;
  const succ = rows.filter((x) => x.t.dependencies.some((d) => d.predecessorId === t.id));
  const item = model.baseline[t.id];
  const base = item ? baselineIndices(item, a.schedule.axis) : null;
  const finishVar = s && base ? s.earlyFinish - (base.earlyStart + base.duration) : null;
  const startVar = s && base ? s.earlyStart - base.earlyStart : null;
  const dep = (type: string, lag: number): string => `${type}${lag ? (lag > 0 ? `+${faInt(lag)}` : `−${faInt(-lag)}`) : ''}`;
  return (
    <Card title={`${row.wbs} ${t.name}`} className="gantt-details">
      <dl className="facts" data-testid="gantt-details" aria-live="polite">
        <div>
          <dt>شروع</dt>
          <dd>
            <span className="num">{faDate(s?.startDate)}</span>
          </dd>
        </div>
        <div>
          <dt>پایان</dt>
          <dd>
            <span className="num">{faDate(s?.finishDate)}</span>
          </dd>
        </div>
        <div>
          <dt>مدت</dt>
          <dd>{t.kind === 'milestone' || s?.duration === 0 ? 'مایلستون' : `${faInt(s?.duration ?? 0)} روز کاری`}</dd>
        </div>
        <div>
          <dt>پیشرفت</dt>
          <dd>{faPct(s?.percent ?? 0)}</dd>
        </div>
        <div>
          <dt>شناوری کل</dt>
          <dd>{t.kind === 'summary' || t.levelOfEffort ? '—' : (s?.percent ?? 0) >= 100 ? 'تمام‌شده' : s?.critical ? `${faInt(s.totalFloat)} روز کاری (بحرانی)` : `${faInt(s?.totalFloat ?? 0)} روز کاری`}</dd>
        </div>
        <div>
          <dt>نسبت به خط مبنا</dt>
          <dd>
            {base && finishVar !== null && startVar !== null ? (
              <>
                شروع {startVar === 0 ? 'طبق مبنا' : `${faNum(Math.abs(startVar))} روز ${startVar > 0 ? 'دیرتر' : 'زودتر'}`}، پایان {finishVar === 0 ? 'طبق مبنا' : `${faNum(Math.abs(finishVar))} روز ${finishVar > 0 ? 'دیرتر' : 'زودتر'}`}
              </>
            ) : row.afterBaseline ? (
              'بعد از خط مبنا افزوده شده'
            ) : (
              'خط مبنا ندارد'
            )}
          </dd>
        </div>
        <div className="wide">
          <dt>پیش‌نیازها</dt>
          <dd>{t.dependencies.length ? t.dependencies.map((d) => `${name(d.predecessorId)} (${dep(d.type, d.lag)})`).join('، ') : '—'}</dd>
        </div>
        <div className="wide">
          <dt>پس‌نیازها</dt>
          <dd>{succ.length ? succ.map((x) => x.t.name).join('، ') : '—'}</dd>
        </div>
      </dl>
    </Card>
  );
}
