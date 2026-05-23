import React, { useState } from 'react';
import { Card } from '../common/Card';
import { type Hucha } from '../../types';
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
import { BarChart3, TrendingUp, DollarSign, PieChart as PieIcon } from 'lucide-react';

interface AnalyticsSectionProps {
  chartData: Array<{ name: string; ingresos: number; gastos: number }>;
  huchas: Hucha[];
}

const COLORS = [
  '#6366f1', // Indigo
  '#0ea5e9', // Sky
  '#10b981', // Emerald
  '#f59e0b', // Amber
  '#ec4899', // Pink
  '#8b5cf6', // Violet
  '#f97316', // Orange
];

export const AnalyticsSection: React.FC<AnalyticsSectionProps> = ({ chartData, huchas }) => {
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');
  const [activePieIndex, setActivePieIndex] = useState<number | null>(null);

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat('es-ES', { style: 'currency', currency: 'EUR' }).format(value);
  };

  // Process pie data
  const pieData = huchas
    .filter(h => h.saldo_acumulado > 0)
    .map((h, index) => ({
      name: h.nombre,
      value: Math.round(h.saldo_acumulado * 100) / 100,
      color: COLORS[index % COLORS.length]
    }));

  const totalSavings = huchas.reduce((sum, h) => sum + h.saldo_acumulado, 0);

  // Custom tooltips for premium glassmorphic feel
  const CustomChartTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-panel p-3.5 border border-white/10 shadow-2xl rounded-2xl bg-slate-950/90 text-left text-xs text-slate-100">
          <p className="font-extrabold text-slate-400 uppercase tracking-widest text-[9px] mb-2">{label}</p>
          <div className="space-y-1.5 font-semibold">
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-emerald-400">
                <span className="w-2 h-2 rounded-full bg-emerald-400" />
                Ingresos:
              </span>
              <span className="font-bold text-slate-200 tabular-nums">{formatCurrency(payload[0].value)}</span>
            </div>
            <div className="flex items-center justify-between gap-6">
              <span className="flex items-center gap-1.5 text-rose-400">
                <span className="w-2 h-2 rounded-full bg-rose-400" />
                Gastos:
              </span>
              <span className="font-bold text-slate-200 tabular-nums">{formatCurrency(payload[1].value)}</span>
            </div>
            <div className="pt-1.5 border-t border-white/5 flex items-center justify-between gap-6">
              <span className="text-slate-400">Diferencia:</span>
              <span className={`font-bold tabular-nums ${
                payload[0].value - payload[1].value >= 0 ? 'text-emerald-400' : 'text-rose-400'
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

  const CustomPieTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload;
      const percentage = totalSavings > 0 ? ((data.value / totalSavings) * 100).toFixed(1) : '0.0';
      return (
        <div className="glass-panel p-3 border border-white/10 shadow-2xl rounded-2xl bg-slate-950/90 text-left text-xs text-slate-100">
          <div className="flex items-center gap-1.5 font-extrabold text-slate-200 uppercase tracking-tight mb-1">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: data.color }} />
            {data.name}
          </div>
          <div className="flex justify-between items-center gap-4 text-slate-400 font-semibold mt-1">
            <span>Saldo: <strong className="text-slate-200 tabular-nums">{formatCurrency(data.value)}</strong></span>
            <span>({percentage}%)</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
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

          <div className="w-full h-72 sm:h-80">
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
            {pieData.length > 0 ? (
              <>
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Tooltip content={<CustomPieTooltip />} />
                    <Pie
                      data={pieData}
                      cx="50%"
                      cy="50%"
                      innerRadius={72}
                      outerRadius={92}
                      paddingAngle={4}
                      dataKey="value"
                      onMouseEnter={(_, index) => setActivePieIndex(index)}
                      onMouseLeave={() => setActivePieIndex(null)}
                    >
                      {pieData.map((entry, index) => (
                        <Cell 
                          key={`cell-${index}`} 
                          fill={entry.color} 
                          className="transition-all duration-300 outline-none cursor-pointer"
                          style={{
                            filter: activePieIndex === index ? 'drop-shadow(0px 0px 8px rgba(99,102,241,0.5))' : 'none',
                            opacity: activePieIndex === null || activePieIndex === index ? 1 : 0.65
                          }}
                        />
                      ))}
                    </Pie>
                  </PieChart>
                </ResponsiveContainer>

                {/* Total savings inside the center of the donut */}
                <div className="absolute flex flex-col items-center justify-center pointer-events-none text-center px-3 w-full">
                  <span className="text-[8.5px] font-black uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500 block leading-none">Total Ahorrado</span>
                  <span className="text-sm sm:text-base font-black text-slate-800 dark:text-slate-100 mt-1.5 tabular-nums block truncate max-w-[130px]">
                    {formatCurrency(totalSavings)}
                  </span>
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
  );
};
