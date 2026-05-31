import React, { useState, useEffect, useMemo } from 'react';
import { Download, FileJson, FileText, Save, ListFilter, Trash2, CheckCircle2, Search, Filter } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../hooks/useFinanceData';

interface ExportViewProps {
  movimientos: Movimiento[];
  huchas: Hucha[];
  userId: string | undefined;
}

interface FilterState {
  startDate: string;
  endDate: string;
  type: 'all' | 'ingreso' | 'gasto';
  huchaId: string;
  searchTerm: string;
}

interface Preset {
  id: string;
  name: string;
  filters: FilterState;
}

const DEFAULT_FILTERS: FilterState = {
  startDate: '',
  endDate: '',
  type: 'all',
  huchaId: 'all',
  searchTerm: '',
};

export const ExportView: React.FC<ExportViewProps> = ({ movimientos, huchas, userId }) => {
  const { isLocked } = usePrivacy();
  
  const [filters, setFilters] = useState<FilterState>(DEFAULT_FILTERS);
  const [presets, setPresets] = useState<Preset[]>([]);
  const [newPresetName, setNewPresetName] = useState('');
  const [isSavingPreset, setIsSavingPreset] = useState(false);
  
  // Feedback state
  const [copiedFormat, setCopiedFormat] = useState<'json' | 'md' | null>(null);

  // Load presets from localStorage on mount
  useEffect(() => {
    if (userId) {
      const saved = localStorage.getItem(`flowt_export_presets_${userId}`);
      if (saved) {
        try {
          setPresets(JSON.parse(saved));
        } catch (e) {
          console.error("Error parsing presets", e);
        }
      }
    }
  }, [userId]);

  // Save presets to localStorage
  const savePresetsToStorage = (newPresets: Preset[]) => {
    if (userId) {
      localStorage.setItem(`flowt_export_presets_${userId}`, JSON.stringify(newPresets));
      setPresets(newPresets);
    }
  };

  const handleSavePreset = () => {
    if (!newPresetName.trim()) return;
    const newPreset: Preset = {
      id: Date.now().toString(),
      name: newPresetName.trim(),
      filters: { ...filters },
    };
    savePresetsToStorage([...presets, newPreset]);
    setNewPresetName('');
    setIsSavingPreset(false);
  };

  const handleDeletePreset = (id: string) => {
    savePresetsToStorage(presets.filter(p => p.id !== id));
  };

  const handleLoadPreset = (preset: Preset) => {
    setFilters(preset.filters);
  };

  // Filtering Logic
  const filteredMovimientos = useMemo(() => {
    return movimientos.filter((mov) => {
      // 1. Date filter
      const movDate = parseMovimientoDate(mov.fecha_operacion);
      if (movDate) {
        if (filters.startDate) {
          const start = new Date(filters.startDate);
          start.setHours(0, 0, 0, 0);
          if (movDate < start) return false;
        }
        if (filters.endDate) {
          const end = new Date(filters.endDate);
          end.setHours(23, 59, 59, 999);
          if (movDate > end) return false;
        }
      }
      
      // 2. Type filter
      if (filters.type !== 'all' && mov.tipo !== filters.type) return false;
      
      // 3. Hucha filter
      if (filters.huchaId !== 'all' && mov.hucha_id !== filters.huchaId) return false;
      
      // 4. Search filter
      if (filters.searchTerm && !mov.concepto.toLowerCase().includes(filters.searchTerm.toLowerCase())) return false;
      
      return true;
    });
  }, [movimientos, filters]);

  // Calculations
  const totalAmount = filteredMovimientos.reduce((sum, mov) => {
    return mov.tipo === 'ingreso' ? sum + mov.importe : sum - mov.importe;
  }, 0);

  // Formatting Logic
  const handleCopyJSON = async () => {
    // Sanitize output (don't include internal IDs if not needed, but keeping them might be useful. Let's keep it simple)
    const data = filteredMovimientos.map(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      return {
        fecha: d ? d.toISOString().split('T')[0] : 'Desconocida',
        concepto: m.concepto,
        importe: m.importe,
        tipo: m.tipo,
        cartera: huchas.find(h => h.id === m.hucha_id)?.nombre || 'Desconocida'
      };
    });

    try {
      await navigator.clipboard.writeText(JSON.stringify(data, null, 2));
      setCopiedFormat('json');
      setTimeout(() => setCopiedFormat(null), 3000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleCopyMD = async () => {
    const header = `| Fecha | Concepto | Tipo | Cartera | Importe |\n|---|---|---|---|---|`;
    const rows = filteredMovimientos.map(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      const fechaStr = d ? d.toLocaleDateString('es-ES') : 'Desconocida';
      const cartera = huchas.find(h => h.id === m.hucha_id)?.nombre || 'Desconocida';
      const importeStr = `${m.tipo === 'gasto' ? '-' : '+'}${m.importe.toFixed(2)}€`;
      return `| ${fechaStr} | ${m.concepto} | ${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} | ${cartera} | ${importeStr} |`;
    }).join('\n');

    const mdString = `${header}\n${rows}\n\n**Total Seleccionado: ${totalAmount.toFixed(2)}€**`;

    try {
      await navigator.clipboard.writeText(mdString);
      setCopiedFormat('md');
      setTimeout(() => setCopiedFormat(null), 3000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  return (
    <div className="flex flex-col gap-6 animate-in slide-in-from-bottom-4 duration-500 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-2">
        <h2 className="text-2xl font-black tracking-tight text-slate-800 dark:text-white flex items-center gap-3">
          <div className="p-2 rounded-xl bg-indigo-500/10 text-indigo-500">
            <Download size={24} />
          </div>
          Exportar Datos
        </h2>
        <p className="text-sm text-slate-500 dark:text-slate-400">
          Filtra tus movimientos y cópialos para análisis externos o asistentes de IA.
        </p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Filters Panel */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          <div className="backdrop-blur-xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/50 dark:border-white/5 rounded-3xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-none">
            <div className="flex items-center justify-between mb-6">
              <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <Filter size={18} className="text-indigo-500" />
                Filtros Avanzados
              </h3>
              <button 
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-xs font-semibold text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors"
              >
                Limpiar Filtros
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Fechas */}
              <div className="col-span-1 sm:col-span-2 flex items-center justify-between mt-2">
                <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">Rango de Fechas</span>
                <button 
                  onClick={() => setFilters(prev => ({ ...prev, startDate: '', endDate: '' }))}
                  className="text-[10px] font-bold text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 bg-indigo-500/10 px-2 py-1 rounded-md transition-colors"
                >
                  Todo el tiempo
                </button>
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Desde</label>
                <input
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                  className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Hasta</label>
                <input
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                  className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                />
              </div>

              {/* Tipo y Hucha */}
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Tipo</label>
                <select
                  value={filters.type}
                  onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value as any }))}
                  className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                >
                  <option value="all">Todos los movimientos</option>
                  <option value="ingreso">Solo Ingresos</option>
                  <option value="gasto">Solo Gastos</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Cartera</label>
                <select
                  value={filters.huchaId}
                  onChange={(e) => setFilters(prev => ({ ...prev, huchaId: e.target.value }))}
                  className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl px-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all appearance-none"
                >
                  <option value="all">Todas las carteras</option>
                  {huchas.map(h => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Búsqueda */}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label className="text-[10px] font-bold uppercase tracking-wider text-slate-500">Buscar en Concepto</label>
                <div className="relative">
                  <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                  <input
                    type="text"
                    value={filters.searchTerm}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                    placeholder="Ej. Nómina, Mercadona, Amazon..."
                    className="w-full bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl pl-11 pr-4 py-2.5 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Presets Panel */}
          <div className="backdrop-blur-xl bg-white/60 dark:bg-slate-900/60 border border-slate-200/50 dark:border-white/5 rounded-3xl p-6 shadow-xl shadow-slate-200/20 dark:shadow-none">
             <div className="flex items-center justify-between mb-4">
              <h3 className="font-bold text-slate-700 dark:text-slate-200 flex items-center gap-2">
                <ListFilter size={18} className="text-indigo-500" />
                Filtros Guardados (Presets)
              </h3>
            </div>

            {isSavingPreset ? (
              <div className="flex gap-2 animate-in fade-in zoom-in-95 duration-200 mb-4">
                <input
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Nombre del preset..."
                  className="flex-1 bg-slate-100/50 dark:bg-slate-800/50 border border-slate-200/50 dark:border-white/5 rounded-xl px-4 py-2 text-sm text-slate-700 dark:text-slate-200 focus:outline-none focus:ring-2 focus:ring-indigo-500/50 transition-all"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                />
                <button
                  onClick={handleSavePreset}
                  className="px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white rounded-xl text-sm font-bold shadow-lg shadow-indigo-500/20 transition-all"
                >
                  Guardar
                </button>
                <button
                  onClick={() => { setIsSavingPreset(false); setNewPresetName(''); }}
                  className="px-4 py-2 bg-slate-200 hover:bg-slate-300 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl text-sm font-bold transition-all"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsSavingPreset(true)}
                className="flex items-center gap-2 text-sm font-semibold text-indigo-500 hover:text-indigo-600 dark:hover:text-indigo-400 mb-4 transition-colors"
              >
                <Save size={16} />
                Guardar filtros actuales
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              {presets.length === 0 ? (
                <span className="text-sm text-slate-500 dark:text-slate-400 italic">No tienes presets guardados.</span>
              ) : (
                presets.map(preset => (
                  <div key={preset.id} className="group relative flex items-center bg-slate-100 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg overflow-hidden">
                    <button
                      onClick={() => handleLoadPreset(preset)}
                      className="px-4 py-2 text-sm font-medium text-slate-700 dark:text-slate-300 hover:bg-slate-200 dark:hover:bg-slate-700 transition-colors"
                    >
                      {preset.name}
                    </button>
                    <button
                      onClick={() => handleDeletePreset(preset.id)}
                      className="px-2.5 py-2 text-slate-400 hover:text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-500/10 transition-colors border-l border-slate-200 dark:border-slate-700"
                      title="Eliminar preset"
                    >
                      <Trash2 size={14} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="col-span-1 flex flex-col gap-6">
          <div className="sticky top-24 backdrop-blur-xl bg-gradient-to-br from-indigo-500/5 to-violet-500/5 dark:from-indigo-500/10 dark:to-violet-500/10 border border-indigo-500/20 dark:border-indigo-500/20 rounded-3xl p-6 shadow-xl shadow-indigo-500/5">
            <h3 className="font-bold text-slate-700 dark:text-slate-200 mb-6 text-center">
              Resumen de Exportación
            </h3>

            <div className="flex flex-col gap-4 mb-8">
              <div className="bg-white/50 dark:bg-slate-950/50 rounded-2xl p-4 flex flex-col items-center justify-center border border-white/20 dark:border-white/5">
                <span className="text-4xl font-black text-slate-800 dark:text-white">
                  {filteredMovimientos.length}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Movimientos
                </span>
              </div>
              <div className="bg-white/50 dark:bg-slate-950/50 rounded-2xl p-4 flex flex-col items-center justify-center border border-white/20 dark:border-white/5">
                <span className={`text-2xl font-black ${isLocked ? 'blur-sm' : totalAmount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isLocked ? '***,**' : `${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}`}€
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Balance Total
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleCopyJSON}
                disabled={filteredMovimientos.length === 0}
                className={`w-full relative py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all overflow-hidden group ${
                  filteredMovimientos.length === 0 
                    ? 'bg-slate-100 dark:bg-slate-800 text-slate-400 cursor-not-allowed'
                    : 'bg-slate-800 dark:bg-white text-white dark:text-slate-900 hover:scale-[1.02] active:scale-95 shadow-lg'
                }`}
              >
                {copiedFormat === 'json' ? (
                  <>
                    <CheckCircle2 size={18} className="text-emerald-400 dark:text-emerald-500" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <FileJson size={18} />
                    <span>Copiar como JSON</span>
                  </>
                )}
                <div className="absolute inset-0 opacity-0 group-hover:opacity-10 bg-white dark:bg-black transition-opacity" />
              </button>

              <button
                onClick={handleCopyMD}
                disabled={filteredMovimientos.length === 0}
                className={`w-full relative py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all overflow-hidden group border ${
                  filteredMovimientos.length === 0 
                    ? 'border-slate-200 dark:border-slate-800 text-slate-400 cursor-not-allowed'
                    : 'border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-800 hover:border-slate-400 dark:hover:border-slate-600 hover:scale-[1.02] active:scale-95 shadow-sm'
                }`}
              >
                {copiedFormat === 'md' ? (
                  <>
                    <CheckCircle2 size={18} className="text-emerald-500" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <FileText size={18} />
                    <span>Copiar como Markdown</span>
                  </>
                )}
              </button>
            </div>
            
            {filteredMovimientos.length === 0 && (
              <p className="text-[10px] text-center text-slate-400 mt-4 px-4">
                No hay movimientos que coincidan con los filtros actuales.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
