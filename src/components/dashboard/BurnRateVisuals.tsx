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
      ? 'bg-rose-500/10 text-rose-600 dark:text-rose-300'
      : percentage > 5
        ? 'bg-sun-500/12 text-sun-600 dark:text-sun-300'
        : 'bg-surface-2 text-ink-soft';

  return (
    <span
      title="Parte del presupuesto mensual de la cartera que se lleva este gasto"
      className={`inline-flex items-center rounded-full px-2 py-0.5 text-[10px] font-bold tabular-nums ${tone} ${className}`}
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

  return (
    <div className="w-full flex flex-col gap-3 p-5 rounded-2xl bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md relative overflow-hidden">
      <div className="relative flex justify-between items-end mb-1">
        <div>
          <div className="flex items-center gap-2 mb-1.5">
            <h4 className="font-extrabold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-wider">
              Vaporizer
            </h4>
            <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-[8px] font-bold tracking-widest uppercase text-slate-500 border border-slate-200/50 dark:border-white/5">
              {period === 'este_mes' ? 'Este Mes' : period === 'mes_pasado' ? 'Mes Pasado' : period === 'este_anio' ? 'Anual' : 'Histórico'}
            </span>
          </div>
          <p className="text-[10px] text-slate-450 dark:text-slate-550 font-semibold uppercase tracking-wider">
            {percentage === 0 ? 'Sin datos de gasto' : `Has consumido el ${percentage}% de los ingresos`}
          </p>
        </div>
        <div className={`text-xl font-black tracking-tight tabular-nums transition-colors duration-500 ${
          isCritical ? 'text-rose-500' : isWarning ? 'text-amber-500' : 'text-emerald-500'
        }`}>
          {percentage}%
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="relative h-2.5 w-full bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden shadow-inner">
        {/* The Fill */}
        <div 
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 ease-out ${
            isCritical 
              ? 'bg-rose-500'
              : isWarning
                ? 'bg-amber-500'
                : 'bg-emerald-500'
          }`}
          style={{ width: `${animatedRatio * 100}%` }}
        />
      </div>
    </div>
  );
};
