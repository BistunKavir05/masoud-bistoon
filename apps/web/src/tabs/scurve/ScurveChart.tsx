import { useId, useMemo, useState } from 'react';
import type { KeyboardEvent, PointerEvent } from 'react';
import { toJalali, toPersianDigits } from '@bistoon/core';
import type { DayAxis, IsoDate, SCurve } from '@bistoon/core';
import { faNum, faPct } from '../../lib/fmt.ts';
import { curvePath, evalCurve, monotoneCurve, polylineCurve, roundedCurve } from '../../lib/curve.ts';
import type { Pt } from '../../lib/curve.ts';

const W = 900;
const H = 380;
const M = { l: 46, r: 18, t: 22, b: 46 };
const PW = W - M.l - M.r;
const PH = H - M.t - M.b;

/** بیشینه‌ی اختلاف عمودیِ منحنی هموار با مقدار دقیق روزانه، به واحد درصد (فقط برای زیبایی؛ مقدارهای نوشتاری همیشه دقیق‌اند) */
export const SMOOTH_MAX_DEV = 1;

const STEPS = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000];

function tickStep(length: number): number {
  return STEPS.find((s) => length / s <= 9) ?? 1000;
}

/** تاریخ پایان روز کاریِ u‌ام (u = ۰ → روز شروع) */
function dateOfX(axis: DayAxis, u: number): IsoDate | null {
  return axis.dateAt(Math.max(0, u - 1));
}

function shortJalali(iso: IsoDate, withYear: boolean): string {
  const j = toJalali(iso);
  const md = `${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`;
  return toPersianDigits(withYear ? `${j.jy}/${md}` : md);
}

function fullJalali(iso: IsoDate): string {
  const j = toJalali(iso);
  return toPersianDigits(`${j.jy}/${String(j.jm).padStart(2, '0')}/${String(j.jd).padStart(2, '0')}`);
}

/**
 * منحنی S. با `smooth` (پیش‌فرض) گوشه‌های برنامه‌ای و پیش‌بینی گرد می‌شود و منحنی واقعی با درون‌یابی یکنوا از نقطه‌های گزارش
 * می‌گذرد؛ بدون آن، همه‌ی منحنی‌ها خط شکسته‌ی دقیق‌اند. عددِ نشانگر برای برنامه‌ای و پیش‌بینی همیشه مقدار دقیق روزانه است
 * و برای واقعی همان مقدار منحنی ترسیم‌شده (بین دو گزارش تخمین است، مثل قبل).
 */
