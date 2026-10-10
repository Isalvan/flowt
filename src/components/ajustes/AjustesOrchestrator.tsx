import React, { useState } from 'react';
import { Layers, Download, Archive, RefreshCw, Tags, Plug } from 'lucide-react';
import { CategoryHuchasView } from './CategoryHuchasView';
import { ReviewHistoryView } from './ReviewHistoryView';
import { ConnectionsView } from './ConnectionsView';
import { SuscripcionesView } from '../suscripciones/SuscripcionesView';
import { ExportView } from '../export/ExportView';
import { usePrivacy } from '../../context/PrivacyContext';
import type { Suscripcion, Hucha, Movimiento } from '../../types';

interface AjustesOrchestratorProps {
  // Suscripciones props
  suscripciones: Suscripcion[];
  huchas: Hucha[];
  onOpenSuscripcionModal: (suscripcion: Suscripcion | null) => void;
  onDeleteSuscripcion: (s: Suscripcion) => void;
  onToggleSuscripcion: (s: Suscripcion) => void;
  onCancelSuscripcion: (s: Suscripcion) => void;
  onUndoCancelSuscripcion: (s: Suscripcion) => void;
  
  // Export props
  chartMovements: Movimiento[];
  userStats: any;
  userId: string | undefined;
  demo?: boolean;
  onRestoreHucha: (huchaId: string) => void;
}

export const AjustesOrchestrator: React.FC<AjustesOrchestratorProps> = ({
  suscripciones,
  huchas,
  onOpenSuscripcionModal,
  onDeleteSuscripcion,
  onToggleSuscripcion,
  onCancelSuscripcion,
  onUndoCancelSuscripcion,
  chartMovements,
  userStats,
  userId,
  demo = false,
  onRestoreHucha
}) => {
  const [subTab, setSubTab] = useState<'suscripciones' | 'exportar' | 'carteras_inactivas' | 'categorias' | 'revisiones' | 'conexiones'>('suscripciones');
  const { formatCurrency } = usePrivacy();

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Elegante selector de sub-vista tipo píldora */}
      <div className="no-scrollbar -mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:justify-center sm:px-0">
        <div className="segmented">
          <button onClick={() => setSubTab('revisiones')} aria-pressed={subTab === 'revisiones'} className="segmented-item"><RefreshCw size={16} />Revisiones automáticas</button>
          <button onClick={() => setSubTab('categorias')} aria-pressed={subTab === 'categorias'} className="segmented-item"><Tags size={16} />Huchas por categoría</button>
          
          <button
            onClick={() => setSubTab('suscripciones')}
            aria-pressed={subTab === 'suscripciones'}
            className="segmented-item"
          >
            <Layers size={16} className={subTab === 'suscripciones' ? 'text-brand-ink' : ''} />
            Suscripciones
          </button>
          
          <button
            onClick={() => setSubTab('exportar')}
            aria-pressed={subTab === 'exportar'}
            className="segmented-item"
          >
            <Download size={16} className={subTab === 'exportar' ? 'text-brand-ink' : ''} />
            Exportar datos
          </button>

          <button
            onClick={() => setSubTab('carteras_inactivas')}
            aria-pressed={subTab === 'carteras_inactivas'}
            className="segmented-item"
          >
            <Archive size={16} className={subTab === 'carteras_inactivas' ? 'text-brand-ink' : ''} />
            Carteras inactivas
          </button>

          <button onClick={() => setSubTab('conexiones')} aria-pressed={subTab === 'conexiones'} className="segmented-item"><Plug size={16} />Conexiones</button>

        </div>
      </div>

      {/* Renderizado de la vista seleccionada */}
      <div className="w-full">
        {subTab === 'revisiones' ? (
          <ReviewHistoryView userId={userId} demo={demo} huchas={huchas} suscripciones={suscripciones} />
        ) : subTab === 'categorias' ? (
          <CategoryHuchasView userId={userId} huchas={huchas} demo={demo} />
        ) : subTab === 'conexiones' ? (
          <ConnectionsView userId={userId} demo={demo} />
        ) : subTab === 'suscripciones' ? (
          <SuscripcionesView
            suscripciones={suscripciones}
            huchas={huchas}
            onOpenSuscripcionModal={onOpenSuscripcionModal}
            onDeleteSuscripcion={onDeleteSuscripcion}
            onToggleSuscripcion={onToggleSuscripcion}
            onCancelSuscripcion={onCancelSuscripcion}
            onUndoCancelSuscripcion={onUndoCancelSuscripcion}
          />
        ) : subTab === 'carteras_inactivas' ? (
          <div className="w-full max-w-2xl mx-auto bg-white/40 dark:bg-slate-900/40 backdrop-blur-md rounded-2xl border border-white/20 dark:border-white/5 p-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
            <h3 className="text-lg font-bold text-slate-800 dark:text-white mb-4">Carteras Inactivas</h3>
            <p className="text-sm text-slate-500 dark:text-slate-400 mb-6">
              Aquí puedes ver y restaurar las carteras que has ocultado o desactivado. Al restaurarlas, volverán a estar disponibles en tu dashboard.
            </p>
            <div className="flex flex-col gap-3">
              {huchas.filter(h => h.activa === false).length === 0 ? (
                <div className="text-center py-8 text-slate-400 dark:text-slate-500 font-medium">
                  No tienes carteras inactivas.
                </div>
              ) : (
                huchas.filter(h => h.activa === false).map(h => (
                  <div key={h.id} className="flex items-center justify-between p-4 bg-white/50 dark:bg-slate-800/50 rounded-xl border border-slate-100 dark:border-slate-700/50">
                    <div className="flex flex-col">
                      <span className="font-bold text-slate-800 dark:text-white">{h.nombre}</span>
                      <span className="text-xs text-slate-500 dark:text-slate-400">Saldo oculto: {formatCurrency(h.saldo_acumulado)}</span>
                    </div>
                    <button
                      onClick={() => onRestoreHucha(h.id)}
                      className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 rounded-lg text-xs font-bold hover:bg-indigo-100 dark:hover:bg-indigo-500/20 transition-colors"
                    >
                      <RefreshCw size={12} />
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
