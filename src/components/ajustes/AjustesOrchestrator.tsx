import React, { useMemo, useState } from 'react';
import { Layers, Download, Archive, RefreshCw, Tags, Plug, Landmark, ChevronLeft, ChevronRight, SlidersHorizontal, type LucideIcon } from 'lucide-react';
import { PHONE_QUERY, useMediaQuery } from '../../hooks/useMediaQuery';
import { BancosView } from './BancosView';
import { CategoryHuchasView } from './CategoryHuchasView';
import { ReviewHistoryView } from './ReviewHistoryView';
import { ConnectionsView } from './ConnectionsView';
import { SuscripcionesView } from '../suscripciones/SuscripcionesView';
import { ExportView } from '../export/ExportView';
import { usePrivacy } from '../../context/PrivacyContext';
import type { Suscripcion, Hucha, Movimiento } from '../../types';
import { useRecurringAlerts } from '../../hooks/useRecurringAlerts';

interface AjustesOrchestratorProps {
  // Suscripciones props
  suscripciones: Suscripcion[];
  huchas: Hucha[];
  ingresoMensualHabitual?: number;
  onOpenSuscripcionModal: (suscripcion: Suscripcion | null, draft?: Partial<Suscripcion>) => void;
  onUpdateSuscripcion: (s: Suscripcion) => Promise<void>;
  onDeleteSuscripcion: (s: Suscripcion) => void;
  onToggleSuscripcion: (s: Suscripcion) => void;
  onCancelSuscripcion: (s: Suscripcion) => void;
  onUndoCancelSuscripcion: (s: Suscripcion) => void;
  
  // Export props
  chartMovements: Movimiento[];
  countMovimientosWithoutBank?: () => Promise<number>;
  assignMovimientosWithoutBank?: (banco: string) => Promise<void>;
  olderMovements: Movimiento[];
  olderMovementsLoading: boolean;
  olderMovementsLoaded: boolean;
  olderMovementsError: boolean;
  loadOlderMovements: () => Promise<void>;
  userStats: any;
  userId: string | undefined;
  demo?: boolean;
  onRestoreHucha: (huchaId: string) => void;
  /** Opens the preferences panel, which also opens from the profile picture. */
  onOpenPreferences?: () => void;
}

type SubTab = 'suscripciones' | 'bancos' | 'exportar' | 'carteras_inactivas' | 'categorias' | 'revisiones' | 'conexiones';

interface SettingsRow {
  id: SubTab | 'preferencias';
  title: string;
  subtitle: string;
  icon: LucideIcon;
  badge?: number;
}

