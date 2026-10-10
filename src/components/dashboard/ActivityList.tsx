import React, { useState } from 'react';
import { 
  ArrowUpRight, 
  ArrowDownRight, 
  Banknote,
  Edit2, 
  Check, 
  X, 
  Download, 
  Link, 
  Link2Off, 
  RefreshCw, 
  Undo2, 
  Info,
  Calendar,
  Search,
  SlidersHorizontal,
  Trash2,
  Landmark,
  Sparkles
} from 'lucide-react';
import { parseMovimientoDate } from '../../hooks/useFinanceData';
import { type Movimiento, type Hucha } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { EmptyIllustration } from '../common/EmptyIllustration';
import { ExpenseImpactBadge } from './BurnRateVisuals';
import { generateCsv } from '../../utils/csv';
import { ServiceIcon } from './ServiceIcon';
import { resolveServiceKey } from '../../utils/serviceNames';
import { CategoryPicker } from './CategoryPicker';
import { MovementReview } from './MovementReview';
import { importeEnEstadisticas } from '../../utils/movements';
import { suggestCompensations } from '../../utils/movementSuggestions';
import { useCategories } from '../../hooks/useCategories';

interface ActivityListProps {
  movimientos: Movimiento[];
  allMovimientos: Movimiento[];
  huchas: Hucha[];
  huchaMonthlyBudgets: Record<string, number>;
  onUpdateConcepto: (movId: string, newConcepto: string) => void;
  onUpdateCategoria?: (id: string, categoria: string) => Promise<void>;
  onAcceptCompensation?: (base: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => Promise<void>;
  onDismissCompensation?: (ingresoId: string, gastoId: string) => Promise<void>;
  onConvert: (mov: Movimiento) => void;
  onLink: (mov: Movimiento) => void;
  onUnlink: (ingreso: Movimiento) => void;
  onChangeHucha: (mov: Movimiento, newHuchaId: string) => void;
  onDeleteMovimiento: (mov: Movimiento) => void;
}

export const ActivityList: React.FC<ActivityListProps> = ({
  movimientos,
  allMovimientos,
  huchas,
  huchaMonthlyBudgets,
  onUpdateConcepto,
  onUpdateCategoria,
  onAcceptCompensation,
  onDismissCompensation,
  onConvert,
  onLink,
  onUnlink,
  onChangeHucha,
  onDeleteMovimiento,
}) => {
  const { categories: MOVEMENT_CATEGORIES, categoryLabel, suggestCategory } = useCategories();
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConcepto, setTempConcepto] = useState('');
  const [hoveredMovId, setHoveredMovId] = useState<string | null>(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHucha, setSelectedHucha] = useState('all');
  const [selectedTipo, setSelectedTipo] = useState('all');
  const [selectedCategoria, setSelectedCategoria] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [selectedBanco, setSelectedBanco] = useState('all');
  const [showFilters, setShowFilters] = useState(false);

  const { formatCurrency, isLocked } = usePrivacy();
  const compensations = React.useMemo(() => new Map(
    onAcceptCompensation && onDismissCompensation ? suggestCompensations(allMovimientos).map(s => [s.ingreso.id, s]) : []
  ), [allMovimientos, onAcceptCompensation, onDismissCompensation]);
  const pendingCount = allMovimientos.filter(m => (onUpdateCategoria && suggestCategory(m)) || compensations.has(m.id)).length;

  const formatDate = (dateValue: unknown) => {
    const d = parseMovimientoDate(dateValue);
    if (!d) return 'Sin fecha';
    return d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
  };

  const handleStartEdit = (m: Movimiento) => {
    setEditingId(m.id);
    setTempConcepto(m.concepto);
  };

