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
import { calcAnual, getCancellationDate, getNextSubscriptionChargeDate } from '../../utils/subscriptions';
import { ServiceIcon } from '../dashboard/ServiceIcon';
import { CATEGORIA_OPTIONS } from '../../hooks/useFinanceData';
import { usePrivacy } from '../../context/PrivacyContext';

interface SuscripcionCardProps {
  suscripcion: Suscripcion;
  totalAnualActivo: number;
  onEdit: (sub: Suscripcion) => void;
  onDelete: (sub: Suscripcion) => void;
  onToggle: (sub: Suscripcion) => void;
  onCancel: (sub: Suscripcion) => void;
  onUndoCancel: (sub: Suscripcion) => void;
}

export const SuscripcionCard: React.FC<SuscripcionCardProps> = ({
  suscripcion,
  totalAnualActivo,
  onEdit,
  onDelete,
  onToggle,
  onCancel,
  onUndoCancel,
}) => {
  const { formatCurrency } = usePrivacy();
  const costeAnual = calcAnual(suscripcion);
  const pesoAnual = totalAnualActivo > 0 ? costeAnual / totalAnualActivo * 100 : 0;

  const nextPayment = suscripcion.cancelando
    ? getCancellationDate(suscripcion) ?? getNextSubscriptionChargeDate(suscripcion)
    : getNextSubscriptionChargeDate(suscripcion);
  const nextPaymentStr = nextPayment.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
  const divisor = {
    mensual: 'mes',
    trimestral: 'trimestre',
    semestral: 'semestre',
    anual: 'año',
  }[suscripcion.frecuencia];

  // Shared bill calculation
  const isShared = suscripcion.mi_parte != null && suscripcion.mi_parte < suscripcion.importe;

  return (
    <Card
      hoverable
      onClick={() => onEdit(suscripcion)}
      className={`flex flex-col transition-opacity ${suscripcion.activa ? '' : 'opacity-60'}`}
    >
      {/* Top color bar */}
      <div 
        className="absolute top-0 left-0 right-0 h-1 transition-colors"
        style={{ backgroundColor: suscripcion.color }}
      />

      <div className="flex items-center justify-between gap-3 mt-1 mb-4">
        <div className="flex items-center gap-3 min-w-0">
          <ServiceIcon name={suscripcion.nombre} color={suscripcion.color} />
          
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <h4 className="truncate text-sm font-bold text-ink" title={suscripcion.nombre}>
                {suscripcion.nombre}
              </h4>
              
              <span className="inline-block rounded-lg bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-ink-soft">
                {CATEGORIA_OPTIONS.find(option => option.value === suscripcion.categoria)?.label ?? suscripcion.categoria}
              </span>
            </div>
            
            <p className="text-[11px] text-ink-faint font-semibold mt-0.5 flex items-center gap-1">
              <Clock className="w-3 h-3 text-ink-faint" />
              Próximo: {nextPaymentStr}
            </p>
          </div>
        </div>

        {/* Active Toggle Switch */}
        <button
          type="button"
          onClick={(e) => { e.stopPropagation(); onToggle(suscripcion); }}
          className={`shrink-0 transition-colors focus:outline-none cursor-pointer ${
            suscripcion.activa 
              ? 'text-emerald-500 hover:text-emerald-600' 
              : 'text-ink-faint hover:text-ink'
          }`}
          title={suscripcion.activa ? 'Desactivar suscripción' : 'Activar suscripción'}
          aria-label={suscripcion.activa ? 'Desactivar suscripción' : 'Activar suscripción'}
        >
          {suscripcion.activa ? (
            <ToggleRight className="w-9 h-9" />
          ) : (
            <ToggleLeft className="w-9 h-9" />
          )}
        </button>
      </div>

      {/* Main pricing breakdown panel */}
      <div className="my-4 p-3.5 rounded-2xl bg-surface-2 flex items-center justify-between gap-3">
        <div>
          <span className="figure text-xl sm:text-2xl text-ink">
            {formatCurrency(suscripcion.mi_parte != null ? suscripcion.mi_parte : suscripcion.importe)}
          </span>
          <span className="text-xs text-ink-soft lowercase ml-1">
            /{divisor}
          </span>
          {suscripcion.activa && (
            <div className="text-[11px] text-ink-soft mt-1 space-y-1">
              <p>{formatCurrency(costeAnual)} al año</p>
              <p>{pesoAnual.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de tus suscripciones</p>
            </div>
          )}
          
          {isShared && (
            <div className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 mt-1 flex items-center gap-0.5">
              <Users className="w-3 h-3" />
              Tú pagas: {formatCurrency(suscripcion.mi_parte || 0)}
            </div>
          )}
        </div>

        {isShared && (
          <div className="text-right shrink-0">
            <span className="text-[11px] text-ink-faint font-semibold block">
              Original
            </span>
            <span className="text-xs font-bold text-ink-soft tabular-nums">
              {formatCurrency(suscripcion.importe)}
            </span>
          </div>
        )}
      </div>

      {/* Pushed to the foot, so the actions of every card in a row line up. */}
      <div className="h-px shrink-0 bg-line mb-4 mt-auto" />

      {/* Footer action buttons */}
      <div className="flex items-center justify-between gap-3 flex-wrap">
        
        {/* Cancellation status widget */}
        <div className="flex-1">
          {suscripcion.cancelando ? (
            <div className="notice is-warning !py-1 !px-2.5 !text-[11px] font-semibold w-fit">
              <AlertCircle className="w-3.5 h-3.5 shrink-0" />
              Baja {nextPaymentStr}
            </div>
          ) : (
            suscripcion.activa && (
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onCancel(suscripcion); }}
                className="text-xs font-semibold text-rose-500 hover:text-rose-600 py-1 px-2 rounded-lg hover:bg-rose-500/10 transition-colors"
              >
                Solicitar baja
              </button>
            )
          )}
        </div>

        <div className="flex items-center gap-1 shrink-0">
          {suscripcion.cancelando && (
            <button
              type="button"
              onClick={(e) => { e.stopPropagation(); onUndoCancel(suscripcion); }}
              className="dashboard-icon-button"
              title="Deshacer baja de suscripción"
              aria-label="Deshacer baja de suscripción"
            >
              <RotateCcw className="w-3.5 h-3.5" />
            </button>
          )}

          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onEdit(suscripcion); }}
            className="dashboard-icon-button"
            title="Editar suscripción"
            aria-label="Editar suscripción"
          >
            <Edit3 className="w-3.5 h-3.5" />
          </button>
          
          <button
            type="button"
            onClick={(e) => { e.stopPropagation(); onDelete(suscripcion); }}
            className="dashboard-icon-button is-danger"
            title="Eliminar suscripción"
            aria-label="Eliminar suscripción"
          >
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </Card>
  );
};
