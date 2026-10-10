import React, { useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  type TooltipContentProps,
  type TooltipValueType,
} from "recharts";
import { BarChart3, TrendingUp } from "lucide-react";
import type { Hucha, Movimiento, Suscripcion } from "../../types";
import { usePrivacy } from "../../context/PrivacyContext";

interface AnalyticsSectionProps {
  chartData: Array<{ name: string; ingresos: number; gastos: number }>;
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  allMovimientos: Movimiento[];
}
const toNumericValue = (value: TooltipValueType | undefined): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : 0;
  }
  return 0;
};

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({
  chartData,
}) => {
  const [chartType, setChartType] = useState<"area" | "bar">("area");
  const { isLocked, formatCurrency } = usePrivacy();
  const tooltip = ({
    active,
    payload,
    label,
  }: TooltipContentProps<TooltipValueType, string | number>) =>
    active && payload?.length ? (
      <div className="glass-panel rounded-xl p-3 text-xs">
        <p className="mb-1.5 font-bold capitalize text-ink-soft">{String(label ?? "")}</p>
        {payload.map((item, index) => {
          const dataKey = String(item.dataKey ?? "");
          const isIncome = dataKey === "ingresos";
          return (
            <p
              key={`${dataKey}-${index}`}
              className={`font-semibold tabular-nums ${isIncome ? "text-emerald-600 dark:text-emerald-400" : "text-rose-500 dark:text-rose-400"}`}
            >
              {isIncome ? "Ingresos" : "Gastos"}:{" "}
              {formatCurrency(toNumericValue(item.value))}
            </p>
          );
        })}
      </div>
    ) : null;

  return (
    <section className="dashboard-surface p-5">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <span className="dashboard-icon bg-brand-tint text-brand-ink">
            <TrendingUp size={18} />
          </span>
          <div>
            <h3 className="dashboard-heading">Evolución de finanzas</h3>
            <p className="dashboard-subtitle">
              Tus ingresos y gastos mes a mes
            </p>
          </div>
        </div>
        <div className="flex shrink-0 rounded-xl bg-surface-2 p-0.5">
          <button
            type="button"
            aria-label="Ver gráfico de área"
            onClick={() => setChartType("area")}
            aria-pressed={chartType === "area"}
            className={`rounded-[0.6rem] p-1.5 transition-colors ${chartType === "area" ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}
          >
            <TrendingUp size={14} />
          </button>
          <button
            type="button"
            aria-label="Ver gráfico de barras"
            onClick={() => setChartType("bar")}
            aria-pressed={chartType === "bar"}
            className={`rounded-[0.6rem] p-1.5 transition-colors ${chartType === "bar" ? "bg-surface text-ink shadow-sm" : "text-ink-faint hover:text-ink"}`}
          >
            <BarChart3 size={14} />
          </button>
        </div>
      </div>
      <div className="h-64 w-full">
        {isLocked ? (
          <div className="grid h-full place-items-center rounded-2xl bg-surface-2 text-sm font-semibold text-ink-faint">
            Gráfica protegida por privacidad
          </div>
        ) : !chartData.length ? (
          <div className="dashboard-empty h-full">
            <p>Aún no hay movimientos en este periodo</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            {chartType === "area" ? (
              <AreaChart
                data={chartData}
                margin={{ top: 10, right: 8, left: -22, bottom: 0 }}
              >
                <defs>
                  <linearGradient
                    id="flowtIncomeFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#10b981" stopOpacity={0.22} />
                    <stop offset="100%" stopColor="#10b981" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient
                    id="flowtExpenseFill"
                    x1="0"
                    y1="0"
                    x2="0"
                    y2="1"
                  >
                    <stop offset="0%" stopColor="#fb7185" stopOpacity={0.16} />
                    <stop offset="100%" stopColor="#fb7185" stopOpacity={0} />
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
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <Tooltip
                  content={tooltip}
                  cursor={{ stroke: "var(--line-strong)", fill: "var(--surface-2)" }}
                />
                <Area
                  type="monotone"
                  dataKey="ingresos"
                  stroke="#10b981"
                  strokeWidth={2.25}
                  fill="url(#flowtIncomeFill)"
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
                <Area
                  type="monotone"
                  dataKey="gastos"
                  stroke="#fb7185"
                  strokeWidth={2.25}
                  fill="url(#flowtExpenseFill)"
                  activeDot={{ r: 4, strokeWidth: 0 }}
                />
              </AreaChart>
            ) : (
              <BarChart
                data={chartData}
                margin={{ top: 10, right: 8, left: -22, bottom: 0 }}
              >
                <CartesianGrid
                  vertical={false}
                  stroke="var(--line-strong)"
                  strokeDasharray="2 6"
                />
                <XAxis
                  dataKey="name"
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <YAxis
                  axisLine={false}
                  tickLine={false}
                  tick={{ fill: "var(--ink-faint)", fontSize: 11 }}
                />
                <Tooltip
                  content={tooltip}
                  cursor={{ stroke: "var(--line-strong)", fill: "var(--surface-2)" }}
                />
                <Bar dataKey="ingresos" fill="#10b981" radius={[6, 6, 0, 0]} maxBarSize={28} />
                <Bar dataKey="gastos" fill="#fb7185" radius={[6, 6, 0, 0]} maxBarSize={28} />
              </BarChart>
            )}
          </ResponsiveContainer>
        )}
      </div>
      <div className="mt-2 flex justify-center gap-5 text-[11px] font-semibold text-ink-soft">
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500" />
          Ingresos
        </span>
        <span>
          <i className="mr-1 inline-block h-2 w-2 rounded-full bg-rose-400" />
          Gastos
        </span>
      </div>
    </section>
  );
};
