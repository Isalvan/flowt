import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, Info, Plus, Trash2, CheckCircle2, AlertCircle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento, type Hucha } from '../../types';

interface ConvertRow {
  huchaId: string;
  tipoAportacion: 'flat' | 'porcentaje' | 'resto';
  value: number;
}

interface ConvertModalProps {
  isOpen: boolean;
  onClose: () => void;
  onConvert: (movimiento: Movimiento, rows?: ConvertRow[], targetHuchaId?: string) => Promise<void>;
  movimiento: Movimiento | null;
  huchas: Hucha[];
}

export const ConvertModal: React.FC<ConvertModalProps> = ({
  isOpen,
  onClose,
  onConvert,
  movimiento,
  huchas,
}) => {
  const [targetHuchaId, setTargetHuchaId] = useState('');
  const [rows, setRows] = useState<ConvertRow[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const amount = movimiento?.importe || 0;

  // Initialize fields on open
  useEffect(() => {
    if (isOpen && movimiento) {
      setError(null);
      if (movimiento.tipo === 'ingreso') {
        // Ingreso -> Gasto: choose a single pocket to subtract from
        const principal = huchas.find(h => h.es_principal) || huchas[0];
        setTargetHuchaId(principal?.id || '');
      } else {
        // Gasto -> Ingreso: setup income allocation rows
        // Prefill default rows based on huchas configuration
        const defaultRows: ConvertRow[] = huchas.filter(h => h.activa !== false).map(h => ({
          huchaId: h.id,
          tipoAportacion: h.tipo_aportacion,
          value: h.valor_aportacion || 0,
        }));
        setRows(defaultRows);
      }
    }
  }, [isOpen, movimiento, huchas]);

  const handleAddRow = () => {
    const unselected = huchas.find(h => !rows.some(r => r.huchaId === h.id));
    if (!unselected) return;
    setRows(prev => [...prev, {
      huchaId: unselected.id,
      tipoAportacion: unselected.tipo_aportacion,
      value: unselected.valor_aportacion || 0,
    }]);
  };

  const handleRemoveRow = (index: number) => {
    setRows(prev => prev.filter((_, i) => i !== index));
  };

  const handleRowChange = (index: number, field: keyof ConvertRow, val: any) => {
    setRows(prev => prev.map((row, i) => {
      if (i !== index) return row;
      const updated = { ...row, [field]: val };
      if (field === 'tipoAportacion') {
        updated.value = val === 'resto' ? 0 : 0;
      }
      return updated;
    }));
  };

  // Calculations for Gasto -> Ingreso
  const calculatedShares = rows.map(r => {
    let share = 0;
    if (r.tipoAportacion === 'flat') {
      share = r.value;
    } else if (r.tipoAportacion === 'porcentaje') {
      share = amount * (r.value / 100);
    } else {
      // remainder (resto)
      const sumOthers = rows
        .filter(x => x !== r)
        .reduce((s, x) => s + (x.tipoAportacion === 'flat' ? x.value : amount * (x.value / 100)), 0);
      share = Math.max(0, amount - sumOthers);
    }
    return { ...r, share: Number(share.toFixed(2)) };
  });

  const totalCalculatedSum = calculatedShares.reduce((s, r) => s + r.share, 0);
  const remainingAmount = Number((amount - totalCalculatedSum).toFixed(2));
  const isBalanced = Math.abs(remainingAmount) < 0.01;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!movimiento) return;

    if (movimiento.tipo === 'gasto' && !isBalanced) {
      setError(`La suma del reparto (${totalCalculatedSum.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}) debe ser exactamente igual al importe total del movimiento (${amount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}). Diferencia: ${remainingAmount.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })}.`);
      return;
    }

    setIsLoading(true);
    try {
      if (movimiento.tipo === 'gasto') {
        await onConvert(movimiento, rows, undefined);
      } else {
        await onConvert(movimiento, undefined, targetHuchaId);
      }
      onClose();
    } catch (err: any) {
      setError(err.message || 'Error al convertir el movimiento');
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
      title="Convertir movimiento"
      size="lg"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Info card of current transaction */}
        <div className="rounded-2xl bg-surface-2 p-4 flex items-center justify-between">
          <div className="flex flex-col truncate pr-3">
            <span className="dashboard-label">Concepto del movimiento</span>
            <span className="text-sm font-bold text-ink truncate">{movimiento?.concepto}</span>
          </div>
          <div className="text-right shrink-0">
            <span className="dashboard-label">Importe actual</span>
            <div className={`text-base font-extrabold tabular-nums ${movimiento?.tipo === 'gasto' ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
              {movimiento?.tipo === 'gasto' ? '-' : '+'}{formatCurrency(amount)}
            </div>
          </div>
        </div>

        {movimiento?.tipo === 'ingreso' ? (
          /* INGRESO -> GASTO */
          <div className="space-y-4 animate-appear-up">
            <div className="notice is-warning">
              <Info size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Convertirás este <strong>ingreso</strong> en un <strong>gasto</strong>.
                Esto restará el importe del saldo de la cartera que elijas a continuación, y anulará el reparto original que tuvo este ingreso.
              </span>
            </div>

            <div>
              <label htmlFor="convert-target-hucha" className="field-label">
                Cartera a la que imputar el gasto
              </label>
              <select
                id="convert-target-hucha"
                value={targetHuchaId}
                onChange={(e) => setTargetHuchaId(e.target.value)}
                className="field"
              >
                {huchas.filter(h => h.activa !== false).map(h => (
                  <option key={h.id} value={h.id}>
                    {h.nombre} (Saldo: {formatCurrency(h.saldo_acumulado)})
                  </option>
                ))}
              </select>
            </div>
          </div>
        ) : (
          /* GASTO -> INGRESO */
          <div className="space-y-4 animate-appear-up">
            <div className="notice is-warning">
              <Info size={16} className="shrink-0 mt-0.5 text-amber-600 dark:text-amber-400" />
              <span>
                Convertirás este <strong>gasto</strong> en un <strong>ingreso</strong>.
                Esto revertirá la sustracción original del gasto (+{formatCurrency(amount)} en su cartera original) y distribuirá el importe como un nuevo ingreso entre tus carteras.
              </span>
            </div>

            {/* Distribution rules ledger */}
            <div className="space-y-3.5">
              <div className="flex items-center justify-between pb-2 border-b border-line">
                <span className="field-label mb-0">Reglas de distribución del ingreso</span>
                <div className="flex items-center gap-1.5 text-xs font-bold tabular-nums">
                  {isBalanced ? (
                    <span className="text-emerald-600 dark:text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={14} />
                      Asignación balanceada
                    </span>
                  ) : (
                    <span className="text-amber-600 dark:text-amber-400 flex items-center gap-1">
                      <AlertCircle size={14} />
                      Restante: {formatCurrency(remainingAmount)}
                    </span>
                  )}
                </div>
              </div>

              {/* Rows */}
              <div className="space-y-3 max-h-[220px] overflow-y-auto pr-1">
                {rows.map((row, idx) => (
                  <div key={idx} className="flex flex-col md:flex-row items-stretch md:items-center gap-2 p-2.5 rounded-2xl bg-surface-2">
                    {/* Hucha */}
                    <select
                      value={row.huchaId}
                      onChange={(e) => handleRowChange(idx, 'huchaId', e.target.value)}
                      className="field flex-1 py-1.5 text-xs"
                    >
                      {huchas.filter(h => h.activa !== false).map(h => (
                        <option key={h.id} value={h.id}>{h.nombre}</option>
                      ))}
                    </select>

                    {/* Method */}
                    <select
                      value={row.tipoAportacion}
                      onChange={(e) => handleRowChange(idx, 'tipoAportacion', e.target.value as any)}
                      className="field w-28 py-1.5 text-xs"
                    >
                      <option value="porcentaje">Porcentaje</option>
                      <option value="flat">Fijo (€)</option>
                      <option value="resto">Resto</option>
                    </select>

                    {/* Value inputs */}
                    <div className="relative w-32 shrink-0">
                      {row.tipoAportacion !== 'resto' ? (
                        <>
                          <span className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-xs font-bold text-ink-faint">
                            {row.tipoAportacion === 'porcentaje' ? '%' : '€'}
                          </span>
                          <input
                            type="number"
                            min="0"
                            step="any"
                            value={row.value || ''}
                            onChange={(e) => handleRowChange(idx, 'value', Number(e.target.value) || 0)}
                            className="field py-1.5 pl-6 pr-3 text-right tabular-nums text-xs font-bold"
                          />
                        </>
                      ) : (
                        <div className="w-full text-center text-xs font-bold py-1.5 bg-surface rounded-lg text-ink-faint">
                          Sobrante
                        </div>
                      )}
                    </div>

                    {/* calculated yield */}
                    <div className="w-20 text-right text-xs font-bold text-ink-soft shrink-0 px-1 tabular-nums">
                      {formatCurrency(calculatedShares[idx]?.share || 0)}
                    </div>

                    {/* Delete */}
                    <button
                      type="button"
                      onClick={() => handleRemoveRow(idx)}
                      disabled={rows.length === 1}
                      className="dashboard-icon-button is-danger shrink-0"
                      aria-label="Eliminar cartera"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))}
              </div>

              {/* Add row */}
              {rows.length < huchas.length && (
                <button
                  type="button"
                  onClick={handleAddRow}
                  className="inline-flex items-center gap-1.5 text-xs font-bold text-brand-ink hover:underline py-1 px-2 cursor-pointer"
                >
                  <Plus size={14} />
                  Añadir cartera de asignación
                </button>
              )}
            </div>
          </div>
        )}

        {/* Error banner */}
        {error && (
          <div role="alert" className="notice is-danger">
            <AlertCircle size={15} className="shrink-0 mt-0.5 text-rose-500" />
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
            disabled={isLoading || (movimiento?.tipo === 'gasto' && !isBalanced)}
            className="dashboard-primary-button"
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
                <ArrowRightLeft size={14} />
                Convertir movimiento
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
