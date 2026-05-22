import React, { useState } from 'react';
import { type Suscripcion, type Hucha } from '../../types';
import { SuscripcionCard } from './SuscripcionCard';
import { Card } from '../common/Card';
import { 
  Plus, 
  CreditCard, 
  TrendingUp, 
  Users,
  Filter
} from 'lucide-react';
import { CATEGORIA_OPTIONS, calcMensual } from '../../hooks/useFinanceData';

interface SuscripcionesViewProps {
  suscripciones: Suscripcion[];
  huchas: Hucha[];
  onOpenSuscripcionModal: (editingSub: Suscripcion | null) => void;
  onDeleteSuscripcion: (s: Suscripcion) => void;
  onToggleSuscripcion: (s: Suscripcion) => void;
  onCancelSuscripcion: (s: Suscripcion) => void;
  onUndoCancelSuscripcion: (s: Suscripcion) => void;
}

export const SuscripcionesView: React.FC<SuscripcionesViewProps> = ({
  suscripciones,
  huchas,
  onOpenSuscripcionModal,
  onDeleteSuscripcion,
  onToggleSuscripcion,
  onCancelSuscripcion,
  onUndoCancelSuscripcion,
}) => {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  };

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

  const activeCount = suscripciones.filter(s => s.activa).length;
  const inactiveCount = suscripciones.length - activeCount;

  // Filter subscriptions
  const filteredSubs = selectedCategory
    ? suscripciones.filter(s => s.categoria === selectedCategory)
    : suscripciones;

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header & main action */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            Suscripciones Recurrentes
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Previsión y distribución automática de cargos periódicos</p>
        </div>

        <button
          onClick={() => onOpenSuscripcionModal(null)}
          className="flex items-center gap-1.5 bg-gradient-to-r from-violet-600 to-indigo-600 hover:from-violet-500 hover:to-indigo-500 text-white font-extrabold text-xs px-5 py-3 rounded-xl shadow-lg hover:shadow-xl hover:shadow-indigo-500/10 active:scale-95 transition-all border border-indigo-400/20 shrink-0 self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" />
          Nueva Suscripción
        </button>
      </div>

      {/* 2. Top Overview Cards */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        
        {/* Total Monthly Equivalent budget */}
        <Card className="bg-gradient-to-br from-violet-600 to-indigo-700 text-white p-5 shadow-xl border-none">
          <div className="flex items-center justify-between opacity-80">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Presupuesto Mensual</span>
            <CreditCard className="w-4 h-4 animate-pulse" />
          </div>
          <div className="mt-3.5">
            <span className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums leading-none">
              {formatCurrency(myActualPrice)}
            </span>
            <p className="text-[10px] opacity-75 font-semibold mt-1 flex items-center gap-1">
              Reservado mensualmente en hucha
            </p>
          </div>
        </Card>

        {/* Active counter */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5">
          <div className="text-slate-400 dark:text-slate-500 text-[10px] font-black uppercase tracking-[0.2em] mb-1">
            Suscripciones Activas
          </div>
          <div className="mt-2.5">
            <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight leading-none">
              {activeCount}
            </span>
            <span className="text-xs text-slate-400 dark:text-slate-500 ml-1.5 font-bold uppercase">
              servicios
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-1.5">
              {inactiveCount} en espera / pausados
            </p>
          </div>
        </Card>

        {/* Saved Shared Payment Split */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Gastos Compartidos</span>
            <Users className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="mt-3.5">
            <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight tabular-nums leading-none">
              {formatCurrency(savedSharedPrice)}
            </span>
            <span className="text-xs text-slate-450 dark:text-slate-500 ml-1 font-bold lowercase">
              /mes
            </span>
            <p className="text-[10px] text-emerald-600 dark:text-emerald-400 font-semibold mt-1">
              Ahorro recuperado por reembolsos
            </p>
          </div>
        </Card>

        {/* Hucha current reserve status */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5 flex flex-col justify-between">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Fondo en Cartera</span>
            <TrendingUp className="w-4 h-4 text-indigo-500" />
          </div>
          <div className="mt-3.5">
            <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight tabular-nums leading-none">
              {formatCurrency(huchas.find(h => h.es_suscripciones)?.saldo_acumulado ?? 0)}
            </span>
            <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-1">
              Acumulado actual para cobros
            </p>
          </div>
        </Card>
      </div>

      {/* 3. Category Filters */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 text-slate-400 dark:text-slate-500 text-xs font-bold uppercase tracking-wider">
          <Filter className="w-4 h-4" />
          Filtrar por Categoría
        </div>
        
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={() => setSelectedCategory(null)}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-200 border cursor-pointer ${
              selectedCategory === null
                ? 'bg-slate-900 border-slate-900 text-white dark:bg-slate-100 dark:border-slate-100 dark:text-slate-900 shadow'
                : 'bg-white/40 border-white/10 text-slate-500 hover:bg-slate-100 dark:bg-slate-900/20 dark:border-white/5 dark:hover:bg-slate-800/40'
            }`}
          >
            Todos
          </button>
          
          {CATEGORIA_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => setSelectedCategory(opt.value)}
              className={`px-4 py-2 rounded-xl text-xs font-extrabold uppercase tracking-wider transition-all duration-200 border cursor-pointer ${
                selectedCategory === opt.value
                  ? 'bg-indigo-600 border-indigo-600 text-white shadow shadow-indigo-600/25'
                  : 'bg-white/40 border-white/10 text-slate-500 hover:bg-slate-100 dark:bg-slate-900/20 dark:border-white/5 dark:hover:bg-slate-800/40'
              }`}
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
              onEdit={onOpenSuscripcionModal}
              onDelete={onDeleteSuscripcion}
              onToggle={onToggleSuscripcion}
              onCancel={onCancelSuscripcion}
              onUndoCancel={onUndoCancelSuscripcion}
            />
          ))
        ) : (
          <div className="flex flex-col items-center justify-center p-12 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 col-span-full">
            <span className="text-base font-extrabold text-slate-300 dark:text-slate-700 uppercase tracking-widest mb-1">Sin Suscripciones</span>
            <p className="text-xs text-slate-400">Registra Netflix, Spotify o tus cuotas del gimnasio para gestionarlas aquí</p>
          </div>
        )}
      </div>
    </div>
  );
};
