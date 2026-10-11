import React, { useState, useEffect, useMemo } from 'react';
import { Download, FileJson, FileText, Save, ListFilter, Trash2, CheckCircle2, Search, Filter } from 'lucide-react';
import { type Movimiento, type Hucha, type Suscripcion } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../hooks/useFinanceData';
import { importeEnEstadisticas } from '../../utils/movements';
import { calcularInformeExportacion, unirHistorialExportacion } from '../../utils/exportReport';
import { generateCsv } from '../../utils/csv';
import { useCategories } from '../../hooks/useCategories';

interface ExportViewProps {
  movimientos: Movimiento[];
  olderMovements: Movimiento[];
  olderMovementsLoading: boolean;
  olderMovementsLoaded: boolean;
  olderMovementsError: boolean;
  loadOlderMovements: () => Promise<void>;
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

export const ExportView: React.FC<ExportViewProps> = ({ movimientos, olderMovements, olderMovementsLoading, olderMovementsLoaded, olderMovementsError, loadOlderMovements, huchas, suscripciones, userId }) => {
  const { categoryLabel, suggestCategory } = useCategories();
  const { isLocked } = usePrivacy();
  useEffect(() => {
    if (!isLocked && !olderMovementsLoaded && !olderMovementsLoading && !olderMovementsError) {
      void loadOlderMovements();
    }
  }, [isLocked, olderMovementsLoaded, olderMovementsLoading, olderMovementsError, loadOlderMovements]);

  const historialCompleto = useMemo(() => unirHistorialExportacion(movimientos, olderMovements), [movimientos, olderMovements]);
  const informeHistorico = useMemo(() => calcularInformeExportacion(historialCompleto), [historialCompleto]);
  const historialPendiente = olderMovementsLoading || !olderMovementsLoaded || olderMovementsError;
  
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
    return historialCompleto.filter((mov) => {
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
  }, [historialCompleto, filters]);

  const informePeriodo = useMemo(() => calcularInformeExportacion(filteredMovimientos), [filteredMovimientos]);
  const { externos: movimientosExternos, devoluciones, internos: transferenciasInternas } = informePeriodo;
  const totalAmount = informePeriodo.balance;
  const totalInterno = informePeriodo.balanceInternos;
  const totalCarteras = huchas.reduce((sum, hucha) => sum + hucha.saldo_acumulado, 0);
  const balanceHistorico = informeHistorico.balance;
  const diferenciaConciliacion = totalCarteras - balanceHistorico;

  const detalleOrigenDestino = (movimiento: Movimiento) => {
    const cartera = huchas.find(h => h.id === movimiento.hucha_id)?.nombre;
    if (cartera) return movimiento.tipo === 'gasto' ? `Extraído de ${cartera}` : `Ingresado en ${cartera}`;
    return movimiento.tipo === 'ingreso' ? 'Repartido automáticamente en carteras' : 'Cartera no disponible';
  };

  const notaCompensacion = (movimiento: Movimiento) => {
    if (movimiento.tipo === 'ingreso') {
      const destinos = movimiento.compensaciones_destinos || [];
      if (destinos.length) return `Compensa: ${destinos.map(d => `${historialCompleto.find(m => m.id === d.gasto_id)?.concepto || 'Gasto no disponible'} (${d.importe.toFixed(2)}€)`).join(', ')}. Neto: ${importeEnEstadisticas(movimiento).toFixed(2)}€`;
      return movimiento.compensa_movimiento_id ? `Compensa: ${historialCompleto.find(m => m.id === movimiento.compensa_movimiento_id)?.concepto || 'Gasto no disponible'}` : null;
    }
    const detalles = movimiento.compensado_por_detalles || [];
    if (detalles.length) return `Compensado (${detalles.map(d => `${historialCompleto.find(m => m.id === d.ingreso_id)?.concepto || d.ingreso_id}: ${d.importe.toFixed(2)}€`).join(', ')}). Neto: ${importeEnEstadisticas(movimiento).toFixed(2)}€`;
    if (movimiento.compensado_por?.length) return `Compensado. Neto: ${importeEnEstadisticas(movimiento).toFixed(2)}€`;
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
        total_ingresos_historicos: informeHistorico.ingresos,
        total_gastos_historicos: informeHistorico.gastos,
        balance_historico: balanceHistorico,
        total_devoluciones: informeHistorico.totalDevoluciones,
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
      devoluciones_recibidas_filtradas: devoluciones.map(exportMovimiento),
      transferencias_internas_filtradas: transferenciasInternas.map(exportMovimiento),
      resumen_filtro_actual: {
        total_movimientos: filteredMovimientos.length,
        movimientos_externos: movimientosExternos.length,
        total_devoluciones: informePeriodo.totalDevoluciones,
        movimientos_devoluciones: devoluciones.length,
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
    let mdString = `# Reporte financiero Flowt\nGenerado el: ${new Date().toLocaleDateString('es-ES')}\n\n`;

    // 1. Estadísticas Globales
    mdString += `## 📊 Estadísticas globales históricas\n`;
    mdString += `- **Ingresos totales:** +${informeHistorico.ingresos.toFixed(2)}€\n`;
    mdString += `- **Gastos totales:** -${informeHistorico.gastos.toFixed(2)}€\n`;
    mdString += `- **Devoluciones recibidas:** +${informeHistorico.totalDevoluciones.toFixed(2)}€\n`;
    mdString += `- **Balance histórico:** ${balanceHistorico.toFixed(2)}€\n\n`;

    // 2. Carteras
    mdString += `## 🏦 Estado de las carteras (huchas)\n`;
    mdString += `| Cartera | Saldo actual | Objetivo | Regla de ingreso | Principal |\n`;
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
      mdString += `## 🔄 Suscripciones activas\n`;
      mdString += `| Suscripción | Coste total | Mi parte | Frecuencia | Categoría |\n`;
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

    mdString += `## 📋 Movimientos (periodo filtrado)\n`;
    mdString += `**Movimientos externos: ${movimientosExternos.length} | Balance externo del periodo: ${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}€**\n\n`;
    
    mdString += `| Fecha | Concepto | Tipo | Origen/destino | Importe | Notas |\n`;
    mdString += `|---|---|---|---|---|---|\n`;
    movimientosExternos.forEach(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      const fechaStr = d ? d.toLocaleDateString('es-ES') : 'Desconocida';
      const importeStr = `${m.tipo === 'gasto' ? '-' : '+'}${m.importe.toFixed(2)}€`;
      
      const destino_origen = detalleOrigenDestino(m);
      const notas = notaCompensacion(m) || '';

      mdString += `| ${fechaStr} | ${m.concepto} | ${m.tipo === 'ingreso' ? 'Ingreso' : 'Gasto'} | ${destino_origen} | ${importeStr} | ${notas} |\n`;
    });

    // También se detalla la parte compensadora de los ingresos parcialmente asignados.
    const ingresosConDevolucion = filteredMovimientos.filter(m =>
      m.tipo === 'ingreso' && !m.es_interno && !m.transfer_id && m.importe > importeEnEstadisticas(m));
    mdString += `\n## Devoluciones recibidas\n`;
    mdString += `**Total del periodo: +${informePeriodo.totalDevoluciones.toFixed(2)}€**\n\n`;
    mdString += `| Fecha | Concepto | Importe | Gasto compensado |\n`;
    mdString += `|---|---|---|---|\n`;
    ingresosConDevolucion.forEach(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      const fechaStr = d ? d.toLocaleDateString('es-ES') : 'Desconocida';
      const importeDevuelto = m.importe - importeEnEstadisticas(m);
      mdString += `| ${fechaStr} | ${m.concepto} | +${importeDevuelto.toFixed(2)}€ | ${notaCompensacion(m) || 'Gasto no disponible'} |\n`;
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
    const headers = ['ID', 'Fecha', 'Tipo', 'Concepto', 'Categoría', 'Estado categoría', 'Importe', 'Importe Neto', 'Origen/Destino', 'Notas'];
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
        categoryLabel(m.categoria || suggestCategory(m)?.categoria),
        m.categoria ? 'Confirmada' : 'Pendiente',
        m.importe,
        importeEnEstadisticas(m),
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
      <div className="flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink">
          <Download size={18} />
        </span>
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
            Exportar datos
          </h2>
          <p className="dashboard-subtitle">
            Filtra tus movimientos y cópialos para análisis externos o asistentes de IA.
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        
        {/* Filters Panel */}
        <div className="col-span-1 lg:col-span-2 flex flex-col gap-6">
          <div className="dashboard-surface p-5">
            <div className="flex items-center justify-between mb-5">
              <h3 className="dashboard-heading flex items-center gap-2">
                <Filter size={16} />
                Filtros avanzados
              </h3>
              <button 
                type="button"
                onClick={() => setFilters(DEFAULT_FILTERS)}
                className="text-xs font-semibold text-ink-faint hover:text-ink transition-colors"
              >
                Limpiar filtros
              </button>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {/* Fechas */}
              <div className="col-span-1 sm:col-span-2 flex items-center justify-between mt-1">
                <span className="dashboard-label">Rango de fechas</span>
                <button 
                  type="button"
                  onClick={() => setFilters(prev => ({ ...prev, startDate: '', endDate: '' }))}
                  className="dashboard-period-button"
                >
                  Todo el tiempo
                </button>
              </div>
              
              <div className="flex flex-col gap-1.5">
                <label htmlFor="export-start-date" className="field-label">Desde</label>
                <input
                  id="export-start-date"
                  type="date"
                  value={filters.startDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, startDate: e.target.value }))}
                  className="field"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="export-end-date" className="field-label">Hasta</label>
                <input
                  id="export-end-date"
                  type="date"
                  value={filters.endDate}
                  onChange={(e) => setFilters(prev => ({ ...prev, endDate: e.target.value }))}
                  className="field"
                />
              </div>

