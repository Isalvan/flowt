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
  Trash2
} from 'lucide-react';
import { parseMovimientoDate } from '../../hooks/useFinanceData';
import { Card } from '../common/Card';
import { type Movimiento, type Hucha } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { EmptyIllustration } from '../common/EmptyIllustration';
import { ExpenseImpactBadge } from './BurnRateVisuals';

interface ActivityListProps {
  movimientos: Movimiento[];
  allMovimientos: Movimiento[];
  huchas: Hucha[];
  huchaMonthlyBudgets: Record<string, number>;
  onUpdateConcepto: (movId: string, newConcepto: string) => void;
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
  onConvert,
  onLink,
  onUnlink,
  onChangeHucha,
  onDeleteMovimiento,
}) => {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [tempConcepto, setTempConcepto] = useState('');
  const [hoveredMovId, setHoveredMovId] = useState<string | null>(null);

  // Filter States
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedHucha, setSelectedHucha] = useState('all');
  const [selectedTipo, setSelectedTipo] = useState('all');
  const [minAmount, setMinAmount] = useState('');
  const [maxAmount, setMaxAmount] = useState('');
  const [dateRange, setDateRange] = useState('all');
  const [customStartDate, setCustomStartDate] = useState('');
  const [customEndDate, setCustomEndDate] = useState('');
  const [showFilters, setShowFilters] = useState(false);

  const { formatCurrency } = usePrivacy();

  const formatDate = (dateValue: any) => {
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
    setMinAmount('');
    setMaxAmount('');
    setDateRange('all');
    setCustomStartDate('');
    setCustomEndDate('');
  };

  // Filter Algorithm
  const filteredMovimientos = React.useMemo(() => {
    const isFilterActive = 
      searchTerm !== '' || 
      selectedHucha !== 'all' || 
      selectedTipo !== 'all' || 
      minAmount !== '' || 
      maxAmount !== '' || 
      dateRange !== 'all';

    // Search across ALL movements if a filter is active; otherwise show default recent list
    const baseList = isFilterActive ? allMovimientos : movimientos;

    return baseList.filter(m => {
      // 1. Text Search
      if (searchTerm) {
        const term = searchTerm.toLowerCase().trim();
        if (!m.concepto.toLowerCase().includes(term)) {
          return false;
        }
      }

      // 2. Hucha Destination Filter
      if (selectedHucha !== 'all') {
        if (m.hucha_id !== selectedHucha) {
          return false;
        }
      }

      // 3. Operation Type Filter
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
  }, [movimientos, allMovimientos, searchTerm, selectedHucha, selectedTipo, minAmount, maxAmount, dateRange, customStartDate, customEndDate]);

  // CSV Exporter using currently filtered items
  const exportToCSV = () => {
    const headers = ['ID', 'Fecha', 'Tipo', 'Concepto', 'Importe', 'Importe Neto', 'Hucha Receptora'];
    const rows = filteredMovimientos.map(m => {
      const huchaName = m.hucha_id ? (huchas.find(h => h.id === m.hucha_id)?.nombre || '') : '';
      const dateStr = formatDate(m.fecha_operacion);
      return [
        m.id,
        dateStr,
        m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        m.concepto.replace(/"/g, '""'),
        m.importe,
        m.tipo === 'gasto' && m.compensado_por ? (m.importe_neto ?? m.importe) : m.importe,
        huchaName
      ];
    });

    const csvContent = [
      headers.join(','),
      ...rows.map(e => e.map(val => `"${val}"`).join(','))
    ].join('\n');

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

  return (
    <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl">
      <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
        <div>
          <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            Actividad Reciente
          </h3>
          <p className="text-xs text-slate-400 dark:text-slate-500">Últimos movimientos registrados</p>
        </div>
        <button
          onClick={exportToCSV}
          className="flex items-center gap-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-xs px-3.5 py-2 rounded-xl transition-all duration-200 hover:scale-105 active:scale-95 border border-white/5 hover:border-slate-300 dark:hover:border-slate-600 shadow-sm hover:shadow cursor-pointer"
        >
          <Download className="w-3.5 h-3.5" />
          Exportar CSV
        </button>
      </div>

      {/* Advanced Filter Bar Controls */}
      <div className="space-y-4 mb-6">
        <div className="flex flex-col sm:flex-row gap-3">
          {/* Concept Search Input */}
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 dark:text-slate-500" />
            <input
              type="text"
              placeholder="Buscar por concepto..."
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              className="w-full pl-10 pr-4 py-2.5 rounded-2xl bg-white/40 dark:bg-slate-950/20 border border-slate-200/50 dark:border-white/5 text-xs text-slate-755 dark:text-slate-200 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all hover:border-slate-350 dark:hover:border-white/10 font-semibold"
            />
            {searchTerm && (
              <button 
                onClick={() => setSearchTerm('')} 
                className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer hover:scale-110 active:scale-90 transition-transform"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <div className="flex gap-2">
            {/* Filter Toggle Button */}
            <button
              onClick={() => setShowFilters(!showFilters)}
              className={`flex items-center gap-1.5 font-bold text-xs px-4 py-2.5 rounded-2xl border transition-all duration-200 cursor-pointer hover:scale-105 active:scale-95 hover:shadow-md ${
                showFilters 
                  ? 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20 shadow-sm' 
                  : 'bg-white/40 dark:bg-slate-950/20 text-slate-600 dark:text-slate-400 border-slate-200/50 dark:border-white/5 hover:border-slate-300 dark:hover:border-white/10'
              }`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" />
              Filtros
            </button>

            {/* Clear Filters Button (conditional) */}
            {(searchTerm || selectedHucha !== 'all' || selectedTipo !== 'all' || minAmount || maxAmount || dateRange !== 'all') && (
              <button
                onClick={clearAllFilters}
                className="flex items-center gap-1 bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white border border-rose-500/10 font-bold text-xs px-3.5 py-2.5 rounded-2xl transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-md hover:shadow-rose-500/10 cursor-pointer"
                title="Limpiar todos los filtros"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>

        {/* Collapsible Advanced Filters Grid */}
        {showFilters && (
          <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-4 p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/10 border border-slate-200/30 dark:border-white/5 animate-in fade-in slide-in-from-top-2 duration-300">
            
            {/* Hucha Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Cartera</label>
              <select
                value={selectedHucha}
                onChange={(e) => setSelectedHucha(e.target.value)}
                className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-2.5 py-2 focus:outline-none cursor-pointer"
              >
                <option value="all">Todas</option>
                {huchas.map(h => (
                  <option key={h.id} value={h.id}>{h.nombre}</option>
                ))}
              </select>
            </div>

            {/* Type Filter */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Tipo</label>
              <select
                value={selectedTipo}
                onChange={(e) => setSelectedTipo(e.target.value)}
                className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-2.5 py-2 focus:outline-none cursor-pointer"
              >
                <option value="all">Todos</option>
                <option value="ingreso">Ingresos</option>
                <option value="gasto">Gastos</option>
              </select>
            </div>

            {/* Amount range */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Importe (€)</label>
              <div className="flex items-center gap-1.5">
                <input
                  type="number"
                  placeholder="Min"
                  value={minAmount}
                  onChange={(e) => setMinAmount(e.target.value)}
                  className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-2.5 py-2 focus:outline-none placeholder-slate-450"
                />
                <span className="text-slate-400 text-xs font-bold">-</span>
                <input
                  type="number"
                  placeholder="Max"
                  value={maxAmount}
                  onChange={(e) => setMaxAmount(e.target.value)}
                  className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-2.5 py-2 focus:outline-none placeholder-slate-450"
                />
              </div>
            </div>

            {/* Date range */}
            <div className="flex flex-col gap-1">
              <label className="text-[10px] font-black uppercase tracking-widest text-slate-400 dark:text-slate-500">Fecha</label>
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value)}
                className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-white/5 rounded-xl px-2.5 py-2 focus:outline-none cursor-pointer"
              >
                <option value="all">Cualquier fecha</option>
                <option value="week">Últimos 7 días</option>
                <option value="month">Este mes</option>
                <option value="three_months">Últimos 3 meses</option>
                <option value="custom">Personalizado...</option>
              </select>
            </div>

            {/* Custom Dates (conditional) */}
            {dateRange === 'custom' && (
              <div className="sm:col-span-2 md:col-span-4 grid gap-4 sm:grid-cols-2 p-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl mt-1 animate-in slide-in-from-top-1 duration-200">
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Fecha Inicio</span>
                  <input
                    type="date"
                    value={customStartDate}
                    onChange={(e) => setCustomStartDate(e.target.value)}
                    className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-indigo-500/15 rounded-xl px-2.5 py-2 focus:outline-none"
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <span className="text-[9px] font-black uppercase tracking-widest text-indigo-600 dark:text-indigo-400">Fecha Fin</span>
                  <input
                    type="date"
                    value={customEndDate}
                    onChange={(e) => setCustomEndDate(e.target.value)}
                    className="w-full text-xs font-bold bg-white/50 dark:bg-slate-950/20 text-slate-700 dark:text-slate-300 border border-slate-200/50 dark:border-indigo-500/15 rounded-xl px-2.5 py-2 focus:outline-none"
                  />
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="space-y-3.5 max-h-[500px] overflow-y-auto pr-1">
        {filteredMovimientos.length > 0 ? (
          filteredMovimientos.map((m) => {
          const hasCompensaciones = 
              (m.tipo === 'gasto' && ((m.compensado_por?.length ?? 0) > 0 || (m.compensado_por_detalles?.length ?? 0) > 0)) || 
              (m.tipo === 'ingreso' && (!!m.compensa_movimiento_id || (m.compensaciones_destinos?.length ?? 0) > 0));
            
            const linkedMovs = hasCompensaciones ? getLinkedMovements(m) : [];
            const isEditing = editingId === m.id;
            
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
                className="group relative flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 rounded-2xl bg-white/40 dark:bg-slate-900/20 border border-white/5 hover:border-indigo-500/10 hover:bg-white/80 dark:hover:bg-slate-950/20 transition-all duration-300 shadow-sm hover:shadow"
              >
                {/* Visual Connector Popover */}
                {hoveredMovId === m.id && hasCompensaciones && linkedMovs.length > 0 && (
                  <div className="absolute left-4 top-[-10px] sm:top-auto sm:bottom-full sm:left-1/2 sm:-translate-x-1/2 z-50 mb-3 w-80 animate-in fade-in slide-in-from-bottom-2 duration-200 pointer-events-none">
                    <div className="glass-panel rounded-2xl p-4 border border-emerald-500/20 shadow-2xl bg-slate-950/95 text-left text-slate-100">
                      <div className="flex items-center gap-1.5 text-emerald-400 font-extrabold text-xs uppercase tracking-wider mb-2.5">
                        <Info className="w-3.5 h-3.5" />
                        {m.tipo === 'gasto' ? 'Gasto Compensado por:' : 'Ingreso Vinculado a Gasto:'}
                      </div>
                      <div className="space-y-2">
                        {linkedMovs.map((link) => (
                          <div key={link.id} className="flex justify-between items-center bg-white/5 border border-white/5 p-2 rounded-xl text-[11px]">
                            <div className="min-w-0">
                              <p className="font-semibold text-slate-200 truncate">{link.concepto}</p>
                              <p className="text-[9px] text-slate-500 flex items-center gap-1 mt-0.5">
                                <Calendar className="w-2.5 h-2.5" /> {formatDate(link.fecha_operacion)}
                              </p>
                            </div>
                            <span className={`font-bold shrink-0 ml-3 ${
                              link.tipo === 'ingreso' ? 'text-emerald-400' : 'text-rose-400'
                            }`}>
                              {link.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(link.importe)}
                            </span>
                          </div>
                        ))}
                      </div>
                      {m.tipo === 'gasto' && (
                        <div className="mt-3 pt-2 border-t border-white/10 flex justify-between items-center text-xs">
                          <span className="font-bold text-slate-400 uppercase tracking-widest text-[10px]">Importe Original:</span>
                          <span className="font-extrabold text-slate-300 tabular-nums">{formatCurrency(m.importe)}</span>
                        </div>
                      )}
                    </div>
                    {/* Small arrow */}
                    <div className="w-3 h-3 bg-slate-950/95 border-b border-r border-emerald-500/20 rotate-45 absolute bottom-[-6px] left-[20px] sm:left-1/2 sm:-translate-x-1/2 -z-10" />
                  </div>
                )}

                <div className="flex items-center gap-3.5 min-w-0 flex-1">
                  {/* Icon depending on type */}
                  <div className={`flex items-center justify-center w-10 h-10 rounded-2xl shrink-0 ${
                    m.es_metalico
                      ? 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border border-sky-500/10 shadow-sm'
                      : m.tipo === 'ingreso'
                        ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/10'
                        : 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border border-rose-500/10'
                  }`}>
                    {m.es_metalico ? (
                      <Banknote className="w-5 h-5" />
                    ) : m.tipo === 'ingreso' ? (
                      <ArrowUpRight className="w-5 h-5" />
                    ) : (
                      <ArrowDownRight className="w-5 h-5" />
                    )}
                  </div>

                  {/* Concept and Info */}
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="flex items-center gap-2 max-w-md">
                        <input
                          type="text"
                          value={tempConcepto}
                          onChange={(e) => setTempConcepto(e.target.value)}
                          className="bg-slate-100/50 dark:bg-slate-800/50 border border-white/10 rounded-xl px-2.5 py-1 text-sm text-slate-800 dark:text-slate-100 focus:outline-none focus:ring-1 focus:ring-indigo-500 w-full"
                          autoFocus
                          onKeyDown={(e) => {
                            if (e.key === 'Enter') handleSaveConcepto(m);
                            if (e.key === 'Escape') handleCancelEdit();
                          }}
                        />
                        <button
                          onClick={() => handleSaveConcepto(m)}
                          className="flex items-center justify-center w-7 h-7 bg-emerald-500 hover:bg-emerald-400 text-white rounded-lg active:scale-90 transition-transform shrink-0"
                        >
                          <Check className="w-4 h-4" />
                        </button>
                        <button
                          onClick={handleCancelEdit}
                          className="flex items-center justify-center w-7 h-7 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-400 rounded-lg active:scale-90 transition-transform shrink-0"
                        >
                          <X className="w-4 h-4" />
                        </button>
                      </div>
                    ) : (
                      <div className="flex items-center gap-2 group/concept">
                        <p
                          onDoubleClick={() => handleStartEdit(m)}
                          className="font-extrabold text-sm text-slate-800 dark:text-slate-100 uppercase tracking-tight truncate cursor-pointer hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                          title="Doble click para editar"
                        >
                          {m.concepto}
                        </p>
                        <button
                          onClick={() => handleStartEdit(m)}
                          className="text-slate-400 opacity-0 group-hover/concept:opacity-100 hover:text-indigo-600 dark:hover:text-indigo-400 transition-opacity p-0.5"
                        >
                          <Edit2 className="w-3 h-3" />
                        </button>
                      </div>
                    )}

                    <div className="flex flex-wrap items-center gap-2 mt-1">
                      <span className="text-[10px] font-bold text-slate-400 uppercase tracking-widest shrink-0">
                        {formatDate(m.fecha_operacion)}
                      </span>
                      {m.hucha_id && (
                        <span className="inline-flex items-center gap-0.5 text-[9px] font-bold text-indigo-500 dark:text-indigo-400 uppercase tracking-wider">
                          • {huchas.find(h => h.id === m.hucha_id)?.nombre || 'Cartera'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                {/* Amounts and action indicators */}
                <div className="flex sm:flex-col items-center sm:items-end justify-between sm:justify-start gap-2.5 w-full sm:w-auto mt-2 sm:mt-0 shrink-0">
                  <div className="flex items-center sm:items-end flex-row sm:flex-col gap-2 sm:gap-0 shrink-0">
                    {expensePercentage >= 5 && (
                      <div className="mb-1">
                        <ExpenseImpactBadge percentage={expensePercentage} />
                      </div>
                    )}
                    <div className="text-left sm:text-right shrink-0">
                      <p className={`text-base font-extrabold tabular-nums tracking-tight ${
                      m.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'
                    } ${hasCompensaciones ? 'line-through opacity-50' : ''}`}>
                      {m.tipo === 'ingreso' ? '+' : '-'}{formatCurrency(m.importe)}
                    </p>
                    
                    {m.tipo === 'gasto' && hasCompensaciones && (
                      <p className="text-xs font-black tabular-nums text-emerald-600 dark:text-emerald-400 -mt-0.5 flex items-center gap-1 justify-end">
                        neto −{formatCurrency(m.importe_neto ?? m.importe)}
                      </p>
                    )}

                    {m.tipo === 'ingreso' && hasCompensaciones && (
                      <p className="text-[9px] font-bold uppercase tracking-widest text-emerald-600 dark:text-emerald-400 mt-0.5 flex items-center gap-0.5 justify-end">
                        <Undo2 className="w-2.5 h-2.5" /> compensación
                      </p>
                    )}
                  </div>
                  </div>

                  {/* Actions (Link, Convert, Reassign Hucha) */}
                  <div className="flex flex-wrap items-center gap-1.5 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity duration-300 w-full sm:w-auto justify-end">
                    
                    {/* Hucha reassign select (expenses only) */}
                    {m.tipo === 'gasto' && huchas.filter(h => !h.es_suscripciones).length > 0 && (
                      <select
                        value={m.hucha_id || ''}
                        onChange={(e) => onChangeHucha(m, e.target.value)}
                        className="text-[9px] font-bold uppercase tracking-wider bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-500 dark:text-slate-450 border border-white/5 rounded-xl px-2.5 py-1.5 focus:outline-none cursor-pointer max-w-[110px] truncate transition-all duration-200 hover:scale-105 active:scale-95 hover:shadow-sm"
                        title="Reasignar hucha"
                      >
                        <option value="" disabled>Reasignar...</option>
                        {huchas
                          .filter(h => !h.es_suscripciones)
                          .map(h => (
                            <option key={h.id} value={h.id}>{h.nombre}</option>
                          ))}
                      </select>
                    )}

                    {/* Convert Type (Ingreso <-> Gasto) */}
                    <button
                      onClick={() => onConvert(m)}
                      className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-slate-100 hover:bg-indigo-500/10 text-slate-400 hover:text-indigo-600 dark:bg-slate-800 dark:hover:bg-indigo-950/40 dark:hover:text-indigo-400 border border-white/5 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm"
                      title="Convertir tipo de movimiento"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                    </button>

                    {/* Link / Unlink Button */}
                    <button
                      onClick={() => onLink(m)}
                      className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-slate-100 hover:bg-emerald-500/10 text-slate-400 hover:text-emerald-600 dark:bg-slate-800 dark:hover:bg-emerald-950/40 dark:hover:text-emerald-400 border border-white/5 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm"
                      title={m.tipo === 'gasto' ? "Vincular/Compensar con Bizum" : "Repartir este ingreso en gastos"}
                    >
                      <Link className="w-3.5 h-3.5" />
                    </button>
                    {((m.tipo === 'gasto' && ((m.compensado_por?.length ?? 0) > 0 || (m.compensado_por_detalles?.length ?? 0) > 0)) || (m.tipo === 'ingreso' && (m.compensa_movimiento_id || (m.compensaciones_destinos?.length ?? 0) > 0))) && (
                      <button
                        onClick={() => onUnlink(m)}
                        className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-rose-500/10 text-rose-500 hover:bg-rose-500/20 border border-rose-500/10 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm"
                        title="Deshacer vínculo de compensación"
                      >
                        <Link2Off className="w-3.5 h-3.5" />
                      </button>
                    )}

                    {/* Delete Movement Button */}
                    <button
                      onClick={() => onDeleteMovimiento(m)}
                      className="flex items-center justify-center w-7.5 h-7.5 rounded-xl bg-slate-100 hover:bg-rose-500/10 text-slate-400 hover:text-rose-600 dark:bg-slate-800 dark:hover:bg-rose-950/40 dark:hover:text-rose-400 border border-white/5 transition-all duration-200 hover:scale-110 active:scale-90 hover:shadow-sm cursor-pointer"
                      title="Eliminar movimiento"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              </div>
            );
          })
        ) : (
          <div className="flex flex-col items-center justify-center p-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 text-center animate-in fade-in duration-300">
            <EmptyIllustration />
            <p className="font-extrabold text-sm text-slate-400 dark:text-slate-600 uppercase tracking-wider">Sin Movimientos</p>
            <p className="text-xs text-slate-400 mt-1">Registra nuevos cargos o nóminas para ver la actividad</p>
          </div>
        )}
      </div>
    </Card>
  );
};
