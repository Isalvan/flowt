import React, { useMemo } from 'react';
import { 
  Activity, 
  TrendingUp, 
  PiggyBank, 
  CreditCard, 
  Lightbulb,
  Target, 
  CheckCircle2, 
  AlertCircle,
  ShieldCheck,
  RefreshCw
} from 'lucide-react';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { calculateFinancialHealthScore } from '../../utils/healthScore';

interface SaludFinancieraViewProps {
  movimientos: Movimiento[];
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  userStats: { total_ingresos: number; total_gastos: number } | null;
}

export const SaludFinancieraView: React.FC<SaludFinancieraViewProps> = ({
  movimientos,
  huchas,
  suscripciones,
  userStats
}) => {
  const healthData = useMemo(() => {
    const totalIngresos = userStats?.total_ingresos || 0;
    const totalGastos = userStats?.total_gastos || 0;
    return calculateFinancialHealthScore(movimientos, huchas, suscripciones, totalIngresos, totalGastos);
  }, [movimientos, huchas, suscripciones, userStats]);

  const { totalScore, category, metrics, recommendations } = healthData;

  // Circular gauge calculations
  const radius = 70;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (totalScore / 100) * circumference;

  const getScoreColor = (score: number) => {
    if (score < 45) return '#ef4444'; // Red
    if (score < 75) return '#f59e0b'; // Amber
    return '#10b981'; // Emerald
  };

  const scoreColor = getScoreColor(totalScore);

  return (
    <div className="space-y-8 animate-in fade-in slide-in-from-bottom-4 duration-700">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div className="flex flex-col gap-2">
          <h2 className="text-3xl font-black text-slate-800 dark:text-white tracking-tight flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-indigo-500/10 dark:bg-indigo-500/20 text-indigo-600 dark:text-indigo-400">
              <Activity size={28} className="drop-shadow-sm" />
            </div>
            Salud Financiera
          </h2>
          <p className="text-sm font-medium text-slate-500 dark:text-slate-400 pl-14">
            Evaluación continua de tu tasa de ahorro, estabilidad y balance financiero.
          </p>
        </div>
      </div>

      {/* Main Score Hero Card */}
      <div className="relative overflow-hidden rounded-[2.5rem] border border-slate-200/50 dark:border-white/10 bg-white/70 dark:bg-slate-900/70 backdrop-blur-2xl p-8 md:p-12 shadow-xl flex flex-col md:flex-row items-center justify-between gap-8">
        
        {/* Left: Gauge & Score */}
        <div className="flex flex-col items-center text-center">
          <div className="relative w-48 h-48 flex items-center justify-center">
            <svg className="w-full h-full transform -rotate-90" viewBox="0 0 160 160">
              {/* Background Ring */}
              <circle
                cx="80"
                cy="80"
                r={radius}
                className="text-slate-100 dark:text-slate-800"
                strokeWidth="14"
                stroke="currentColor"
                fill="transparent"
              />
              {/* Score Animated Ring */}
              <circle
                cx="80"
                cy="80"
                r={radius}
                stroke={scoreColor}
                strokeWidth="14"
                strokeDasharray={circumference}
                strokeDashoffset={strokeDashoffset}
                strokeLinecap="round"
                fill="transparent"
                className="transition-all duration-1000 ease-out"
              />
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              <span className="text-5xl font-black tracking-tight text-slate-800 dark:text-white">
                {totalScore}
              </span>
              <span className="text-xs font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                de 100
              </span>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2">
            <span className={`px-4 py-1.5 rounded-full text-sm font-bold border shadow-sm flex items-center gap-2 ${healthData.colorClass}`}>
              <ShieldCheck size={16} />
              {category}
            </span>
          </div>
        </div>

        {/* Right: Summary Message */}
        <div className="flex-1 space-y-4 text-center md:text-left">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold border border-slate-200/50 dark:border-white/5">
            <Target size={14} className="text-emerald-500" />
            Diagnóstico Financiero en Tiempo Real
          </div>
          <h3 className="text-2xl font-bold text-slate-800 dark:text-white">
            {totalScore >= 75 && '¡Tus finanzas están en un excelente estado de equilibrio!'}
            {totalScore >= 45 && totalScore < 75 && 'Tu salud financiera es estable, con margen de optimización.'}
            {totalScore < 45 && 'Tus finanzas requieren atención prioritaria para frenar desbalances.'}
          </h3>
          <p className="text-sm text-slate-600 dark:text-slate-300 leading-relaxed max-w-xl">
            El Score de Salud Financiera evalúa continuamente 4 pilares: tu ratio de ahorro mensual, la estabilidad de tus huchas, la tendencia de flujo de caja y la presión de tus suscripciones activas.
          </p>
        </div>
      </div>

      {/* Grid of 4 Breakdown Metrics */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {metrics.map((metric) => {
          const color = getScoreColor(metric.score);

          return (
            <div
              key={metric.id}
              className="rounded-[2rem] border border-slate-200/50 dark:border-white/10 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-6 shadow-md hover:shadow-lg transition-all duration-300"
            >
              <div className="flex items-center justify-between mb-3">
                <span className="text-sm font-bold text-slate-700 dark:text-slate-200">
                  {metric.label}
                </span>
                <span className="text-sm font-black px-2.5 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-white">
                  {metric.score} / 100
                </span>
              </div>

              {/* Progress Bar */}
              <div className="w-full h-3 bg-slate-100 dark:bg-slate-800 rounded-full overflow-hidden mb-3">
                <div
                  className="h-full rounded-full transition-all duration-700 ease-out"
                  style={{ width: `${metric.score}%`, backgroundColor: color }}
                />
              </div>

              <div className="flex items-center justify-between text-xs text-slate-500 dark:text-slate-400">
                <span>{metric.description}</span>
                <span className="font-bold text-slate-700 dark:text-slate-300">{metric.valueFormatted}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Actionable Recommendations */}
      <div className="rounded-[2rem] border border-slate-200/50 dark:border-white/10 bg-white/60 dark:bg-slate-900/60 backdrop-blur-xl p-8 shadow-lg space-y-6">
        <div className="flex items-center gap-3">
          <div className="p-2.5 rounded-xl bg-amber-500/10 text-amber-500 border border-amber-500/20">
            <Lightbulb size={20} />
          </div>
          <div>
            <h4 className="text-lg font-bold text-slate-800 dark:text-white">
              Acciones Recomendadas
            </h4>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Sugerencias prácticas para optimizar tu presupuesto este mes.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4">
          {recommendations.map((rec, index) => (
            <div
              key={index}
              className="flex items-start gap-4 p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-800/40 border border-slate-200/40 dark:border-white/5 shadow-sm"
            >
              <div className="mt-0.5 p-1 rounded-full bg-emerald-500/10 text-emerald-500 shrink-0">
                <CheckCircle2 size={18} />
              </div>
              <p className="text-sm font-medium text-slate-700 dark:text-slate-200 leading-relaxed">
                {rec}
              </p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};
