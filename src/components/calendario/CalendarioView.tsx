import React, { useState, useEffect } from 'react';
import { type Suscripcion } from '../../types';
import { getSubscriptionChargeForMonth } from '../../utils/subscriptions';
import { Card } from '../common/Card';
import { 
  Calendar, 
  ChevronLeft, 
  ChevronRight, 
  Clock, 
  Info,
  AlertCircle,
  Sparkles
} from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';

interface CalendarioViewProps {
  suscripciones: Suscripcion[];
}

export const CalendarioView: React.FC<CalendarioViewProps> = ({ suscripciones }) => {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(new Date().getDate());

  const { formatCurrency } = usePrivacy();

  const activeSubs = suscripciones.filter(s => s.activa);

  // Automatically select today's day when month changes if it exists in that month
  useEffect(() => {
    const today = new Date();
    if (today.getMonth() === currentDate.getMonth() && today.getFullYear() === currentDate.getFullYear()) {
      setSelectedDay(today.getDate());
    } else {
      setSelectedDay(null);
    }
  }, [currentDate]);

  // Month navigation helpers
  const prevMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1));
  };

  const nextMonth = () => {
    setCurrentDate(new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1));
  };

  // Month properties
  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const monthName = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

  // Get total days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Starting day index of the month (Monday-indexed: 0 = Mon, 6 = Sun)
  const rawStartDay = new Date(year, month, 1).getDay();
  const startDayOffset = rawStartDay === 0 ? 6 : rawStartDay - 1;

  // Calendar cells array
  const cells: Array<{ dayNum: number | null; isToday: boolean }> = [];
  const today = new Date();
  
  // Empty slots before month start
  for (let i = 0; i < startDayOffset; i++) {
    cells.push({ dayNum: null, isToday: false });
  }

  // Month days
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = today.getDate() === d && today.getMonth() === month && today.getFullYear() === year;
    cells.push({ dayNum: d, isToday });
  }

  // Get subscriptions triggering on a specific day number
  const getSubsForDay = (day: number): Suscripcion[] => {
    return activeSubs.filter(s => {
      const charge = getSubscriptionChargeForMonth(s, year, month);
      return charge?.getDate() === day;
    });
  };

  // Select day handler
  const handleSelectDay = (day: number | null) => {
    if (day) setSelectedDay(day);
  };

  // Get selected day subs
  const selectedDaySubs = selectedDay ? getSubsForDay(selectedDay) : [];

  // Monthly Agenda sorted listing
  const sortedAgenda = activeSubs
    .filter(s => getSubscriptionChargeForMonth(s, year, month) !== null)
    .sort((a, b) => a.dia_pago - b.dia_pago);
  const getChargeDay = (subscription: Suscripcion): number => (
    getSubscriptionChargeForMonth(subscription, year, month)?.getDate() ?? subscription.dia_pago
  );

  const daysOfWeek = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header with Month switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
            Calendario de cargos
          </h2>
          <p className="dashboard-subtitle">Vencimiento mensual estimado de tus suscripciones recurrentes</p>
        </div>

        {/* Month selector controls */}
        <div className="flex items-center gap-1 rounded-2xl border border-line bg-surface-2 p-1">
          <button
            type="button"
            onClick={prevMonth}
            className="dashboard-icon-button"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <span className="text-xs font-bold text-ink px-3 py-1 text-center min-w-[140px] first-letter:uppercase">
            {monthName}
          </span>

          <button
            type="button"
            onClick={nextMonth}
            className="dashboard-icon-button"
            aria-label="Mes siguiente"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Grid split layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Left 2/3 - Interactive Grid */}
        <Card className="lg:col-span-2">
          
          {/* Week Headers */}
          <div className="grid grid-cols-7 gap-2 mb-3 text-center text-[11px] font-bold text-ink-soft bg-surface-2 py-2 rounded-xl">
            {daysOfWeek.map(day => (
              <span key={day} className="py-0.5">{day}</span>
            ))}
          </div>

          {/* Day Cells Grid */}
          <div className="grid grid-cols-7 gap-2">
            {cells.map((cell, idx) => {
              const { dayNum, isToday } = cell;
              const hasSubs = dayNum ? getSubsForDay(dayNum).length > 0 : false;
              const daySubs = dayNum ? getSubsForDay(dayNum) : [];
              const isSelected = selectedDay === dayNum && dayNum !== null;

              return (
                <div
                  key={idx}
                  onClick={() => handleSelectDay(dayNum)}
                  className={`
                    min-h-[72px] 
                    p-2 
                    rounded-2xl 
                    border 
                    flex 
                    flex-col 
                    justify-between 
                    transition-colors 
                    ${dayNum ? 'cursor-pointer' : 'bg-transparent border-transparent pointer-events-none'}
                    ${isSelected 
                      ? 'border-brand bg-brand-tint' 
                      : dayNum 
                        ? isToday 
                          ? 'border-emerald-500/50 bg-emerald-500/10' 
                          : 'border-line bg-surface hover:bg-surface-2 hover:border-line-strong' 
                        : 'border-transparent bg-transparent'
                    }
                  `}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] tabular-nums transition-colors ${
                      isToday 
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 w-5 h-5 rounded-full flex items-center justify-center font-bold' 
                        : isSelected 
                          ? 'text-brand-ink font-extrabold'
                          : 'text-ink font-semibold'
                    }`}>
                      {dayNum}
                    </span>

                    {isToday && (
                      <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 bg-emerald-500/10 px-1.5 py-0.5 rounded-md">Hoy</span>
                    )}
                  </div>

                  {/* Bullet color indicators for day's subscriptions */}
                  {hasSubs && (
                    <div className="flex flex-wrap gap-1 mt-1 justify-start max-w-full">
                      {daySubs.map(sub => (
                        <span 
                          key={sub.id} 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-line" 
                          style={{ backgroundColor: sub.color }}
                          title={`${sub.nombre}: ${formatCurrency(sub.importe)}`}
                        />
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </Card>

        {/* Right 1/3 - Selected Day Details & Agenda */}
        <div className="space-y-6 flex flex-col">
          
          {/* Selected day details panel */}
          <Card>
            <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3">
              <Calendar className="w-4 h-4 text-brand-ink" />
              Detalles: día {selectedDay || today.getDate()}
            </h3>

            {selectedDaySubs.length > 0 ? (
              <div className="space-y-3">
                {selectedDaySubs.map(sub => (
                  <div key={sub.id} className="p-3 rounded-2xl bg-surface-2 flex items-center justify-between">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-line" 
                          style={{ backgroundColor: sub.color }} 
                        />
                        <h4 className="truncate text-xs font-bold text-ink">
                          {sub.nombre}
                        </h4>
                      </div>
                      <span className="inline-block text-[11px] font-semibold text-brand-ink mt-1 bg-brand-tint px-2 py-0.5 rounded-lg">
                        {sub.categoria}
                      </span>
                    </div>

                    <div className="text-right shrink-0 ml-3">
                      <span className="text-xs font-extrabold text-ink tabular-nums">
                        {formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}
                      </span>
                      <p className="text-[11px] text-ink-soft font-semibold mt-0.5">
                        {sub.frecuencia}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="dashboard-empty p-6">
                <Info className="w-5 h-5 text-ink-faint mb-1" />
                <p className="dashboard-heading">Sin cargos</p>
                <p className="text-[11px] text-ink-soft">No hay cargos programados para este día</p>
              </div>
            )}
          </Card>

          {/* Full Month Agenda listing card */}
          <Card className="flex-1 flex flex-col justify-between">
            <div>
              <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3">
                <Clock className="w-4 h-4 text-brand-ink" />
                Agenda mensual
              </h3>

              <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
                {sortedAgenda.length > 0 ? (
                  sortedAgenda.map(sub => (
                    <div 
                      key={sub.id}
                      onClick={() => setSelectedDay(getChargeDay(sub))}
                      className={`flex items-center justify-between p-2.5 rounded-2xl border transition-colors cursor-pointer ${
                        selectedDay === getChargeDay(sub)
                          ? 'border-brand bg-brand-tint' 
                          : 'border-transparent hover:bg-surface-2'
                      }`}
                    >
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="text-[11px] font-bold text-brand-ink bg-brand-tint px-2 py-0.5 rounded-lg tabular-nums shrink-0">
                          D{getChargeDay(sub)}
                        </span>
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-line" 
                          style={{ backgroundColor: sub.color }} 
                        />
                        <span className="text-xs font-semibold text-ink truncate">
                          {sub.nombre}
                        </span>
                      </div>

                      <span className="text-xs font-bold text-ink tabular-nums shrink-0 ml-3">
                        {formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="dashboard-empty p-6">
                    <AlertCircle className="w-5 h-5 text-ink-faint mb-1" />
                    <p className="dashboard-heading">Agenda vacía</p>
                    <p className="text-[11px] text-ink-soft">No hay suscripciones activas registradas</p>
                  </div>
                )}
              </div>
            </div>

            {sortedAgenda.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-line flex justify-between items-center text-xs font-bold text-ink-soft shrink-0">
                <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-brand-ink" /> Total agenda:</span>
                <span className="font-extrabold text-ink tabular-nums text-sm">
                  {formatCurrency(
                    sortedAgenda.reduce((s, sub) => s + (sub.mi_parte != null ? sub.mi_parte : sub.importe), 0)
                  )}
                </span>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
