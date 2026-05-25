import React from 'react';
import { type Suscripcion } from '../../types';
import { Card } from '../common/Card';
import { 
  Edit3, 
  Trash2, 
  ToggleLeft, 
  ToggleRight, 
  Users, 
  Clock, 
  AlertCircle,
  RotateCcw
} from 'lucide-react';
import { getNextPaymentDate } from '../../hooks/useFinanceData';
import { usePrivacy } from '../../context/PrivacyContext';

interface SuscripcionCardProps {
  suscripcion: Suscripcion;
  onEdit: (sub: Suscripcion) => void;
  onDelete: (sub: Suscripcion) => void;
  onToggle: (sub: Suscripcion) => void;
  onCancel: (sub: Suscripcion) => void;
  onUndoCancel: (sub: Suscripcion) => void;
}

export const SuscripcionCard: React.FC<SuscripcionCardProps> = ({
  suscripcion,
  onEdit,
  onDelete,
  onToggle,
  onCancel,
  onUndoCancel,
}) => {
  const { formatCurrency } = usePrivacy();

  const nextPayment = getNextPaymentDate(suscripcion.dia_pago);
  const nextPaymentStr = nextPayment.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const divisor = suscripcion.frecuencia === 'anual' ? 'anual' : 'mes';

  // Shared bill calculation
  const isShared = suscripcion.mi_parte != null && suscripcion.mi_parte < suscripcion.importe;

  return (
    <Card
      hoverable
      glow={true}
      glowColor={`${suscripcion.color}25`}
      onClick={() => onEdit(suscripcion)}
      className={`relative border border-white/10 dark:border-white/5 transition-all duration-300 ${
        suscripcion.activa
          ? 'bg-white/60 dark:bg-slate-900/30'
          : 'bg-slate-100/30 dark:bg-slate-950/10 opacity-60 grayscale-[15%]'
      }`}
    >
      {/* Dynamic top gradient bar based on custom subscription color */}
      <div 
        className="absolute top-0 left-0 right-0 h-1.5 transition-all duration-300"
        style={{ backgroundColor: suscripcion.color }}
      />

      <div className="flex items-center justify-between gap-3 mt-2 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          {/* Circular Brand Avatar Container */}
          <div 
            className="w-10 h-10 rounded-2xl flex items-center justify-center font-black text-white uppercase text-xs tracking-tighter shrink-0 transition-transform duration-300 group-hover:scale-110 shadow-sm"
            style={{ 
              backgroundColor: suscripcion.color, 
              boxShadow: `0 8px 16px -4px ${suscripcion.color}60`
            }}
          >
            {suscripcion.nombre.substring(0, 2)}
          </div>
          
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="font-extrabold text-slate-800 dark:text-slate-100 text-sm uppercase tracking-tight truncate max-w-[120px]" title={suscripcion.nombre}>
                {suscripcion.nombre}
              </h4>
              
              <span className="inline-block rounded-lg bg-slate-150 dark:bg-slate-800/80 px-2 py-0.5 text-[8px] font-bold text-slate-500 dark:text-slate-400 uppercase tracking-widest">
                {suscripcion.categoria}
              </span>
            </div>
            
            <p className="text-[9px] text-slate-400 font-bold uppercase tracking-wider mt-0.5 flex items-center gap-1">
              <Clock className="w-2.5 h-2.5 text-slate-400" />
              Próximo: {nextPaymentStr}
            </p>
          </div>
        </div>

        {/* Active Toggle Switch */}
        <button
          onClick={(e) => { e.stopPropagation(); onToggle(suscripcion); }}
          className={`shrink-0 transition-all duration-300 focus:outline-none cursor-pointer hover:scale-110 active:scale-95 ${
            suscripcion.activa 
              ? 'text-emerald-500 hover:text-emerald-400 drop-shadow-[0_0_6px_rgba(16,185,129,0.4)]' 
              : 'text-slate-350 dark:text-slate-700 hover:text-slate-400'
          }`}
          title={suscripcion.activa ? 'Desactivar suscripción' : 'Activar suscripción'}
        >
          {suscripcion.activa ? (
            <ToggleRight className="w-10 h-10 transition-transform duration-300" />
          ) : (
            <ToggleLeft className="w-10 h-10 transition-transform duration-300" />
          )}
        </button>
      </div>

      {/* Main modern glass container displaying pricing breakdown */}
      <div className="my-4 p-3.5 rounded-2xl bg-slate-100/50 dark:bg-slate-950/20 border border-slate-200/20 dark:border-white/5 flex items-center justify-between gap-3 shadow-inner">
        <div>
          <span className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tabular-nums tracking-tight">
            {formatCurrency(suscripcion.mi_parte != null ? suscripcion.mi_parte : suscripcion.importe)}
          </span>
          <span className="text-xs text-slate-400 font-bold lowercase ml-1">
            /{divisor}
          </span>
          
          {isShared && (
            <div className="text-[9px] font-black text-emerald-600 dark:text-emerald-400 uppercase mt-1 flex items-center gap-0.5">
              <Users className="w-3 h-3" />
              Tú pagas: {formatCurrency(suscripcion.mi_parte || 0)}
            </div>
          )}
        </div>

        {isShared && (
          <div className="text-right shrink-0">
            <span className="text-[9px] text-slate-400 font-bold block uppercase tracking-wider">
              Original
            </span>
            <span className="text-xs font-black text-slate-500 dark:text-slate-450 tabular-nums">
              {formatCurrency(suscripcion.importe)}
            </span>
          </div>
        )}
      </div>

      {/* Divider */}
      <div className="h-[1px] bg-white/10 dark:bg-white/5 my-4" />

      {/* Footer action buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        
        {/* Cancellation status widget */}
        <div className="flex-1">
          {suscripcion.cancelando ? (
            <div className="flex items-center gap-1.5 text-amber-600 dark:text-amber-400 bg-amber-500/10 border border-amber-500/25 py-1 px-2.5 rounded-xl text-[9px] font-bold uppercase tracking-wider">
              <AlertCircle className="w-3 h-3 shrink-0 animate-pulse" />
              Baja {nextPaymentStr}
            </div>
          ) : (
            suscripcion.activa && (
              <button
                onClick={(e) => { e.stopPropagation(); onCancel(suscripcion); }}
                className="text-[9px] font-bold uppercase tracking-widest text-rose-500 hover:text-rose-600 py-1 px-2 rounded-lg hover:bg-rose-500/5 cursor-pointer transition-all duration-200 hover:scale-105 active:scale-95"
              >
                Solicitar Baja
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {suscripcion.cancelando && (
            <button
              onClick={(e) => { e.stopPropagation(); onUndoCancel(suscripcion); }}
              className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-500/10 hover:bg-indigo-500/20 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm cursor-pointer"
              title="Deshacer baja de suscripción"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            onClick={(e) => { e.stopPropagation(); onEdit(suscripcion); }}
            className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-indigo-500/10 text-slate-400 hover:text-indigo-600 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 border border-white/5 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm cursor-pointer"
            title="Editar suscripción"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          
          <button
            onClick={(e) => { e.stopPropagation(); onDelete(suscripcion); }}
            className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-slate-100 dark:bg-slate-800 hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 border border-white/5 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm cursor-pointer"
            title="Eliminar suscripción"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
};
