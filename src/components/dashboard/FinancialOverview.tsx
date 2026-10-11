import React, { useId, useMemo, useState } from 'react';
import { ArrowDownRight, ArrowUpRight, ArrowLeftRight } from 'lucide-react';
import { CountUp } from '../common/CountUp';
import { useCountUp } from '../../hooks/useCountUp';
import { usePrivacy } from '../../context/PrivacyContext';

interface FinancialOverviewProps {
  balance: number;
  featured?: { nombre: string; saldo: number; accent: string };
  ingresos: number;
  gastos: number;
  /** Which period the income / expense figures cover, e.g. "Este mes". */
  periodLabel?: string;
  /** The balance remains available while the period figures are unavailable. */
  periodStatus?: 'loading' | 'error';
  /** Running net of the period, oldest first. Drawn as the line behind the figures. */
  trend?: number[];
}

const euro = new Intl.NumberFormat('es-ES', { minimumFractionDigits: 2, maximumFractionDigits: 2, useGrouping: 'always' });

/** The balance, with the cents stepped back so the eye lands on the euros. */
const Balance: React.FC<{ value: number }> = ({ value }) => {
  const shown = useCountUp(value, 1.1, true);
  const [whole, cents] = euro.format(shown).split(',');
  return (
    <>
      {whole}
      <span className="text-[0.5em] font-semibold tracking-normal text-ink-soft">,{cents} €</span>
    </>
  );
};

const TREND_WIDTH = 400;
const TREND_HEIGHT = 100;
const TREND_MAX_POINTS = 48;

/**
 * Where the money has been, ending in the ring from the logo: today.
 * Stretches to whatever box it is given, so it is drawn in a fixed viewBox with
 * a non-scaling stroke and the ring is laid over it in HTML to stay round.
 */
const TrendLine: React.FC<{ values: number[]; className?: string }> = ({ values, className = '' }) => {
  const id = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const shape = useMemo(() => {
    const stride = Math.max(1, Math.ceil(values.length / TREND_MAX_POINTS));
    const sampled = values.filter((_, i) => i % stride === 0 || i === values.length - 1);
    const series = [0, ...sampled];
    const min = Math.min(...series);
    const span = Math.max(...series) - min || 1;
    const points = series.map((v, i) => ({
      x: (i / (series.length - 1)) * TREND_WIDTH,
      y: 8 + (1 - (v - min) / span) * (TREND_HEIGHT - 16),
    }));
    const line = points
      .map((p, i) => {
        if (i === 0) return `M${p.x} ${p.y}`;
        const mid = (points[i - 1].x + p.x) / 2;
        return `C${mid} ${points[i - 1].y} ${mid} ${p.y} ${p.x} ${p.y}`;
      })
      .join('');
    return { line, area: `${line}V${TREND_HEIGHT}H0Z`, end: points[points.length - 1].y / TREND_HEIGHT };
  }, [values]);

  return (
    <div
      role="img"
      aria-label="Evolución de tu saldo en el periodo"
      className={`relative ${className}`}
      style={{ animation: 'reveal-x 1200ms var(--ease-soft) 150ms backwards' }}
    >
      <svg
        viewBox={`0 0 ${TREND_WIDTH} ${TREND_HEIGHT}`}
        preserveAspectRatio="none"
        className="absolute inset-y-0 left-0 h-full w-[calc(100%-6px)] overflow-visible"
      >
        <defs>
          <linearGradient id={`${id}-line`} x1="0" y1="0" x2={TREND_WIDTH} y2="0" gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#6366f1" stopOpacity="0.15" />
            <stop offset="0.5" stopColor="#6366f1" />
            <stop offset="1" stopColor="#ff9f0a" />
          </linearGradient>
          <linearGradient id={`${id}-area`} x1="0" y1="0" x2="0" y2={TREND_HEIGHT} gradientUnits="userSpaceOnUse">
            <stop offset="0" stopColor="#6366f1" stopOpacity="0.14" />
            <stop offset="1" stopColor="#6366f1" stopOpacity="0" />
          </linearGradient>
        </defs>
        <path d={shape.area} fill={`url(#${id}-area)`} />
        <path
          d={shape.line}
          fill="none"
          stroke={`url(#${id}-line)`}
          strokeWidth="2.25"
          strokeLinecap="round"
          vectorEffect="non-scaling-stroke"
        />
      </svg>
      <span
        className="absolute right-0 h-3 w-3 -translate-y-1/2 rounded-full border-[2.5px] border-sun-500 bg-surface"
        style={{ top: `${shape.end * 100}%` }}
      />
    </div>
  );
};

