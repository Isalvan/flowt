import React from 'react';
import { type Movimiento, type Hucha, type Suscripcion } from '../../types';
import { HuchaCard } from './HuchaCard';
import { ActivityList } from './ActivityList';
import { AnalyticsSection } from './AnalyticsSection';
import { Card } from '../common/Card';
import { EmptyIllustration } from '../common/EmptyIllustration';
import { 
  Plus, 
  ArrowRightLeft, 
  History, 
  Calendar, 
  DollarSign, 
  TrendingUp, 
  TrendingDown, 
  CreditCard, 
  Info
} from 'lucide-react';
import { getNextPaymentDate } from '../../hooks/useFinanceData';
import { usePrivacy } from '../../context/PrivacyContext';

interface DashboardViewProps {
  // Data states
  movimientos: Movimiento[];
  chartMovements: Movimiento[];
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  mediaIngresos: number;
  totalGastos: number;
  balance: number;
  totalMensualSuscripciones: number;
  chartData: any[];

  // Action methods
  onUpdateConcepto: (movId: string, newConcepto: string) => void;
  onConvert: (mov: Movimiento) => void;
  onLink: (mov: Movimiento) => void;
  onUnlink: (ingreso: Movimiento) => void;
  onChangeHucha: (mov: Movimiento, newHuchaId: string) => void;
  onDeleteMovimiento: (mov: Movimiento) => void;

