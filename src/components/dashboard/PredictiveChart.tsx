import React, { useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { AlertTriangle, LineChart } from "lucide-react";
import type { Hucha, Movimiento, Suscripcion } from "../../types";
import { usePrivacy } from "../../context/PrivacyContext";
import { usePreferences } from "../../context/PreferencesContext";
import { payrollDates } from "../../utils/periods";
import {
  buildProjectionData,
  calculateProjectionEstimates,
  netVariability,
} from "../../utils/predictive";

interface PredictiveChartProps {
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  allMovimientos: Movimiento[];
}

const HORIZON_KEY = "flowt-projection-months";
const HORIZON_PRESETS = [3, 6, 12];
const MAX_MONTHS = 60;
const clampMonths = (value: number) =>
  Math.min(MAX_MONTHS, Math.max(1, Math.round(value) || 1));
const readStoredMonths = () => {
  try {
    const stored = Number(localStorage.getItem(HORIZON_KEY));
    return stored ? clampMonths(stored) : 3;
  } catch {
    return 3;
  }
};
const daysUntil = (months: number) => {
  const start = new Date();
  const end = new Date(start);
  end.setMonth(start.getMonth() + months);
  return Math.round((end.getTime() - start.getTime()) / 86400000);
};

export const PredictiveChart: React.FC<PredictiveChartProps> = ({
  huchas,
  suscripciones,
  allMovimientos,
}) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const { inicioPeriodo } = usePreferences();
  const [months, setMonths] = useState(readStoredMonths);
  // Kept apart from `months` so the field can be emptied while typing.
  const [monthsDraft, setMonthsDraft] = useState(String(months));
  const changeMonths = (value: number, syncDraft = true) => {
    const next = clampMonths(value);
    setMonths(next);
    if (syncDraft) setMonthsDraft(String(next));
    try {
      localStorage.setItem(HORIZON_KEY, String(next));
    } catch {
      // The horizon just won't be remembered.
    }
  };
  const totalSavings = useMemo(
    () => huchas.reduce((sum, hucha) => sum + hucha.saldo_acumulado, 0),
    [huchas],
  );
  const estimates = useMemo(
    () =>
      calculateProjectionEstimates(allMovimientos, suscripciones, new Date(), huchas),
    [allMovimientos, suscripciones, huchas],
  );
  const variability = useMemo(
    () => {
      const result = netVariability(allMovimientos, new Date(), {
        inicioPeriodo,
        nominas: payrollDates(allMovimientos),
      });
      // Identical periods give a band with no width, which would read as false certainty.
      return result && result.standardDeviation >= 0.01 ? result : null;
    },
    [allMovimientos, inicioPeriodo],
  );
  const projectionData = useMemo(
    () =>
      estimates
        ? buildProjectionData(
            totalSavings,
            estimates,
            new Date(),
            daysUntil(months),
            variability,
          )
        : [],
    [estimates, totalSavings, months, variability],
  );
  const horizonLabel = months === 1 ? "Próximo mes" : `Próximos ${months} meses`;

  const balances = projectionData.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const lastPoint = projectionData.at(-1);
  const end = lastPoint?.balance ?? totalSavings;
  const diff = Math.round((end - totalSavings) * 100) / 100;
  const domainMin = Math.min(...projectionData.map((point) => point.low ?? point.balance));
  const domainMax = Math.max(...projectionData.map((point) => point.high ?? point.balance));
  const figures = variability
    ? [["Prudente", lastPoint?.low ?? end], ["Esperado", end], ["Optimista", lastPoint?.high ?? end]] as const
    : [["Mínimo", min], ["Máximo", max], ["Variación", diff]] as const;
  const isAlert = min < totalSavings * 0.15 || min < 50;
  const tooltip = ({
    active,
    payload,
    label,
  }: TooltipContentProps<TooltipValueType, string | number>) => {
    const point: (typeof projectionData)[number] | undefined = payload?.[0]?.payload;
    return active && point ? (
      <div className="glass-panel rounded-xl p-3 text-xs">
        <p className="mb-1.5 font-bold text-ink-soft">{String(label ?? "")}</p>
        <p className="font-semibold tabular-nums text-brand-ink">
          Saldo esperado: {formatCurrency(point.balance)}
        </p>
        {point.low !== undefined && point.high !== undefined && (
          <p className="mt-1 text-ink-soft">
            entre {formatCurrency(point.low)} y {formatCurrency(point.high)}
          </p>
        )}
      </div>
    ) : null;
  };

  return (
    <section className="dashboard-surface p-5">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span className="dashboard-icon bg-brand-tint text-brand-ink">
            <LineChart size={18} />
          </span>
          <div className="min-w-0">
            <h3 className="dashboard-heading">Proyección de saldo</h3>
            <p className="dashboard-subtitle">
              {estimates
                ? `${horizonLabel}, según tu ritmo ${estimates.observedMonths === 1 ? "del último mes" : `de los últimos ${estimates.observedMonths} meses`}`
                : horizonLabel}
            </p>
          </div>
        </div>
        {estimates && !isLocked && (
          <div className="flex shrink-0 items-center gap-2">
            <div
              role="group"
              aria-label="Horizonte de la proyección"
              className="flex rounded-xl bg-surface-2 p-0.5"
            >
              {HORIZON_PRESETS.map((preset) => (
                <button
                  type="button"
                  key={preset}
                  onClick={() => changeMonths(preset)}
                  aria-pressed={months === preset}
                  className={`rounded-[0.6rem] px-2.5 py-1 text-xs font-bold tabular-nums transition-colors ${months === preset ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}
                >
                  {preset}m
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1.5 text-xs font-semibold text-ink-soft">
              <input
                type="number"
                inputMode="numeric"
                min={1}
                max={MAX_MONTHS}
                aria-label="Meses a proyectar"
                value={monthsDraft}
                onChange={(event) => {
                  setMonthsDraft(event.target.value);
                  const value = Number(event.target.value);
                  if (value >= 1) changeMonths(value, false);
                }}
                onBlur={() => setMonthsDraft(String(months))}
                className="w-12 rounded-lg border border-line-strong bg-surface px-1.5 py-1 text-center text-xs font-bold tabular-nums text-ink"
              />
              meses
            </label>
          </div>
        )}
      </div>
      {isLocked ? (
        <div className="grid h-56 place-items-center rounded-2xl bg-surface-2 text-sm font-semibold text-ink-faint">
          Gráfica protegida por privacidad
        </div>
      ) : !estimates ? (
        <div className="dashboard-empty h-56">
          <p>
            Aún no hay suficientes ingresos y gastos para calcular una
            proyección fiable
          </p>
        </div>
      ) : (
        <>
          <div className="grid grid-cols-3 gap-2">
            {figures.map(([label, value]) => (
              <div key={label} className="rounded-xl bg-surface-2 px-3 py-2">
                <p className="text-[11px] font-semibold text-ink-soft">
                  {label}
                </p>
                <p
                  className={`text-sm font-extrabold tabular-nums ${label !== "Variación" ? "text-ink" : diff >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}
                >
                  {label === "Variación" && diff >= 0 ? "+" : ""}
                  {formatCurrency(value)}
                </p>
              </div>
            ))}
          </div>
          <div
            className="mt-3 h-56 w-full"
            role="img"
            aria-label={`Proyección de saldo a ${months} meses: saldo esperado ${formatCurrency(end)}${variability ? `, entre ${formatCurrency(lastPoint?.low ?? end)} y ${formatCurrency(lastPoint?.high ?? end)}` : `, mínimo ${formatCurrency(min)} y máximo ${formatCurrency(max)}`}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart
                data={projectionData}
                margin={{ top: 10, right: 8, left: -6, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="flowtProjectionFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop
                      offset="0%"
                      stopColor="var(--brand)"
                      stopOpacity={0.22}
                    />
                    <stop
                      offset="100%"
                      stopColor="var(--brand)"
                      stopOpacity={0}
                    />
                  </linearGradient>
                </defs>
                <CartesianGrid
                  vertical={false}
                  stroke="var(--line-strong)"
                  strokeDasharray="2 6"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  minTickGap={24}
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <YAxis
                  domain={[Math.floor(domainMin), Math.ceil(domainMax)]}
                  tickFormatter={(value: number) => value.toLocaleString("es-ES", { maximumFractionDigits: 2 })}
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <Tooltip
                  content={tooltip}
                  cursor={{ stroke: "var(--line-strong)" }}
                />
                {variability && (
                  <Area
                    type="monotone"
                    dataKey={(point: (typeof projectionData)[number]) => [point.low, point.high]}
                    stroke="none"
                    fill="var(--brand)"
                    fillOpacity={0.14}
                    activeDot={false}
                    isAnimationActive={false}
                  />
                )}
                <Area
                  type="monotone"
                  dataKey="balance"
                  stroke="var(--brand)"
                  strokeWidth={2.25}
                  fill={variability ? "none" : "url(#flowtProjectionFill)"}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
          <p className="mt-3 text-xs text-ink-soft">
            {variability
              ? `La franja refleja lo que ha variado tu ahorro en tus últimos ${variability.periods} periodos.`
              : "Con tres periodos completos de historial verás también una franja de incertidumbre."}
          </p>
          {isAlert && (
            <p className="mt-3 flex gap-2 rounded-xl bg-rose-500/10 p-3 text-xs font-semibold text-rose-700 dark:text-rose-300">
              <AlertTriangle size={15} className="shrink-0" />
              La proyección baja a un saldo muy ajustado. Revisa tus próximos
              cargos.
            </p>
          )}
        </>
      )}
    </section>
  );
};