export const FinancialOverview: React.FC<FinancialOverviewProps> = ({ balance, featured, ingresos, gastos, periodLabel, periodStatus, trend }) => {
  const { isLocked } = usePrivacy();
  const [showTotal, setShowTotal] = useState(false);
  const displayedBalance = featured && !showTotal ? featured.saldo : balance;
  const status = isLocked ? undefined : periodStatus;
  const spent = ingresos > 0 ? Math.round((gastos / ingresos) * 100) : 0;
  const meter = isLocked ? 0 : Math.min(spent, 100);
  const meterColor = spent >= 85 ? 'text-rose-500' : spent >= 65 ? 'text-sun-500' : 'text-emerald-500';
  const showTrend = !isLocked && !status && trend !== undefined && trend.length > 1;
  const amount = (value: number) =>
    isLocked ? '•••• €' : status ? '—' : <CountUp end={value} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1.1} />;

  return (
    <section className="dashboard-surface p-5 sm:p-7" aria-label="Resumen financiero">
      <div className="grid gap-5 lg:grid-cols-[auto_minmax(0,1fr)_auto] lg:items-end lg:gap-10">
        <div className="min-w-0">
          {featured ? <button
            type="button"
            onClick={() => setShowTotal(!showTotal)}
            aria-label={showTotal ? `Ver ${featured.nombre}` : 'Ver saldo total'}
            className="eyebrow -my-1.5 flex max-w-full items-center gap-1.5 rounded-lg py-1.5 transition-colors duration-150 hover:text-ink"
          >
            {!showTotal && <span aria-hidden="true" className={`h-2 w-2 shrink-0 rounded-full ${featured.accent}`} />}
            <span className="truncate">{showTotal ? 'Saldo total' : featured.nombre}</span>
            <ArrowLeftRight size={12} aria-hidden="true" className="shrink-0 text-ink-faint" />
          </button> : <p className="eyebrow">Saldo actual</p>}
          <p className={`figure mt-3 whitespace-nowrap text-[2.9rem] sm:text-6xl ${displayedBalance < 0 && !isLocked ? 'text-rose-500' : 'text-ink'}`}>
            {isLocked ? '•••• €' : <Balance key={featured && !showTotal ? 'featured' : 'total'} value={displayedBalance} />}
          </p>
        </div>

        {showTrend ? <TrendLine values={trend} className="h-14 lg:h-20" /> : <div className="hidden lg:block" />}

        <div className="grid min-w-0 grid-cols-2 gap-3 lg:w-[23rem]">
          <div className="min-w-0 rounded-2xl bg-surface-2 p-3.5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-emerald-500/12 text-emerald-600 dark:text-emerald-300">
                <ArrowUpRight size={14} />
              </span>
              <p className="dashboard-label">Ingresos</p>
            </div>
            <p className="figure mt-2.5 truncate text-lg text-ink sm:text-xl">{amount(ingresos)}</p>
          </div>
          <div className="min-w-0 rounded-2xl bg-surface-2 p-3.5">
            <div className="flex items-center gap-2">
              <span className="grid h-6 w-6 place-items-center rounded-lg bg-rose-500/12 text-rose-600 dark:text-rose-300">
                <ArrowDownRight size={14} />
              </span>
              <p className="dashboard-label">Gastos</p>
            </div>
            <p className="figure mt-2.5 truncate text-lg text-ink sm:text-xl">{amount(gastos)}</p>
          </div>
        </div>
      </div>

      {status ? (
        <p className="mt-6 text-sm text-ink-soft" role={status === 'error' ? 'alert' : 'status'}>
          {status === 'error' ? 'No se pudieron cargar los movimientos históricos.' : 'Cargando movimientos…'}
        </p>
      ) : <div className="mt-6">
        <div className="mb-2.5 flex items-baseline justify-between gap-3 text-xs">
          <span className="text-ink-soft">
            <span className="font-bold text-ink">Gastado</span> sobre tus ingresos
            {periodLabel && <span className="text-ink-faint"> · {periodLabel.toLowerCase()}</span>}
          </span>
          <span className="font-extrabold tabular-nums text-ink">{isLocked ? '••' : `${spent}%`}</span>
        </div>
        <div
          role="progressbar"
          aria-label="Gastado sobre tus ingresos"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={meter}
          className="flow-meter"
        >
          {meter > 0 && <i className={meterColor} style={{ width: `${meter}%` }} />}
        </div>
      </div>}
    </section>
  );
};
