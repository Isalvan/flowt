import React, { useState, useEffect } from 'react';
import { Trash2, AlertTriangle, Settings, Grid, CheckCircle2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';

interface DeleteHuchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConfirmDelete: (hucha: Hucha, deleteMode: 'auto' | 'manual' | 'debt', manualDistributions?: Record<string, number>, debtAssignedTo?: string) => Promise<void>;
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
  const [debtAssignedTo, setDebtAssignedTo] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const remainingHuchas = allHuchas.filter(h => h.id !== huchaToDelete?.id);
  const totalFunds = huchaToDelete?.saldo_acumulado || 0;
  const isDebtMode = huchaToDelete ? (huchaToDelete.deuda_pendiente || 0) > 0 : false;

  // Initialize distributions on open
  useEffect(() => {
    if (isOpen && huchaToDelete) {
      setMode('auto');
      setError(null);
      if (isDebtMode) {
        setDebtAssignedTo(huchaToDelete.deuda_con || (remainingHuchas[0]?.id ?? ''));
      } else {
        const initialDists: Record<string, number> = {};
        remainingHuchas.forEach(h => {
          initialDists[h.id] = 0;
        });
        setManualDistributions(initialDists);
      }
    }
  }, [isOpen, huchaToDelete, allHuchas, isDebtMode]);

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

    if (!isDebtMode && mode === 'manual' && !isBalanced) {
      setError(`Debes asignar exactamente la totalidad de los fondos (${totalFunds.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}). Faltan/sobran ${Math.abs(remainingToDistribute).toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}.`);
      return;
    }

    if (isDebtMode && !debtAssignedTo) {
      setError('Debes seleccionar una cartera para asumir la deuda.');
      return;
    }

    setIsLoading(true);
    try {
      await onConfirmDelete(huchaToDelete, isDebtMode ? 'debt' : mode, manualDistributions, debtAssignedTo);
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
      title={isDebtMode ? 'Eliminar cartera con deuda' : 'Eliminar cartera con fondos'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Warning card */}
        <div className="notice is-danger">
          <AlertTriangle className="shrink-0 mt-0.5 text-rose-500" size={16} />
          <div>
            {isDebtMode ? (
              <>
                La cartera <strong>{huchaToDelete?.nombre}</strong> tiene una deuda pendiente de{' '}
                <strong className="text-rose-500 dark:text-rose-400 tabular-nums">{formatCurrency(huchaToDelete?.deuda_pendiente || 0)}</strong>.
                Para eliminarla, debes transferir esta deuda a otra cartera.
              </>
            ) : (
              <>
                La cartera <strong>{huchaToDelete?.nombre}</strong> tiene un saldo acumulado de{' '}
                <strong className="text-rose-500 dark:text-rose-400 tabular-nums">{formatCurrency(totalFunds)}</strong>.
                Para eliminarla, debes transferir estos fondos a las carteras restantes.
              </>
            )}
          </div>
        </div>

        {isDebtMode ? (
          <div className="space-y-3 animate-appear-up">
            <label htmlFor="delete-debt-assign" className="field-label">
              Seleccionar cartera asignataria
            </label>
            <div>
              <select
                id="delete-debt-assign"
                value={debtAssignedTo}
                onChange={(e) => setDebtAssignedTo(e.target.value)}
                className="field"
              >
                <option value="" disabled>Selecciona una cartera</option>
                {remainingHuchas.map(h => {
                  const isPrestamista = h.id === huchaToDelete?.deuda_con;
                  return (
                    <option key={h.id} value={h.id}>
                      {h.nombre} {isPrestamista ? '(prestamista original)' : ''}
                    </option>
                  );
                })}
              </select>
            </div>
            <p className="field-hint">
              Si seleccionas la cartera prestamista original, la deuda simplemente se cancelará, asumiendo la pérdida. 
              Si seleccionas otra cartera, esta nueva cartera pasará a deber el dinero a la cartera prestamista.
            </p>
          </div>
        ) : (
          <>
            {/* Mode Selector */}
            <div>
              <span className="field-label">
                Método de reparto
              </span>
              <div className="segmented flex w-full">
                <button
                  type="button"
                  onClick={() => setMode('auto')}
                  aria-pressed={mode === 'auto'}
                  className="segmented-item flex-1 justify-center"
                >
                  <Settings size={14} />
                  Reparto automático
                </button>
                <button
                  type="button"
                  onClick={() => setMode('manual')}
                  aria-pressed={mode === 'manual'}
                  className="segmented-item flex-1 justify-center"
                >
                  <Grid size={14} />
                  Reparto manual
                </button>
              </div>
            </div>

            {/* Mode Content */}
            {mode === 'auto' ? (
              <div className="rounded-2xl bg-surface-2 p-4 text-xs leading-relaxed text-ink-soft space-y-2 animate-appear-up">
                <h5 className="dashboard-label">
                  Reglas de reparto automático
                </h5>
                <p>
                  Los fondos se distribuirán de acuerdo con las configuraciones individuales de aportación:
                </p>
                <ul className="list-disc pl-4 space-y-1">
                  <li>Primero se completarán los importes fijos (flat) de las carteras.</li>
                  <li>A continuación, se distribuirán los porcentajes definidos de cada cartera restante.</li>
                  <li>El sobrante se asignará automáticamente a tu cartera principal o hucha marcada como "Resto".</li>
                </ul>
              </div>
            ) : (
              <div className="space-y-4 animate-appear-up">
                <div className="flex items-center justify-between pb-2 border-b border-line">
                  <span className="field-label mb-0">Distribuir fondos</span>
                  <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
                    {isBalanced ? (
                      <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                        <CheckCircle2 size={14} />
                        Asignado correctamente
                      </span>
                    ) : (
                      <span className={remainingToDistribute > 0 ? 'text-amber-600 dark:text-amber-400' : 'text-rose-500 dark:text-rose-400'}>
                        Restante: {formatCurrency(remainingToDistribute)}
                      </span>
                    )}
                  </div>
                </div>

                <div className="space-y-3 max-h-[180px] overflow-y-auto pr-1">
                  {remainingHuchas.map(h => (
                    <div key={h.id} className="flex items-center justify-between gap-4 p-3 rounded-2xl bg-surface-2">
                      <div className="flex flex-col truncate pr-2">
                        <span className="text-xs font-bold text-ink truncate">{h.nombre}</span>
                        <span className="text-[11px] text-ink-faint tabular-nums">Saldo actual: {formatCurrency(h.saldo_acumulado)}</span>
                      </div>
                      <div className="relative shrink-0 w-32">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-faint">€</span>
                        <input
                          type="number"
                          min="0"
                          step="any"
                          placeholder="0.00"
                          value={manualDistributions[h.id] || ''}
                          onChange={(e) => handleManualValueChange(h.id, e.target.value)}
                          className="field py-1.5 pl-6 pr-3 text-right tabular-nums text-xs font-bold"
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* Error alert banner */}
        {error && (
          <div role="alert" className="notice is-danger">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 text-rose-500" />
            <span>{error}</span>
          </div>
        )}

        {/* Buttons */}
        <div className="modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="dashboard-secondary-button"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isLoading || (!isDebtMode && mode === 'manual' && !isBalanced) || (isDebtMode && !debtAssignedTo)}
            className="dashboard-danger-button"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando…
              </>
            ) : (
              <>
                <Trash2 size={14} />
                Confirmar borrado
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
