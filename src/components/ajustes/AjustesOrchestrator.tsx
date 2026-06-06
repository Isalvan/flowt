import React, { useState } from 'react';
import { Layers, Download } from 'lucide-react';
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
  userId
}) => {
  const [subTab, setSubTab] = useState<'suscripciones' | 'exportar'>('suscripciones');

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Elegante selector de sub-vista tipo píldora */}
      <div className="flex justify-center w-full">
        <div className="inline-flex bg-white/40 dark:bg-slate-900/40 backdrop-blur-md p-1.5 rounded-2xl border border-white/20 dark:border-white/5 shadow-sm">
          
          <button
            onClick={() => setSubTab('suscripciones')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 ${
              subTab === 'suscripciones'
                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Layers size={16} className={subTab === 'suscripciones' ? 'text-indigo-500' : ''} />
            Suscripciones
          </button>
          
          <button
            onClick={() => setSubTab('exportar')}
            className={`relative flex items-center gap-2 px-6 py-2.5 rounded-xl font-bold text-sm transition-all duration-300 ${
              subTab === 'exportar'
                ? 'bg-white dark:bg-slate-800 text-slate-800 dark:text-white shadow-md'
                : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Download size={16} className={subTab === 'exportar' ? 'text-indigo-500' : ''} />
            Exportar Datos
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
