import React, { useState, useEffect, useMemo } from 'react';
import { Download, FileJson, FileText, Save, ListFilter, Trash2, CheckCircle2, Search, Filter } from 'lucide-react';
import { type Movimiento, type Hucha, type Suscripcion } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../hooks/useFinanceData';
import { cuentaEnEstadisticas } from '../../utils/movements';
import { generateCsv } from '../../utils/csv';

interface ExportViewProps {
  movimientos: Movimiento[];
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  userStats: { total_ingresos: number; total_gastos: number } | null;
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

export const ExportView: React.FC<ExportViewProps> = ({ movimientos, huchas, suscripciones, userStats, userId }) => {
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

  const movimientosExternos = useMemo(() => filteredMovimientos.filter(cuentaEnEstadisticas), [filteredMovimientos]);
  const transferenciasInternas = useMemo(() => filteredMovimientos.filter(m => !cuentaEnEstadisticas(m)), [filteredMovimientos]);
  const calculateBalance = (items: Movimiento[]) => items.reduce((sum, mov) => {
    return mov.tipo === 'ingreso' ? sum + mov.importe : sum - mov.importe;
  }, 0);
  const totalAmount = calculateBalance(movimientosExternos);
  const totalInterno = calculateBalance(transferenciasInternas);
  const totalCarteras = huchas.reduce((sum, hucha) => sum + hucha.saldo_acumulado, 0);
  const balanceHistorico = (userStats?.total_ingresos || 0) - (userStats?.total_gastos || 0);
  const diferenciaConciliacion = totalCarteras - balanceHistorico;

  const detalleOrigenDestino = (movimiento: Movimiento) => {
    const cartera = huchas.find(h => h.id === movimiento.hucha_id)?.nombre;
    if (cartera) return movimiento.tipo === 'gasto' ? `Extraído de ${cartera}` : `Ingresado en ${cartera}`;
    return movimiento.tipo === 'ingreso' ? 'Repartido automáticamente en carteras' : 'Cartera no disponible';
  };

  const notaCompensacion = (movimiento: Movimiento) => {
    if (movimiento.tipo === 'ingreso') {
      const destinos = movimiento.compensaciones_destinos || [];
      if (destinos.length) return `Compensa: ${destinos.map(d => `${movimientos.find(m => m.id === d.gasto_id)?.concepto || d.gasto_id} (${d.importe.toFixed(2)}€)`).join(', ')}`;
      return movimiento.compensa_movimiento_id ? 'Reembolso/compensación de un gasto previo' : null;
    }
    const detalles = movimiento.compensado_por_detalles || [];
    if (detalles.length) return `Compensado (${detalles.map(d => `${movimientos.find(m => m.id === d.ingreso_id)?.concepto || d.ingreso_id}: ${d.importe.toFixed(2)}€`).join(', ')}). Neto: ${(movimiento.importe_neto ?? movimiento.importe).toFixed(2)}€`;
    if (movimiento.compensado_por?.length) return `Compensado. Neto: ${(movimiento.importe_neto ?? movimiento.importe).toFixed(2)}€`;
    return null;
  };

  const exportMovimiento = (m: Movimiento) => {
    const d = parseMovimientoDate(m.fecha_operacion);
    return {
      fecha: d ? d.toISOString().split('T')[0] : 'Desconocida',
      concepto: m.concepto,
      importe: m.importe,
      tipo: m.tipo,
      es_interno: !!m.es_interno,
      transfer_id: m.transfer_id || null,
      detalle_origen_destino: detalleOrigenDestino(m),
      compensacion: {
        destinos: m.compensaciones_destinos || [],
        compensado_por: m.compensado_por_detalles || [],
        importe_neto: m.importe_neto ?? null,
        nota: notaCompensacion(m),
      },
    };
  };

  // Formatting Logic
  const handleCopyJSON = async () => {
    // Sanitize and structure the output into a detailed report
    const report = {
      generado_el: new Date().toISOString(),
      estadisticas_globales: {
        total_ingresos_historicos: userStats?.total_ingresos || 0,
        total_gastos_historicos: userStats?.total_gastos || 0,
        balance_historico: (userStats?.total_ingresos || 0) - (userStats?.total_gastos || 0)
      },
      carteras_huchas: huchas.map(h => ({
        nombre: h.nombre,
        saldo_actual: h.saldo_acumulado,
        objetivo: h.objetivo || null,
        regla_aportacion: h.tipo_aportacion,
        valor_aportacion: h.valor_aportacion || 0,
        es_principal: !!h.es_principal,
        es_suscripciones: !!h.es_suscripciones
      })),
      suscripciones_activas: suscripciones.filter(s => s.activa).map(s => ({
        nombre: s.nombre,
        importe: s.importe,
        mi_parte: s.mi_parte || s.importe,
        frecuencia: s.frecuencia,
        categoria: s.categoria
      })),
      movimientos_externos_filtrados: movimientosExternos.map(exportMovimiento),
      transferencias_internas_filtradas: transferenciasInternas.map(exportMovimiento),
      resumen_filtro_actual: {
        total_movimientos: filteredMovimientos.length,
        movimientos_externos: movimientosExternos.length,
        balance_externo: totalAmount,
        movimientos_internos: transferenciasInternas.length,
        balance_transferencias_internas: totalInterno,
        balance_externo_historico: balanceHistorico,
        suma_carteras: totalCarteras,
        diferencia_conciliacion_historica: diferenciaConciliacion,
      }
    };

    try {
      await navigator.clipboard.writeText(JSON.stringify(report, null, 2));
      setCopiedFormat('json');
      setTimeout(() => setCopiedFormat(null), 3000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleCopyMD = async () => {
    let mdString = `# Reporte Financiero Flowt\nGenerado el: ${new Date().toLocaleDateString('es-ES')}\n\n`;

    // 1. Estadísticas Globales
    mdString += `## 📊 Estadísticas Globales Históricas\n`;
    mdString += `- **Ingresos Totales:** +${(userStats?.total_ingresos || 0).toFixed(2)}€\n`;
    mdString += `- **Gastos Totales:** -${(userStats?.total_gastos || 0).toFixed(2)}€\n`;
    mdString += `- **Balance Histórico:** ${((userStats?.total_ingresos || 0) - (userStats?.total_gastos || 0)).toFixed(2)}€\n\n`;

    // 2. Carteras
    mdString += `## 🏦 Estado de las Carteras (Huchas)\n`;
    mdString += `| Cartera | Saldo Actual | Objetivo | Regla de Ingreso | Principal |\n`;
    mdString += `|---|---|---|---|---|\n`;
    huchas.forEach(h => {
      const objetivo = h.objetivo ? `${h.objetivo}€` : 'Sin objetivo';
      let regla = h.tipo_aportacion === 'flat' ? `${h.valor_aportacion}€ fijos` : h.tipo_aportacion === 'porcentaje' ? `${h.valor_aportacion}% del ingreso` : 'Resto sobrante';
      mdString += `| ${h.nombre} | ${h.saldo_acumulado.toFixed(2)}€ | ${objetivo} | ${regla} | ${h.es_principal ? '✅' : '❌'} |\n`;
    });
    mdString += `\n`;

    // 3. Suscripciones
    const activas = suscripciones.filter(s => s.activa);
    if (activas.length > 0) {
      mdString += `## 🔄 Suscripciones Activas\n`;
      mdString += `| Suscripción | Coste Total | Mi Parte | Frecuencia | Categoría |\n`;
      mdString += `|---|---|---|---|---|\n`;
      activas.forEach(s => {
        mdString += `| ${s.nombre} | ${s.importe.toFixed(2)}€ | ${(s.mi_parte || s.importe).toFixed(2)}€ | ${s.frecuencia} | ${s.categoria} |\n`;
      });
      mdString += `\n`;
    }

    // 4. Conciliación y movimientos externos
    mdString += `## Conciliación del periodo\n`;
    mdString += `- **Balance externo del periodo filtrado:** ${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}€\n`;
    mdString += `- **Balance de transferencias internas:** ${totalInterno >= 0 ? '+' : ''}${totalInterno.toFixed(2)}€\n`;
    mdString += `- **Balance externo histórico:** ${balanceHistorico >= 0 ? '+' : ''}${balanceHistorico.toFixed(2)}€\n`;
    mdString += `- **Suma de carteras:** ${totalCarteras.toFixed(2)}€\n`;
    mdString += `- **Diferencia de conciliación histórica:** ${diferenciaConciliacion.toFixed(2)}€\n\n`;

    mdString += `## 📋 Movimientos (Periodo Filtrado)\n`;
    mdString += `**Movimientos externos: ${movimientosExternos.length} | Balance externo del periodo: ${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}€**\n\n`;
    
    mdString += `| Fecha | Concepto | Tipo | Origen/Destino | Importe | Notas |\n`;
    mdString += `|---|---|---|---|---|---|\n`;
    movimientosExternos.forEach(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      const fechaStr = d ? d.toLocaleDateString('es-ES') : 'Desconocida';
      const importeStr = `${m.tipo === 'gasto' ? '-' : '+'}${m.importe.toFixed(2)}€`;
      
      let destino_origen = '';
      if (m.tipo === 'gasto') {
        destino_origen = huchas.find(h => h.id === m.hucha_id)?.nombre || 'Desconocida';
      } else {
        destino_origen = 'Repartido en Carteras';
      }

      destino_origen = detalleOrigenDestino(m);
      let notas = notaCompensacion(m) || '';
      if (m.compensa_movimiento_id) notas = 'Reembolso';
      if (m.compensado_por?.length) notas = `Compensado (Coste neto: ${m.importe_neto}€)`;

      mdString += `| ${fechaStr} | ${m.concepto} | ${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} | ${destino_origen} | ${importeStr} | ${notas} |\n`;
    });

    if (transferenciasInternas.length > 0) {
      mdString += `\n## Transferencias internas\n`;
      mdString += `| Fecha | Concepto | Tipo | Origen/Destino | Importe | ID transferencia |\n`;
      mdString += `|---|---|---|---|---|---|\n`;
      transferenciasInternas.forEach(m => {
        const d = parseMovimientoDate(m.fecha_operacion);
        const fechaStr = d ? d.toLocaleDateString('es-ES') : 'Desconocida';
        const importeStr = `${m.tipo === 'gasto' ? '-' : '+'}${m.importe.toFixed(2)}€`;
        mdString += `| ${fechaStr} | ${m.concepto} | ${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} | ${detalleOrigenDestino(m)} | ${importeStr} | ${m.transfer_id || 'Sin vincular'} |\n`;
      });
    }

    try {
      await navigator.clipboard.writeText(mdString);
      setCopiedFormat('md');
      setTimeout(() => setCopiedFormat(null), 3000);
    } catch (err) {
      console.error("Failed to copy", err);
    }
  };

  const handleExportCSV = () => {
    const headers = ['ID', 'Fecha', 'Tipo', 'Concepto', 'Importe', 'Importe Neto', 'Origen/Destino', 'Notas'];
    const rows = filteredMovimientos.map(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      const fechaStr = d ? d.toISOString().split('T')[0] : 'Desconocida';
      const origenDestino = detalleOrigenDestino(m);
      const notas = notaCompensacion(m) || '';
      return [
        m.id,
        fechaStr,
        m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto',
        m.concepto,
        m.importe,
        m.importe_neto ?? m.importe,
        origenDestino,
        notas
      ];
    });

    const csvContent = generateCsv(headers, rows);
    const blob = new Blob([new Uint8Array([0xEF, 0xBB, 0xBF]), csvContent], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `flowt_export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
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
                  {movimientosExternos.length}
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Movimientos externos
                </span>
              </div>
              <div className="bg-white/50 dark:bg-slate-950/50 rounded-2xl p-4 flex flex-col items-center justify-center border border-white/20 dark:border-white/5">
                <span className={`text-2xl font-black ${isLocked ? 'blur-sm' : totalAmount >= 0 ? 'text-emerald-500' : 'text-rose-500'}`}>
                  {isLocked ? '***,**' : `${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}`}€
                </span>
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Balance externo
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-3">
              <button
                onClick={handleCopyJSON}
                disabled={filteredMovimientos.length === 0 || isLocked}
                className={`w-full relative py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all overflow-hidden group ${
                  (filteredMovimientos.length === 0 || isLocked)
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
                disabled={filteredMovimientos.length === 0 || isLocked}
                className={`w-full relative py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all overflow-hidden group border ${
                  (filteredMovimientos.length === 0 || isLocked)
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

              <button
                onClick={handleExportCSV}
                disabled={filteredMovimientos.length === 0 || isLocked}
                className={`w-full relative py-3.5 rounded-2xl flex items-center justify-center gap-2 font-bold text-sm transition-all overflow-hidden group border ${
                  (filteredMovimientos.length === 0 || isLocked)
                    ? 'border-slate-200 dark:border-slate-800 text-slate-400 cursor-not-allowed'
                    : 'border-emerald-500/30 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/10 hover:scale-[1.02] active:scale-95 shadow-sm'
                }`}
              >
                <Download size={18} />
                <span>Descargar CSV Sanitizado</span>
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
