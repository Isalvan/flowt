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

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const DAYS_OF_WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;

const getDefaultSelectedDay = (date: Date, subs: Suscripcion[]): number | null => {
  const now = new Date();
  const isCurrentMonth =
    now.getMonth() === date.getMonth() && now.getFullYear() === date.getFullYear();

  if (isCurrentMonth) {
    return now.getDate();
  }

  const y = date.getFullYear();
  const m = date.getMonth();
  const active = subs.filter(s => s.activa);

  let earliestDay: number | null = null;
  for (const s of active) {
    const charge = getSubscriptionChargeForMonth(s, y, m);
    if (charge) {
      const d = charge.getDate();
      if (earliestDay === null || d < earliestDay) {
        earliestDay = d;
      }
    }
  }

  return earliestDay;
};

export const CalendarioView: React.FC<CalendarioViewProps> = ({ suscripciones }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(() =>
    getDefaultSelectedDay(new Date(), suscripciones)
  );

  const { formatCurrency } = usePrivacy();

  const activeSubs = suscripciones.filter(s => s.activa);

  // Seleccionar hoy si es el mes actual; si no, el primer día con cargos (o null)
  useEffect(() => {
    setSelectedDay(getDefaultSelectedDay(currentDate, suscripciones));
  }, [currentDate, suscripciones]);

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
  const monthOnlyName = currentDate.toLocaleDateString('es-ES', { month: 'long' });

  const today = new Date();
  const isCurrentMonth = today.getMonth() === month && today.getFullYear() === year;

  // Get total days in month
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  
  // Starting day index of the month (Monday-indexed: 0 = Mon, 6 = Sun)
  const rawStartDay = new Date(year, month, 1).getDay();
  const startDayOffset = rawStartDay === 0 ? 6 : rawStartDay - 1;

  // Calendar cells array
  const cells: Array<{ dayNum: number | null; isToday: boolean }> = [];
  
  // Empty slots before month start
  for (let i = 0; i < startDayOffset; i++) {
    cells.push({ dayNum: null, isToday: false });
  }

  // Month days
  for (let d = 1; d <= daysInMonth; d++) {
    const isToday = isCurrentMonth && today.getDate() === d;
    cells.push({ dayNum: d, isToday });
  }

  // Monthly Agenda sorted listing
  const sortedAgenda = activeSubs
    .map(sub => {
      const chargeDate = getSubscriptionChargeForMonth(sub, year, month);
      return { sub, chargeDate };
    })
    .filter((item): item is { sub: Suscripcion; chargeDate: Date } => item.chargeDate !== null)
    .sort((a, b) => a.chargeDate.getDate() - b.chargeDate.getDate());

  // Get subscriptions triggering on a specific day number
  const getSubsForDay = (day: number): Suscripcion[] => {
    return sortedAgenda
      .filter(item => item.chargeDate.getDate() === day)
      .map(item => item.sub);
  };

  // Select day handler
  const handleSelectDay = (day: number) => {
    setSelectedDay(day);
  };

  // Get selected day subs
  const selectedDaySubs = selectedDay !== null ? getSubsForDay(selectedDay) : [];
  const selectedDate = selectedDay !== null ? new Date(year, month, selectedDay) : null;
  const selectedDayTitle = selectedDate
    ? selectedDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' })
    : '';

  // Totales
  const totalCargos = sortedAgenda.length;
  const totalMes = sortedAgenda.reduce(
    (acc, item) => acc + (item.sub.mi_parte != null ? item.sub.mi_parte : item.sub.importe),
    0
  );

  const quedaPorCobrar = isCurrentMonth
    ? sortedAgenda
        .filter(item => item.chargeDate.getDate() >= today.getDate())
        .reduce(
          (acc, item) => acc + (item.sub.mi_parte != null ? item.sub.mi_parte : item.sub.importe),
          0
        )
    : 0;

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      
      {/* 1. Header with Month switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
            Calendario de cargos
          </h2>
          <p className="dashboard-subtitle">
            {totalCargos} {totalCargos === 1 ? 'cargo' : 'cargos'} este mes · {formatCurrency(totalMes)}
          </p>
        </div>

        {/* Month selector controls - ocupa todo el ancho en móvil */}
        <div className="flex w-full sm:w-auto items-center justify-between gap-1 rounded-2xl border border-line bg-surface-2 p-1">
          <button
            type="button"
            onClick={prevMonth}
            className="dashboard-icon-button"
            aria-label="Mes anterior"
          >
            <ChevronLeft className="w-4 h-4" />
          </button>
          
          <span className="text-xs font-bold text-ink px-3 py-1 text-center flex-1 sm:flex-initial sm:min-w-[140px] first-letter:uppercase">
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
        <Card className="!p-3 sm:!p-5 lg:col-span-2">
          
          {/* Week Headers */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 sm:mb-3 text-center text-[10px] sm:text-[11px] font-bold text-ink-soft bg-surface-2 py-1.5 sm:py-2 rounded-xl">
            {DAYS_OF_WEEK.map(day => (
              <span key={day} className="py-0.5">{day}</span>
            ))}
          </div>

          {/* Day Cells Grid */}
          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {cells.map((cell, idx) => {
              const { dayNum, isToday } = cell;

              if (dayNum === null) {
                return (
                  <div
                    key={`empty-${idx}`}
                    aria-hidden="true"
                    className="aspect-square sm:aspect-auto sm:min-h-[76px] lg:min-h-[92px] rounded-xl sm:rounded-2xl border border-transparent bg-transparent pointer-events-none"
                  />
                );
              }

              const daySubs = getSubsForDay(dayNum);
              const hasSubs = daySubs.length > 0;
              const isSelected = selectedDay === dayNum;
              const cellAriaLabel = `${dayNum} de ${monthOnlyName}, ${daySubs.length} ${daySubs.length === 1 ? 'cargo' : 'cargos'}`;

              return (
                <button
                  key={`day-${dayNum}`}
                  type="button"
                  onClick={() => handleSelectDay(dayNum)}
                  aria-pressed={isSelected}
                  aria-label={cellAriaLabel}
                  className={`
                    aspect-square sm:aspect-auto sm:min-h-[76px] lg:min-h-[92px]
                    p-1 sm:p-2
                    rounded-xl sm:rounded-2xl
                    border
                    flex flex-col
                    transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1
                    ${isSelected 
                      ? 'border-brand bg-brand-tint ring-2 ring-brand/40 shadow-sm' 
                      : isToday 
                        ? 'border-emerald-500/40 bg-emerald-500/5 dark:border-emerald-500/30 dark:bg-emerald-500/10 hover:bg-emerald-500/10' 
                        : 'border-line bg-surface hover:bg-surface-2 hover:border-line-strong' 
                    }
                  `}
                >
                  {/* Móvil (< sm): número centrado arriba y debajo máx 3 puntos + "+N" */}
                  <div className="flex sm:hidden flex-col items-center justify-between h-full w-full py-0.5">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] tabular-nums transition-colors ${
                      isToday 
                        ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold' 
                        : isSelected 
                          ? 'text-brand-ink font-extrabold'
                          : 'text-ink font-semibold'
                    }`}>
                      {dayNum}
                    </span>

                    {hasSubs && (
                      <div className="flex items-center justify-center gap-0.5 max-w-full">
                        {daySubs.slice(0, 3).map(sub => (
                          <span 
                            key={sub.id} 
                            className="w-1.5 h-1.5 rounded-full shrink-0" 
                            style={{ backgroundColor: sub.color }}
                          />
                        ))}
                        {daySubs.length > 3 && (
                          <span className="text-[8px] font-extrabold text-ink-soft leading-none">
                            +{daySubs.length - 3}
                          </span>
                        )}
                      </div>
                    )}
                  </div>

                  {/* Desktop y tablet (>= sm): celdas más altas, lista de puntos y nombres en lg */}
                  <div className="hidden sm:flex flex-col justify-between h-full w-full">
                    <div className="flex items-center justify-start w-full">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs tabular-nums transition-colors ${
                        isToday 
                          ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold' 
                          : isSelected 
                            ? 'text-brand-ink font-extrabold'
                            : 'text-ink font-semibold'
                      }`}>
                        {dayNum}
                      </span>
                    </div>

                    {hasSubs && (
                      <div className="flex flex-col gap-1 mt-auto w-full text-left">
                        {/* Puntos de color */}
                        <div className="flex flex-wrap gap-1">
                          {daySubs.map(sub => (
                            <span 
                              key={sub.id} 
                              className="w-2 h-2 rounded-full shrink-0 border border-line" 
                              style={{ backgroundColor: sub.color }}
                              title={`${sub.nombre}: ${formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}`}
                            />
                          ))}
                        </div>

                        {/* Desde lg: nombre de hasta 2 suscripciones y "+N más" */}
                        <div className="hidden lg:flex flex-col gap-0.5 mt-0.5 w-full">
                          {daySubs.slice(0, 2).map(sub => (
                            <span 
                              key={sub.id}
                              className="truncate text-[10px] font-medium text-ink leading-tight block w-full"
                              title={`${sub.nombre}: ${formatCurrency(sub.mi_parte != null ? sub.mi_parte : sub.importe)}`}
                            >
                              {sub.nombre}
                            </span>
                          ))}
                          {daySubs.length > 2 && (
                            <span className="text-[10px] font-semibold text-ink-soft leading-tight">
                              +{daySubs.length - 2} más
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </Card>

        {/* Right 1/3 - Selected Day Details & Agenda (en móvil va debajo de la rejilla) */}
        <div className="space-y-6 flex flex-col lg:col-span-1">
          
          {/* Tarjeta del día (si no hay día seleccionado, no se muestra) */}
          {selectedDay !== null && (
            <Card className="!p-4 sm:!p-5">
              <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3">
                <Calendar className="w-4 h-4 text-brand-ink shrink-0" />
                <span className="first-letter:uppercase">{selectedDayTitle}</span>
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
                <p className="flex items-center gap-2 text-xs text-ink-soft">
                  <Info className="h-4 w-4 shrink-0 text-ink-faint" />
                  No hay cargos programados para este día
                </p>
              )}
            </Card>
          )}

          {/* Agenda mensual - Sin altura máxima ni scroll interno */}
          <Card className="!p-4 sm:!p-5 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3">
                <Clock className="w-4 h-4 text-brand-ink shrink-0" />
                <span>Agenda mensual</span>
              </h3>

              <div className="space-y-2">
                {sortedAgenda.length > 0 ? (
                  sortedAgenda.map(({ sub, chargeDate }) => {
                    const chargeDayNum = chargeDate.getDate();
                    const weekdayShort = WEEKDAYS_SHORT[chargeDate.getDay()];
                    const dayLabel = `${weekdayShort} ${chargeDayNum}`;
                    const isSelectedInAgenda = selectedDay === chargeDayNum;
                    const isPast = isCurrentMonth && chargeDayNum < today.getDate();

                    return (
                      <button 
                        key={sub.id}
                        type="button"
                        onClick={() => setSelectedDay(chargeDayNum)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition-colors ${
                          isSelectedInAgenda
                            ? 'border-brand bg-brand-tint' 
                            : 'border-transparent hover:bg-surface-2'
                        } ${isPast ? 'opacity-60 hover:opacity-100' : ''}`}
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-brand-ink bg-brand-tint px-2 py-0.5 rounded-lg tabular-nums shrink-0">
                            {dayLabel}
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
                      </button>
                    );
                  })
                ) : (
                  <div className="dashboard-empty p-6">
                    <AlertCircle className="w-5 h-5 text-ink-faint mb-1" />
                    <p className="dashboard-heading">Agenda vacía</p>
                    <p className="text-[11px] text-ink-soft">No hay suscripciones activas registradas</p>
                  </div>
                )}
              </div>
            </div>

            {/* Pie de agenda con "Total del mes" y "Queda por pagar" */}
            {sortedAgenda.length > 0 && (
              <div className="mt-4 pt-3.5 border-t border-line space-y-2 shrink-0">
                {isCurrentMonth && (
                  <div className="flex justify-between items-center text-xs font-semibold text-ink-soft">
                    <span>Queda por pagar</span>
                    <span className="font-bold text-ink tabular-nums">
                      {formatCurrency(quedaPorCobrar)}
                    </span>
                  </div>
                )}
                <div className="flex justify-between items-center text-xs font-bold text-ink-soft">
                  <span className="flex items-center gap-1 text-ink">
                    <Sparkles className="w-3.5 h-3.5 text-brand-ink shrink-0" />
                    Total del mes
                  </span>
                  <span className="font-extrabold text-ink tabular-nums text-sm">
                    {formatCurrency(totalMes)}
                  </span>
                </div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};

