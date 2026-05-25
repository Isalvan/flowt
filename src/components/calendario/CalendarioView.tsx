import React, { useState, useEffect } from 'react';
import { type Suscripcion } from '../../types';
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
    return activeSubs.filter(s => s.dia_pago === day);
  };

  // Select day handler
  const handleSelectDay = (day: number | null) => {
    if (day) setSelectedDay(day);
  };

  // Get selected day subs
  const selectedDaySubs = selectedDay ? getSubsForDay(selectedDay) : [];

  // Monthly Agenda sorted listing
  const sortedAgenda = [...activeSubs].sort((a, b) => a.dia_pago - b.dia_pago);

  const daysOfWeek = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];

  return (
    <div className="space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header with Month switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl sm:text-3xl font-black text-slate-800 dark:text-slate-100 uppercase tracking-tight">
            Calendario de Cargos
          </h2>
          <p className="text-slate-500 dark:text-slate-400 text-xs sm:text-sm">Vencimiento mensual estimado de tus suscripciones recurrentes</p>
        </div>

        {/* Month selector controls */}
        <div className="flex items-center gap-1 bg-white/40 dark:bg-slate-950/20 p-1 border border-slate-200/50 dark:border-white/5 rounded-2xl self-start sm:self-auto shadow-inner backdrop-blur-md">
          <button
            onClick={prevMonth}
            className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl hover:bg-white dark:hover:bg-slate-800 shadow-sm active:scale-95 transition-all cursor-pointer"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <span className="font-black text-xs text-slate-700 dark:text-slate-350 uppercase tracking-[0.15em] px-4 py-1.5 text-center min-w-[150px] capitalize font-title">
            {monthName}
          </span>

          <button
            onClick={nextMonth}
            className="p-2 text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 rounded-xl hover:bg-white dark:hover:bg-slate-800 shadow-sm active:scale-95 transition-all cursor-pointer"
          >
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* 2. Grid split layout */}
      <div className="grid gap-6 lg:grid-cols-3">
        
        {/* Left 2/3 - Interactive Grid */}
        <Card className="lg:col-span-2 bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-xl p-5 sm:p-6">
          
          {/* Week Headers */}
          <div className="grid grid-cols-7 gap-2.5 mb-4 text-center font-black text-[9px] text-slate-400 dark:text-slate-500 uppercase tracking-[0.2em] bg-slate-100/40 dark:bg-slate-950/10 py-2 rounded-xl border border-slate-150/20 dark:border-white/5 shadow-inner">
            {daysOfWeek.map(day => (
              <span key={day} className="py-0.5">{day}</span>
            ))}
          </div>

          {/* Day Cells Grid */}
          <div className="grid grid-cols-7 gap-2.5">
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
                    min-h-[78px] 
                    p-2.5 
                    rounded-2xl 
                    border 
                    flex 
                    flex-col 
                    justify-between 
                    transition-all 
                    duration-300 
                    relative
                    ${dayNum ? 'cursor-pointer hover:border-indigo-500/40 hover:bg-white/90 dark:hover:bg-slate-950/30 hover:scale-[1.03] hover:shadow-md' : 'bg-transparent border-transparent pointer-events-none'}
                    ${isSelected 
                      ? 'border-indigo-500 bg-indigo-500/10 dark:bg-indigo-500/5 shadow-[0_4px_12px_rgba(99,102,241,0.15)] ring-2 ring-indigo-500/25 scale-[1.02]' 
                      : dayNum 
                        ? isToday 
                          ? 'border-emerald-500/70 bg-emerald-500/5 shadow-[0_0_10px_rgba(16,185,129,0.08)] ring-1 ring-emerald-500/10' 
                          : 'border-slate-150/70 dark:border-white/5 bg-white/45 dark:bg-slate-900/15' 
                        : 'border-transparent bg-transparent'
                    }
                  `}
                >
                  {/* Day number */}
                  <div className="flex items-center justify-between">
                    <span className={`text-[11px] font-black tabular-nums transition-colors ${
                      isToday 
                        ? 'text-emerald-600 dark:text-emerald-400 bg-emerald-500/15 w-5.5 h-5.5 rounded-full flex items-center justify-center border border-emerald-500/20' 
                        : isSelected 
                          ? 'text-indigo-600 dark:text-indigo-400 font-extrabold'
                          : 'text-slate-650 dark:text-slate-350 font-bold'
                    }`}>
                      {dayNum}
                    </span>

                    {isToday && (
                      <span className="text-[7.5px] font-black uppercase text-emerald-600 dark:text-emerald-400 tracking-wider bg-emerald-500/10 px-1.5 py-0.5 rounded-md border border-emerald-500/20">Hoy</span>
                    )}
                  </div>

                  {/* Bullet color indicators with premium glow for day's subscriptions */}
                  {hasSubs && (
                    <div className="flex flex-wrap gap-1.5 mt-2 justify-start max-w-full">
                      {daySubs.map(sub => (
                        <span 
                          key={sub.id} 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/20 shadow-inner" 
                          style={{ 
                            backgroundColor: sub.color,
                            boxShadow: `0 0 6px ${sub.color}aa`
                          }}
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
          <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-lg p-5">
            <h3 className="font-extrabold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-widest border-b border-slate-150/40 dark:border-white/5 pb-3 mb-4 flex items-center gap-1.5">
              <Calendar className="w-4 h-4 text-indigo-500" />
              Detalles: Día {selectedDay || today.getDate()}
            </h3>

            {selectedDaySubs.length > 0 ? (
              <div className="space-y-3">
                {selectedDaySubs.map(sub => (
                  <div key={sub.id} className="p-3.5 rounded-2xl bg-white/40 dark:bg-slate-900/20 border border-slate-150/40 dark:border-white/5 flex items-center justify-between shadow-sm hover:scale-[1.02] transition-transform duration-250">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5">
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" 
                          style={{ 
                            backgroundColor: sub.color,
                            boxShadow: `0 0 5px ${sub.color}80`
                          }} 
                        />
                        <h4 className="font-extrabold text-xs text-slate-800 dark:text-slate-205 uppercase tracking-tight truncate">
                          {sub.nombre}
                        </h4>
                      </div>
                      <span className="inline-block text-[8px] font-black text-indigo-500 dark:text-indigo-400 uppercase tracking-wider mt-1 bg-indigo-500/5 px-2 py-0.5 rounded-lg border border-indigo-500/10">
                        {sub.categoria}
                      </span>
                    </div>

                    <div className="text-right shrink-0 ml-3">
                      <span className="text-xs font-black text-slate-800 dark:text-white tabular-nums">
                        {formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}
                      </span>
                      <p className="text-[8px] text-slate-400 dark:text-slate-500 uppercase font-bold leading-none mt-0.5">
                        {sub.frecuencia}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="flex flex-col items-center justify-center p-8 border border-dashed border-slate-200 dark:border-slate-800 rounded-2xl bg-slate-50/50 dark:bg-slate-900/10 text-center">
                <Info className="w-6 h-6 text-slate-350 dark:text-slate-650 mb-2" />
                <p className="font-black text-[10px] text-slate-400 dark:text-slate-600 uppercase tracking-widest">Sin Cargos</p>
                <p className="text-[9px] text-slate-400 dark:text-slate-500 mt-0.5">No hay cargos programados para este día</p>
              </div>
            )}
          </Card>

          {/* Full Month Agenda listing card */}
          <Card className="bg-white/60 dark:bg-slate-900/30 border border-white/10 dark:border-white/5 shadow-lg p-5 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="font-extrabold text-xs text-slate-800 dark:text-slate-200 uppercase tracking-widest border-b border-slate-150/40 dark:border-white/5 pb-3 mb-4 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-indigo-500" />
                Agenda Mensual
              </h3>

              <div className="space-y-2.5 max-h-[220px] overflow-y-auto pr-1">
                {sortedAgenda.length > 0 ? (
                  sortedAgenda.map(sub => (
                    <div 
                      key={sub.id}
                      onClick={() => setSelectedDay(sub.dia_pago)}
                      className={`flex items-center justify-between p-2.5 rounded-2xl border transition-all duration-200 cursor-pointer ${
                        selectedDay === sub.dia_pago 
                          ? 'border-indigo-500/40 bg-indigo-500/5' 
                          : 'border-transparent hover:bg-white/50 dark:hover:bg-slate-950/20 hover:scale-[1.01]'
                      }`}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <span className="text-[11px] font-black text-indigo-500/80 dark:text-indigo-400/80 bg-indigo-500/5 px-2 py-0.5 rounded-lg border border-indigo-500/10 tabular-nums shrink-0">
                          D{sub.dia_pago}
                        </span>
                        <span 
                          className="w-2.5 h-2.5 rounded-full shrink-0 border border-white/10" 
                          style={{ 
                            backgroundColor: sub.color,
                            boxShadow: `0 0 5px ${sub.color}60`
                          }} 
                        />
                        <span className="text-[11px] font-black text-slate-700 dark:text-slate-300 uppercase tracking-tight truncate">
                          {sub.nombre}
                        </span>
                      </div>

                      <span className="text-[11px] font-black text-slate-800 dark:text-slate-200 tabular-nums shrink-0 ml-3">
                        {formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}
                      </span>
                    </div>
                  ))
                ) : (
                  <div className="flex flex-col items-center justify-center p-6 text-center">
                    <AlertCircle className="w-6 h-6 text-slate-300 dark:text-slate-700 mb-2" />
                    <p className="font-bold text-[10px] text-slate-400 dark:text-slate-650 uppercase tracking-widest">Agenda Vacía</p>
                    <p className="text-[9px] text-slate-400 mt-0.5">No hay suscripciones activas registradas</p>
                  </div>
                )}
              </div>
            </div>

            {sortedAgenda.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-slate-150/40 dark:border-white/5 flex justify-between items-center text-xs font-black text-slate-400 dark:text-slate-500 uppercase tracking-[0.15em] shrink-0">
                <span className="flex items-center gap-1"><Sparkles className="w-3.5 h-3.5 text-indigo-500 animate-pulse" /> Total Agenda:</span>
                <span className="font-black text-slate-850 dark:text-slate-100 tabular-nums text-sm">
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