export const AjustesOrchestrator: React.FC<AjustesOrchestratorProps> = ({
  suscripciones,
  huchas,
  ingresoMensualHabitual,
  onOpenSuscripcionModal,
  onUpdateSuscripcion,
  onDeleteSuscripcion,
  onToggleSuscripcion,
  onCancelSuscripcion,
  onUndoCancelSuscripcion,
  chartMovements,
  countMovimientosWithoutBank,
  assignMovimientosWithoutBank,
  olderMovements,
  olderMovementsLoading,
  olderMovementsLoaded,
  olderMovementsError,
  loadOlderMovements,
  userStats,
  userId,
  demo = false,
  onRestoreHucha,
  onOpenPreferences,
}) => {
  // On a phone Ajustes opens on a list of sections, each one a screen of its own;
  // from a tablet up the sections stay as a row of tabs.
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [chosen, setChosen] = useState<SubTab | null>(null);
  const subTab: SubTab | null = chosen ?? (isPhone ? null : 'suscripciones');
  const setSubTab = (tab: SubTab) => setChosen(tab);
  const { formatCurrency } = usePrivacy();
  const recurringMovements = useMemo(() => [...new Map(
    [...chartMovements, ...olderMovements].map(m => [m.id, m]),
  ).values()], [chartMovements, olderMovements]);
  const recurringUserId = demo ? 'demo' : userId ?? 'anonymous';
  const { count: alertCount } = useRecurringAlerts(recurringMovements, suscripciones, recurringUserId);
  const activeSubs = suscripciones.filter(s => s.activa).length;
  const inactiveWallets = huchas.filter(h => h.activa === false).length;
  const groups: { title: string; rows: SettingsRow[] }[] = [
    { title: 'Tu dinero', rows: [
      { id: 'suscripciones', title: 'Suscripciones', icon: Layers, badge: alertCount,
        subtitle: activeSubs ? `${activeSubs} ${activeSubs === 1 ? 'activa' : 'activas'}` : 'Cargos que se repiten' },
      { id: 'bancos', title: 'Bancos', icon: Landmark, subtitle: 'Dónde tienes el dinero' },
      { id: 'categorias', title: 'Huchas por categoría', icon: Tags, subtitle: 'De qué hucha sale cada gasto' },
      { id: 'carteras_inactivas', title: 'Carteras inactivas', icon: Archive,
        subtitle: inactiveWallets ? `${inactiveWallets} ${inactiveWallets === 1 ? 'oculta' : 'ocultas'}` : 'Ninguna oculta' },
    ] },
    { title: 'Automático', rows: [
      { id: 'revisiones', title: 'Revisiones automáticas', icon: RefreshCw, subtitle: 'Qué cambió Flowt y cómo deshacerlo' },
      ...(onOpenPreferences ? [{ id: 'preferencias' as const, title: 'Preferencias', icon: SlidersHorizontal, subtitle: 'Periodo, cifra destacada y desbloqueo' }] : []),
    ] },
    { title: 'Tus datos', rows: [
      { id: 'conexiones', title: 'Conexiones', icon: Plug, subtitle: 'Asistentes que consultan tus finanzas' },
      { id: 'exportar', title: 'Exportar datos', icon: Download, subtitle: 'Descarga tus movimientos' },
    ] },
  ];

  if (isPhone && subTab === null) {
    return (
      <div className="flex w-full flex-col gap-5 animate-in fade-in duration-300">
        <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink">Ajustes</h2>
        {groups.map(group => (
          <section key={group.title} aria-label={group.title}>
            <h3 className="eyebrow mb-2 px-1 text-ink-faint">{group.title}</h3>
            <div className="dashboard-surface overflow-hidden">
              {group.rows.map(row => {
                const Icon = row.icon;
                return (
                  <button
                    key={row.id}
                    type="button"
                    onClick={() => row.id === 'preferencias' ? onOpenPreferences?.() : setSubTab(row.id)}
                    className="flex w-full items-center gap-3 border-t border-line px-4 py-3.5 text-left transition-colors duration-150 first:border-t-0 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
                  >
                    <span className="dashboard-icon !h-9 !w-9 bg-brand-tint text-brand-ink"><Icon size={16} /></span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-bold text-ink">{row.title}</span>
                      <span className="block truncate text-xs text-ink-soft">{row.subtitle}</span>
                    </span>
                    {row.badge ? <span aria-label={`${row.badge} avisos pendientes`} className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{row.badge}</span> : null}
                    <ChevronRight size={16} aria-hidden="true" className="shrink-0 text-ink-faint" />
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </div>
    );
  }

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Each section brings its own title, so the screen only needs the way back. */}
      {isPhone && subTab && (
        <button type="button" onClick={() => setChosen(null)} className="-mb-2 -ml-1 inline-flex w-fit items-center gap-0.5 rounded-lg py-1 pr-2 text-sm font-bold text-brand-ink">
          <ChevronLeft size={18} aria-hidden="true" /> Ajustes
        </button>
      )}

      {/* Elegante selector de sub-vista tipo píldora */}
      <div className={`no-scrollbar -mx-4 overflow-x-auto px-4 sm:mx-0 sm:justify-center sm:px-0 ${isPhone ? 'hidden' : 'flex'}`}>
        <div className="segmented">
          <button onClick={() => setSubTab('revisiones')} aria-pressed={subTab === 'revisiones'} className="segmented-item"><RefreshCw size={16} />Revisiones automáticas</button>
          <button onClick={() => setSubTab('categorias')} aria-pressed={subTab === 'categorias'} className="segmented-item"><Tags size={16} />Huchas por categoría</button>
          
          <button
            type="button"
            onClick={() => setSubTab('suscripciones')}
            aria-pressed={subTab === 'suscripciones'}
            className="segmented-item"
          >
            <Layers size={16} />
            Suscripciones
            {alertCount > 0 && <span aria-label={`${alertCount} avisos pendientes`} className="rounded-full bg-brand px-2 py-0.5 text-xs font-bold text-white">{alertCount}</span>}
          </button>
          <button type="button" onClick={() => setSubTab('bancos')} aria-pressed={subTab === 'bancos'} className="segmented-item"><Landmark size={16} />Bancos</button>
          
          <button
            type="button"
            onClick={() => setSubTab('exportar')}
            aria-pressed={subTab === 'exportar'}
            className="segmented-item"
          >
            <Download size={16} />
            Exportar datos
          </button>

          <button
            type="button"
            onClick={() => setSubTab('carteras_inactivas')}
            aria-pressed={subTab === 'carteras_inactivas'}
            className="segmented-item"
          >
            <Archive size={16} />
            Carteras inactivas
          </button>

          <button onClick={() => setSubTab('conexiones')} aria-pressed={subTab === 'conexiones'} className="segmented-item"><Plug size={16} />Conexiones</button>

        </div>
      </div>

      {/* Renderizado de la vista seleccionada */}
      <div className="w-full">
        {subTab === 'revisiones' ? (
          <ReviewHistoryView userId={userId} demo={demo} huchas={huchas} suscripciones={suscripciones} />
        ) : subTab === 'bancos' ? (
          <BancosView chartMovements={chartMovements} countMovimientosWithoutBank={countMovimientosWithoutBank} assignMovimientosWithoutBank={assignMovimientosWithoutBank} />
        ) : subTab === 'categorias' ? (
          <CategoryHuchasView userId={userId} huchas={huchas} demo={demo} />
        ) : subTab === 'conexiones' ? (
          <ConnectionsView userId={userId} demo={demo} />
        ) : subTab === 'suscripciones' ? (
          <SuscripcionesView
            suscripciones={suscripciones}
            movimientos={recurringMovements}
            userId={recurringUserId}
            onUpdateSuscripcion={onUpdateSuscripcion}
            huchas={huchas}
            ingresoMensualHabitual={ingresoMensualHabitual}
            onOpenSuscripcionModal={onOpenSuscripcionModal}
            onDeleteSuscripcion={onDeleteSuscripcion}
            onToggleSuscripcion={onToggleSuscripcion}
            onCancelSuscripcion={onCancelSuscripcion}
            onUndoCancelSuscripcion={onUndoCancelSuscripcion}
          />
        ) : subTab === 'carteras_inactivas' ? (
          <div className="w-full max-w-2xl mx-auto dashboard-surface p-5 animate-in fade-in">
            <h3 className="dashboard-heading mb-1">Carteras inactivas</h3>
            <p className="dashboard-subtitle mb-6">
              Aquí puedes ver y restaurar las carteras que has ocultado o desactivado. Al restaurarlas, volverán a estar disponibles en tu dashboard.
            </p>
            <div className="flex flex-col gap-3">
              {huchas.filter(h => h.activa === false).length === 0 ? (
                <div className="dashboard-empty py-8">
                  No tienes carteras inactivas.
                </div>
              ) : (
                huchas.filter(h => h.activa === false).map(h => (
                  <div key={h.id} className="flex items-center justify-between rounded-2xl bg-surface-2 p-4">
                    <div className="flex flex-col">
                      <span className="font-bold text-ink">{h.nombre}</span>
                      <span className="text-xs text-ink-soft">
                        Saldo oculto: <span className="tabular-nums">{formatCurrency(h.saldo_acumulado)}</span>
                      </span>
                    </div>
                    <button
                      type="button"
                      onClick={() => onRestoreHucha(h.id)}
                      className="dashboard-secondary-button !py-1.5 !px-3 text-xs"
                    >
                      <RefreshCw size={14} />
                      Restaurar
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        ) : (
          <ExportView
            movimientos={chartMovements}
            olderMovements={olderMovements}
            olderMovementsLoading={olderMovementsLoading}
            olderMovementsLoaded={olderMovementsLoaded}
            olderMovementsError={olderMovementsError}
            loadOlderMovements={loadOlderMovements}
            huchas={huchas}
            suscripciones={suscripciones}
            userStats={userStats}
            userId={userId}
          />
        )}
      </div>
      
    </div>
  );
};
