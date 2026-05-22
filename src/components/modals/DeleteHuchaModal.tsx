import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, Settings, Grid, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';

interface DeleteHuchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (hucha: Hucha, deleteMode: 'auto' | 'manual', manualDistributions?: Record<string, number>) => Promise<void>;
  huchaToDelete: Hucha | null;
  allHuchas: Hucha[];
}

export const DeleteHuchaModal: React.FC<DeleteHuchaModalProps> = ({
  isOpen,
  onClose,
  onConfirmDelete,
  huchaToDelete,
  allHuchas,
}) => {
  const [mode, setMode] = useState<'auto' | 'manual'>('auto');
  const [manualDistributions, setManualDistributions] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingHuchas = allHuchas.filter(h => h.id !== huchaToDelete?.id);
  const totalFunds = huchaToDelete?.saldo_acumulado || 0;

  // Initialize distributions on open
  useEffect(() => {
    if (isOpen && huchaToDelete) {
      setMode('auto');
      setError(null);
      const initialDists: Record<string, number> = {};
      remainingHuchas.forEach(h => {
        initialDists[h.id] = 0;
      });
      setManualDistributions(initialDists);
    }
  }, [isOpen, huchaToDelete, allHuchas]);

  const handleManualValueChange = (huchaId: string, value: string) => {
    setError(null);
    const num = Number(value) || 0;
    setManualDistributions(prev => ({
      ...prev,
      [huchaId]: num
    }));
  };

  const manualSum = Object.values(manualDistributions).reduce((sum, v) => sum + v, 0);
  const remainingToDistribute = Number((totalFunds - manualSum).toFixed(2));
  const isBalanced = Math.abs(remainingToDistribute) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!huchaToDelete) return;

    if (mode === 'manual' && !isBalanced) {
      setError(`Debes asignar exactamente la totalidad de los fondos (${totalFunds.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}). Faltan/sobran ${Math.abs(remainingToDistribute).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}.`);
      return;
    }

    setIsLoading(true);
    try {
      await onConfirmDelete(huchaToDelete, mode, manualDistributions);
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al procesar el borrado de la cartera');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2 text-rose-500">
          <Trash2 size={24} />
          <span>Eliminar Cartera con Fondos</span>
        </div>
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Warning card */}
        <div className="p-4 bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-300 rounded-2xl flex gap-3 text-sm leading-relaxed">
          <AlertTriangle className="shrink-0 text-rose-500 mt-0.5" size={18} />
          <div>
            La cartera <strong>{huchaToDelete?.nombre}</strong> tiene un saldo acumulado de{' '}
            <strong className="text-rose-600 dark:text-rose-400">{formatCurrency(totalFunds)}</strong>.
            Para eliminarla, debes transferir estos fondos a las carteras restantes.
          </div>
        </div>

        {/* Mode Selector */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Método de Reparto
          </label>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => setMode('auto')}
              className={`
                py-3 
                px-4 
                rounded-xl 
                border 
                text-xs 
                font-bold 
                flex 
                items-center 
                justify-center 
                gap-2 
                transition-all
                ${mode === 'auto'
                  ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/40'
                }
              `}
            >
              <Settings size={14} />
              Reparto Automático
            </button>
            <button
              type="button"
              onClick={() => setMode('manual')}
              className={`
                py-3 
                px-4 
                rounded-xl 
                border 
                text-xs 
                font-bold 
                flex 
                items-center 
                justify-center 
                gap-2 
                transition-all
                ${mode === 'manual'
                  ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/40'
                }
              `}
            >
              <Grid size={14} />
              Reparto Manual
            </button>
          </div>
        </div>

        {/* Mode Content */}
        {mode === 'auto' ? (
          <div className="p-4 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl border border-slate-100 dark:border-slate-800/80 text-[11px] leading-relaxed text-slate-500 dark:text-slate-400 space-y-2 animate-appear-up">
            <h5 className="font-extrabold uppercase text-[10px] tracking-wider text-slate-400">
              Reglas de Reparto Automático
            </h5>
            <p>
              Los fondos se distribuirán de acuerdo con las configuraciones individuales de aportación:
            </p>
            <ul className="list-disc pl-4 space-y-1">
              <li>Primero se completarán los importes fijos (Flat) de las carteras.</li>
              <li>A continuación, se distribuirán los porcentajes definidos de cada cartera restante.</li>
              <li>El sobrante se asignará automáticamente a tu cartera principal o hucha marcada como "Resto".</li>
            </ul>
          </div>
        ) : (
          <div className="space-y-4 animate-appear-up">
            <div className="flex items-center justify-between pb-2 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-xs font-bold text-slate-400">Distribuir Fondos</span>
              <div className="flex items-center gap-1.5 text-xs font-extrabold">
                {isBalanced ? (
                  <span className="text-emerald-500 dark:text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 size={14} />
                    Asignado correctamente
                  </span>
                ) : (
                  <span className={remainingToDistribute > 0 ? 'text-amber-500' : 'text-rose-500'}>
                    Restante: {formatCurrency(remainingToDistribute)}
                  </span>
                )}
              </div>
            </div>

            <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1 custom-scrollbar">
              {remainingHuchas.map(h => (
                <div key={h.id} className="flex items-center justify-between gap-4 p-2 rounded-xl border border-slate-100 dark:border-slate-800 bg-white/20 dark:bg-slate-950/10">
                  <div className="flex flex-col truncate pr-2">
                    <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{h.nombre}</span>
                    <span className="text-[9px] text-slate-400">Saldo actual: {formatCurrency(h.saldo_acumulado)}</span>
                  </div>
                  <div className="relative shrink-0 w-32">
                    <span className="absolute left-3 top-2.5 text-xs font-bold text-slate-400">€</span>
                    <input
                      type="number"
                      min="0"
                      step="any"
                      placeholder="0.00"
                      value={manualDistributions[h.id] || ''}
                      onChange={(e) => handleManualValueChange(h.id, e.target.value)}
                      className="w-full pl-6 pr-3 py-2 rounded-lg border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs font-bold text-slate-800 dark:text-white text-right focus:outline-none focus:ring-2 focus:ring-sky-500/50"
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Error alert banner */}
        {error && (
          <div className="p-3 bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-300 rounded-xl text-xs flex gap-2">
            <AlertTriangle size={16} className="shrink-0 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Buttons */}
        <div className="flex items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/60">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold tracking-wide uppercase hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isLoading || (mode === 'manual' && !isBalanced)}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 text-white text-xs font-bold tracking-wide uppercase shadow-md hover:shadow-rose-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando...
              </>
            ) : (
              <>
                <Trash2 size={14} />
                Confirmar Borrado
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
