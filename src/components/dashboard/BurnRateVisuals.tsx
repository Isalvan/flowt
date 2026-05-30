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
    <div className="w-full flex flex-col gap-3 p-6 rounded-[2rem] bg-white/40 dark:bg-slate-900/40 backdrop-blur-xl border border-white/40 dark:border-white/10 shadow-2xl shadow-indigo-500/5 relative overflow-hidden group">
      {/* Subtle background glow depending on status */}
      <div className={`absolute -inset-20 opacity-20 blur-[100px] transition-colors duration-1000 ${
        isCritical ? 'bg-rose-500' : isWarning ? 'bg-amber-500' : 'bg-teal-500'
      }`} />
      
      <div className="relative flex justify-between items-end">
        <div>
          <h4 className="font-black text-lg text-slate-800 dark:text-slate-100 tracking-tight flex items-center gap-3">
            Vaporizer 
            <span className="px-2.5 py-1 rounded-full bg-slate-200/50 dark:bg-slate-800/50 text-[9px] font-black tracking-widest uppercase text-slate-500 dark:text-slate-400 border border-slate-300/30 dark:border-white/5">
              {period === 'este_mes' ? 'Burn Rate Este Mes' : period === 'mes_pasado' ? 'Burn Rate Mes Pasado' : period === 'este_anio' ? 'Burn Rate Anual' : 'Burn Rate Histórico'}
            </span>
          </h4>
          <p className="text-[11px] text-slate-500 font-semibold tracking-wider mt-1">
            {percentage === 0 ? 'Sin datos de gasto' : `Has vaporizado el ${percentage}% de tus ingresos`}
          </p>
        </div>
        <div className={`text-2xl font-black tracking-tighter tabular-nums drop-shadow-sm transition-colors duration-500 ${
          isCritical ? 'text-red-500' : isWarning ? 'text-amber-500' : 'text-emerald-500'
        }`}>
          {percentage}%
        </div>
      </div>

      {/* Progress Bar Container */}
      <div className="relative h-5 w-full bg-slate-200/50 dark:bg-slate-950/50 rounded-full overflow-hidden shadow-[inset_0_2px_4px_rgba(0,0,0,0.1)] border border-white/20 dark:border-white/5">
        {/* The Fill */}
        <div 
          className={`absolute top-0 left-0 h-full rounded-full transition-all duration-1000 cubic-bezier(0.34, 1.56, 0.64, 1) ${
            isCritical 
              ? 'bg-gradient-to-r from-rose-500 via-red-500 to-orange-500 shadow-[0_0_20px_rgba(244,63,94,0.6)]'
              : isWarning
                ? 'bg-gradient-to-r from-amber-400 via-orange-400 to-rose-400 shadow-[0_0_20px_rgba(251,191,36,0.6)]'
                : 'bg-gradient-to-r from-teal-400 via-emerald-400 to-cyan-400 shadow-[0_0_20px_rgba(52,211,153,0.6)]'
          }`}
          style={{ width: `${animatedRatio * 100}%` }}
        >
          {/* Inner glass highlight */}
          <div className="absolute inset-0 bg-gradient-to-b from-white/30 to-transparent rounded-full" />
          {/* Pulsing effect if critical */}
          {isCritical && (
            <div className="absolute inset-0 bg-white/20 animate-pulse rounded-full" />
          )}
        </div>
      </div>
    </div>
  );
};
