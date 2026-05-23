import React, { useState, useMemo } from 'react';
import { History, Search, ArrowUpRight, ArrowDownRight, Edit, Check, X, ShieldCheck, RefreshCw, Calendar } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento } from '../../types';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  history: Movimiento[];
  onLoadMore: () => Promise<void>;
  hasMore: boolean;
  isLoading: boolean;
  onUpdateConcepto: (movId: string, newConcepto: string) => Promise<void>;
  onUnlink: (mov: Movimiento) => Promise<void>;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen,
  onClose,
  history,
  onLoadMore,
  hasMore,
  isLoading,
  onUpdateConcepto,
  onUnlink,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<'all' | 'ingreso' | 'gasto'>('all');
  
  // Inline editing state
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConcepto, setTempConcepto] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Search & Type filters
  const filteredHistory = useMemo(() => {
    return history.filter(m => {
      const matchesType = filterType === 'all' || m.tipo === filterType;
      const matchesSearch = !searchTerm.trim() || 
        m.concepto.toLowerCase().includes(searchTerm.toLowerCase()) || 
        m.importe.toString().includes(searchTerm);
      return matchesType && matchesSearch;
    });
  }, [history, searchTerm, filterType]);

  const handleStartEdit = (m: Movimiento) => {
    setEditingId(m.id);
    setTempConcepto(m.concepto);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
    setTempConcepto('');
  };

  const handleSaveConcepto = async (id: string) => {
    if (!tempConcepto.trim()) return;
    setIsSaving(true);
    try {
      await onUpdateConcepto(id, tempConcepto.trim());
      setEditingId(null);
    } catch (err) {
      console.error(err);
    } finally {
      setIsSaving(false);
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
          <History className="text-sky-500" size={24} />
          <span>Histórico de Movimientos</span>
        </div>
      }
      size="lg"
    >
      <div className="space-y-4">
        {/* Controls: Search and Filters */}
        <div className="flex flex-col sm:flex-row gap-3">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3.5 text-slate-400" size={16} />
            <input
              type="text"
              placeholder="Buscar por concepto o importe..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
            />
          </div>

          <div className="flex rounded-xl p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200/50 dark:border-slate-800 shrink-0">
            {(['all', 'ingreso', 'gasto'] as const).map(type => (
              <button
                key={type}
                type="button"
                onClick={() => setFilterType(type)}
                className={`
                  px-3 
                  py-1.5 
                  rounded-lg 
                  text-[10px] 
                  font-extrabold 
                  uppercase 
                  tracking-wider 
                  transition-all
                  ${filterType === type
                    ? 'bg-white dark:bg-slate-800 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-400 hover:text-slate-600 dark:hover:text-slate-200'
                  }
                `}
              >
                {type === 'all' ? 'Todos' : type === 'ingreso' ? 'Ingresos' : 'Gastos'}
              </button>
            ))}
          </div>
        </div>

        {/* History Ledger List */}
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
          {filteredHistory.length > 0 ? (
            filteredHistory.map(m => {
              const isGasto = m.tipo === 'gasto';
              const isEditing = editingId === m.id;

              return (
                <div
                  key={m.id}
                  className="group flex items-center justify-between gap-4 p-3 rounded-xl border border-slate-100 dark:border-slate-800 bg-white/20 dark:bg-slate-950/10 hover:bg-slate-50/50 dark:hover:bg-slate-900/10 transition-colors"
                >
                  <div className="flex items-center gap-3 min-w-0 flex-1">
                    {/* Direction Icon Badge */}
                    <div className={`
                      w-8 h-8 
                      rounded-lg 
                      flex items-center justify-center 
                      shrink-0
                      ${isGasto 
                        ? 'bg-rose-500/10 text-rose-500' 
                        : 'bg-emerald-500/10 text-emerald-500'
                      }
                    `}>
                      {isGasto ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                    </div>

                    {/* Concept and Subtitle */}
                    <div className="flex-1 min-w-0">
                      {isEditing ? (
                        <div className="flex items-center gap-1.5 w-full">
                          <input
                            type="text"
                            value={tempConcepto}
                            onChange={(e) => setTempConcepto(e.target.value)}
                            disabled={isSaving}
                            className="flex-1 px-2.5 py-1 rounded-md border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-1 focus:ring-sky-500"
                            autoFocus
                          />
                          <button
                            onClick={() => handleSaveConcepto(m.id)}
                            disabled={isSaving || !tempConcepto.trim()}
                            className="p-1 rounded-md text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/30 transition-colors"
                          >
                            <Check size={14} />
                          </button>
                          <button
                            onClick={handleCancelEdit}
                            disabled={isSaving}
                            className="p-1 rounded-md text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/30 transition-colors"
                          >
                            <X size={14} />
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5">
                          <span className="text-xs font-bold text-slate-700 dark:text-slate-200 truncate max-w-[180px] sm:max-w-xs">
                            {m.concepto}
                          </span>
                          <button
                            onClick={() => handleStartEdit(m)}
                            className="opacity-0 group-hover:opacity-100 hover:opacity-100 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-opacity p-0.5"
                            aria-label="Editar concepto"
                          >
                            <Edit size={10} />
                          </button>
                        </div>
                      )}

                      {/* Info badges/Dates */}
                      <div className="flex items-center flex-wrap gap-x-2 gap-y-0.5 mt-0.5">
                        <span className="text-[10px] text-slate-400 flex items-center gap-1">
                          <Calendar size={10} />
                          {formatDate(m.fecha_operacion)}
                        </span>

                        {/* Compensated visual badges */}
                        {m.tipo === 'ingreso' && m.compensa_movimiento_id && (
                          <div className="flex items-center gap-1 py-0.5 px-1.5 rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 text-[9px] font-extrabold tracking-wide">
                            <ShieldCheck size={8} />
                            Compensa Gasto
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onUnlink(m);
                              }}
                              className="text-rose-500 hover:text-rose-700 ml-0.5"
                              title="Deshacer compensación"
                            >
                              ✕
                            </button>
                          </div>
                        )}
                        {m.tipo === 'gasto' && m.compensado_por && m.compensado_por.length > 0 && (
                          <span className="flex items-center gap-1 py-0.5 px-1.5 rounded-full bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 text-[9px] font-extrabold tracking-wide">
                            <ShieldCheck size={8} />
                            Compensado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  {/* Amounts */}
                  <div className="text-right shrink-0">
                    <div className={`text-xs font-extrabold ${isGasto ? 'text-rose-500' : 'text-emerald-500'}`}>
                      {isGasto ? '-' : '+'}{formatCurrency(m.importe)}
                    </div>
                    {m.importe_neto !== undefined && m.importe_neto !== null && m.importe_neto < m.importe && (
                      <div className="text-[9px] font-extrabold text-slate-400 dark:text-slate-500">
                        Neto: {formatCurrency(m.importe_neto)}
                      </div>
                    )}
                  </div>
                </div>
              );
            })
          ) : (
            <div className="text-center py-10 text-slate-400 text-xs">
              No se han encontrado movimientos cargados.
            </div>
          )}
        </div>

        {/* Load More Button */}
        {hasMore && (
          <button
            type="button"
            onClick={onLoadMore}
            disabled={isLoading}
            className="w-full py-2.5 rounded-xl border border-dashed border-slate-200 dark:border-slate-800 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-900/30 text-xs font-bold transition-all flex items-center justify-center gap-2"
          >
            {isLoading ? (
              <RefreshCw className="animate-spin" size={14} />
            ) : (
              <span>Cargar más movimientos</span>
            )}
          </button>
        )}
      </div>
    </Modal>
  );
};