  const handleSaveConcepto = (m: Movimiento) => {
    if (tempConcepto.trim() && tempConcepto.trim() !== m.concepto) {
      onUpdateConcepto(m.id, tempConcepto.trim());
    }
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  // Clear all filters
  const clearAllFilters = () => {
    setSearchTerm('');
    setSelectedHucha('all');
    setSelectedTipo('all');
    setSelectedCategoria('all');
    setMinAmount('');
    setMaxAmount('');
    setDateRange('all');
    setCustomStartDate('');
    setCustomEndDate('');
    setSelectedBanco('all');
  };

  // Filter Algorithm
  const filteredMovimientos = React.useMemo(() => {
    const isFilterActive = 
      searchTerm !== '' || 
      selectedHucha !== 'all' || 
      selectedTipo !== 'all' || 
      selectedBanco !== 'all' ||
      minAmount !== '' || 
      maxAmount !== '' || 
      dateRange !== 'all' || selectedCategoria !== 'all';

    // Search across ALL movements if a filter is active; otherwise show default recent list
    const baseList = isFilterActive ? allMovimientos : movimientos;

    return baseList.filter(m => {
      if (selectedCategoria === 'pending' && !suggestCategory(m) && !compensations.has(m.id)) return false;
      if (selectedCategoria !== 'all' && selectedCategoria !== 'pending' && (m.categoria || suggestCategory(m)?.categoria || 'sin_categorizar') !== selectedCategoria) return false;
      // 1. Text Search
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        if (!m.concepto.toLowerCase().includes(term)) {
          return false;
        }
      }

      // 2. Bank Filter
      if (selectedBanco !== 'all') {
        if ((m.banco || '').toLowerCase() !== selectedBanco.toLowerCase()) {
          return false;
        }
      }

      // 3. Hucha Destination Filter
      if (selectedHucha !== 'all') {
        if (m.hucha_id !== selectedHucha) {
          return false;
        }
      }

      // 4. Operation Type Filter
      if (selectedTipo !== 'all') {
        if (m.tipo !== selectedTipo) {
          return false;
        }
      }

      // 4. Amount Range Filter
      const amt = m.importe;
      if (minAmount && amt < parseFloat(minAmount)) {
        return false;
      }
      if (maxAmount && amt > parseFloat(maxAmount)) {
        return false;
      }

      // 5. Date Range Filter
      const mDate = parseMovimientoDate(m.fecha_operacion);
      if (mDate) {
        const today = new Date();
        const checkDate = new Date(mDate);
        checkDate.setHours(0,0,0,0);

        if (dateRange === 'week') {
          const limitDate = new Date(today);
          limitDate.setDate(today.getDate() - 7);
          limitDate.setHours(0,0,0,0);
          if (checkDate < limitDate) return false;
        } else if (dateRange === 'month') {
          if (mDate.getMonth() !== today.getMonth() || mDate.getFullYear() !== today.getFullYear()) {
            return false;
          }
        } else if (dateRange === 'three_months') {
          const limitDate = new Date(today);
          limitDate.setDate(today.getDate() - 90);
          limitDate.setHours(0,0,0,0);
          if (checkDate < limitDate) return false;
        } else if (dateRange === 'custom') {
          if (customStartDate) {
            const start = new Date(customStartDate);
            start.setHours(0, 0, 0, 0);
            if (checkDate < start) return false;
          }
          if (customEndDate) {
            const end = new Date(customEndDate);
            end.setHours(23, 59, 59, 999);
            if (checkDate > end) return false;
          }
        }
      }

      return true;
    });
  }, [movimientos, allMovimientos, compensations, suggestCategory, searchTerm, selectedHucha, selectedTipo, selectedCategoria, selectedBanco, minAmount, maxAmount, dateRange, customStartDate, customEndDate]);

