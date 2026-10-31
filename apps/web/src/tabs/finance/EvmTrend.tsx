import { useMemo } from 'react';
import { computeEvmTrend, snapshotTaskProgress, buildSnapshotRows, toJalali, toPersianDigits } from '@bistoon/core';
import type { EvmPoint, IsoDate } from '@bistoon/core';
import { faDate, faNum, faPct, faRatio } from '../../lib/fmt.ts';
import { useProjectState } from '../../state/project.ts';
import { Badge, Card, Empty } from '../../ui/controls.tsx';

const W = 900;
const H = 260;
const M = { l: 78, r: 16, t: 14, b: 34 };

/** عدد کوتاه‌شده برای محور (میلیارد/میلیون/هزار) تا برچسب‌ها جا بگیرند؛ مقدار دقیق در جدول است */
function compact(n: number): string {
  const a = Math.abs(n);
  if (a >= 1e9) return `${faNum(n / 1e9, 1)} میلیارد`;
  if (a >= 1e6) return `${faNum(n / 1e6, 1)} میلیون`;
  if (a >= 1e3) return `${faNum(n / 1e3, 1)} هزار`;
  return faNum(n);
}

const shortDate = (iso: IsoDate): string => {
  const j = toJalali(iso);
  return toPersianDigits(`${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
};

/** نمودار خطی PV، EV و AC در گزارش‌های پیشرفت؛ محور افقی به ترتیب گزارش‌هاست (فاصله‌ی برابر)، نه مقیاس زمان */
function TrendChart({ points }: { points: readonly EvmPoint[] }) {
  const maxY = Math.max(1, ...points.map((p) => Math.max(p.pv, p.ev, p.ac ?? 0)));
  const px = (i: number): number => M.l + (points.length <= 1 ? 0.5 : i / (points.length - 1)) * (W - M.l - M.r);
  const py = (v: number): number => M.t + (1 - v / maxY) * (H - M.t - M.b);
  const line = (get: (p: EvmPoint) => number | null): string => {
    let d = '';
    points.forEach((p, i) => {
      const v = get(p);
      if (v === null) return;
      d += `${d === '' || get(points[i - 1] as EvmPoint) === null ? 'M' : 'L'}${px(i).toFixed(1)} ${py(v).toFixed(1)}`;
    });
    return d;
  };
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const every = Math.max(1, Math.ceil(points.length / 8));
  return (
    <div className="evm-chart">
      <svg viewBox={`0 0 ${W} ${H}`} style={{ direction: 'ltr', width: '100%', height: 'auto' }} role="img" aria-label="نمودار روند PV، EV و AC در گزارش‌های پیشرفت؛ همان مقادیر در جدول زیر آمده است." data-testid="evm-chart">
        {ticks.map((t) => (
          <g key={t}>
            <line className="sc-grid" x1={M.l} x2={W - M.r} y1={py(maxY * t)} y2={py(maxY * t)} />
            <text className="sc-tick" x={M.l - 6} y={py(maxY * t) + 4} textAnchor="end">
              {compact(maxY * t)}
            </text>
          </g>
        ))}
        {points.map((p, i) =>
          i % every === 0 || i === points.length - 1 ? (
            <text key={p.date} className="sc-tick" x={px(i)} y={H - 12} textAnchor="middle">
              {shortDate(p.date)}
            </text>
          ) : null,
        )}
        <path className="sc-plan" d={line((p) => p.pv)} />
        <path className="sc-act" d={line((p) => p.ev)} />
        <path className="evm-ac" d={line((p) => p.ac)} />
        {points.map((p, i) => (
          <circle key={p.date} className={`sc-dot${p.kind === 'estimated' ? ' est' : p.kind === 'current' ? ' cur' : ''}`} cx={px(i)} cy={py(p.ev)} r={3.5}>
            <title>{`${faDate(p.date)} — EV ${faNum(p.ev)}`}</title>
          </circle>
        ))}
      </svg>
      <ul className="sc-legend" aria-label="راهنمای نمودار">
        <li>
          <i className="sw plan" /> PV (برنامه‌ای)
        </li>
        <li>
          <i className="sw act" /> EV (کسب‌شده)
        </li>
        <li>
          <i className="sw ac" /> AC (هزینه‌ی واقعی)
        </li>
      </ul>
    </div>
  );
}

const ratioTone = (v: number | null): '' | 'ok' | 'warn' | 'bad' => (v === null ? '' : v < 0.9 ? 'bad' : v < 1 ? 'warn' : 'ok');
const signedTone = (v: number | null): React.CSSProperties | undefined => (v !== null && v < 0 ? { color: 'var(--bad)', fontWeight: 600 } : undefined);

/** جدول و نمودار روند شاخص‌های EVM به‌ازای هر گزارش پیشرفت */
export function EvmTrend() {
  const ps = useProjectState();
  const a = ps.analysis;
  const model = ps.model;
  const unit = ps.bundle!.project.finance.unit;

  const points = useMemo(() => {
    if (!a || !model) return [];
    const { scurve, schedule, progress, finance } = a;
    const rows = buildSnapshotRows({
      snapshots: model.snapshots,
      tasks: model.tasks,
      status: model.status,
      current: { actual: progress.actual, planned: progress.planned, tasks: snapshotTaskProgress(model.tasks, schedule) },
      plannedAt: (s) => scurve.planned[schedule.axis.onOrAfter(s.date) + 1]?.[1] ?? 0,
    });
    return computeEvmTrend({ rows, snapshots: model.snapshots, currentAc: finance.totalActualWithOverhead, bac: finance.bac, method: finance.method });
  }, [a, model]);

  const bac = a?.finance.bac ?? 0;
  const kindLabel = (k: EvmPoint['kind']): string => (k === 'recorded' ? 'ثبت‌شده' : k === 'estimated' ? 'تخمینی' : 'وضعیت فعلی');
  const cell = (v: number | null): string => (v === null ? '—' : faNum(v));

  return (
    <Card title="روند شاخص‌ها در گزارش‌های پیشرفت">
      {!a || points.length === 0 || bac <= 0 ? (
        <Empty title="روندی برای نمایش نیست">برای روند EVM باید بودجه‌ی مبنا (BAC) بزرگ‌تر از صفر و دست‌کم یک گزارش پیشرفت وجود داشته باشد.</Empty>
      ) : (
        <div className="stack">
          {points.length >= 2 ? <TrendChart points={points} /> : <p className="small muted" style={{ margin: 0 }}>نمودار روند از دو گزارش پیشرفت به بالا رسم می‌شود؛ تاکنون فقط یک نقطه وجود دارد.</p>}
          <div className="tbl-wrap" style={{ border: 0 }}>
            <table className="tbl" data-testid="evm-trend">
              <thead>
                <tr>
                  <th>تاریخ</th>
                  <th>گزارش</th>
                  <th className="n">PV</th>
                  <th className="n">EV</th>
                  <th className="n">AC</th>
                  <th className="n">SV</th>
                  <th className="n">CV</th>
                  <th className="n">SPI</th>
                  <th className="n">CPI</th>
                  <th className="n">EAC</th>
                  <th className="n">ETC</th>
                  <th className="n">VAC</th>
                  <th className="n">TCPI</th>
                </tr>
              </thead>
              <tbody>
                {points.map((p) => (
                  <tr key={p.date} data-testid={`evm-row-${p.date}`}>
                    <td className="num">{faDate(p.date)}</td>
                    <td>
                      <Badge kind={p.kind === 'recorded' ? 'ok' : p.kind === 'current' ? 'accent' : ''}>{kindLabel(p.kind)}</Badge>
                      <div className="small muted">
                        برنامه‌ای {faPct(p.plannedPercent)} — واقعی {faPct(p.actualPercent)}
                      </div>
                    </td>
                    <td className="n">{cell(p.pv)}</td>
                    <td className="n">{cell(p.ev)}</td>
                    <td className="n">{cell(p.ac)}</td>
                    <td className="n" style={signedTone(p.sv)}>
                      {cell(p.sv)}
                    </td>
                    <td className="n" style={signedTone(p.cv)}>
                      {cell(p.cv)}
                    </td>
                    <td className="n" style={ratioTone(p.spi) === 'bad' ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                      {faRatio(p.spi)}
                    </td>
                    <td className="n" style={ratioTone(p.cpi) === 'bad' ? { color: 'var(--bad)', fontWeight: 600 } : undefined}>
                      {faRatio(p.cpi)}
                    </td>
                    <td className="n">{cell(p.eac)}</td>
                    <td className="n">{cell(p.etc)}</td>
                    <td className="n" style={signedTone(p.vac)}>
                      {cell(p.vac)}
                    </td>
                    <td className="n">{faRatio(p.tcpi)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="small muted" style={{ margin: 0 }} data-testid="evm-trend-note">
            مبنا: PV = BAC × درصد برنامه‌ای و EV = BAC × درصد واقعی همان گزارش (بودجه‌ی مبنا {faNum(bac)} {unit}). AC هزینه‌ی واقعیِ ثبت‌شده در آن گزارش است و سربار را هم دربر می‌گیرد؛ برای گزارش‌های تخمینی یا قدیمیِ بدون هزینه، شاخص‌های وابسته به AC خالی می‌ماند. ردیف «وضعیت فعلی» ممکن است اندکی با کارت‌های بالا فرق کند، چون آن‌ها EV را بر پایه‌ی هزینه‌ی هر فعالیت و AC را بدون سربار حساب می‌کنند.
          </p>
        </div>
      )}
    </Card>
  );
}