              {/* Tipo y Hucha */}
              <div className="flex flex-col gap-1.5">
                <label htmlFor="export-type" className="field-label">Tipo</label>
                <select
                  id="export-type"
                  value={filters.type}
                  onChange={(e) => setFilters(prev => ({ ...prev, type: e.target.value as any }))}
                  className="field"
                >
                  <option value="all">Todos los movimientos</option>
                  <option value="ingreso">Solo ingresos</option>
                  <option value="gasto">Solo gastos</option>
                </select>
              </div>
              <div className="flex flex-col gap-1.5">
                <label htmlFor="export-hucha" className="field-label">Cartera</label>
                <select
                  id="export-hucha"
                  value={filters.huchaId}
                  onChange={(e) => setFilters(prev => ({ ...prev, huchaId: e.target.value }))}
                  className="field"
                >
                  <option value="all">Todas las carteras</option>
                  {huchas.map(h => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
                </select>
              </div>

              {/* Búsqueda */}
              <div className="flex flex-col gap-1.5 sm:col-span-2">
                <label htmlFor="export-search" className="field-label">Buscar en concepto</label>
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
                  <input
                    id="export-search"
                    type="text"
                    value={filters.searchTerm}
                    onChange={(e) => setFilters(prev => ({ ...prev, searchTerm: e.target.value }))}
                    placeholder="Ej. Nómina, Mercadona, Amazon…"
                    className="field pl-9"
                  />
                </div>
              </div>
            </div>
          </div>

          {/* Presets Panel */}
          <div className="dashboard-surface p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="dashboard-heading flex items-center gap-2">
                <ListFilter size={16} />
                Filtros guardados (presets)
              </h3>
            </div>

            {isSavingPreset ? (
              <div className="flex gap-2 animate-in fade-in zoom-in-95 duration-200 mb-4">
                <input
                  id="export-preset-name"
                  type="text"
                  value={newPresetName}
                  onChange={(e) => setNewPresetName(e.target.value)}
                  placeholder="Nombre del preset…"
                  className="field flex-1"
                  autoFocus
                  onKeyDown={(e) => e.key === 'Enter' && handleSavePreset()}
                />
                <button
                  type="button"
                  onClick={handleSavePreset}
                  className="dashboard-primary-button"
                >
                  Guardar
                </button>
                <button
                  type="button"
                  onClick={() => { setIsSavingPreset(false); setNewPresetName(''); }}
                  className="dashboard-secondary-button"
                >
                  Cancelar
                </button>
              </div>
            ) : (
              <button
                type="button"
                onClick={() => setIsSavingPreset(true)}
                className="flex items-center gap-1.5 text-xs font-semibold text-brand-ink hover:text-brand mb-4 transition-colors"
              >
                <Save size={14} />
                Guardar filtros actuales
              </button>
            )}

            <div className="flex flex-wrap gap-2">
              {presets.length === 0 ? (
                <span className="text-xs text-ink-soft italic">No tienes presets guardados.</span>
              ) : (
                presets.map(preset => (
                  <div key={preset.id} className="group relative flex items-center rounded-xl border border-line-strong bg-surface-2 overflow-hidden">
                    <button
                      type="button"
                      onClick={() => handleLoadPreset(preset)}
                      className="px-3 py-1.5 text-xs font-semibold text-ink hover:bg-surface transition-colors"
                    >
                      {preset.name}
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePreset(preset.id)}
                      className="px-2 py-1.5 text-ink-faint hover:text-rose-500 hover:bg-rose-500/10 transition-colors border-l border-line"
                      title="Eliminar preset"
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>

        {/* Action Panel */}
        <div className="col-span-1 flex flex-col gap-6">
          <div className="sticky top-24 dashboard-surface p-5">
            <h3 className="dashboard-heading mb-4 text-center">
              Resumen de exportación
            </h3>

            <div className="flex flex-col gap-3 mb-6">
              <div className="rounded-2xl bg-surface-2 p-4 flex flex-col items-center justify-center">
                <span className="figure text-3xl text-ink">
                  {movimientosExternos.length}
                </span>
                <span className="dashboard-label mt-1">
                  Movimientos externos
                </span>
              </div>
              <div className="rounded-2xl bg-surface-2 p-4 flex flex-col items-center justify-center">
                <span className={`figure text-2xl ${isLocked ? 'blur-sm' : totalAmount >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>
                  {isLocked ? '***,**' : `${totalAmount >= 0 ? '+' : ''}${totalAmount.toFixed(2)}`}€
                </span>
                <span className="dashboard-label mt-1">
                  Balance externo
                </span>
              </div>
            </div>

            <div className="flex flex-col gap-2.5">
              {olderMovementsError ? (
                <div className="notice" role="alert">
                  <p>No se pudo cargar el historial completo.</p>
                  <button type="button" className="dashboard-secondary-button" disabled={olderMovementsLoading}
                    onClick={() => void loadOlderMovements()}>Reintentar</button>
                </div>
              ) : historialPendiente && !isLocked ? (
                <p className="dashboard-subtitle" role="status">Cargando el historial completo…</p>
              ) : null}
              <button
                type="button"
                onClick={handleCopyJSON}
                disabled={filteredMovimientos.length === 0 || isLocked || historialPendiente}
                className="dashboard-primary-button w-full"
              >
                {copiedFormat === 'json' ? (
                  <>
                    <CheckCircle2 size={16} />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <FileJson size={16} />
                    <span>Copiar como JSON</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleCopyMD}
                disabled={filteredMovimientos.length === 0 || isLocked || historialPendiente}
                className="dashboard-secondary-button w-full"
              >
                {copiedFormat === 'md' ? (
                  <>
                    <CheckCircle2 size={16} className="text-emerald-600 dark:text-emerald-400" />
                    <span>¡Copiado!</span>
                  </>
                ) : (
                  <>
                    <FileText size={16} />
                    <span>Copiar como Markdown</span>
                  </>
                )}
              </button>

              <button
                type="button"
                onClick={handleExportCSV}
                disabled={filteredMovimientos.length === 0 || isLocked || historialPendiente}
                className="dashboard-secondary-button w-full"
              >
                <Download size={16} />
                <span>Descargar CSV sanitizado</span>
              </button>
            </div>
            
            {filteredMovimientos.length === 0 && (
              <p className="text-xs text-center text-ink-faint mt-4 px-4">
                No hay movimientos que coincidan con los filtros actuales.
              </p>
            )}
          </div>
        </div>

      </div>
    </div>
  );
};
