import React, { useMemo } from 'react';
import { Card } from '../common/Card';
import { type Hucha, type Suscripcion, type Movimiento } from '../../types';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer 
} from 'recharts';
import { TrendingUp, AlertTriangle, Info, Sparkles, Lock } from 'lucide-react';
import { parseMovimientoDate } from '../../hooks/useFinanceData';
import { usePrivacy } from '../../context/PrivacyContext';

interface PredictiveChartProps {
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  allMovimientos: Movimiento[];
}

export const PredictiveChart: React.FC<PredictiveChartProps> = ({
  huchas,
  suscripciones,
  allMovimientos,
}) => {
  const { isLocked, openUnlockModal, formatCurrency } = usePrivacy();

  const totalSavings = useMemo(() => huchas.reduce((sum, h) => sum + h.saldo_acumulado, 0), [huchas]);

  // Algorithm to estimate monthly income and variable expense
  const estimates = useMemo(() => {
    const today = new Date();
    const twoMonthsAgo = new Date();
    twoMonthsAgo.setMonth(today.getMonth() - 2);

    const recentMovs = allMovimientos.filter(m => {
      const d = parseMovimientoDate(m.fecha_operacion);
      return d && d >= twoMonthsAgo;
    });

    // 1. Estimate income
    const incomes = recentMovs.filter(m => m.tipo === 'ingreso');
    const totalIncome = incomes.reduce((sum, m) => sum + m.importe, 0);
    // If no recent data, fallback to reasonable averages
    let monthlyIncome = totalIncome > 0 ? totalIncome / 2 : 1800; 

    // 2. Estimate expenses (excluding subscriptions)
    // Subscriptions have colors or names in list, let's identify variables by checking if they are not in subscription agend
    const activeSubs = suscripciones.filter(s => s.activa);
    const subNames = activeSubs.map(s => s.nombre.toLowerCase());

    const variableExpenses = recentMovs.filter(m => {
      if (m.tipo !== 'gasto') return false;
      const isSub = subNames.some(name => m.concepto.toLowerCase().includes(name));
      return !isSub;
    });
    const totalVariable = variableExpenses.reduce((sum, m) => sum + m.importe, 0);
    let monthlyVariable = totalVariable > 0 ? totalVariable / 2 : 600;

    return {
      monthlyIncome,
      monthlyVariable,
      dailyVariable: monthlyVariable / 30,
      activeSubs
    };
  }, [allMovimientos, suscripciones]);

  // Generate 90 days prediction data points
  const projectionData = useMemo(() => {
    const data = [];
    let currentBalance = totalSavings;
    const startDay = new Date();
    
    // Projections over 90 days
    for (let day = 0; day <= 90; day++) {
      const currentDate = new Date(startDay);
      currentDate.setDate(startDay.getDate() + day);

      const dayOfMonth = currentDate.getDate();
      const monthLabel = currentDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

      // 1. Deduct daily variable expense
      if (day > 0) {
        currentBalance -= estimates.dailyVariable;
      }

      // 2. Add Salary/Income on the 28th of each month (lump sum)
      if (dayOfMonth === 28 && day > 0) {
        currentBalance += estimates.monthlyIncome;
      }

      // 3. Deduct active subscription billing on its specific payment day
      estimates.activeSubs.forEach(sub => {
        if (sub.dia_pago === dayOfMonth && day > 0) {
          // Adjust subscription cost based on frequency
          let chargeAmount = sub.importe;
          if (sub.frecuencia === 'trimestral' && dayOfMonth === sub.dia_pago) {
            // charge every 3 months
            const diffMonths = currentDate.getMonth() - startDay.getMonth();
            if (diffMonths % 3 !== 0) chargeAmount = 0;
          } else if (sub.frecuencia === 'semestral') {
            const diffMonths = currentDate.getMonth() - startDay.getMonth();
            if (diffMonths % 6 !== 0) chargeAmount = 0;
          } else if (sub.frecuencia === 'anual') {
            const diffMonths = currentDate.getMonth() - startDay.getMonth();
            if (diffMonths % 12 !== 0) chargeAmount = 0;
          }

          // Shared subscription compensation factor (mi_parte)
          const effectiveCharge = sub.mi_parte !== null && sub.mi_parte !== undefined
            ? parseFloat(sub.mi_parte.toString())
            : chargeAmount;

          currentBalance -= effectiveCharge;
        }
      });

      // Keep scale rounded to 2 decimals
      currentBalance = Math.round(currentBalance * 100) / 100;

      // Output data point (skip plotting every single day to make the chart smooth - plot every 3 days or weekly, but keep calculation daily)
      if (day % 3 === 0 || day === 90) {
        data.push({
          name: monthLabel,
          balance: currentBalance,
          rawDate: currentDate
        });
      }
    }
    return data;
  }, [totalSavings, estimates]);

  // Statistics summaries
  const stats = useMemo(() => {
    const balances = projectionData.map(d => d.balance);
    const min = Math.min(...balances);
    const max = Math.max(...balances);
    const end = projectionData[projectionData.length - 1]?.balance ?? totalSavings;
    const diff = end - totalSavings;
    
    return {
      min,
      max,
      end,
      diff,
      isAlert: min < totalSavings * 0.15 || min < 50
    };
  }, [projectionData, totalSavings]);

  const CustomPredictiveTooltip = ({ active, payload, label }: any) => {
    if (active && payload && payload.length) {
      return (
        <div className="glass-panel p-3 border border-slate-200/50 dark:border-white/10 shadow-2xl rounded-2xl bg-slate-950/90 text-left text-xs text-slate-800 dark:text-slate-100">
          <p className="font-extrabold text-slate-500 dark:text-slate-400 uppercase tracking-widest text-[9px] mb-1.5">{label}</p>
          <div className="flex items-center gap-1.5 font-extrabold">
            <span className="text-indigo-500 dark:text-indigo-400">Saldo proyectado:</span>
            <span className="text-slate-800 dark:text-slate-100 tabular-nums">{formatCurrency(payload[0].value)}</span>
          </div>
          <div className="text-[10px] text-slate-400 mt-1 font-semibold">
            {payload[0].value >= totalSavings ? (
              <span className="text-emerald-500 font-bold">+{formatCurrency(payload[0].value - totalSavings)} vs. inicial</span>
            ) : (
              <span className="text-rose-500 font-bold">−{formatCurrency(totalSavings - payload[0].value)} vs. inicial</span>
            )}
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl p-5 flex flex-col justify-between h-full">
      <div>
        <div className="flex items-center justify-between border-b border-white/10 pb-4 mb-4">
          <div>
            <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight flex items-center gap-2">
              <TrendingUp className="w-5 h-5 text-indigo-500" />
              Proyección de Liquidez
            </h3>
            <p className="text-xs text-slate-400 dark:text-slate-500">Estimación a 90 días del saldo total acumulado</p>
          </div>
          <div className="flex items-center gap-1 px-2.5 py-1 rounded-lg bg-indigo-500/10 border border-indigo-500/15 text-indigo-600 dark:text-indigo-400 text-[10px] font-black uppercase tracking-wider">
            <Sparkles className="w-3 h-3 animate-pulse" />
            Predictive AI
          </div>
        </div>

        {/* Predictive Metrics Row */}
        <div className="grid grid-cols-3 gap-3 mb-6">
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-slate-950/10 border border-white/5 text-center">
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block mb-1">Mínimo Proyectado</span>
            <span className={`text-xs sm:text-sm font-black tabular-nums ${stats.min < 0 ? 'text-rose-600 dark:text-rose-400' : 'text-slate-700 dark:text-slate-200'}`}>
              {formatCurrency(stats.min)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-slate-950/10 border border-white/5 text-center">
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block mb-1">Máximo Proyectado</span>
            <span className="text-xs sm:text-sm font-black text-slate-700 dark:text-slate-200 tabular-nums">
              {formatCurrency(stats.max)}
            </span>
          </div>
          <div className="p-3 rounded-2xl bg-white/40 dark:bg-slate-950/10 border border-white/5 text-center">
            <span className="text-[8px] font-black uppercase tracking-wider text-slate-400 block mb-1">Crecimiento Neto</span>
            <span className={`text-xs sm:text-sm font-black tabular-nums flex items-center justify-center gap-0.5 ${stats.diff >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`}>
              {stats.diff >= 0 ? '+' : ''}{formatCurrency(stats.diff)}
            </span>
          </div>
        </div>

        {/* Area Chart visualization */}
        <div className="w-full h-52 sm:h-60 mt-2 relative">
          {isLocked && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-slate-100/10 dark:bg-slate-950/20 backdrop-blur-md rounded-2xl p-6 text-center select-none animate-in fade-in duration-300">
              <div className="p-3.5 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-500 dark:text-indigo-400 mb-3.5 shadow-inner">
                <Lock className="w-5 h-5 animate-pulse" />
              </div>
              <h4 className="font-extrabold text-xs text-slate-700 dark:text-slate-200 uppercase tracking-widest">
                Proyección Protegida
              </h4>
              <p className="text-[10px] text-slate-455 dark:text-slate-500 max-w-[200px] mt-1.5 leading-relaxed font-semibold">
                Desbloquea la aplicación con tu PIN para visualizar las proyecciones de liquidez.
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
            <AreaChart data={projectionData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorPredictive" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#6366f1" stopOpacity={0.25}/>
                  <stop offset="95%" stopColor="#6366f1" stopOpacity={0.0}/>
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="rgba(148, 163, 184, 0.08)" />
              <XAxis 
                dataKey="name" 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 700 }}
              />
              <YAxis 
                axisLine={false} 
                tickLine={false} 
                tick={{ fill: '#94a3b8', fontSize: 9, fontWeight: 700 }}
              />
              <Tooltip content={<CustomPredictiveTooltip />} />
              <Area 
                type="monotone" 
                dataKey="balance" 
                stroke="#6366f1" 
                strokeWidth={2.5}
                fillOpacity={1} 
                fill="url(#colorPredictive)" 
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Advisory warning or helpful tip */}
      <div className="mt-6">
        {stats.isAlert ? (
          <div className="p-3 bg-rose-500/5 dark:bg-rose-500/10 border border-rose-500/20 rounded-2xl flex gap-2.5 text-[10px] leading-relaxed text-rose-700 dark:text-rose-350">
            <AlertTriangle size={15} className="shrink-0 mt-0.5 animate-bounce" />
            <span>
              <strong>¡Alerta de Liquidez!</strong> El saldo proyectado descenderá por debajo de los límites seguros. Revisa suscripciones prescindibles o reduce gastos variables para evitar números rojos.
            </span>
          </div>
        ) : (
          <div className="p-3 bg-indigo-500/5 dark:bg-indigo-500/10 border border-indigo-500/20 rounded-2xl flex gap-2.5 text-[10px] leading-relaxed text-indigo-700 dark:text-indigo-300">
            <Info size={15} className="shrink-0 mt-0.5" />
            <span>
              <strong>Proyección Saludable:</strong> Con tus ingresos de <strong>{formatCurrency(estimates.monthlyIncome)}/mes</strong> y gastos actuales, tu liquidez proyectada se mantiene en niveles estables.
            </span>
          </div>
        )}
      </div>
    </Card>
  );
};
