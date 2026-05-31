import React from 'react';
import { CountUp } from '../common/CountUp';
import { Card } from '../common/Card';
import { type Hucha } from '../../types';
import { Edit3, Trash2, CreditCard, Lock, CheckCircle, PiggyBank } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { VesselSVG } from '../ui/svg/VesselSVG';

interface HuchaCardProps {
  hucha: Hucha;
  onEdit: (hucha: Hucha) => void;
  onDelete: (hucha: Hucha) => void;
}

export const HuchaCard: React.FC<HuchaCardProps> = ({ hucha, onEdit, onDelete }) => {
  const hasObjetivo = hucha.objetivo != null && hucha.objetivo > 0;
  const isCapped = !!hucha.tope_objetivo && hasObjetivo;
  const isFull = hasObjetivo && hucha.saldo_acumulado >= (hucha.objetivo || 0);
  
  const rawProgress = hasObjetivo ? (hucha.saldo_acumulado / (hucha.objetivo || 1)) : 0;
  const progressFraction = Math.min(Math.max(rawProgress, 0), 1);
  const progressPercent = Math.round(progressFraction * 100);

  const { isLocked } = usePrivacy();

  const getContributionLabel = () => {
    if (hucha.tipo_aportacion === 'porcentaje') return `${hucha.valor_aportacion}%`;
    if (hucha.tipo_aportacion === 'flat') {
      return isLocked ? '•• €' : `${hucha.valor_aportacion} €`;
    }
    return 'Resto';
  };

  const getHuchaColor = () => {
    if (isFull) return '#10b981'; // Emerald
    if (isCapped) return '#f59e0b'; // Amber
    if (hucha.es_suscripciones) return '#a855f7'; // Purple
    if (hucha.es_principal) return '#3b82f6'; // Blue
    if (hucha.es_metalico) return '#14b8a6'; // Teal
    
    // Deterministic random color based on name length for variety
    const colors = ['#0ea5e9', '#ec4899', '#f43f5e', '#8b5cf6', '#06b6d4'];
    return colors[hucha.nombre.length % colors.length];
  };

  const colorHex = getHuchaColor();

  return (
    <Card
      hoverable
      onClick={() => onEdit(hucha)}
      className="group relative border border-slate-200 dark:border-white/5 bg-white/80 dark:bg-slate-950/80 backdrop-blur-2xl transition-all duration-500 overflow-hidden shadow-lg"
    >
      {/* Background ambient glow based on hucha color */}
      <div 
        className="absolute top-0 right-0 w-32 h-32 blur-[60px] opacity-20 pointer-events-none group-hover:opacity-40 transition-opacity duration-500"
        style={{ backgroundColor: colorHex }}
      />

      <div className="flex justify-between items-start mb-2 relative z-10">
        <div className="flex-1 min-w-0 pr-4">
          <div className="flex flex-wrap items-center gap-1.5 mb-2">
            <h4 className="font-black text-slate-800 dark:text-white text-lg leading-tight uppercase tracking-widest truncate">
              {hucha.nombre}
            </h4>
            
            {hucha.es_suscripciones && (
              <span className="text-[10px] text-violet-400 font-bold uppercase tracking-wider bg-violet-500/10 px-1.5 py-0.5 rounded border border-violet-500/20">
                <CreditCard className="w-3 h-3 inline mr-1" />Auto
              </span>
            )}
            
            {isFull && (
              <span className="text-[10px] text-emerald-400 font-bold uppercase tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded border border-emerald-500/20">
                <CheckCircle className="w-3 h-3 inline mr-1" />Lleno
              </span>
            )}
          </div>

          <span className="inline-block border border-slate-200 dark:border-white/10 bg-slate-50 dark:bg-white/5 px-2 py-0.5 text-[9px] font-bold uppercase tracking-widest text-slate-500 dark:text-slate-400">
            Regla: {getContributionLabel()}
          </span>
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity duration-300">
          <button
            onClick={(e) => { e.stopPropagation(); onEdit(hucha); }}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-slate-200 dark:hover:bg-white/10 text-slate-400 hover:text-slate-800 dark:hover:text-white transition-colors"
          >
            <Edit3 className="w-4 h-4" />
          </button>
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(hucha); }}
            className="p-1.5 rounded-lg bg-slate-100 dark:bg-white/5 hover:bg-rose-500/20 text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors"
          >
            <Trash2 className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="flex items-center justify-between mt-6 relative z-10">
        <div className="flex flex-col">
          <span className="text-3xl font-black text-slate-800 dark:text-white tracking-tighter drop-shadow-lg">
            {isLocked ? '•••• €' : <CountUp end={hucha.saldo_acumulado} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1.5} />}
          </span>
          {hasObjetivo && (
            <div className="text-[10px] font-bold text-slate-500 uppercase tracking-widest mt-1">
              Obj: {isLocked ? '•• €' : <CountUp end={hucha.objetivo!} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1.5} />}
            </div>
          )}
        </div>

        {/* Custom SVG Vessel representing the Hucha */}
        <div className="relative shrink-0 flex items-center justify-center">
          {hasObjetivo ? (
            <div className="relative w-16 h-20 group-hover:scale-105 transition-transform duration-500">
              <VesselSVG progress={progressFraction} colorHex={colorHex} className="w-full h-full drop-shadow-xl" />
              <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
                <span className="text-[9px] font-black text-slate-800 dark:text-white mix-blend-difference">
                  {isLocked ? <Lock className="w-3 h-3" /> : `${progressPercent}%`}
                </span>
              </div>
            </div>
          ) : (
            <div className="w-16 h-20 flex items-center justify-center bg-slate-100 dark:bg-white/5 rounded-xl border border-slate-200 dark:border-white/10">
              <PiggyBank className="w-8 h-8 text-slate-500 opacity-50" />
            </div>
          )}
        </div>
      </div>
    </Card>
  );
};
