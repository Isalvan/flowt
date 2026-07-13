import React, { useState } from 'react';
import { Card } from '../common/Card';
import { type Hucha, type Suscripcion, type Movimiento } from '../../types';
import { 
  AreaChart, 
  Area, 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  PieChart, 
  Pie, 
  Cell 
} from 'recharts';
import { BarChart3, TrendingUp, DollarSign, PieChart as PieIcon, Lock, Shield, Zap, Sparkles, Star, Info } from 'lucide-react';
import { PredictiveChart } from './PredictiveChart';
import { usePrivacy } from '../../context/PrivacyContext';
import { cuentaEnEstadisticas } from '../../utils/movements';

interface AnalyticsSectionProps {
  chartData: Array<{ name: string; ingresos: number; gastos: number }>;
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  allMovimientos: Movimiento[];
}

export const COLORS = [
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#f97316', // Orange
];

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({ chartData, huchas, suscripciones, allMovimientos }) => {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);

  const { isLocked, openUnlockModal, formatCurrency } = usePrivacy();

  // Process pie data
  const pieData = huchas
    .filter(h => h.saldo_acumulado > 0)
    .map((h, index) => ({
      name: h.nombre,
      value: Math.round(h.saldo_acumulado * 100) / 100,
      color: COLORS[index % COLORS.length]
    }));

  const totalSavings = huchas.reduce((sum, h) => sum + h.saldo_acumulado, 0);

  // --- ENGINE DE MÉTRICAS AVANZADAS DE LIBERTAD FINANCIERA ---
  const movimientosEstadisticos = allMovimientos.filter(cuentaEnEstadisticas);
  const incomeMovements = movimientosEstadisticos.filter(m => m.tipo === 'ingreso');
  const expenseMovements = movimientosEstadisticos.filter(m => m.tipo === 'gasto');

  const totalIncome = incomeMovements.reduce((sum, m) => sum + m.importe, 0);
  const totalExpense = expenseMovements.reduce((sum, m) => sum + m.importe, 0);

  // Tasa de Ahorro (Retained Income %)
  const savingsRate = totalIncome > 0 ? Math.max(0, ((totalIncome - totalExpense) / totalIncome) * 100) : 0;

  // Días de rango real en el historial
  let representativeDays = 30;
  if (movimientosEstadisticos.length > 1) {
    const dates = movimientosEstadisticos.map(m => new Date(m.fecha_operacion).getTime());
    const minDate = Math.min(...dates);
    const maxDate = Math.max(...dates);
    const diffDays = Math.ceil((maxDate - minDate) / (1000 * 60 * 60 * 24));
    if (diffDays > 0) representativeDays = Math.min(180, diffDays);
  }

  // Tasa de Consumo Diario (Daily Burn Rate)
  const dailyBurnRate = representativeDays > 0 ? (totalExpense / representativeDays) : 0;
  
  // Costo mensual de suscripciones activas
  const monthlySubsCost = suscripciones
    .filter(s => s.activa)
    .reduce((sum, s) => sum + (s.mi_parte != null ? s.mi_parte : s.importe), 0);

  // Pista de Libertad Financiera (Runway en meses cubierto por los ahorros acumulados)
  const averageMonthlyExpense = dailyBurnRate * 30.4;
  const runwayMonths = averageMonthlyExpense > 0 ? (totalSavings / averageMonthlyExpense) : 0;

  // Presión de Suscripciones (Porcentaje del ingreso mensual que ocupan las suscripciones activas)
  const monthlyIncome = representativeDays > 0 ? (totalIncome / (representativeDays / 30.4)) : 0;
  const subsPressure = monthlyIncome > 0 ? (monthlySubsCost / monthlyIncome) * 100 : 0;

  // Configuración dinámica del estado de Runway
  let runwayStatus = { label: 'Sin Datos', color: 'text-slate-400 bg-slate-500/15 border-slate-500/20', desc: 'Registra ingresos y gastos para calcular tu pista de despegue.' };
  if (movimientosEstadisticos.length > 0) {
    if (runwayMonths === 0) {
      runwayStatus = { label: 'Zona Vulnerable', color: 'text-rose-500 bg-rose-500/10 border-rose-500/20', desc: 'No tienes ahorros acumulados o tus gastos consumen todo. Prioriza crear un fondo de emergencia.' };
    } else if (runwayMonths < 1) {
      runwayStatus = { label: 'Zona Crítica', color: 'text-rose-500 bg-rose-500/10 border-rose-500/20', desc: 'Tus ahorros cubren menos de 1 mes de gastos. Estás expuesto a imprevistos inmediatos.' };
    } else if (runwayMonths < 3) {
      runwayStatus = { label: 'Colchón Básico', color: 'text-amber-500 bg-amber-500/10 border-amber-500/20', desc: 'Tus ahorros cubren entre 1 y 3 meses de gastos. Estás en camino hacia la estabilidad.' };
    } else if (runwayMonths < 6) {
      runwayStatus = { label: 'Zona de Seguridad', color: 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20', desc: 'Tus ahorros cubren entre 3 y 6 meses de gastos. Cuentas con un respaldo sólido.' };
    } else {
      runwayStatus = { label: 'Libertad Financiera', color: 'text-indigo-500 bg-indigo-500/10 border-indigo-500/20', desc: '¡Excelente! Tienes más de 6 meses de pista de despegue. Tu salud financiera es robusta.' };
    }
  }

  // Custom tooltips for premium glassmorphic feel
  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-panel p-3.5 border border-slate-200/50 dark:border-white/10 shadow-2xl rounded-2xl bg-slate-950/90 text-left text-xs text-slate-800 dark:text-slate-100">
          <p className="font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[9px] mb-2">{label}</p>
          <div className="space-y-1.5 font-semibold">
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-emerald-500 dark:text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-500 dark:bg-emerald-400" />
                Ingresos:
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">{formatCurrency(payload[0].value)}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-rose-500 dark:text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-500 dark:bg-rose-400" />
                Gastos:
              </span>
              <span className="font-bold text-slate-800 dark:text-slate-200 tabular-nums">{formatCurrency(payload[1].value)}</span>
            </div>
            <div className="pt-1.5 border-t border-slate-200 dark:border-white/5 flex items-center justify-between gap-6">
              <span className="text-slate-500 dark:text-slate-400">Diferencia:</span>
              <span className={`font-bold tabular-nums ${
                payload[0].value - payload[1].value >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
              }`}>
                {formatCurrency(payload[0].value - payload[1].value)}
              </span>
            </div>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="space-y-6">
      <div className="grid gap-6 md:grid-cols-3">
        {/* Trend chart card */}
        <Card className="md:col-span-2 bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-white/10 pb-4 mb-6">
              <div>
                <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight">
                  Evolución de Finanzas
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">Comparativa mensual de ingresos vs. gastos</p>
              </div>

              {/* Selector buttons */}
              <div className="flex items-center bg-slate-100/70 dark:bg-slate-900 p-1 rounded-2xl border border-slate-200/40 dark:border-white/5 shadow-inner">
                <button
                  onClick={() => setChartType('area')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                    chartType === 'area'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <TrendingUp className="w-3.5 h-3.5" />
                  Área
                </button>
                <button
                  onClick={() => setChartType('bar')}
                  className={`flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-bold transition-all duration-200 cursor-pointer ${
                    chartType === 'bar'
                      ? 'bg-white dark:bg-slate-800 text-indigo-600 dark:text-indigo-400 shadow'
                      : 'text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
                  }`}
                >
                  <BarChart3 className="w-3.5 h-3.5" />
                  Barras
                </button>
              </div>
            </div>

            <div className="w-full h-72 sm:h-80 relative">
              {isLocked && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/10 dark:bg-slate-950/20 backdrop-blur-md rounded-2xl p-6 text-center select-none animate-in fade-in duration-300">
                  <div className="p-3.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400 mb-3.5 shadow-inner">
                    <Lock className="w-5 h-5 animate-pulse" />
                  </div>
                  <h4 className="font-extrabold text-xs text-slate-700 dark:text-slate-200 uppercase tracking-widest">
                    Evolución Protegida
                  </h4>
                  <p className="text-[10px] text-slate-450 dark:text-slate-500 max-w-[200px] mt-1.5 leading-relaxed font-semibold">
                    Desbloquea la aplicación con tu PIN para visualizar las gráficas de evolución financiera.
                  </p>
                  <button
                    onClick={() => openUnlockModal()}
                    className="mt-4 px-4 py-2 bg-indigo-500 hover:bg-indigo-600 text-white text-[9px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow active:scale-95"
                  >
                    Desbloquear
                  </button>
                </div>
              )}
              <ResponsiveContainer width="100%" height="100%">
                {chartType === 'area' ? (
                  <AreaChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <defs>
                      <linearGradient id="colorIngresos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#10b981" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#10b981" stopOpacity={0.0}/>
                      </linearGradient>
                      <linearGradient id="colorGastos" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#ef4444" stopOpacity={0.25}/>
                        <stop offset="95%" stopColor="#ef4444" stopOpacity={0.0}/>
                      </linearGradient>
                    </defs>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.08)" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Area 
                      type="monotone" 
                      dataKey="ingresos" 
                      stroke="#10b981" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorIngresos)" 
                    />
                    <Area 
                      type="monotone" 
                      dataKey="gastos" 
                      stroke="#ef4444" 
                      strokeWidth={2.5}
                      fillOpacity={1} 
                      fill="url(#colorGastos)" 
                    />
                  </AreaChart>
                ) : (
                  <BarChart data={chartData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.08)" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#94a3b8', fontSize: 10, fontWeight: 700 }}
                    />
                    <Tooltip content={<CustomChartTooltip />} />
                    <Bar 
                      dataKey="ingresos" 
                      fill="#10b981" 
                      radius={[5, 5, 0, 0]} 
                      maxBarSize={30}
                    />
                    <Bar 
                      dataKey="gastos" 
                      fill="#ef4444" 
                      radius={[5, 5, 0, 0]} 
                      maxBarSize={30}
                    />
                  </BarChart>
                )}
              </ResponsiveContainer>
            </div>
          </div>
        </Card>

        {/* Donut chart card */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl flex flex-col justify-between">
          <div>
            <div className="border-b border-white/10 pb-4 mb-6">
              <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight flex items-center gap-1.5">
                <PieIcon className="w-5 h-5 text-indigo-500" />
                Reparto de Fondos
              </h3>
              <p className="text-xs text-slate-400 dark:text-slate-500">Distribución de saldos por hucha</p>
            </div>

            <div className="relative flex items-center justify-center w-full h-52">
              {isLocked && (
                <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/10 dark:bg-slate-950/20 backdrop-blur-md rounded-2xl p-4 text-center select-none animate-in fade-in duration-300">
                  <div className="p-3 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400 mb-2.5 shadow-inner">
                    <Lock className="w-4.5 h-4.5 animate-pulse" />
                  </div>
                  <h4 className="font-extrabold text-[11px] text-slate-700 dark:text-slate-200 uppercase tracking-widest">
                    Reparto Protegido
                  </h4>
                  <button
                    onClick={() => openUnlockModal()}
                    className="mt-3 px-3.5 py-1.5 bg-indigo-500 hover:bg-indigo-600 text-white text-[8px] font-black uppercase tracking-widest rounded-xl transition-all cursor-pointer shadow active:scale-95"
                  >
                    Desbloquear
                  </button>
                </div>
              )}
              {pieData.length > 0 ? (
                <>
                  <ResponsiveContainer width="100%" height="100%">
                    <PieChart>
                      <Pie
                        data={pieData}
                        cx="50%"
                        cy="50%"
                        innerRadius={72}
                        outerRadius={92}
                        paddingAngle={2}
                        dataKey="value"
                        onMouseEnter={(_, index) => setActivePieIndex(index)}
                        onMouseLeave={() => setActivePieIndex(null)}
                        stroke="none"
                      >
                        {pieData.map((entry, index) => (
                          <Cell 
                            key={`cell-${index}`} 
                            fill={entry.color} 
                            stroke="none"
                            className="transition-all duration-300 outline-none cursor-pointer"
                            style={{
                              filter: activePieIndex === index ? `drop-shadow(0px 0px 8px ${entry.color}80)` : 'none',
                              opacity: activePieIndex === null || activePieIndex === index ? 1 : 0.65
                            }}
                          />
                        ))}
                      </Pie>
                    </PieChart>
                  </ResponsiveContainer>

                  {/* Total savings inside the center of the donut */}
                  <div className="absolute flex flex-col items-center justify-center pointer-events-none text-center px-3 w-full transition-all duration-350">
                    {activePieIndex !== null && pieData[activePieIndex] ? (
                      <div className="animate-in fade-in zoom-in-95 duration-200 flex flex-col items-center justify-center w-full">
                        <span 
                          className="text-[9px] font-black uppercase tracking-[0.15em] block leading-none truncate max-w-[110px]"
                          style={{ color: pieData[activePieIndex].color }}
                        >
                          {pieData[activePieIndex].name}
                        </span>
                        <span className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 mt-1.5 block truncate max-w-[130px] tabular-nums animate-in slide-in-from-bottom-1 duration-200">
                          {formatCurrency(pieData[activePieIndex].value)}
                        </span>
                        <span className="text-[8.5px] font-black text-slate-400 dark:text-slate-500 mt-1 block leading-none tracking-widest">
                          {totalSavings > 0 ? ((pieData[activePieIndex].value / totalSavings) * 100).toFixed(1) : '0.0'}%
                        </span>
                      </div>
                    ) : (
                      <div className="animate-in fade-in zoom-in-95 duration-200 flex flex-col items-center justify-center w-full">
                        <span className="text-[8.5px] font-black uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 block leading-none">Total Ahorrado</span>
                        <span className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 mt-1.5 block truncate max-w-[130px] tabular-nums">
                          {formatCurrency(totalSavings)}
                        </span>
                      </div>
                    )}
                  </div>
                </>
              ) : (
                <div className="flex flex-col items-center justify-center text-center p-6 h-full w-full">
                  <DollarSign className="w-10 h-10 text-slate-300 dark:text-slate-700 mb-2" />
                  <p className="font-bold text-xs text-slate-400 dark:text-slate-600 uppercase tracking-widest">Sin Saldos</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Todas tus carteras están a cero</p>
                </div>
              )}
            </div>
          </div>

          {/* Legend listing */}
          {pieData.length > 0 && (
            <div className="space-y-1.5 mt-4 border-t border-white/5 pt-4 max-h-[140px] overflow-y-auto pr-1">
              {pieData.map((entry, index) => {
                const percentage = totalSavings > 0 ? ((entry.value / totalSavings) * 100).toFixed(0) : '0';
                return (
                  <div 
                    key={index} 
                    onMouseEnter={() => setActivePieIndex(index)}
                    onMouseLeave={() => setActivePieIndex(null)}
                    className={`flex items-center justify-between text-xs p-1.5 rounded-lg transition-colors cursor-pointer ${
                      activePieIndex === index ? 'bg-white/50 dark:bg-white/5' : 'bg-transparent'
                    }`}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span 
                        className="w-2.5 h-2.5 rounded-full shrink-0" 
                        style={{ backgroundColor: entry.color }} 
                      />
                      <span className="font-bold text-slate-700 dark:text-slate-300 truncate">{entry.name}</span>
                    </div>
                    <div className="flex items-center gap-3 text-slate-400 font-semibold shrink-0 ml-3">
                      <span className="text-slate-800 dark:text-slate-200 tabular-nums">{formatCurrency(entry.value)}</span>
                      <span className="text-[10px] tabular-nums font-bold">({percentage}%)</span>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      </div>

      {/* 3. Panel de Salud y Libertad Financiera */}
      <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl p-5 sm:p-6 overflow-hidden relative glass-glare">
        <div className="flex items-center justify-between border-b border-slate-150/40 dark:border-white/5 pb-4 mb-6 shrink-0">
          <div>
            <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight flex items-center gap-2">
              <Shield className="w-5 h-5 text-indigo-500 animate-pulse" />
              Métricas de Libertad y Salud Financiera
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">Indicadores avanzados de resistencia y eficiencia de tu capital</p>
          </div>
          <span className="flex items-center gap-1 text-[8.5px] font-black uppercase text-indigo-500 dark:text-indigo-400 bg-indigo-500/5 px-2.5 py-1 rounded-xl border border-indigo-500/10 tracking-widest shrink-0">
            <Sparkles className="w-3 h-3" /> Exclusivo
          </span>
        </div>

        {movimientosEstadisticos.length > 0 ? (
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            
            {/* Metric 1: Financial Runway */}
            <div className="p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/15 border border-slate-150/50 dark:border-white/5 flex flex-col justify-between hover:scale-[1.02] transition-transform duration-300">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Pista de Libertad</span>
                <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tabular-nums">
                  {runwayMonths.toFixed(1)} <span className="text-xs font-bold text-slate-400 dark:text-slate-500">meses</span>
                </span>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-slate-200/50 dark:border-white/5">
                <span className={`inline-block text-[8px] font-black uppercase tracking-wider px-2 py-0.5 rounded-lg border ${runwayStatus.color} mb-1.5`}>
                  {runwayStatus.label}
                </span>
                <p className="text-[9px] text-slate-450 dark:text-slate-500 leading-relaxed font-semibold">
                  {runwayStatus.desc}
                </p>
              </div>
            </div>

            {/* Metric 2: Savings Rate */}
            <div className="p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/15 border border-slate-150/50 dark:border-white/5 flex flex-col justify-between hover:scale-[1.02] transition-transform duration-300">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tasa de Ahorro Neto</span>
                <span className={`text-2xl font-black tabular-nums ${
                  savingsRate >= 20 ? 'text-emerald-500' : savingsRate >= 10 ? 'text-amber-500' : 'text-rose-500'
                }`}>
                  {savingsRate.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-slate-200/50 dark:border-white/5 flex flex-col justify-end h-full">
                <div className="w-full bg-slate-200 dark:bg-slate-850 h-1.5 rounded-full overflow-hidden mb-2 shadow-inner">
                  <div 
                    className={`h-full rounded-full transition-all duration-500 ${
                      savingsRate >= 20 ? 'bg-emerald-500' : savingsRate >= 10 ? 'bg-amber-500' : 'bg-rose-500'
                    }`} 
                    style={{ width: `${Math.min(100, savingsRate)}%` }} 
                  />
                </div>
                <p className="text-[9px] text-slate-450 dark:text-slate-500 leading-relaxed font-semibold">
                  {savingsRate >= 20 
                    ? '¡Nivel excelente! Retienes más del 20% de tus ingresos. Estás multiplicando tu riqueza rápido.' 
                    : savingsRate >= 10 
                      ? 'Nivel saludable. Ahorras entre el 10% y el 20%. Considera recortar costes para maximizar.' 
                      : 'Nivel vulnerable. Retienes menos del 10%. Tu capacidad de ahorro es limitada.'}
                </p>
              </div>
            </div>

            {/* Metric 3: Daily Burn Rate */}
            <div className="p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/15 border border-slate-150/50 dark:border-white/5 flex flex-col justify-between hover:scale-[1.02] transition-transform duration-300">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Tasa de Consumo Diario</span>
                <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tabular-nums">
                  {formatCurrency(dailyBurnRate)} <span className="text-[10px] font-bold text-slate-450 dark:text-slate-500">/ día</span>
                </span>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-slate-200/50 dark:border-white/5">
                <div className="flex items-center gap-1.5 text-indigo-500 dark:text-indigo-400 font-bold mb-1.5 text-[9px] uppercase tracking-wider">
                  <Zap className="w-3.5 h-3.5 animate-pulse" /> Consumo Promedio
                </div>
                <p className="text-[9px] text-slate-450 dark:text-slate-500 leading-relaxed font-semibold">
                  Tu ritmo medio de salida es de {formatCurrency(dailyBurnRate)} diarios (calculado sobre {representativeDays} días de historial). Equivale a {formatCurrency(averageMonthlyExpense)} mensuales de gasto libre.
                </p>
              </div>
            </div>

            {/* Metric 4: Subscription Pressure */}
            <div className="p-4 rounded-2xl bg-slate-50/50 dark:bg-slate-950/15 border border-slate-150/50 dark:border-white/5 flex flex-col justify-between hover:scale-[1.02] transition-transform duration-300">
              <div>
                <span className="text-[9px] font-black text-slate-400 uppercase tracking-widest block mb-1">Presión de Suscripciones</span>
                <span className={`text-2xl font-black tabular-nums ${
                  subsPressure > 15 ? 'text-rose-500' : subsPressure > 5 ? 'text-amber-500' : 'text-emerald-500'
                }`}>
                  {subsPressure.toFixed(1)}%
                </span>
              </div>
              <div className="mt-3.5 pt-3.5 border-t border-slate-200/50 dark:border-white/5">
                <div className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400 font-bold mb-1.5 text-[9px] uppercase tracking-wider">
                  <Star className="w-3.5 h-3.5 text-amber-400" /> Cargos Comprometidos
                </div>
                <p className="text-[9px] text-slate-450 dark:text-slate-500 leading-relaxed font-semibold">
                  Tus suscripciones activas ({formatCurrency(monthlySubsCost)}/mes) consumen el {subsPressure.toFixed(1)}% de tus ingresos estimados. Mantener esta presión por debajo del 10% libera tu flujo de caja.
                </p>
              </div>
            </div>

          </div>
        ) : (
          <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/10 text-center">
            <Info className="w-8 h-8 text-slate-350 dark:text-slate-655 mb-2" />
            <p className="font-bold text-xs text-slate-400 dark:text-slate-600 uppercase tracking-widest">Sin Datos de Análisis</p>
            <p className="text-xs text-slate-400 mt-1">Registra movimientos de ingresos y gastos para activar las métricas de libertad y salud financiera.</p>
          </div>
        )}
      </Card>

      <PredictiveChart
        huchas={huchas}
        suscripciones={suscripciones}
        allMovimientos={allMovimientos}
      />
    </div>
  );
};
