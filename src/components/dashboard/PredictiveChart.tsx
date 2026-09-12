import React, { useMemo } from "react";
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
import { AlertTriangle, Info, Lock, TrendingUp } from "lucide-react";
import type { Hucha, Movimiento, Suscripcion } from "../../types";
import { Card } from "../common/Card";
import { usePrivacy } from "../../context/PrivacyContext";
import {
  buildProjectionData,
  calculateProjectionEstimates,
} from "../../utils/predictive";

interface PredictiveChartProps {
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

export const PredictiveChart: React.FC<PredictiveChartProps> = ({
  huchas,
  suscripciones,
  allMovimientos,
}) => {
  const { isLocked, openUnlockModal, formatCurrency } = usePrivacy();
  const totalSavings = useMemo(
    () => huchas.reduce((sum, hucha) => sum + hucha.saldo_acumulado, 0),
    [huchas],
  );
  const estimates = useMemo(
    () => calculateProjectionEstimates(allMovimientos, suscripciones),
    [allMovimientos, suscripciones],
  );
  const projectionData = useMemo(
    () => (estimates ? buildProjectionData(totalSavings, estimates) : []),
    [estimates, totalSavings],
  );

  if (!estimates) {
    return (
      <div className="rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-500 dark:border-slate-700 dark:text-slate-400">
        Datos insuficientes para proyectar liquidez. Necesitas ingresos y un
        historial representativo de movimientos.
      </div>
    );
  }

  const balances = projectionData.map((point) => point.balance);
  const min = Math.min(...balances);
  const max = Math.max(...balances);
  const end = projectionData.at(-1)?.balance ?? totalSavings;
  const diff = end - totalSavings;
  const isAlert = min < totalSavings * 0.15 || min < 50;
  const tooltip = ({
    active,
    payload,
    label,
  }: TooltipContentProps<TooltipValueType, string | number>) =>
    active && payload?.length ? (
      <div className="rounded-xl border border-slate-200 bg-white p-3 text-xs shadow-xl dark:border-slate-700 dark:bg-slate-900">
        <p className="font-bold text-slate-500">{String(label ?? "")}</p>
        <p className="mt-1 font-black text-indigo-600">
          Saldo proyectado: {formatCurrency(toNumericValue(payload[0]?.value))}
        </p>
      </div>
    ) : null;

  return (
    <Card className="dashboard-surface !p-5">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-lg font-extrabold text-slate-800 dark:text-white">
            <TrendingUp size={18} className="text-indigo-500" /> Proyección de
            liquidez
          </h3>
          <p className="text-xs text-slate-500">
            Estimación basada en el promedio de tus movimientos durante{" "}
            {estimates.observedDays} días.
          </p>
        </div>
        {isLocked && (
          <button
            type="button"
            onClick={() => openUnlockModal()}
            className="text-xs font-bold text-indigo-600"
          >
            <Lock size={15} />
          </button>
        )}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2 text-center">
        {[
          ["Mínimo", min],
          ["Máximo", max],
          ["Neto", diff],
        ].map(([label, value]) => (
          <div key={String(label)}>
            <p className="text-[10px] font-bold text-slate-500">{label}</p>
            <p
              className={`text-sm font-black tabular-nums ${label === "Neto" ? (diff >= 0 ? "text-emerald-600" : "text-rose-500") : ""}`}
            >
              {label === "Neto" && diff >= 0 ? "+" : ""}
              {formatCurrency(Number(value))}
            </p>
          </div>
        ))}
      </div>
      <div className="relative mt-4 h-56">
        {isLocked && (
          <div className="absolute inset-0 z-10 grid place-items-center rounded-xl bg-white/70 text-xs font-bold text-slate-500 backdrop-blur-sm dark:bg-slate-950/70">
            <span>
              Proyección protegida ·{" "}
              <button
                type="button"
                onClick={() => openUnlockModal()}
                className="text-indigo-600 underline"
              >
                Desbloquear
              </button>
            </span>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={projectionData}
            margin={{ top: 8, right: 8, left: -20, bottom: 0 }}
          >
            <CartesianGrid
              vertical={false}
              stroke="#e2e8f0"
              strokeDasharray="3 3"
            />
            <XAxis
              dataKey="name"
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 9 }}
            />
            <YAxis
              axisLine={false}
              tickLine={false}
              tick={{ fill: "#64748b", fontSize: 9 }}
            />
            <Tooltip content={tooltip} />
            <Area
              type="monotone"
              dataKey="balance"
              stroke="#6366f1"
              fill="#6366f122"
              strokeWidth={2}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div
        className={`mt-4 flex gap-2 rounded-xl p-3 text-xs ${isAlert ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : "bg-indigo-500/10 text-indigo-700 dark:text-indigo-300"}`}
      >
        {isAlert ? (
          <AlertTriangle size={15} className="shrink-0" />
        ) : (
          <Info size={15} className="shrink-0" />
        )}
        <span>
          {isAlert
            ? "La proyección alcanza un nivel de liquidez bajo. Revisa tus próximos cargos."
            : `Estimación basada en el flujo diario medio observado durante ${estimates.observedDays} días.`}
        </span>
      </div>
    </Card>
  );
};