  // Modal triggers
  onOpenHuchaModal: (editingHucha: Hucha | null) => void;
  onDeleteHucha: (hucha: Hucha) => void;
  onOpenTransferModal: () => void;
  onOpenHistoryModal: () => void;
  onOpenManualMovimientoModal: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = ({
  movimientos,
  chartMovements,
  huchas,
  suscripciones,
  mediaIngresos,
  totalGastos,
  balance,
  totalMensualSuscripciones,
  chartData,
  onUpdateConcepto,
  onConvert,
  onLink,
  onUnlink,
  onChangeHucha,
  onOpenHuchaModal,
  onDeleteHucha,
  onOpenTransferModal,
  onOpenHistoryModal,
  onOpenManualMovimientoModal,
  onDeleteMovimiento,
}) => {
  const { formatCurrency } = usePrivacy();

  // Resolve upcoming recurrences (top 3 next active)
  const getUpcomingBills = (): Array<{ sub: Suscripcion; date: Date; daysLeft: number }> => {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    return suscripciones
      .filter(s => s.activa)
      .map(s => {
        const nextDate = getNextPaymentDate(s.dia_pago);
        const diffTime = nextDate.getTime() - today.getTime();
        const daysLeft = Math.ceil(diffTime / (1000 * 60 * 60 * 24));
        return { sub: s, date: nextDate, daysLeft };
      })
      .sort((a, b) => a.daysLeft - b.daysLeft)
      .slice(0, 3);
  };

  const upcomingBills = getUpcomingBills();

  // Premium Sparkline Renderer
  const renderSparkline = (data: number[], color: string, isLight: boolean = false) => {
    if (!data || data.length < 2) return null;
    const width = 72;
    const height = 26;
    const padding = 1.5;
    const min = Math.min(...data);
    const max = Math.max(...data);
    const range = max - min === 0 ? 1 : max - min;
    const points = data.map((val, index) => {
      const x = padding + (index / (data.length - 1)) * (width - padding * 2);
      const y = padding + (1 - (val - min) / range) * (height - padding * 2);
      return `${x},${y}`;
    });
    const pointsStr = points.join(' ');
    const fillPointsStr = `${padding},${height} ${pointsStr} ${width - padding},${height}`;

    return (
      <svg width={width} height={height} className="overflow-visible opacity-80 group-hover:opacity-100 transition-opacity pointer-events-none shrink-0 mb-1 ml-2">
        <defs>
          <linearGradient id={`sparkGrad-${color}`} x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={color} stopOpacity={isLight ? 0.35 : 0.22} />
            <stop offset="100%" stopColor={color} stopOpacity={0} />
          </linearGradient>
        </defs>
        <polygon points={fillPointsStr} fill={`url(#sparkGrad-${color})`} />
        <polyline fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" points={pointsStr} />
        {points.length > 0 && (
          <circle
            cx={points[points.length - 1].split(',')[0]}
            cy={points[points.length - 1].split(',')[1]}
            r="2"
            fill={color}
            className="animate-pulse"
          />
        )}
      </svg>
    );
  };

  // Sparkline data mapping
  const lastSixData = chartData && chartData.length > 0 ? chartData.slice(-6) : [
    { ingresos: 100, gastos: 60 },
    { ingresos: 120, gastos: 80 },
    { ingresos: 110, gastos: 90 },
    { ingresos: 140, gastos: 70 },
    { ingresos: 130, gastos: 95 },
    { ingresos: 160, gastos: 90 }
  ];

  const balanceTrend = lastSixData.map(d => d.ingresos - d.gastos);
  const ingresosTrend = lastSixData.map(d => d.ingresos);
  const gastosTrend = lastSixData.map(d => d.gastos);
  const subsTrend = lastSixData.map(d => Math.max(12, d.gastos * 0.08 + 15));

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header with Title & Main Buttons */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            Mi Panel
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Gestión inteligente y reparto automatizado de ahorros</p>
        </div>

        {/* Floating primary actions */}
        <div className="flex flex-wrap items-center gap-2.5">
          <button
            onClick={onOpenManualMovimientoModal}
            className="flex items-center gap-1.5 bg-sky-600 hover:bg-sky-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-sky-500/10 hover:shadow-sky-500/20 active:scale-95 transition-all border border-sky-400/20 cursor-pointer"
          >
            <Plus className="w-4 h-4" />
            Añadir Movimiento
          </button>

          <button
            onClick={() => onOpenHuchaModal(null)}
            className="flex items-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-extrabold text-xs px-4 py-2.5 rounded-xl shadow-lg shadow-indigo-500/10 hover:shadow-indigo-500/20 active:scale-95 transition-all border border-indigo-400/20"
          >
            <Plus className="w-4 h-4" />
            Nueva Hucha
          </button>
          
          <button
            onClick={onOpenTransferModal}
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-xs px-4 py-2.5 rounded-xl transition-all border border-white/5 active:scale-95 shadow-sm"
          >
            <ArrowRightLeft className="w-4 h-4" />
            Traspasar Fondos
          </button>

          <button
            onClick={onOpenHistoryModal}
            className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 font-extrabold text-xs px-4 py-2.5 rounded-xl transition-all border border-white/5 active:scale-95 shadow-sm"
          >
            <History className="w-4 h-4" />
            Historial Completo
          </button>

          {/* Help keyboard shortcuts button */}
          <button
            onClick={() => window.dispatchEvent(new KeyboardEvent('keydown', { key: '?' }))}
            className="hidden sm:flex items-center justify-center bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-400 hover:text-slate-650 dark:hover:text-slate-200 w-10 h-10 rounded-xl transition-all border border-white/5 active:scale-95 shadow-sm cursor-pointer"
            title="Atajos de teclado (?)"
          >
            <span className="text-xs font-black">?</span>
          </button>
        </div>
      </div>

      {/* 2. Stat summaries */}
      <div className="grid gap-4 grid-cols-2 lg:grid-cols-4">
        
        {/* Total balance card */}
        <Card className="bg-gradient-to-br from-indigo-500 to-blue-600 text-white p-5 shadow-xl border-none group glass-glare">
          <div className="flex items-center justify-between opacity-80">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Saldo Total Acumulado</span>
            <DollarSign className="w-4 h-4" />
          </div>
          <div className="flex items-end justify-between mt-3.5">
            <div>
              <span className="text-2xl sm:text-3xl font-black tracking-tight tabular-nums leading-none">
                {formatCurrency(balance)}
              </span>
              <p className="text-[10px] opacity-75 font-semibold mt-1">
                Ahorros distribuidos
              </p>
            </div>
            {renderSparkline(balanceTrend, '#ffffff', true)}
          </div>
        </Card>

        {/* Total ingress card */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5 flex flex-col justify-between group glass-glare glow-card-emerald">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Media Mensual</span>
            <TrendingUp className="w-4 h-4 text-emerald-500" />
          </div>
          <div className="flex items-end justify-between mt-3.5">
            <div>
              <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight tabular-nums leading-none">
                {formatCurrency(mediaIngresos)}
              </span>
              <p className="text-[10px] text-slate-450 dark:text-slate-550 font-semibold mt-1">
                Media de meses con &gt;900 €
              </p>
            </div>
            {renderSparkline(ingresosTrend, '#10b981')}
          </div>
        </Card>

        {/* Total expenses card */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5 flex flex-col justify-between group glass-glare glow-card-rose">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Gastos Mensuales</span>
            <TrendingDown className="w-4 h-4 text-rose-500" />
          </div>
          <div className="flex items-end justify-between mt-3.5">
            <div>
              <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight tabular-nums leading-none">
                {formatCurrency(totalGastos)}
              </span>
              <p className="text-[10px] text-slate-450 dark:text-slate-550 font-semibold mt-1">
                Compras y servicios abonados
              </p>
            </div>
            {renderSparkline(gastosTrend, '#ef4444')}
          </div>
        </Card>

        {/* Subscription budget card */}
        <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-md p-5 flex flex-col justify-between group glass-glare glow-card-indigo">
          <div className="flex items-center justify-between text-slate-400 dark:text-slate-500">
            <span className="text-[10px] font-black uppercase tracking-[0.2em]">Fondo Recurrente</span>
            <CreditCard className="w-4 h-4 text-violet-500" />
          </div>
          <div className="flex items-end justify-between mt-3.5">
            <div>
              <span className="text-2xl font-black text-slate-800 dark:text-slate-100 tracking-tight tabular-nums leading-none">
                {formatCurrency(totalMensualSuscripciones)}
              </span>
              <p className="text-[10px] text-slate-450 dark:text-slate-550 font-semibold mt-1">
                Presupuesto mensual estimado
              </p>
            </div>
            {renderSparkline(subsTrend, '#8b5cf6')}
          </div>
        </Card>
      </div>

      {/* 3. Savind pockets (Huchas grid) */}
      <div className="space-y-4">
        <h3 className="font-extrabold text-sm text-slate-400 dark:text-slate-500 uppercase tracking-widest">Mis Carteras de Ahorro</h3>
        <div className="grid gap-4 sm:gap-6 md:grid-cols-2 lg:grid-cols-3">
          {huchas.length > 0 ? (
            huchas.map(h => (
              <HuchaCard
                key={h.id}
                hucha={h}
                onEdit={onOpenHuchaModal}
                onDelete={onDeleteHucha}
              />
            ))
          ) : (
            <div className="flex flex-col items-center justify-center p-12 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 md:col-span-2 lg:col-span-3 text-center animate-in fade-in duration-300">
              <EmptyIllustration />
              <span className="text-base font-bold text-slate-350 dark:text-slate-600 uppercase tracking-widest mb-1">Sin Carteras</span>
              <p className="text-xs text-slate-400 font-semibold mt-1">Crea tu primera hucha de ahorro para activar la distribución de fondos</p>
            </div>
          )}
        </div>
      </div>

      {/* 4. Analytics trend & breakdown */}
      <AnalyticsSection 
        chartData={chartData} 
        huchas={huchas} 
        suscripciones={suscripciones}
        allMovimientos={chartMovements}
      />

      {/* 5. Main Content split (Activity List & Upcoming Recurring Bills) */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Left Column (2/3 width) - Activity List */}
        <div className="lg:col-span-2">
          <ActivityList
            movimientos={movimientos}
            allMovimientos={chartMovements}
            huchas={huchas}
            onUpdateConcepto={onUpdateConcepto}
            onConvert={onConvert}
            onLink={onLink}
            onUnlink={onUnlink}
            onChangeHucha={onChangeHucha}
            onDeleteMovimiento={onDeleteMovimiento}
          />
        </div>

        {/* Right Column (1/3 width) - Upcoming Recurrent Bills */}
        <div className="space-y-6">
          <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl h-full flex flex-col justify-between">
            <div>
              <div className="border-b border-white/10 pb-4 mb-4">
                <h3 className="font-extrabold text-lg text-slate-800 dark:text-slate-100 uppercase tracking-tight flex items-center gap-2">
                  <Calendar className="w-5 h-5 text-indigo-500 animate-pulse" />
                  Próximos Cargos
                </h3>
                <p className="text-xs text-slate-400 dark:text-slate-500">Recurrentes que vencen próximamente</p>
              </div>

              <div className="space-y-3.5">
                {upcomingBills.length > 0 ? (
                  upcomingBills.map(({ sub, date, daysLeft }) => {
                    const divisor = sub.frecuencia === 'anual' ? 'anual' : 'mes';
                    return (
                      <div 
                        key={sub.id} 
                        className="flex items-center justify-between p-3.5 rounded-2xl bg-white/40 dark:bg-slate-900/20 border border-white/5 hover:border-indigo-500/10 transition-all duration-200 shadow-sm"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span 
                              className="w-2.5 h-2.5 rounded-full shrink-0" 
                              style={{ backgroundColor: sub.color }} 
                            />
                            <p className="font-extrabold text-xs text-slate-700 dark:text-slate-300 uppercase tracking-tight truncate">
                              {sub.nombre}
                            </p>
                          </div>
                          
                          <div className="flex items-center gap-2 mt-1 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <span>Vence en: <strong className={`${daysLeft <= 3 ? 'text-amber-600 dark:text-amber-400 font-extrabold' : 'text-slate-500'}`}>{daysLeft} {daysLeft === 1 ? 'día' : 'días'}</strong></span>
                            <span>• {date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })}</span>
                          </div>
                        </div>

                        <div className="text-right shrink-0 ml-3">
                          <span className="text-sm font-black text-slate-900 dark:text-white tabular-nums">
                            {formatCurrency(sub.importe)}
                          </span>
                          <p className="text-[9px] text-slate-400 uppercase font-semibold">
                            / {divisor}
                          </p>
                        </div>
                      </div>
                    );
                  })
                ) : (
                  <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-3xl bg-slate-50/50 dark:bg-slate-900/10 text-center animate-in fade-in duration-300">
                    <EmptyIllustration />
                    <p className="font-bold text-xs text-slate-450 dark:text-slate-600 uppercase tracking-widest">Sin Cargos Activos</p>
                    <p className="text-[10px] text-slate-400 mt-1">Todas tus suscripciones están al día o inactivas</p>
                  </div>
                )}
              </div>
            </div>

            {upcomingBills.length > 0 && (
              <div className="mt-6 pt-4 border-t border-white/5 flex gap-2.5 p-3 bg-indigo-500/5 rounded-2xl border border-indigo-500/10 text-[10px] leading-relaxed text-indigo-700 dark:text-indigo-300">
                <Info size={14} className="shrink-0 mt-0.5" />
                <span>
                  Los fondos se restan de tu hucha de <strong>Suscripciones</strong> o <strong>Principal</strong> en sus días de vencimiento.
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
