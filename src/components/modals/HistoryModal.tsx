import React, { useState, useMemo, useEffect } from 'react';
import { ArrowUpRight, ArrowDownRight, Edit, Check, X, ShieldCheck, RefreshCw, Calendar, Banknote, Trash2 } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Movimiento } from '../../types';
import { CategoryPicker } from '../dashboard/CategoryPicker';
import { matchesHistoryMovement, type HistoryFilter } from '../../utils/historySearch';

interface HistoryModalProps {
  isOpen: boolean;
  onClose: () => void;
  chartMovements: Movimiento[];
  olderMovements: Movimiento[];
  olderMovementsLoading: boolean;
  olderMovementsLoaded: boolean;
  olderMovementsError: boolean;
  loadOlderMovements: () => Promise<void>;
  onUpdateConcepto: (movId: string, newConcepto: string) => Promise<void>;
  onUpdateCategoria?: (id: string, categoria: string) => Promise<void>;
  onUnlink: (mov: Movimiento) => Promise<void>;
  onDeleteMovimiento: (mov: Movimiento) => void;
}

export const HistoryModal: React.FC<HistoryModalProps> = ({
  isOpen, onClose, chartMovements, olderMovements, olderMovementsLoading,
  olderMovementsLoaded, olderMovementsError, loadOlderMovements,
  onUpdateConcepto, onUpdateCategoria, onUnlink, onDeleteMovimiento,
}) => {
  const [searchTerm, setSearchTerm] = useState('');
  const [filterType, setFilterType] = useState<HistoryFilter>('all');
  const [visibleCount, setVisibleCount] = useState(15);
  // DeferredOverlay preserves state between openings; reset only the page.
  const [wasOpen, setWasOpen] = useState(isOpen);
  if (wasOpen !== isOpen) {
    setWasOpen(isOpen);
    if (isOpen) setVisibleCount(15);
  }
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConcepto, setTempConcepto] = useState('');
  const [isSaving, setIsSaving] = useState(false);
  const isFiltering = Boolean(searchTerm.trim()) || filterType !== 'all';

  useEffect(() => {
    if (isOpen && isFiltering && !olderMovementsLoaded && !olderMovementsLoading && !olderMovementsError) {
      void loadOlderMovements();
    }
  }, [isOpen, isFiltering, olderMovementsLoaded, olderMovementsLoading, olderMovementsError, loadOlderMovements]);

  const history = useMemo(() => [...chartMovements, ...olderMovements], [chartMovements, olderMovements]);
  const filteredHistory = useMemo(() => history.filter(m => matchesHistoryMovement(m, searchTerm, filterType)),
    [history, searchTerm, filterType]);
  const displayedHistory = isFiltering ? filteredHistory : history.slice(0, visibleCount);
  const hasMore = !isFiltering && (visibleCount < history.length || !olderMovementsLoaded);
  const handleLoadMore = () => {
    const nextCount = visibleCount + 15;
    setVisibleCount(nextCount);
    if (nextCount >= chartMovements.length && !olderMovementsLoaded && !olderMovementsLoading && !olderMovementsError) {
      void loadOlderMovements();
    }
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
  const formatCurrency = (val: number) => val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });
  const formatDate = (value: unknown): string => {
    if (value instanceof Date) return value.toLocaleDateString('es-ES');
    if (typeof value === 'string') return new Date(value).toLocaleDateString('es-ES');
    if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
      const date: unknown = value.toDate();
      if (date instanceof Date) return date.toLocaleDateString('es-ES');
    }
    return '---';
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} size="lg" title="Historial completo">
      <div className="space-y-4">
        <div className="flex flex-col gap-3">
          <div>
            <label htmlFor="history-search" className="field-label">Buscar movimientos</label>
            <input id="history-search" type="search" placeholder="Buscar por concepto o importe…"
              value={searchTerm} onChange={e => setSearchTerm(e.target.value)} className="field" />
          </div>
          <div className="segmented" role="group" aria-label="Tipo de movimiento">
            {(['all', 'ingreso', 'gasto'] as const).map(type => (
              <button key={type} type="button" onClick={() => setFilterType(type)}
                className="segmented-item" aria-pressed={filterType === type}>
                {type === 'all' ? 'Todos' : type === 'ingreso' ? 'Ingresos' : 'Gastos'}
              </button>
            ))}
          </div>
        </div>
        {isFiltering && !olderMovementsLoaded && !olderMovementsError && (
          <p role="status" className="dashboard-label flex items-center gap-2">
            <RefreshCw className="animate-spin shrink-0" size={14} />Buscando en movimientos antiguos…
          </p>
        )}
        {olderMovementsError && (
          <div className="notice is-danger" role="alert">
            <div className="space-y-2">
              <p>No se pudieron cargar los movimientos antiguos. Los resultados pueden estar incompletos.</p>
              <button type="button" className="dashboard-secondary-button" disabled={olderMovementsLoading}
                onClick={() => void loadOlderMovements()}>Reintentar</button>
            </div>
          </div>
        )}
        <div className="space-y-2 max-h-[360px] overflow-y-auto pr-1 custom-scrollbar">
          {displayedHistory.length > 0 ? displayedHistory.map(m => {
            const isGasto = m.tipo === 'gasto';
            const isEditing = editingId === m.id;
            const isLinked = m.tipo === 'ingreso'
              ? Boolean(m.compensa_movimiento_id || (m.compensaciones_destinos?.length ?? 0) > 0)
              : (m.compensado_por?.length ?? 0) > 0 || (m.compensado_por_detalles?.length ?? 0) > 0;
            return (
              <div key={m.id} className="flex items-center justify-between gap-3 p-3 rounded-xl border border-line bg-surface hover:bg-surface-2 transition-colors">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <div className={`w-8 h-8 rounded-lg flex items-center justify-center shrink-0 ${m.es_metalico ? 'bg-brand-tint text-brand-ink' : isGasto ? 'bg-rose-500/10 text-rose-500' : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'}`}>
                    {m.es_metalico ? <Banknote size={18} /> : isGasto ? <ArrowDownRight size={18} /> : <ArrowUpRight size={18} />}
                  </div>
                  <div className="flex-1 min-w-0">
                    {isEditing ? (
                      <div className="flex items-center gap-1.5">
                        <input aria-label="Concepto" value={tempConcepto} onChange={e => setTempConcepto(e.target.value)}
                          disabled={isSaving} className="field min-w-0" autoFocus />
                        <button type="button" aria-label="Guardar concepto" onClick={() => void handleSaveConcepto(m.id)}
                          disabled={isSaving || !tempConcepto.trim()} className="dashboard-icon-button"><Check size={14} /></button>
                        <button type="button" aria-label="Cancelar edición" onClick={() => { setEditingId(null); setTempConcepto(''); }}
                          disabled={isSaving} className="dashboard-icon-button"><X size={14} /></button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-1">
                        <span className="text-xs font-bold text-ink truncate">{m.concepto}</span>
                        <button type="button" onClick={() => { setEditingId(m.id); setTempConcepto(m.concepto); }}
                          className="dashboard-icon-button shrink-0" aria-label="Editar concepto"><Edit size={12} /></button>
                        <button type="button" onClick={() => onDeleteMovimiento(m)} className="dashboard-icon-button is-danger shrink-0"
                          aria-label="Eliminar movimiento" title="Eliminar movimiento"><Trash2 size={12} /></button>
                      </div>
                    )}
                    {onUpdateCategoria && <CategoryPicker movimiento={m} onSave={onUpdateCategoria} />}
                    <div className="flex items-center flex-wrap gap-x-2 gap-y-1 mt-1 text-[10px] text-ink-soft">
                      <span className="flex items-center gap-1"><Calendar size={10} />{formatDate(m.fecha_operacion)}</span>
                      {isLinked && (
                        <div className="flex items-center gap-1 px-1.5 rounded-full bg-brand-tint text-brand-ink">
                          <ShieldCheck size={10} />{isGasto ? 'Compensado' : 'Repartido'}
                          <button type="button" onClick={e => { e.stopPropagation(); void onUnlink(m); }} className="dashboard-icon-button is-danger"
                            title={isGasto ? 'Deshacer todas las compensaciones de este gasto' : 'Deshacer todos los repartos de este ingreso'}
                            aria-label={isGasto ? 'Deshacer todas las compensaciones de este gasto' : 'Deshacer todos los repartos de este ingreso'}><X size={12} /></button>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
                <div className="text-right shrink-0 tabular-nums">
                  <div className={`text-xs font-extrabold ${isGasto ? 'text-rose-500' : 'text-emerald-600 dark:text-emerald-400'}`}>
                    {isGasto ? '-' : '+'}{formatCurrency(m.importe)}
                  </div>
                  {m.importe_neto !== undefined && m.importe_neto !== null && m.importe_neto < m.importe && (
                    <div className="text-[10px] text-ink-faint">Neto: {formatCurrency(m.importe_neto)}</div>
                  )}
                </div>
              </div>
            );
          }) : <div className="dashboard-empty">No se han encontrado movimientos.</div>}
        </div>
        {!isFiltering && olderMovementsLoading && (
          <p role="status" className="dashboard-label flex items-center gap-2"><RefreshCw className="animate-spin" size={14} />Cargando movimientos antiguos…</p>
        )}
        {hasMore && (!olderMovementsError || visibleCount < history.length) && (
          <button type="button" className="dashboard-secondary-button w-full" onClick={handleLoadMore}
            disabled={olderMovementsLoading && visibleCount >= history.length}>Cargar más</button>
        )}
      </div>
    </Modal>
  );
};
