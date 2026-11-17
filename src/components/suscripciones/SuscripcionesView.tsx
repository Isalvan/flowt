import React, { useState } from 'react';
import { type Suscripcion, type Hucha, type Movimiento } from '../../types';
import { SuscripcionCard } from './SuscripcionCard';
import { Card } from '../common/Card';
import { EmptyIllustration } from '../common/EmptyIllustration';
import { 
  Plus, 
  CreditCard, 
  TrendingUp, 
  Users,
  Filter
} from 'lucide-react';
import { CATEGORIA_OPTIONS, calcMensual } from '../../hooks/useFinanceData';
import { usePrivacy } from '../../context/PrivacyContext';
import { calcAnual } from '../../utils/subscriptions';
import { useRecurringAlerts } from '../../hooks/useRecurringAlerts';

interface SuscripcionesViewProps {
  suscripciones: Suscripcion[];
  huchas: Hucha[];
  ingresoMensualHabitual?: number;
  movimientos?: Movimiento[];
  userId?: string;
  onOpenSuscripcionModal: (editingSub: Suscripcion | null, draft?: Partial<Suscripcion>) => void;
  onUpdateSuscripcion?: (s: Suscripcion) => Promise<void>;
  onDeleteSuscripcion: (s: Suscripcion) => void;
  onToggleSuscripcion: (s: Suscripcion) => void;
  onCancelSuscripcion: (s: Suscripcion) => void;
  onUndoCancelSuscripcion: (s: Suscripcion) => void;
}

