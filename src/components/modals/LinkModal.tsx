import React, { useState, useMemo, useEffect } from 'react';
import { ShieldCheck, Check, Search, Calendar } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento } from '../../types';
import { availableAmount } from '../../utils/movementSuggestions';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLink: (baseMov: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => Promise<void>;
  gasto: Movimiento | null; // Renamed internally to baseMov
  allMovimientos: Movimiento[];
}

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen,
  onClose,
  onLink,
  gasto: baseMov,
  allMovimientos,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [allocations, setAllocations] = useState<Record<string, number>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState('');

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setError('');
      setAllocations({});
    }
  }, [isOpen, baseMov]);

  const isBaseIngreso = baseMov?.tipo === 'ingreso';

  // Filter eligible targets
  const eligibleTargets = useMemo(() => {
    if (!baseMov) return [];
    
    return allMovimientos.filter(m => m.tipo !== baseMov.tipo && m.id !== baseMov.id && !m.es_interno && !m.transfer_id && availableAmount(m) > 0);
  }, [allMovimientos, baseMov]);

  // Search filtered
  const filteredTargets = useMemo(() => {
    if (!searchTerm.trim()) return eligibleTargets;
    const query = searchTerm.toLowerCase();
    return eligibleTargets.filter(m => 
      m.concepto.toLowerCase().includes(query) || 
      m.importe.toString().includes(query)
    );
  }, [eligibleTargets, searchTerm]);

  const getAvailableFromTarget = availableAmount;
  const baseAvailableAmount = baseMov ? availableAmount(baseMov) : 0;
  const totalAllocatedAmount = Object.values(allocations).reduce((sum, val) => sum + val, 0);
  const remainingToAllocate = Math.max(0, baseAvailableAmount - totalAllocatedAmount);

  const handleToggleSelect = (target: Movimiento) => {
    setAllocations(prev => {
      const next = { ...prev };
      if (next[target.id]) {
        // Deselect
        delete next[target.id];
      } else {
        // Select: assign up to the remaining amount, capped by target's available amount
        const targetAvail = getAvailableFromTarget(target);
        const toAssign = Math.min(targetAvail, remainingToAllocate > 0 ? remainingToAllocate : targetAvail);
        if (toAssign > 0) {
          next[target.id] = Number(toAssign.toFixed(2));
        }
      }
      return next;
    });
  };

  const handleAmountChange = (targetId: string, value: string, targetAvail: number) => {
    if (value === '') {
      setAllocations(prev => {
        const next = { ...prev };
        delete next[targetId];
        return next;
      });
      return;
    }
    
    let numVal = parseFloat(value);
    if (isNaN(numVal) || numVal <= 0) return;
    
    // Cap at target's available amount
    if (numVal > targetAvail) numVal = targetAvail;

    setAllocations(prev => ({
      ...prev,
      [targetId]: Number(numVal.toFixed(2))
    }));
  };

  const handleLink = async () => {
    if (!baseMov || Object.keys(allocations).length === 0) return;
    setIsLoading(true);
    setError('');
    try {
      const allocsArray = Object.entries(allocations).map(([id, amount]) => {
        const targetMov = allMovimientos.find(m => m.id === id)!;
        return { mov: targetMov, importe: amount };
      });
      await onLink(baseMov, allocsArray);
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'No se ha podido guardar la compensación');
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  const formatDate = (dateValue: any) => {
    if (!dateValue) return '---';
    if (dateValue?.toDate instanceof Function) {
      return dateValue.toDate().toLocaleDateString('es-ES');
    }
    if (dateValue instanceof Date) {
      return dateValue.toLocaleDateString('es-ES');
    }
    if (typeof dateValue === 'string') {
      return new Date(dateValue).toLocaleDateString('es-ES');
    }
    return '---';
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={isBaseIngreso ? 'Repartir ingreso (Bizum)' : 'Vincular compensación (Bizum)'}
      size="md"
    >
      <div className="space-y-4">
        {/* Base Movement Info Banner */}
        {baseMov && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-1.5">
            <span className="dashboard-label">
              {isBaseIngreso ? 'Ingreso a repartir' : 'Gasto a compensar'}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-ink truncate pr-2">{baseMov.concepto}</span>
              <span className={`text-sm font-extrabold shrink-0 tabular-nums ${isBaseIngreso ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                {isBaseIngreso ? '+' : '-'}{formatCurrency(baseMov.importe)}
              </span>
            </div>
            {baseAvailableAmount < baseMov.importe && (
              <div className="text-[11px] font-medium text-ink-soft">
                {isBaseIngreso ? 'Saldo disponible para repartir:' : 'Saldo pendiente de compensar:'}{' '}
                <span className="font-bold tabular-nums text-ink">{formatCurrency(baseAvailableAmount)}</span>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
          <input
            type="text"
            placeholder={`Buscar ${isBaseIngreso ? 'gastos' : 'ingresos'}…`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="field pl-10"
          />
        </div>

        {/* Targets Items List */}
        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
          {filteredTargets.length > 0 ? (
            filteredTargets.map(m => {
              const targetAvail = getAvailableFromTarget(m);
              const allocAmount = allocations[m.id];
              const isSelected = allocAmount !== undefined;

              return (
                <div
                  key={m.id}
                  className={`flex flex-col gap-2 p-3 rounded-2xl border transition-colors ${
                    isSelected
                      ? 'border-brand bg-brand-tint'
                      : 'border-line bg-surface-2 hover:border-line-strong'
                  }`}
                >
                  <div 
                    className="flex items-center justify-between gap-3 cursor-pointer"
                    onClick={() => handleToggleSelect(m)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`w-5 h-5 rounded-full border flex items-center justify-center shrink-0 transition-colors ${
                        isSelected
                          ? 'border-brand bg-brand text-white'
                          : 'border-line-strong bg-transparent'
                      }`}>
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>

                      <div className="flex flex-col truncate">
                        <span className="text-xs font-bold text-ink truncate">{m.concepto}</span>
                        <span className="text-[11px] text-ink-faint flex items-center gap-1 mt-0.5">
                          <Calendar size={12} />
                          {formatDate(m.fecha_operacion)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`text-xs font-bold tabular-nums ${isBaseIngreso ? 'text-rose-500 dark:text-rose-400' : 'text-emerald-600 dark:text-emerald-400'}`}>
                        {isBaseIngreso ? '-' : '+'}{formatCurrency(m.importe)}
                      </div>
                      {targetAvail < m.importe && (
                        <div className="text-[11px] text-ink-faint font-medium tabular-nums">
                          Disp.: {formatCurrency(targetAvail)}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="pl-8 pt-2 flex items-center gap-3 border-t border-line mt-1">
                      <span className="text-[11px] font-semibold text-ink-soft">Asignar:</span>
                      <div className="relative flex-1">
                        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint text-xs font-bold">€</span>
                        <input 
                          type="number"
                          step="0.01"
                          max={targetAvail}
                          value={allocAmount || ''}
                          onChange={(e) => handleAmountChange(m.id, e.target.value, targetAvail)}
                          className="field py-1.5 pl-7 pr-3 text-xs font-bold tabular-nums"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="dashboard-empty py-6 min-h-[5rem]">
              No se han encontrado {isBaseIngreso ? 'gastos' : 'ingresos'} elegibles.
            </div>
          )}
        </div>

        {/* Ledger allocation preview */}
        {Object.keys(allocations).length > 0 && baseMov && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-2.5 animate-appear-up">
            <h5 className="dashboard-label">
              Resumen de asignación
            </h5>
            
            <div className="grid grid-cols-2 gap-4 text-xs font-bold text-ink">
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-ink-faint font-semibold">Total asignado:</span>
                <span className="text-brand-ink tabular-nums">{formatCurrency(totalAllocatedAmount)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[11px] text-ink-faint font-semibold">{isBaseIngreso ? 'Ingreso libre restante:' : 'Gasto pdte. restante:'}</span>
                <span className={`tabular-nums ${remainingToAllocate < 0 ? 'text-rose-500 dark:text-rose-400' : 'text-ink'}`}>
                  {formatCurrency(remainingToAllocate)}
                </span>
              </div>
            </div>
            {remainingToAllocate < 0 && (
              <p className="notice is-danger mt-1">Has excedido el importe disponible.</p>
            )}
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
            type="button"
            onClick={handleLink}
            disabled={isLoading || Object.keys(allocations).length === 0 || !baseMov || remainingToAllocate < 0}
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
                <ShieldCheck size={14} />
                Confirmar ({Object.keys(allocations).length})
              </>
            )}
          </button>
        </div>
        {error && <div role="alert" className="notice is-danger">{error}</div>}
      </div>
    </Modal>
  );
};

