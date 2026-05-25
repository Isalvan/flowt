import React from 'react';
import { Card } from '../common/Card';
import { type Hucha } from '../../types';
import { Edit3, Trash2, CreditCard, Lock, CheckCircle, PiggyBank } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';

interface HuchaCardProps {
  hucha: Hucha;
  onEdit: (hucha: Hucha) => void;
  onDelete: (hucha: Hucha) => void;
}

export const HuchaCard: React.FC<HuchaCardProps> = ({ hucha, onEdit, onDelete }) => {
  const hasObjetivo = hucha.objetivo != null && hucha.objetivo > 0;
  const isCapped = !!hucha.tope_objetivo && hasObjetivo;
  const isFull = hasObjetivo && hucha.saldo_acumulado >= (hucha.objetivo || 0);
  
  const rawProgress = hasObjetivo ? (hucha.saldo_acumulado / (hucha.objetivo || 1)) * 100 : 0;
  const progressPercent = Math.min(Math.round(rawProgress), 100);

  // SVG Circular Progress config
  const radius = 21;
  const circumference = 2 * Math.PI * radius;
  const strokeDashoffset = circumference - (Math.min(progressPercent, 100) / 100) * circumference;

  const { isLocked, formatCurrency } = usePrivacy();

  const getContributionLabel = () => {
    if (hucha.tipo_aportacion === 'porcentaje') return `${hucha.valor_aportacion}%`;
    if (hucha.tipo_aportacion === 'flat') {
      return isLocked ? '•• €' : `${hucha.valor_aportacion} €`;
    }
    return 'Resto';
  };

  const getGlowColor = () => {
    if (isFull) return 'rgba(16, 185, 129, 0.12)';
    if (isCapped) return 'rgba(245, 158, 11, 0.12)';
    if (hucha.es_suscripciones) return 'rgba(139, 92, 246, 0.12)';
    if (hucha.es_principal) return 'rgba(59, 130, 246, 0.12)';
    return 'rgba(99, 102, 241, 0.08)';
  };

  return (
    <Card
      hoverable
      glow={true}
      glowColor={getGlowColor()}
      className={`group relative border border-white/10 dark:border-white/5 transition-all duration-300 glass-glare ${
        hucha.es_principal 
          ? 'bg-gradient-to-br from-blue-50/50 via-white/40 to-indigo-50/30 dark:from-blue-950/20 dark:via-slate-900/40 dark:to-indigo-950/15'
          : 'bg-white/60 dark:bg-slate-900/30'
      }`}
    >
      <div className="flex items-start justify-between gap-4 mb-4">
        {/* Title and contribution type badge */}
        <div className="flex-1 min-w-0">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <h4 className="font-extrabold text-slate-800 dark:text-slate-100 text-base leading-tight uppercase tracking-tight truncate max-w-[140px]" title={hucha.nombre}>
              {hucha.nombre}
            </h4>
            
            {hucha.es_suscripciones && (
              <span className="inline-flex items-center gap-0.5 rounded-lg bg-violet-100 dark:bg-violet-950/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-violet-700 dark:text-violet-300">
                <CreditCard className="w-2.5 h-2.5" />
                Auto
              </span>
            )}
            
            {isFull && (
              <span className="inline-flex items-center gap-0.5 rounded-lg bg-emerald-100 dark:bg-emerald-950/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                <CheckCircle className="w-2.5 h-2.5" />
                Lleno
              </span>
            )}
            
            {isCapped && (
              <span className="inline-flex items-center gap-0.5 rounded-lg bg-amber-100 dark:bg-amber-950/50 px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300" title="Tope activo: nuevos fondos se redirigen a hucha Resto">
                <Lock className="w-2.5 h-2.5" />
                Tope
              </span>
            )}
          </div>

          <span className="inline-block rounded-xl bg-slate-900 dark:bg-slate-800 px-3 py-1 text-[9px] font-black uppercase tracking-widest text-slate-100 dark:text-slate-300 shadow-sm">
            Regla: {getContributionLabel()}
          </span>
        </div>

        {/* Quick action buttons - visible on hover or mobile */}
        <div className="flex items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 shrink-0">
          <button
            onClick={() => onEdit(hucha)}
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 hover:bg-indigo-500/10 text-slate-400 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 transition-all duration-200 active:scale-90 cursor-pointer"
            title="Editar cartera"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={() => onDelete(hucha)}
            className="flex items-center justify-center w-8 h-8 rounded-xl bg-slate-100 hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 transition-all duration-200 active:scale-90 cursor-pointer"
            title="Eliminar cartera"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-end justify-between mt-6">
        <div>
          <span className="text-2xl sm:text-3xl font-extrabold text-slate-900 dark:text-white tracking-tight tabular-nums leading-none">
            {formatCurrency(hucha.saldo_acumulado)}
          </span>
          {hasObjetivo && (
            <div className="text-[10px] font-bold text-slate-400 uppercase tracking-widest mt-1">
              Objetivo: {formatCurrency(hucha.objetivo!)}
            </div>
          )}
        </div>

        {/* Circular Progress Wheel */}
        <div className="relative flex items-center justify-center shrink-0 w-14 h-14 bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-white/5 rounded-full shadow-inner">
          {hasObjetivo ? (
            <>
              <svg className="w-12 h-12 -rotate-90 transform">
                {/* Background circle */}
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className="stroke-slate-200 dark:stroke-slate-700 fill-none"
                  strokeWidth="3.5"
                />
                {/* Progress circle */}
                <circle
                  cx="24"
                  cy="24"
                  r={radius}
                  className="stroke-indigo-500 dark:stroke-indigo-400 fill-none transition-all duration-700 ease-out animate-circular-fill"
                  strokeWidth="3.5"
                  strokeDasharray={circumference}
                  strokeDashoffset={strokeDashoffset}
                  strokeLinecap="round"
                />
              </svg>
              <span className="absolute text-[10px] font-extrabold text-slate-700 dark:text-slate-300 tabular-nums flex items-center justify-center">
                {isLocked ? <Lock className="w-3.5 h-3.5 text-indigo-500 dark:text-indigo-400" /> : `${progressPercent}%`}
              </span>
            </>
          ) : (
            <PiggyBank className="w-6 h-6 text-slate-400 dark:text-slate-500" />
          )}
        </div>
      </div>
    </Card>
  );
};
