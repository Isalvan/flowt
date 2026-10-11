import React, { useMemo, useRef, useState } from "react";
import {
  Area,
  AreaChart,
  ComposedChart,
  Line,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { AlertTriangle, LineChart, Plus, X } from "lucide-react";
import type { Hucha, Movimiento, Suscripcion } from "../../types";
import { usePrivacy } from "../../context/PrivacyContext";
import { usePreferences } from "../../context/PreferencesContext";
import { payrollDates } from "../../utils/periods";
import {
  buildProjectionData,
  calculateProjectionEstimates,
  netVariability,
  scenarioSummary,
} from "../../utils/predictive";
import { ProjectionAdjustmentForm, type NamedProjectionAdjustment } from "./ProjectionAdjustmentForm";

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
  const [adjustments, setAdjustments] = useState<NamedProjectionAdjustment[]>([]);
  const [formOpen, setFormOpen] = useState(false);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const closeForm = () => {
    setFormOpen(false);
    addButtonRef.current?.focus();
  };
  const adjustmentLabel = (adjustment: NamedProjectionAdjustment) => {
    if (adjustment.tipo === "cancelar_suscripcion") return adjustment.descripcion;
    const amount = `${adjustment.importe < 0 ? "−" : "+"}${formatCurrency(Math.abs(adjustment.importe))}`;
    return `${adjustment.descripcion} · ${amount}${adjustment.tipo === "mensual" ? "/mes" : ` · ${adjustment.fecha.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`}`;
  };
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
            adjustments,
          )
        : [],
    [estimates, totalSavings, months, variability, adjustments],
  );
  const horizonLabel = months === 1 ? "Próximo mes" : `Próximos ${months} meses`;

  const balances = projectionData.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const lastPoint = projectionData.at(-1);
  const end = lastPoint?.balance ?? totalSavings;
  const diff = Math.round((end - totalSavings) * 100) / 100;
  const domainMin = Math.min(...projectionData.map((point) => Math.min(point.low ?? point.balance, point.scenario ?? point.balance)));
  const domainMax = Math.max(...projectionData.map((point) => Math.max(point.high ?? point.balance, point.scenario ?? point.balance)));
  const summary = scenarioSummary(projectionData);
  const Chart = adjustments.length > 0 ? ComposedChart : AreaChart;
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
        {point.scenario !== undefined && (
          <p className="mt-1 font-semibold tabular-nums text-violet-600 dark:text-violet-400">
            Con tus supuestos: {formatCurrency(point.scenario)}
          </p>
        )}
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
          <div className="flex flex-wrap items-center gap-2">
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
      {!isLocked && estimates && (
        <div className="mb-3">
          <div className="flex flex-wrap items-center gap-2">
            <button
              ref={addButtonRef}
              type="button"
              aria-expanded={formOpen}
              onClick={() => (formOpen ? closeForm() : setFormOpen(true))}
              className="inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-brand hover:bg-brand-tint hover:text-brand-ink"
            >
              <Plus size={14} />
              Añadir supuesto
            </button>
            {adjustments.map((adjustment) => {
              const label = adjustmentLabel(adjustment);
              return (
                <span
                  key={adjustment.id}
                  className="inline-flex h-8 items-center gap-1 rounded-full bg-surface-2 pl-3 pr-0.5 text-xs font-semibold text-ink"
                >
                  {label}
                  <button
                    type="button"
                    aria-label={`Quitar supuesto ${label}`}
                    onClick={() => setAdjustments((current) => current.filter((item) => item.id !== adjustment.id))}
                    className="grid h-7 w-7 place-items-center rounded-full text-ink-soft transition-colors duration-150 hover:bg-surface hover:text-ink"
                  >
                    <X size={14} />
                  </button>
                </span>
              );
            })}
            {adjustments.length > 1 && (
              <button
                type="button"
                onClick={() => setAdjustments([])}
                className="rounded-lg px-1.5 py-1 text-xs font-bold text-ink-soft underline-offset-4 hover:text-ink hover:underline"
              >
                Quitar todos
              </button>
            )}
          </div>
          {formOpen && (
            <div className="mt-3">
              <ProjectionAdjustmentForm
                subscriptions={suscripciones.filter((subscription) => subscription.activa)}
                onAdd={(adjustment) => setAdjustments((current) => [...current, adjustment])}
                onClose={closeForm}
              />
            </div>
          )}
          {(formOpen || adjustments.length > 0) && (
            <p className="field-hint mt-2">Los supuestos son para probar; no se guardan.</p>
          )}
        </div>
      )}
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
          {adjustments.length > 0 && <p className="mt-3 text-xs text-ink-soft" role="status">
            Con tus supuestos acabarías con {formatCurrency(Math.abs(summary.difference))} {summary.difference < 0 ? "menos" : "más"}
            {summary.firstNegativeDate && ` y te quedarías sin saldo el ${summary.firstNegativeDate.toLocaleDateString("es-ES", { day: "numeric", month: "short" })}`}.
          </p>}
          {adjustments.length > 0 && <div className="mt-3 flex flex-wrap gap-4 text-xs text-ink-soft" aria-label="Leyenda de la proyección">
            <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-[var(--brand)]" aria-hidden="true" />Saldo esperado</span>
            <span className="flex items-center gap-2"><span className="w-5 border-t-2 border-dashed border-violet-500" aria-hidden="true" />Con tus supuestos</span>
          </div>}
          <div
            className="mt-3 h-56 w-full"
            role="img"
            aria-label={`Proyección de saldo a ${months} meses: saldo esperado ${formatCurrency(end)}${variability ? `, entre ${formatCurrency(lastPoint?.low ?? end)} y ${formatCurrency(lastPoint?.high ?? end)}` : `, mínimo ${formatCurrency(min)} y máximo ${formatCurrency(max)}`}${lastPoint?.scenario !== undefined ? `, con tus supuestos ${formatCurrency(lastPoint.scenario)}` : ""}.`}
          >
            <ResponsiveContainer width="100%" height="100%">
              <Chart
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
                  name="Saldo esperado"
                  stroke="var(--brand)"
                  strokeWidth={2.25}
                  fill={variability ? "none" : "url(#flowtProjectionFill)"}
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                {adjustments.length > 0 && <Line type="monotone" dataKey="scenario" name="Con tus supuestos" stroke="#8b5cf6" strokeWidth={2.25} strokeDasharray="6 4" dot={false} activeDot={{ r: 4, strokeWidth: 0 }} isAnimationActive={false} />}
              </Chart>
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
