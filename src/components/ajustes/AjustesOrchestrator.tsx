import React, { useState } from 'react';
import { Layers, Download, Archive, RefreshCw } from 'lucide-react';
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
  const { formatCurrency } = usePrivacy();

  return (
    <div className="w-full flex flex-col gap-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      
      {/* Elegante selector de sub-vista tipo píldora */}
      <div className="no-scrollbar -mx-4 flex overflow-x-auto px-4 sm:mx-0 sm:justify-center sm:px-0">
        <div className="segmented">
          
          <button
            type="button"
            onClick={() => setSubTab('suscripciones')}
            aria-pressed={subTab === 'suscripciones'}
            className="segmented-item"
          >
            <Layers size={16} />
            Suscripciones
          </button>
          
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