export function ScurveChart({ curve, axis, smooth = true }: { curve: SCurve; axis: DayAxis; smooth?: boolean }) {
  const uid = useId();
  const [hover, setHover] = useState<number | null>(null);
  const px = (x: number): number => M.l + (x / curve.length) * PW;
  const py = (y: number): number => M.t + (1 - Math.max(0, Math.min(100, y)) / 100) * PH;

  const plannedCurve = useMemo(() => (smooth ? roundedCurve(curve.planned, SMOOTH_MAX_DEV) : polylineCurve(curve.planned)), [curve, smooth]);
  const actualPts = useMemo(() => [[0, 0] as Pt, ...curve.actual.map((p): Pt => [p.x, p.y])], [curve]);
  const actualCurve = useMemo(() => (smooth ? monotoneCurve(actualPts) : polylineCurve(actualPts)), [actualPts, smooth]);
  const forecastCurve = useMemo(() => (curve.forecast.length > 1 ? (smooth ? roundedCurve(curve.forecast, SMOOTH_MAX_DEV) : polylineCurve(curve.forecast)) : null), [curve, smooth]);
  const planned = useMemo(() => curvePath(plannedCurve, px, py), [plannedCurve]); // eslint-disable-line react-hooks/exhaustive-deps
  const actualPath = useMemo(() => curvePath(actualCurve, px, py), [actualCurve]); // eslint-disable-line react-hooks/exhaustive-deps
  const forecast = useMemo(() => (forecastCurve ? curvePath(forecastCurve, px, py) : ''), [forecastCurve]); // eslint-disable-line react-hooks/exhaustive-deps

  const step = tickStep(curve.length);
  const xs: number[] = [];
  for (let u = 0; u <= curve.length; u += step) xs.push(u);
  const ys = [0, 25, 50, 75, 100];

  const at = (u: number | null): { planned: number; actual: number | null; forecast: number | null; date: IsoDate | null } | null => {
    if (u === null) return null;
    const pl = curve.planned[u]?.[1] ?? 100;
    const fc = u >= curve.statusX ? (curve.forecast.find((p) => p[0] === u)?.[1] ?? (u > (curve.forecast[curve.forecast.length - 1]?.[0] ?? 0) ? 100 : null)) : null;
    return { planned: pl, actual: evalCurve(actualCurve, u), forecast: fc, date: dateOfX(axis, u) };
  };
  const info = at(hover);

  const toU = (clientX: number, el: SVGSVGElement): number => {
    const r = el.getBoundingClientRect();
    const x = ((clientX - r.left) / r.width) * W;
    return Math.max(0, Math.min(curve.length, Math.round(((x - M.l) / PW) * curve.length)));
  };
  const onMove = (e: PointerEvent<SVGSVGElement>): void => setHover(toU(e.clientX, e.currentTarget));
  const onKey = (e: KeyboardEvent<SVGSVGElement>): void => {
    const cur = hover ?? curve.statusX;
    const jump = e.shiftKey ? 10 : 1;
    // نمودار چپ‌به‌راست است؛ پیکان چپ = زمان قبل
    if (e.key === 'ArrowLeft') setHover(Math.max(0, cur - jump));
    else if (e.key === 'ArrowRight') setHover(Math.min(curve.length, cur + jump));
    else if (e.key === 'Home') setHover(0);
    else if (e.key === 'End') setHover(curve.length);
    else if (e.key === 'Escape') setHover(null);
    else return;
    e.preventDefault();
  };

  const statusDate = dateOfX(axis, curve.statusX);
  const desc = `منحنی S: برنامه‌ای ${faPct(curve.plannedAtStatus)} و واقعی ${faPct(curve.actual.find((p) => p.snapshot === null)?.y ?? 0)} در تاریخ وضعیت${statusDate ? ` ${fullJalali(statusDate)}` : ''}. جدول زیر همین مقادیر را متنی نشان می‌دهد.`;

  let lastYear = -1;
  return (
    <div className="sc">
      <div className="sc-readout" aria-live="off" data-testid="sc-readout">
        {info && info.date ? (
          <>
            <strong className="num">{fullJalali(info.date)}</strong>
            <span>
              <i className="sw plan" /> برنامه‌ای {faPct(info.planned)}
            </span>
            {info.actual !== null ? (
              <span>
                <i className="sw act" /> واقعی {faPct(info.actual)}
              </span>
            ) : null}
            {info.forecast !== null ? (
              <span>
                <i className="sw fc" /> پیش‌بینی {faPct(info.forecast)}
              </span>
            ) : null}
          </>
        ) : (
          <span className="muted">برای دیدن مقدار هر روز، نشانگر را روی نمودار ببرید (یا با کلید فلش چپ/راست).</span>
        )}
      </div>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="sc-svg"
        style={{ direction: 'ltr' }}
        role="img"
        aria-label={desc}
        aria-describedby={`${uid}-hint`}
        tabIndex={0}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        onKeyDown={onKey}
        onBlur={() => setHover(null)}
        data-testid="scurve-chart"
      >
        <desc id={`${uid}-hint`}>{desc}</desc>
        {ys.map((y) => (
          <g key={y}>
            <line className="sc-grid" x1={M.l} x2={W - M.r} y1={py(y)} y2={py(y)} />
            <text className="sc-tick" x={M.l - 8} y={py(y) + 4} textAnchor="end">
              {toPersianDigits(y)}٪
            </text>
          </g>
        ))}
        {xs.map((u) => {
          const d = dateOfX(axis, u);
          if (!d) return null;
          const yr = toJalali(d).jy;
          const label = shortJalali(d, yr !== lastYear);
          lastYear = yr;
          return (
            <g key={u}>
              <line className="sc-grid v" x1={px(u)} x2={px(u)} y1={M.t} y2={H - M.b} />
              <text className="sc-tick" x={px(u)} y={H - M.b + 18} textAnchor="middle">
                {label}
              </text>
              <text className="sc-tick sub" x={px(u)} y={H - M.b + 33} textAnchor="middle">
                {u === 0 ? 'شروع' : `روز ${faNum(u)}`}
              </text>
            </g>
          );
        })}
        <rect className="sc-plot" x={M.l} y={M.t} width={PW} height={PH} fill="none" />

        {curve.contractEndX !== null ? (
          <g>
            <line className="sc-end" x1={px(curve.contractEndX)} x2={px(curve.contractEndX)} y1={M.t} y2={H - M.b} />
            <text className="sc-flag end" x={px(curve.contractEndX) - 5} y={M.t + 26} textAnchor="end">
              پایان قرارداد
            </text>
          </g>
        ) : null}
        <g>
          <line className="sc-status" x1={px(curve.statusX)} x2={px(curve.statusX)} y1={M.t} y2={H - M.b} />
          <text className="sc-flag" x={px(curve.statusX) + 5} y={M.t + 11} textAnchor="start">
            وضعیت
          </text>
        </g>

        <path className="sc-plan" d={planned} />
        {forecast ? <path className="sc-fc" d={forecast} /> : null}
        <path className="sc-act" d={actualPath} />

        {curve.actual.map((p) => {
          const date = p.snapshot ? p.snapshot.date : null;
          const label = p.snapshot ? `${fullJalali(p.snapshot.date)} — ${p.snapshot.estimated ? 'تخمینی' : 'ثبت‌شده'}: ${faPct(p.y)}` : `وضعیت فعلی: ${faPct(p.y)}`;
          return p.snapshot === null ? (
            <circle key="cur" className="sc-dot cur" cx={px(p.x)} cy={py(p.y)} r={6}>
              <title>{label}</title>
            </circle>
          ) : (
            <circle key={date} className={`sc-dot${p.snapshot.estimated ? ' est' : ''}`} cx={px(p.x)} cy={py(p.y)} r={4}>
              <title>{label}</title>
            </circle>
          );
        })}

        {hover !== null ? (
          <g pointerEvents="none">
            <line className="sc-cross" x1={px(hover)} x2={px(hover)} y1={M.t} y2={H - M.b} />
            {info ? <circle className="sc-hp plan" cx={px(hover)} cy={py(evalCurve(plannedCurve, hover ?? 0) ?? info.planned)} r={4} /> : null}
            {info && info.actual !== null ? <circle className="sc-hp act" cx={px(hover)} cy={py(info.actual)} r={4} /> : null}
          </g>
        ) : null}
      </svg>
      <ul className="sc-legend" aria-label="راهنمای نمودار">
        <li>
          <i className="sw plan" /> برنامه‌ای (خط مبنا)
        </li>
        <li>
          <i className="sw act" /> واقعی
        </li>
        <li>
          <i className="sw fc" /> پیش‌بینی ادامه
        </li>
        <li>
          <i className="dot" /> گزارش ثبت‌شده
        </li>
        <li>
          <i className="dot est" /> گزارش تخمینی
        </li>
        <li>
          <i className="dot cur" /> وضعیت فعلی
        </li>
      </ul>
      {smooth ? (
        <p className="sc-note muted" data-testid="sc-smooth-note">
          گوشه‌های منحنی فقط برای خوانایی گرد شده‌اند و از مقدار دقیق هر روز حداکثر {faNum(SMOOTH_MAX_DEV)} واحد درصد فاصله دارند؛ عددهای نشانگر و جدول دقیق‌اند. منحنی واقعی از نقطه‌های گزارش‌شده می‌گذرد و میان دو گزارش تخمین است.
        </p>
      ) : null}
    </div>
  );
}