  // CSV Exporter using currently filtered items
  const exportToCSV = () => {
    const headers = ['ID', 'Fecha', 'Tipo', 'Concepto', 'Categoría', 'Estado categoría', 'Importe', 'Importe Neto', 'Hucha Receptora'];
    const rows = filteredMovimientos.map(m => {
      const huchaName = m.hucha_id ? (huchas.find(h => h.id === m.hucha_id)?.nombre || '') : '';
      const dateStr = formatDate(m.fecha_operacion);
      return [
        m.id,
        dateStr,
        m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        m.concepto,
        categoryLabel(m.categoria || suggestCategory(m)?.categoria),
        m.categoria ? 'Confirmada' : 'Pendiente',
        m.importe,
        importeEnEstadisticas(m),
        huchaName
      ];
    });

    const csvContent = generateCsv(headers, rows);

    // Create file and download
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `flowt_actividad_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Find linked movements for tooltips
  const getLinkedMovements = (mov: Movimiento) => {
    if (mov.tipo === 'gasto') {
      const legacyIds = mov.compensado_por || [];
      const newIds = (mov.compensado_por_detalles || []).map(d => d.ingreso_id);
      const allIds = Array.from(new Set([...legacyIds, ...newIds]));
      return allIds.length > 0 ? allMovimientos.filter(m => allIds.includes(m.id)) : [];
    }
    if (mov.tipo === 'ingreso') {
      const legacyId = mov.compensa_movimiento_id ? [mov.compensa_movimiento_id] : [];
      const newIds = (mov.compensaciones_destinos || []).map(d => d.gasto_id);
      const allIds = Array.from(new Set([...legacyId, ...newIds]));
      return allIds.length > 0 ? allMovimientos.filter(m => allIds.includes(m.id)) : [];
    }
    return [];
  };

  const hasActiveFilters = Boolean(
    searchTerm || selectedHucha !== 'all' || selectedTipo !== 'all' || selectedCategoria !== 'all' ||
    selectedBanco !== 'all' || minAmount || maxAmount || dateRange !== 'all'
  );
  const field = 'w-full rounded-xl border border-line bg-surface-2 px-2.5 py-2 text-xs font-semibold text-ink placeholder:text-ink-faint focus:outline-none focus-visible:border-brand';
  const toolbarButton = 'inline-flex shrink-0 items-center gap-1.5 rounded-xl border px-3 py-2 text-xs font-bold transition-colors duration-150';
  const toolbarIdle = 'border-line bg-surface text-ink-soft hover:bg-surface-2 hover:text-ink';
  const toolbarOn = 'border-transparent bg-brand-tint text-brand-ink';

  return (
    <section aria-label="Actividad reciente" className="dashboard-surface p-4 sm:p-5">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="dashboard-heading">Actividad reciente</h3>
          <p className="dashboard-subtitle">Últimos movimientos registrados</p>
        </div>
        <button
          type="button"
          onClick={exportToCSV}
          aria-label="Exportar CSV"
          className={`${toolbarButton} ${toolbarIdle}`}
        >
          <Download className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Exportar CSV</span>
        </button>
      </div>

      {/* Search and filters */}
      <div className="mb-3 space-y-3">
        <div className="flex flex-col gap-2 sm:flex-row">
          <div className="relative min-w-0 flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-faint" />
            <input
              type="text"
              placeholder="Buscar por concepto..."
              aria-label="Buscar por concepto"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full rounded-xl border border-line bg-surface-2 py-2 pl-9 pr-9 text-[13px] font-medium text-ink placeholder:text-ink-faint focus:outline-none focus-visible:border-brand"
            />
            {searchTerm && (
              <button
                type="button"
                onClick={() => setSearchTerm('')}
                aria-label="Borrar búsqueda"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center rounded-lg text-ink-faint hover:bg-surface hover:text-ink"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {!isLocked && pendingCount > 0 && (
              <button
                type="button"
                aria-pressed={selectedCategoria === 'pending'}
                onClick={() => setSelectedCategoria(selectedCategoria === 'pending' ? 'all' : 'pending')}
                className={`${toolbarButton} ${selectedCategoria === 'pending' ? toolbarOn : toolbarIdle}`}
              >
                <Sparkles size={13} /> Revisar{' '}
                <span className="rounded-md bg-sun-500 px-1.5 py-0.5 text-[10px] leading-none text-slate-950">{pendingCount}</span>
              </button>
            )}
            <button
              type="button"
              aria-expanded={showFilters}
              onClick={() => setShowFilters(!showFilters)}
              className={`${toolbarButton} ${showFilters ? toolbarOn : toolbarIdle}`}
            >
              <SlidersHorizontal className="h-3.5 w-3.5" />
              Filtros
            </button>

            {hasActiveFilters && (
              <button
                type="button"
                onClick={clearAllFilters}
                className={`${toolbarButton} border-transparent bg-rose-500/10 text-rose-600 hover:bg-rose-500/15 dark:text-rose-300`}
                title="Limpiar todos los filtros"
                aria-label="Limpiar todos los filtros"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        </div>

        {showFilters && (
          <div className="animate-in fade-in slide-in-from-top-2 grid gap-3 rounded-2xl bg-surface-2/60 p-3 duration-200 sm:grid-cols-2 md:grid-cols-4">
            {onUpdateCategoria && <label className="flex flex-col gap-1">
              <span className="eyebrow">Categoría</span>
              <select aria-label="Filtrar por categoría" value={selectedCategoria} onChange={e => setSelectedCategoria(e.target.value)} className={field}>
                <option value="all">Todas las categorías</option>
                <option value="pending">Pendientes de revisar</option>
                {MOVEMENT_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
              </select>
            </label>}

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Cartera</span>
              <select value={selectedHucha} onChange={(e) => setSelectedHucha(e.target.value)} className={field}>
                <option value="all">Todas</option>
                {huchas.filter(h => h.activa !== false).map(h => (
                  <option key={h.id} value={h.id}>{h.nombre}</option>
                ))}
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Banco</span>
              <select value={selectedBanco} onChange={(e) => setSelectedBanco(e.target.value)} className={field}>
                <option value="all">Todos los bancos</option>
                <option value="Unicaja">Unicaja</option>
                <option value="Revolut">Revolut</option>
                <option value="BBVA">BBVA</option>
                <option value="Santander">Santander</option>
                <option value="CaixaBank">CaixaBank</option>
                <option value="ING">ING</option>
                <option value="Sabadell">Sabadell</option>
                <option value="N26">N26</option>
              </select>
            </label>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Tipo</span>
              <select value={selectedTipo} onChange={(e) => setSelectedTipo(e.target.value)} className={field}>
                <option value="all">Todos</option>
                <option value="ingreso">Ingresos</option>
                <option value="gasto">Gastos</option>
              </select>
            </label>

            <div className="flex flex-col gap-1">
              <span className="eyebrow">Importe (€)</span>
              <div className="flex items-center gap-1.5">
                <input type="number" placeholder="Min" aria-label="Importe mínimo" value={minAmount} onChange={(e) => setMinAmount(e.target.value)} className={field} />
                <span className="text-xs text-ink-faint">–</span>
                <input type="number" placeholder="Max" aria-label="Importe máximo" value={maxAmount} onChange={(e) => setMaxAmount(e.target.value)} className={field} />
              </div>
            </div>

            <label className="flex flex-col gap-1">
              <span className="eyebrow">Fecha</span>
              <select value={dateRange} onChange={(e) => setDateRange(e.target.value)} className={field}>
                <option value="all">Cualquier fecha</option>
                <option value="week">Últimos 7 días</option>
                <option value="month">Este mes</option>
                <option value="three_months">Últimos 3 meses</option>
                <option value="custom">Personalizado...</option>
              </select>
            </label>

            {dateRange === 'custom' && (
              <div className="animate-in fade-in slide-in-from-top-1 grid gap-3 duration-200 sm:col-span-2 sm:grid-cols-2 md:col-span-4">
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Desde</span>
                  <input type="date" value={customStartDate} onChange={(e) => setCustomStartDate(e.target.value)} className={field} />
                </label>
                <label className="flex flex-col gap-1">
                  <span className="eyebrow">Hasta</span>
                  <input type="date" value={customEndDate} onChange={(e) => setCustomEndDate(e.target.value)} className={field} />
                </label>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="custom-scrollbar -mr-2 max-h-[440px] divide-y divide-line overflow-y-auto pr-2 sm:max-h-[520px]">
        {filteredMovimientos.length > 0 ? (
          filteredMovimientos.map((m) => {
            const hasCompensaciones =
              (m.tipo === 'gasto' && ((m.compensado_por?.length ?? 0) > 0 || (m.compensado_por_detalles?.length ?? 0) > 0)) ||
              (m.tipo === 'ingreso' && (!!m.compensa_movimiento_id || (m.compensaciones_destinos?.length ?? 0) > 0));

            const linkedMovs = hasCompensaciones ? getLinkedMovements(m) : [];
            const isEditing = editingId === m.id;
            const compensation = compensations.get(m.id);
            const reassignable = huchas.filter(h => !h.es_suscripciones && h.activa !== false);

            let expensePercentage = 0;
            if (m.tipo === 'gasto' && m.hucha_id) {
              const budget = huchaMonthlyBudgets[m.hucha_id] || 0;
              if (budget > 0) {
                expensePercentage = (m.importe / budget) * 100;
              }
            }

            return (
              <div
                key={m.id}
                onMouseEnter={() => setHoveredMovId(m.id)}
                onMouseLeave={() => setHoveredMovId(null)}
                className="group relative py-3.5 first:pt-1 last:pb-1"
              >
                {/* What this movement is linked to */}
                {hoveredMovId === m.id && hasCompensaciones && linkedMovs.length > 0 && (
                  <div className="animate-in fade-in slide-in-from-bottom-1 pointer-events-none absolute left-12 top-full z-50 -mt-2 w-80 max-w-[calc(100vw-5rem)] duration-150">
                    <div className="glass-panel rounded-2xl p-3.5 text-left">
                      <p className="eyebrow mb-2 flex items-center gap-1.5 !text-emerald-600 dark:!text-emerald-400">
                        <Info className="h-3.5 w-3.5" />
                        {m.tipo === 'gasto' ? 'Gasto compensado por' : 'Ingreso vinculado a'}
                      </p>
                      <div className="space-y-1.5">
                        {linkedMovs.map((link) => (
                          <div key={link.id} className="flex items-center justify-between gap-3 rounded-xl bg-surface-2 p-2 text-[11px]">
                            <div className="min-w-0">
                              <p className="truncate font-semibold text-ink">{link.concepto}</p>
                              <p className="mt-0.5 flex items-center gap-1 text-[10px] text-ink-faint">
                                <Calendar className="h-2.5 w-2.5" /> {formatDate(link.fecha_operacion)}
                              </p>
                            </div>
                            <span className={`shrink-0 font-bold tabular-nums ${link.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                              {link.tipo === 'ingreso' ? '+' : '−'}{formatCurrency(link.importe)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {m.tipo === 'gasto' && (
                        <div className="mt-2.5 flex items-center justify-between border-t border-line pt-2 text-xs">
                          <span className="text-ink-soft">Importe original</span>
                          <span className="font-extrabold tabular-nums text-ink">{formatCurrency(m.importe)}</span>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                <div className="flex items-start gap-3">
                  {/* Icon depending on type */}
                  <div className={`grid h-10 w-10 shrink-0 place-items-center rounded-xl ${
                    m.es_metalico
                      ? 'bg-sky-500/12 text-sky-600 dark:text-sky-300'
                      : m.tipo === 'ingreso'
                        ? 'bg-emerald-500/12 text-emerald-600 dark:text-emerald-300'
                        : resolveServiceKey(m.concepto)
                          ? ''
                          : 'bg-surface-2 text-ink-soft'
                  }`}>
                    {m.es_metalico ? (
                      <Banknote className="h-5 w-5" />
                    ) : m.tipo === 'ingreso' ? (
                      <ArrowUpRight className="h-5 w-5" />
                    ) : resolveServiceKey(m.concepto) ? (
                      <ServiceIcon name={m.concepto} />
                    ) : (
                      <ArrowDownRight className="h-5 w-5" />
                    )}
                  </div>

                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      {/* Concept and info */}
                      <div className="min-w-0 flex-1">
                        {isEditing ? (
                          <div className="flex max-w-md items-center gap-1.5">
                            <input
                              type="text"
                              value={tempConcepto}
                              aria-label="Concepto"
                              onChange={(e) => setTempConcepto(e.target.value)}
                              className="w-full rounded-lg border border-brand bg-surface-2 px-2.5 py-1 text-sm text-ink focus:outline-none"
                              autoFocus
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') handleSaveConcepto(m);
                                if (e.key === 'Escape') handleCancelEdit();
                              }}
                            />
                            <button
                              type="button"
                              onClick={() => handleSaveConcepto(m)}
                              aria-label="Guardar concepto"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-emerald-500 text-white transition-transform hover:bg-emerald-400 active:scale-90"
                            >
                              <Check className="h-4 w-4" />
                            </button>
                            <button
                              type="button"
                              onClick={handleCancelEdit}
                              aria-label="Cancelar edición"
                              className="grid h-7 w-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-soft transition-transform hover:text-ink active:scale-90"
                            >
                              <X className="h-4 w-4" />
                            </button>
                          </div>
                        ) : (
                          <div className="group/concept flex items-center gap-1.5">
                            <p
                              onDoubleClick={() => handleStartEdit(m)}
                              className="truncate text-sm font-bold text-ink"
                              title="Doble click para editar"
                            >
                              {m.concepto}
                            </p>
                            <button
                              type="button"
                              onClick={() => handleStartEdit(m)}
                              aria-label={`Editar concepto de ${m.concepto}`}
                              className="shrink-0 rounded p-0.5 text-ink-faint opacity-0 transition-opacity hover:text-brand-ink focus-visible:opacity-100 group-hover/concept:opacity-100"
                            >
                              <Edit2 className="h-3 w-3" />
                            </button>
                          </div>
                        )}

                        <div className="mt-0.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-soft">
                          <span>{formatDate(m.fecha_operacion)}</span>
                          {m.banco && (
                            <span className="inline-flex items-center gap-1">
                              <span aria-hidden="true">·</span>
                              <Landmark size={10} />
                              {m.banco}
                            </span>
                          )}
                          {m.hucha_id && (
                            <span className="inline-flex items-center gap-1.5 font-semibold text-brand-ink">
                              <span aria-hidden="true" className="font-normal text-ink-soft">·</span>
                              {huchas.find(h => h.id === m.hucha_id)?.nombre || 'Cartera'}
                            </span>
                          )}
                          {expensePercentage >= 5 && (
                            <ExpenseImpactBadge percentage={expensePercentage} />
                          )}
                        </div>
                      </div>

                      {/* Amount */}
                      <div className="shrink-0 text-right">
                        <p className={`text-sm font-extrabold tabular-nums ${
                          m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink'
                        } ${hasCompensaciones ? 'line-through opacity-50' : ''}`}>
                          {m.tipo === 'ingreso' ? '+' : '−'}{formatCurrency(m.importe)}
                        </p>

                        {m.tipo === 'gasto' && hasCompensaciones && (
                          <p className="text-xs font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                            neto −{formatCurrency(m.importe_neto ?? m.importe)}
                          </p>
                        )}

                        {m.tipo === 'ingreso' && hasCompensaciones && (
                          <p className="mt-0.5 flex items-center justify-end gap-1 text-[10px] font-bold text-emerald-600 dark:text-emerald-400">
                            <Undo2 className="h-2.5 w-2.5" /> Compensación
                          </p>
                        )}

                      </div>
                    </div>

                    <div className="flex flex-wrap items-end justify-between gap-x-3">
                      {onUpdateCategoria && <CategoryPicker movimiento={m} onSave={onUpdateCategoria} />}

                      {/* Actions (reassign, convert, link, delete) */}
                      <div className="ml-auto mt-2 flex items-center gap-0.5 transition-opacity duration-200 sm:opacity-0 sm:group-focus-within:opacity-100 sm:group-hover:opacity-100">
                        {m.tipo === 'gasto' && reassignable.length > 0 && (
                          <select
                            value={m.hucha_id || ''}
                            onChange={(e) => onChangeHucha(m, e.target.value)}
                            className="mr-1 max-w-[120px] truncate rounded-lg bg-surface-2 px-2 py-1.5 text-[11px] font-semibold text-ink-soft hover:text-ink focus:outline-none"
                            title="Reasignar hucha"
                            aria-label="Reasignar hucha"
                          >
                            <option value="" disabled>Reasignar...</option>
                            {reassignable.map(h => (
                              <option key={h.id} value={h.id}>{h.nombre}</option>
                            ))}
                          </select>
                        )}

                        <button
                          type="button"
                          onClick={() => onConvert(m)}
                          className="dashboard-icon-button"
                          title="Convertir tipo de movimiento"
                          aria-label="Convertir tipo de movimiento"
                        >
                          <RefreshCw className="h-3.5 w-3.5" />
                        </button>

                        <button
                          type="button"
                          onClick={() => onLink(m)}
                          className="dashboard-icon-button"
                          title={m.tipo === 'gasto' ? "Vincular/Compensar con Bizum" : "Repartir este ingreso en gastos"}
                          aria-label={m.tipo === 'gasto' ? "Vincular/Compensar con Bizum" : "Repartir este ingreso en gastos"}
                        >
                          <Link className="h-3.5 w-3.5" />
                        </button>
                        {hasCompensaciones && (
                          <button
                            type="button"
                            onClick={() => onUnlink(m)}
                            className="dashboard-icon-button is-danger"
                            title="Deshacer vínculo de compensación"
                            aria-label="Deshacer vínculo de compensación"
                          >
                            <Link2Off className="h-3.5 w-3.5" />
                          </button>
                        )}

                        <button
                          type="button"
                          onClick={() => onDeleteMovimiento(m)}
                          className="dashboard-icon-button is-danger"
                          title="Eliminar movimiento"
                          aria-label="Eliminar movimiento"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                  </div>
                </div>
                {compensation && onAcceptCompensation && onDismissCompensation && (
                  <div className="mt-3 sm:pl-[3.25rem]">
                    <MovementReview key={compensation.id} suggestion={compensation} onAccept={onAcceptCompensation} onDismiss={onDismissCompensation} onAdjust={onLink} />
                  </div>
                )}
              </div>
            );
          })
        ) : (
          <div className="dashboard-empty animate-in fade-in my-1 py-10 duration-300">
            <EmptyIllustration />
            <p className="text-sm font-bold text-ink">{hasActiveFilters ? 'Nada coincide con esos filtros' : 'Aún no hay movimientos'}</p>
            <p className="max-w-xs text-xs font-normal">
              {hasActiveFilters ? 'Prueba a quitar alguno para ver más movimientos.' : 'Cuando llegue un cargo o una nómina aparecerá aquí.'}
            </p>
          </div>
        )}
      </div>
    </section>
  );
};
