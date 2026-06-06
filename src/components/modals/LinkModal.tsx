import React, { useState, useMemo, useEffect } from 'react';
import { ShieldCheck, Check, Search, Calendar } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento } from '../../types';

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

  // Reset state when modal opens
  useEffect(() => {
    if (isOpen) {
      setSearchTerm('');
      setAllocations({});
    }
  }, [isOpen, baseMov]);

  const isBaseIngreso = baseMov?.tipo === 'ingreso';

  // Filter eligible targets
  const eligibleTargets = useMemo(() => {
    if (!baseMov) return [];
    
    return allMovimientos.filter(m => {
      // Must be opposite type
      if (m.tipo === baseMov.tipo) return false;
      if (m.id === baseMov.id) return false;
      
      if (isBaseIngreso) {
        // Base is Ingreso. Target is Gasto. Gasto can be partially compensated.
        // Solo mostrar gastos que no estén totalmente compensados
        const neto = m.importe_neto ?? m.importe;
        if (neto <= 0) return false;
        return true;
      } else {
        // Base is Gasto. Target is Ingreso.
        // Mostrar ingresos que tengan saldo disponible para compensar
        const totalAsignado = (m.compensaciones_destinos || []).reduce((acc, curr) => acc + curr.importe, 0);
        // Si no tiene compensaciones_destinos, usamos compensa_movimiento_id legacy
        if (!m.compensaciones_destinos && m.compensa_movimiento_id) return false; // ya asignado
        if (m.importe - totalAsignado <= 0) return false;
        return true;
      }
    });
  }, [allMovimientos, baseMov, isBaseIngreso]);

  // Search filtered
  const filteredTargets = useMemo(() => {
    if (!searchTerm.trim()) return eligibleTargets;
    const query = searchTerm.toLowerCase();
    return eligibleTargets.filter(m => 
      m.concepto.toLowerCase().includes(query) || 
      m.importe.toString().includes(query)
    );
  }, [eligibleTargets, searchTerm]);

  // Max amount you can extract from a specific target
  const getAvailableFromTarget = (m: Movimiento) => {
    if (m.tipo === 'gasto') {
      return m.importe_neto ?? m.importe;
    } else {
      const totalAsignado = (m.compensaciones_destinos || []).reduce((acc, curr) => acc + curr.importe, 0);
      return m.importe - totalAsignado;
    }
  };

  // Base movement unallocated amount
  const getBaseAvailableAmount = () => {
    if (!baseMov) return 0;
    if (isBaseIngreso) {
      const totalAsignado = (baseMov.compensaciones_destinos || []).reduce((acc, curr) => acc + curr.importe, 0);
      return baseMov.importe - totalAsignado;
    } else {
      return baseMov.importe_neto ?? baseMov.importe;
    }
  };

  const baseAvailableAmount = getBaseAvailableAmount();
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
    try {
      const allocsArray = Object.entries(allocations).map(([id, amount]) => {
        const targetMov = allMovimientos.find(m => m.id === id)!;
        return { mov: targetMov, importe: amount };
      });
      await onLink(baseMov, allocsArray);
      onClose();
    } catch (err) {
      console.error(err);
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
      title={
        <div className="flex items-center gap-2">
          <ShieldCheck className={isBaseIngreso ? "text-indigo-500" : "text-emerald-500"} size={24} />
          <span>{isBaseIngreso ? 'Repartir Ingreso (Bizum)' : 'Vincular Compensación (Bizum)'}</span>
        </div>
      }
      size="md"
    >
      <div className="space-y-4">
        {/* Base Movement Info Banner */}
        {baseMov && (
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              {isBaseIngreso ? 'Ingreso a Repartir' : 'Gasto a Compensar'}
            </span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800 dark:text-white truncate pr-2">{baseMov.concepto}</span>
              <span className={`text-sm font-extrabold shrink-0 ${isBaseIngreso ? 'text-emerald-500' : 'text-rose-500'}`}>
                {isBaseIngreso ? '+' : '-'}{formatCurrency(baseMov.importe)}
              </span>
            </div>
            {baseAvailableAmount < baseMov.importe && (
              <div className="text-[10px] font-medium text-slate-400">
                {isBaseIngreso ? 'Saldo disponible para repartir:' : 'Saldo pendiente de compensar:'} <span className="font-bold text-slate-500">{formatCurrency(baseAvailableAmount)}</span>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
          <input
            type="text"
            placeholder={`Buscar ${isBaseIngreso ? 'gastos' : 'ingresos'}...`}
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
          />
        </div>

        {/* Targets Items List */}
        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
          {filteredTargets.length > 0 ? (
            filteredTargets.map(m => {
              const targetAvail = getAvailableFromTarget(m);
              const allocAmount = allocations[m.id];
              const isSelected = allocAmount !== undefined;

              return (
                <div
                  key={m.id}
                  className={`
                    flex flex-col gap-2
                    p-3 
                    rounded-xl 
                    border 
                    transition-all
                    ${isSelected
                      ? (isBaseIngreso ? 'border-indigo-500 bg-indigo-500/5 dark:bg-indigo-500/10' : 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10')
                      : 'border-slate-100 dark:border-slate-800 bg-white/20 dark:bg-slate-950/10 hover:bg-slate-50 dark:hover:bg-slate-900/30'
                    }
                  `}
                >
                  <div 
                    className="flex items-center justify-between gap-3 cursor-pointer"
                    onClick={() => handleToggleSelect(m)}
                  >
                    <div className="flex items-center gap-3 min-w-0">
                      <div className={`
                        w-5 h-5 
                        rounded-full 
                        border 
                        flex items-center justify-center 
                        shrink-0 
                        transition-all
                        ${isSelected
                          ? (isBaseIngreso ? 'border-indigo-500 bg-indigo-500 text-white' : 'border-emerald-500 bg-emerald-500 text-white')
                          : 'border-slate-300 dark:border-slate-700 bg-transparent'
                        }
                      `}>
                        {isSelected && <Check size={12} strokeWidth={3} />}
                      </div>

                      <div className="flex flex-col truncate">
                        <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate">{m.concepto}</span>
                        <span className="text-[10px] text-slate-400 flex items-center gap-1 mt-0.5">
                          <Calendar size={10} />
                          {formatDate(m.fecha_operacion)}
                        </span>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className={`text-xs font-extrabold ${isBaseIngreso ? 'text-rose-500' : 'text-emerald-500'}`}>
                        {isBaseIngreso ? '-' : '+'}{formatCurrency(m.importe)}
                      </div>
                      {targetAvail < m.importe && (
                        <div className="text-[9px] text-slate-400 font-bold">
                          Disp: {formatCurrency(targetAvail)}
                        </div>
                      )}
                    </div>
                  </div>

                  {isSelected && (
                    <div className="pl-8 pt-2 flex items-center gap-3 border-t border-slate-200/50 dark:border-white/5 mt-1">
                      <span className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">Asignar:</span>
                      <div className="relative flex-1">
                        <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">€</span>
                        <input 
                          type="number"
                          step="0.01"
                          max={targetAvail}
                          value={allocAmount || ''}
                          onChange={(e) => handleAmountChange(m.id, e.target.value, targetAvail)}
                          className="w-full pl-7 pr-3 py-1.5 text-xs font-bold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg focus:outline-none focus:ring-1 focus:ring-indigo-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs">
              No se han encontrado {isBaseIngreso ? 'gastos' : 'ingresos'} elegibles.
            </div>
          )}
        </div>

        {/* Ledger allocation preview */}
        {Object.keys(allocations).length > 0 && baseMov && (
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-100/50 dark:bg-slate-900/50 space-y-2.5 animate-appear-up">
            <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Resumen de Asignación
            </h5>
            
            <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-600 dark:text-slate-300">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">Total asignado:</span>
                <span className="text-indigo-500">{formatCurrency(totalAllocatedAmount)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">{isBaseIngreso ? 'Ingreso libre restante:' : 'Gasto pdte. restante:'}</span>
                <span className={`text-slate-700 dark:text-white ${remainingToAllocate < 0 ? 'text-rose-500' : ''}`}>
                  {formatCurrency(remainingToAllocate)}
                </span>
              </div>
            </div>
            {remainingToAllocate < 0 && (
              <p className="text-[10px] text-rose-500 font-bold mt-1">Has excedido el importe disponible.</p>
            )}
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
            type="button"
            onClick={handleLink}
            disabled={isLoading || Object.keys(allocations).length === 0 || !baseMov || remainingToAllocate < 0}
            className={`flex-1 py-3 rounded-xl text-white text-xs font-bold tracking-wide uppercase shadow-md flex items-center justify-center gap-2 disabled:opacity-50 transition-all
              ${isBaseIngreso 
                ? 'bg-gradient-to-r from-indigo-500 to-violet-600 hover:from-indigo-600 hover:to-violet-700 hover:shadow-indigo-500/20' 
                : 'bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 hover:shadow-emerald-500/20'
              }
            `}
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
                <ShieldCheck size={14} />
                Confirmar ({Object.keys(allocations).length})
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};