export const SuscripcionesView: React.FC<SuscripcionesViewProps> = ({
  suscripciones,
  huchas,
  ingresoMensualHabitual,
  movimientos = [],
  userId = 'demo',
  onUpdateSuscripcion,
  onOpenSuscripcionModal,
  onDeleteSuscripcion,
  onToggleSuscripcion,
  onCancelSuscripcion,
  onUndoCancelSuscripcion,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [notice, setNotice] = useState('');
  const [updating, setUpdating] = useState<string | null>(null);
  const { candidates, priceChanges, dismiss, count } = useRecurringAlerts(movimientos, suscripciones, userId);

  const { formatCurrency } = usePrivacy();

  // Math summary
  const myActualPrice = suscripciones
    .filter(s => s.activa)
    .reduce((sum, s) => sum + calcMensual(s), 0);

  const totalOriginalPrice = suscripciones
    .filter(s => s.activa)
    .reduce((sum, s) => {
      const divisor = s.frecuencia === 'anual' ? 12 : s.frecuencia === 'semestral' ? 6 : s.frecuencia === 'trimestral' ? 3 : 1;
      return sum + (s.importe / divisor);
    }, 0);

  const savedSharedPrice = Math.max(0, totalOriginalPrice - myActualPrice);
  const totalAnualActivo = Number(suscripciones
    .filter(s => s.activa)
    .reduce((sum, s) => sum + calcAnual(s), 0).toFixed(2));
  const porcentajeIngresos = ingresoMensualHabitual != null
    && Number.isFinite(ingresoMensualHabitual) && ingresoMensualHabitual > 0
    ? totalAnualActivo / (ingresoMensualHabitual * 12) * 100
    : null;

  const activeCount = suscripciones.filter(s => s.activa).length;
  const inactiveCount = suscripciones.length - activeCount;

  // Filter subscriptions
  const filteredSubs = (selectedCategory
    ? suscripciones.filter(s => s.categoria === selectedCategory)
    : [...suscripciones]).sort((a, b) => {
      if (a.activa !== b.activa) return a.activa ? -1 : 1;
      return a.activa ? calcAnual(b) - calcAnual(a) : 0;
    });

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header & main action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
            Suscripciones recurrentes
          </h2>
          <p className="dashboard-subtitle">Previsión y distribución automática de cargos periódicos</p>
        </div>

        <button
          type="button"
          onClick={() => onOpenSuscripcionModal(null)}
          className="dashboard-primary-button self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Nueva suscripción
        </button>
      </div>

      {/* 2. Top Overview Cards */}
      <div className="grid gap-4 grid-cols-2 xl:grid-cols-5">
        
        {/* Total Monthly Equivalent budget */}
        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="dashboard-label">Presupuesto mensual</span>
            <CreditCard className="w-4 h-4 text-brand-ink" />
          </div>
          <div className="mt-3.5">
            <span className="figure text-2xl sm:text-3xl text-ink">
              {formatCurrency(myActualPrice)}
            </span>
            <p className="text-xs text-ink-soft mt-1">
              Reservado mensualmente en hucha
            </p>
          </div>
        </Card>

        {/* Active counter */}
        <Card className="flex flex-col justify-between">
          <div className="dashboard-label mb-1">
            Suscripciones activas
          </div>
          <div className="mt-2.5">
            <span className="figure text-2xl text-ink">
              {activeCount}
            </span>
            <span className="text-xs text-ink-soft ml-1.5 font-semibold">
              servicios
            </span>
            <p className="text-xs text-ink-soft mt-1.5">
              {inactiveCount} en espera / pausados
            </p>
          </div>
        </Card>

        {/* Saved Shared Payment Split */}
        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="dashboard-label">Gastos compartidos</span>
            <Users className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
          </div>
          <div className="mt-3.5">
            <span className="figure text-2xl text-ink">
              {formatCurrency(savedSharedPrice)}
            </span>
            <span className="text-xs text-ink-soft ml-1 font-semibold">
              /mes
            </span>
            <p className="text-xs text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
              Ahorro recuperado por reembolsos
            </p>
          </div>
        </Card>

        {/* Hucha current reserve status */}
        <Card className="flex flex-col justify-between">
          <div className="flex items-center justify-between">
            <span className="dashboard-label">Fondo en cartera</span>
            <TrendingUp className="w-4 h-4 text-brand-ink" />
          </div>
          <div className="mt-3.5">
            <span className="figure text-2xl text-ink">
              {formatCurrency(huchas.find(h => h.es_suscripciones)?.saldo_acumulado ?? 0)}
            </span>
            <p className="text-xs text-ink-soft mt-1">
              Acumulado actual para cobros
            </p>
          </div>
        </Card>
        <Card className="flex flex-col justify-between col-span-2 xl:col-span-1">
          <div className="dashboard-label">Coste anual</div>
          <div className="mt-3.5">
            <span className="figure text-2xl text-ink">
              {formatCurrency(totalAnualActivo)}
            </span>
            {porcentajeIngresos != null && (
              <p className="text-xs text-ink-soft mt-1">
                {porcentajeIngresos.toLocaleString('es-ES', { maximumFractionDigits: 1 })} % de lo que ingresas
              </p>
            )}
          </div>
        </Card>
      </div>

      {notice && <p role="status" className="text-sm text-ink-soft">{notice}</p>}
      {count > 0 && (
        <section aria-label="Avisos" className="space-y-3">
          <h3 className="dashboard-heading">Avisos</h3>
          {candidates.map(candidate => (
            <Card key={`new:${candidate.key}`} className="space-y-3">
              <p className="text-sm text-ink">
                Hemos detectado un cargo que se repite: <strong>{candidate.nombre}</strong>, {formatCurrency(candidate.importe)} al mes desde hace {candidate.meses} meses.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" className="dashboard-primary-button" onClick={() => onOpenSuscripcionModal(null, {
                  nombre: candidate.nombre, importe: candidate.importe, frecuencia: 'mensual',
                  dia_pago: candidate.dia_pago, fecha_inicio: candidate.fecha_inicio, categoria: candidate.categoria,
                  hucha_id: huchas.find(h => h.es_suscripciones)?.id ?? null,
                })}>Añadir como suscripción</button>
                <button type="button" className="dashboard-secondary-button" onClick={() => dismiss(`new:${candidate.key}`)}>No es una suscripción</button>
              </div>
            </Card>
          ))}
          {priceChanges.map(change => (
            <Card key={`price:${change.suscripcionId}:${change.movimientoId}`} className="space-y-3">
              <p className="text-sm text-ink">
                <strong>{change.nombre}</strong> ha subido de {formatCurrency(change.importeAnterior)} a {formatCurrency(change.importeNuevo)} (+{formatCurrency(change.diferenciaMensual)} al mes, +{formatCurrency(change.diferenciaAnual)} al año).
              </p>
              {suscripciones.find(s => s.id === change.suscripcionId)?.mi_parte != null && (
                <p className="text-xs text-ink-soft">Es compartida: conservaremos tu parte. Revisa si necesitas ajustarla.</p>
              )}
              <div className="flex flex-wrap gap-2">
                <button type="button" className="dashboard-primary-button" disabled={updating !== null || !onUpdateSuscripcion} onClick={async () => {
                  const subscription = suscripciones.find(s => s.id === change.suscripcionId);
                  if (!subscription || !onUpdateSuscripcion) return;
                  setUpdating(subscription.id);
                  try {
                    await onUpdateSuscripcion({ ...subscription, importe: change.importeNuevo });
                    setNotice(subscription.mi_parte != null ? 'Importe actualizado. Revisa tu parte de la suscripción compartida.' : 'Importe actualizado.');
                    dismiss(`price:${change.suscripcionId}:${change.movimientoId}`);
                  } catch {
                    setNotice('No se ha podido actualizar el importe. Vuelve a intentarlo.');
                  } finally { setUpdating(null); }
                }}>{updating === change.suscripcionId ? 'Actualizando…' : 'Actualizar importe'}</button>
                <button type="button" className="dashboard-secondary-button" onClick={() => dismiss(`price:${change.suscripcionId}:${change.movimientoId}`)}>Ignorar</button>
              </div>
            </Card>
          ))}
        </section>
      )}

      {/* 3. Category Filters */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 dashboard-label">
          <Filter className="w-3.5 h-3.5" />
          Filtrar por categoría
        </div>
        
        <div role="group" aria-label="Filtrar por categoría" className="segmented flex-wrap">
          <button
            type="button"
            onClick={() => setSelectedCategory(null)}
            aria-pressed={selectedCategory === null}
            className="segmented-item"
          >
            Todos
          </button>
          
          {CATEGORIA_OPTIONS.map(opt => (
            <button
              type="button"
              key={opt.value}
              onClick={() => setSelectedCategory(opt.value)}
              aria-pressed={selectedCategory === opt.value}
              className="segmented-item"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>

      {/* 4. Subscriptions grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {filteredSubs.length > 0 ? (
          filteredSubs.map(s => (
            <SuscripcionCard
              key={s.id}
              suscripcion={s}
              totalAnualActivo={totalAnualActivo}
              onEdit={onOpenSuscripcionModal}
              onDelete={onDeleteSuscripcion}
              onToggle={onToggleSuscripcion}
              onCancel={onCancelSuscripcion}
              onUndoCancel={onUndoCancelSuscripcion}
            />
          ))
        ) : (
          <div className="dashboard-empty col-span-full p-12">
            <EmptyIllustration />
            <span className="dashboard-heading mb-1">Sin suscripciones</span>
            <p className="text-xs text-ink-soft">Registra Netflix, Spotify o tus cuotas del gimnasio para gestionarlas aquí</p>
          </div>
        )}
      </div>
    </div>
  );
};
