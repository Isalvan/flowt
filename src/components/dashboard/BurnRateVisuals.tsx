import { useEffect, useState } from 'react';

// ExpenseImpactBadge Component
export const ExpenseImpactBadge = ({
  percentage,
  className = '',
}: {
  percentage: number;
  className?: string;
}) => {
  let severity = 'neutral';
  if (percentage > 10) severity = 'critical';
  else if (percentage > 5) severity = 'warning';

  const baseStyles = "relative inline-flex items-center justify-center px-3 py-1 rounded-full text-xs font-bold uppercase tracking-wider overflow-hidden backdrop-blur-md border shadow-lg transition-all duration-300";
  
  const severityStyles: Record<string, string> = {
    critical: "bg-red-500/20 border-red-500/50 text-red-100 shadow-[0_0_15px_rgba(239,68,68,0.5),inset_0_0_10px_rgba(239,68,68,0.2)] animate-pulse-shake",
    warning: "bg-amber-500/20 border-amber-500/50 text-amber-100 shadow-[0_0_10px_rgba(245,158,11,0.3),inset_0_0_5px_rgba(245,158,11,0.1)]",
    neutral: "bg-slate-500/20 border-slate-500/30 text-slate-300 shadow-[0_0_5px_rgba(148,163,184,0.1)]"
  };

  const glowStyles: Record<string, string> = {
    critical: "bg-red-400",
    warning: "bg-amber-400",
    neutral: "bg-slate-400"
  };

  return (
    <>
      <style>{`
        @keyframes pulse-shake {
          0%, 100% { transform: scale(1) rotate(0deg); }
          25% { transform: scale(1.02) rotate(1deg); }
          50% { transform: scale(1.04) rotate(-1deg); }
          75% { transform: scale(1.02) rotate(0.5deg); }
        }
        .animate-pulse-shake {
          animation: pulse-shake 2s infinite ease-in-out;
        }
      `}</style>
      <div className={`${baseStyles} ${severityStyles[severity]} ${className}`}>
        {/* Inner glow element */}
        <span className={`absolute -top-2 -left-2 w-8 h-8 rounded-full blur-xl opacity-50 ${glowStyles[severity]}`}></span>
        
        <span className="relative z-10 drop-shadow-md">
          Impact: {percentage.toFixed(1)}%
        </span>
        
        {/* Glossy top highlight for 3D effect */}
        <span className="absolute top-0 left-0 right-0 h-1/2 bg-gradient-to-b from-white/20 to-transparent rounded-t-full"></span>
      </div>
    </>
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
