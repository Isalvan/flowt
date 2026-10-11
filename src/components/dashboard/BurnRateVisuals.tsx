import { useEffect, useState } from 'react';

// ExpenseImpactBadge Component
// How much of the wallet's monthly budget a single expense takes.
export const ExpenseImpactBadge = ({
  percentage,
  className = '',
}: {
  percentage: number;
  className?: string;
}) => {
  const tone =
    percentage > 10
      ? 'bg-rose-500/10 text-rose-500 dark:text-rose-400'
      : percentage > 5
        ? 'bg-sun-500/12 text-sun-600 dark:text-sun-400'
        : 'bg-surface-2 text-ink-soft';

  return (
    <span
      title="Parte del presupuesto mensual de la cartera que se lleva este gasto"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-bold tabular-nums ${tone} ${className}`}
    >
      {percentage.toLocaleString('es-ES', { maximumFractionDigits: 1 })}% del presupuesto
    </span>
  );
};

// GlobalBurnBar Component (All-Time Retroactive Health Bar)
export const GlobalBurnBar = ({
  totalIngresos,
  totalGastos,
  period
}: {
  totalIngresos: number;
  totalGastos: number;
  period: 'este_mes' | 'mes_pasado' | 'este_anio' | 'historico';
}) => {
  const [animatedRatio, setAnimatedRatio] = useState(0);
  
  const ratio = totalIngresos > 0 ? (totalGastos / totalIngresos) : 0;
  const cappedRatio = Math.min(Math.max(ratio, 0), 1);

  useEffect(() => {
    const timeout = setTimeout(() => {
      setAnimatedRatio(cappedRatio);
    }, 200);
    return () => clearTimeout(timeout);
  }, [cappedRatio]);

  const percentage = Math.round(ratio * 100);
  
  // Determine state based on percentage
  const isCritical = percentage >= 85;
  const isWarning = percentage >= 65 && !isCritical;
  const meterColor = isCritical ? 'text-rose-500' : isWarning ? 'text-sun-500' : 'text-emerald-500';

  return (
    <div className="dashboard-surface w-full p-5 flex flex-col gap-3">
      <div className="flex justify-between items-end mb-1">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h4 className="dashboard-heading">
              Vaporizer
            </h4>
            <span className="rounded-md bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
              {period === 'este_mes' ? 'Este mes' : period === 'mes_pasado' ? 'Mes pasado' : period === 'este_anio' ? 'Anual' : 'Histórico'}
            </span>
          </div>
          <p className="dashboard-subtitle">
            {percentage === 0 ? 'Sin datos de gasto' : `Has consumido el ${percentage}% de los ingresos`}
          </p>
        </div>
        <div className={`figure text-xl ${
          isCritical ? 'text-rose-500 dark:text-rose-400' : isWarning ? 'text-sun-500' : 'text-emerald-600 dark:text-emerald-400'
        }`}>
          {percentage}%
        </div>
      </div>

      {/* Progress Bar Container: flow-meter */}
      <div
        role="progressbar"
        aria-label="Ritmo de gasto"
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={percentage}
        className="flow-meter"
      >
        {percentage > 0 && (
          <i
            className={meterColor}
            style={{ width: `${animatedRatio * 100}%` }}
          />
        )}
      </div>
    </div>
  );
};
