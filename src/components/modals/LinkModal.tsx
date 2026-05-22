import React, { useState, useMemo } from 'react';
import { ShieldCheck, Check, Search, Calendar } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento } from '../../types';

interface LinkModalProps {
  isOpen: boolean;
  onClose: () => void;
  onLink: (gasto: Movimiento, selectedIngresos: Movimiento[]) => Promise<void>;
  gasto: Movimiento | null;
  allMovimientos: Movimiento[];
}

export const LinkModal: React.FC<LinkModalProps> = ({
  isOpen,
  onClose,
  onLink,
  gasto,
  allMovimientos,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [isLoading, setIsLoading] = useState(false);

  // Filter list of eligible unlinked incomes
  const eligibleIngresos = useMemo(() => {
    return allMovimientos.filter(m => 
      m.tipo === 'ingreso' && 
      !m.compensa_movimiento_id && // not linked to anything else
      m.id !== gasto?.id // safety check
    );
  }, [allMovimientos, gasto]);

  // Search filtered incomes
  const filteredIngresos = useMemo(() => {
    if (!searchTerm.trim()) return eligibleIngresos;
    const query = searchTerm.toLowerCase();
    return eligibleIngresos.filter(m => 
      m.concepto.toLowerCase().includes(query) || 
      m.importe.toString().includes(query)
    );
  }, [eligibleIngresos, searchTerm]);

  const selectedIngresos = useMemo(() => {
    return eligibleIngresos.filter(m => selectedIds.has(m.id));
  }, [eligibleIngresos, selectedIds]);

  const totalSelectedSum = selectedIngresos.reduce((sum, m) => sum + m.importe, 0);
  const remainingExpenseAmount = gasto ? Math.max(0, gasto.importe - totalSelectedSum) : 0;

  const handleToggleSelect = (id: string) => {
    setSelectedIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const handleLink = async () => {
    if (!gasto || selectedIngresos.length === 0) return;
    setIsLoading(true);
    try {
      await onLink(gasto, selectedIngresos);
      setSelectedIds(new Set());
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
          <ShieldCheck className="text-emerald-500" size={24} />
          <span>Vincular Compensación (Bizum)</span>
        </div>
      }
      size="md"
    >
      <div className="space-y-4">
        {/* Expense Info Banner */}
        {gasto && (
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 space-y-1.5">
            <span className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">Gasto a compensar</span>
            <div className="flex items-center justify-between">
              <span className="text-sm font-bold text-slate-800 dark:text-white truncate pr-2">{gasto.concepto}</span>
              <span className="text-sm font-extrabold text-rose-500 shrink-0">-{formatCurrency(gasto.importe)}</span>
            </div>
            {gasto.importe_neto !== undefined && gasto.importe_neto !== null && gasto.importe_neto < gasto.importe && (
              <div className="text-[10px] font-medium text-slate-400">
                Saldo neto actual: <span className="font-bold text-slate-500">{formatCurrency(gasto.importe_neto)}</span>
              </div>
            )}
          </div>
        )}

        {/* Search */}
        <div className="relative">
          <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
          <input
            type="text"
            placeholder="Buscar bizum o ingreso elegible..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
          />
        </div>

        {/* Income Items List */}
        <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1 custom-scrollbar">
          {filteredIngresos.length > 0 ? (
            filteredIngresos.map(m => {
              const isSelected = selectedIds.has(m.id);
              return (
                <div
                  key={m.id}
                  onClick={() => handleToggleSelect(m.id)}
                  className={`
                    flex items-center justify-between gap-3 
                    p-3 
                    rounded-xl 
                    border 
                    cursor-pointer 
                    transition-all
                    ${isSelected
                      ? 'border-emerald-500 bg-emerald-500/5 dark:bg-emerald-500/10'
                      : 'border-slate-100 dark:border-slate-800 bg-white/20 dark:bg-slate-950/10 hover:bg-slate-50 dark:hover:bg-slate-900/30'
                    }
                  `}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    {/* Checkbox circle indicator */}
                    <div className={`
                      w-5 h-5 
                      rounded-full 
                      border 
                      flex items-center justify-center 
                      shrink-0 
                      transition-all
                      ${isSelected
                        ? 'border-emerald-500 bg-emerald-500 text-white'
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

                  <div className="text-xs font-extrabold text-emerald-500 shrink-0">
                    +{formatCurrency(m.importe)}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-6 text-slate-400 text-xs">
              No se han encontrado ingresos o Bizums elegibles para vincular.
            </div>
          )}
        </div>

        {/* Ledger allocation preview */}
        {selectedIds.size > 0 && gasto && (
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800 bg-emerald-500/5 dark:bg-emerald-500/10 space-y-2.5 animate-appear-up">
            <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400">
              Resumen de Compensación
            </h5>
            
            <div className="grid grid-cols-2 gap-4 text-xs font-bold text-slate-600 dark:text-slate-300">
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">Bizums seleccionados:</span>
                <span className="text-emerald-500">{formatCurrency(totalSelectedSum)}</span>
              </div>
              <div className="flex flex-col gap-0.5">
                <span className="text-[10px] text-slate-400">Importe neto final:</span>
                <span className="text-slate-700 dark:text-white">{formatCurrency(remainingExpenseAmount)}</span>
              </div>
            </div>
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
            disabled={isLoading || selectedIds.size === 0 || !gasto}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-emerald-500 to-teal-600 hover:from-emerald-600 hover:to-teal-700 text-white text-xs font-bold tracking-wide uppercase shadow-md hover:shadow-emerald-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Vinculando...
              </>
            ) : (
              <>
                <ShieldCheck size={14} />
                Vincular Bizums ({selectedIds.size})
              </>
            )}
          </button>
        </div>
      </div>
    </Modal>
  );
};
