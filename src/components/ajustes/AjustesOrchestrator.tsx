import React, { useState } from 'react';
import { Layers, Download, Archive, RefreshCw } from 'lucide-react';
import { SuscripcionesView } from '../suscripciones/SuscripcionesView';
import { ExportView } from '../export/ExportView';
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
  onRestoreHucha
}) => {
  const [subTab, setSubTab] = useState<'suscripciones' | 'exportar' | 'carteras_inactivas'>('suscripciones');

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Elegante selector de sub-vista tipo píldora */}
      <div className="flex justify-center w-full">
        <div className="inline-flex bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 dark:border-white/5 shadow-sm">
          
          <button
            onClick={() => setSubTab('suscripciones')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 cursor-pointer ${
              subTab === 'suscripciones'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
            }`}
          >
            <Layers size={16} className={subTab === 'suscripciones' ? 'text-indigo-500' : ''} />
            Suscripciones
          </button>
          
          <button
            onClick={() => setSubTab('exportar')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 cursor-pointer ${
              subTab === 'exportar'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
            }`}
          >
            <Download size={16} className={subTab === 'exportar' ? 'text-indigo-500' : ''} />
            Exportar Datos
          </button>

          <button
            onClick={() => setSubTab('carteras_inactivas')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 cursor-pointer ${
              subTab === 'carteras_inactivas'
                ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow-[0_2px_10px_rgba(0,0,0,0.08)] ring-1 ring-slate-900/5 dark:ring-white/10 scale-[1.02]'
                : 'text-slate-500 hover:text-slate-800 hover:bg-slate-200/50 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800/50'
            }`}
          >
            <Archive size={16} className={subTab === 'carteras_inactivas' ? 'text-indigo-500' : ''} />
            Carteras Inactivas
          </button>

        </div>
      </div>

      {/* Renderizado de la vista seleccionada */}
      <div className="w-full">
        {subTab === 'suscripciones' ? (
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
                      <span className="text-xs text-slate-500 dark:text-slate-400">Saldo oculto: {h.saldo_acumulado.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}</span>
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
