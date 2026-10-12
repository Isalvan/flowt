import React, { useState } from 'react';
import { type Hucha, type Movimiento, type Suscripcion } from '../../types';
import { buildCalendarMonth, type CalendarMonth } from '../../utils/calendarMonth';
import { importeEnEstadisticas } from '../../utils/movements';
import { parseMovimientoDate } from '../../utils/periodStats';
import { detectPayroll } from '../../utils/payroll';
import { Card } from '../common/Card';
import { Calendar, ChevronLeft, ChevronRight, Clock, Info, AlertCircle } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';

interface CalendarioViewProps {
  suscripciones: Suscripcion[];
  movimientos: Movimiento[];
  huchas: Hucha[];
  loadOlderMovements?: () => Promise<void> | void;
}

const WEEKDAYS_SHORT = ['dom', 'lun', 'mar', 'mié', 'jue', 'vie', 'sáb'] as const;
const DAYS_OF_WEEK = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'] as const;
const SPENDING_BACKGROUNDS = ['', 'bg-brand/[0.06]', 'bg-brand/[0.12]', 'bg-brand/[0.2]', 'bg-brand/[0.3]'] as const;

const getDefaultSelectedDay = (calendar: CalendarMonth): number | null =>
  calendar.days.find(day => day.isToday)?.day ??
  calendar.days.find(day => day.movements.length || day.upcoming.length || day.expectedPayroll)?.day ?? null;

export const CalendarioView: React.FC<CalendarioViewProps> = ({ suscripciones, movimientos, huchas, loadOlderMovements }) => {
  const [currentDate, setCurrentDate] = useState(() => new Date());
  const [selectedDay, setSelectedDay] = useState<number | null>(() => new Date().getDate());
  const { isLocked, formatCurrency } = usePrivacy();
  const { categoryLabel } = useCategories();

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();
  const today = new Date();
  const calendar = buildCalendarMonth(movimientos, suscripciones, year, month, today);
  const payroll = detectPayroll(movimientos, today);
  const monthName = currentDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
  const monthOnlyName = currentDate.toLocaleDateString('es-ES', { month: 'long' });
  const isFutureMonth = new Date(year, month, 1) > today;
  const rawStartDay = new Date(year, month, 1).getDay();
  const startDayOffset = rawStartDay === 0 ? 6 : rawStartDay - 1;
  const cells = [...Array.from({ length: startDayOffset }, () => null), ...calendar.days];
  const sortedAgenda = calendar.days.flatMap(day => day.upcoming.map(sub => ({ sub, day })));
  const totalCargos = sortedAgenda.length;
  const effectiveSelectedDay = selectedDay ?? getDefaultSelectedDay(calendar);
  const selected = effectiveSelectedDay !== null ? calendar.days[effectiveSelectedDay - 1] : null;
  const selectedDayTitle = selected?.date.toLocaleDateString('es-ES', { day: 'numeric', month: 'long' });
  const hasMovements = calendar.days.some(day => day.movements.length > 0);
  const hasExpectedPayroll = calendar.days.some(day => day.expectedPayroll);
  const subtitleParts = [];
  if (!isFutureMonth && calendar.spent > 0) subtitleParts.push(`Gastado ${formatCurrency(calendar.spent)}`);
  if (totalCargos > 0 || hasMovements) subtitleParts.push(`${totalCargos} ${totalCargos === 1 ? 'cargo' : 'cargos'} por venir`);

  const navigateMonth = (offset: number) => {
    const date = new Date(year, month + offset, 1);
    setCurrentDate(date);
    setSelectedDay(getDefaultSelectedDay(buildCalendarMonth(movimientos, suscripciones, date.getFullYear(), date.getMonth(), today)));
    const oldestMonth = movimientos.reduce((oldest, movement) => {
      const movementDate = parseMovimientoDate(movement.fecha_operacion);
      return movementDate ? Math.min(oldest, movementDate.getFullYear() * 12 + movementDate.getMonth()) : oldest;
    }, Infinity);
    const historyBoundary = Number.isFinite(oldestMonth) ? oldestMonth : today.getFullYear() * 12 + today.getMonth();
    if (date.getFullYear() * 12 + date.getMonth() < historyBoundary) {
      void loadOlderMovements?.();
    }
  };

  return (
    <div className="space-y-6 sm:space-y-8 animate-in fade-in duration-500">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">Calendario</h2>
          <p className="dashboard-subtitle">{subtitleParts.join(' · ') || 'Sin movimientos este mes'}</p>
        </div>

        <div className="flex w-full sm:w-auto items-center justify-between gap-1 rounded-2xl border border-line bg-surface-2 p-1">
          <button type="button" onClick={() => navigateMonth(-1)} className="dashboard-icon-button" aria-label="Mes anterior">
            <ChevronLeft className="w-4 h-4" />
          </button>
          <span className="text-xs font-bold text-ink px-3 py-1 text-center flex-1 sm:flex-initial sm:min-w-[140px] first-letter:uppercase">{monthName}</span>
          <button type="button" onClick={() => navigateMonth(1)} className="dashboard-icon-button" aria-label="Mes siguiente">
            <ChevronRight className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="!p-3 sm:!p-5 lg:col-span-2">
          <div className="grid grid-cols-7 gap-1 sm:gap-2 mb-2 sm:mb-3 text-center text-[10px] sm:text-[11px] font-bold text-ink-soft bg-surface-2 py-1.5 sm:py-2 rounded-xl">
            {DAYS_OF_WEEK.map(day => <span key={day} className="py-0.5">{day}</span>)}
          </div>

          <div className="grid grid-cols-7 gap-1 sm:gap-2">
            {cells.map((day, idx) => {
              if (day === null) {
                return <div key={`empty-${idx}`} aria-hidden="true"
                  className="aspect-square sm:aspect-auto sm:min-h-[76px] lg:min-h-[92px] rounded-xl sm:rounded-2xl border border-transparent bg-transparent pointer-events-none" />;
              }
              const isSelected = effectiveSelectedDay === day.day;
              const hasSubs = day.upcoming.length > 0;
              const ariaParts = [];
              if (day.spent > 0) ariaParts.push(`gastado ${formatCurrency(day.spent)}`);
              if (day.income > 0) ariaParts.push(`ingresado ${formatCurrency(day.income)}`);
              if (hasSubs) ariaParts.push(`${day.upcoming.length} ${day.upcoming.length === 1 ? 'cargo previsto' : 'cargos previstos'}`);
              if (day.expectedPayroll) ariaParts.push('nómina prevista');
              const cellAriaLabel = `${day.day} de ${monthOnlyName}, ${ariaParts.join(', ') || 'sin movimientos'}`.replace(/\u00a0/g, ' ');
              const background = !isLocked && day.level > 0 ? SPENDING_BACKGROUNDS[day.level] : '';

              return (
                <button key={`day-${day.day}`} type="button" onClick={() => setSelectedDay(day.day)}
                  aria-pressed={isSelected} aria-label={cellAriaLabel}
                  className={`
                    aspect-square sm:aspect-auto sm:min-h-[76px] lg:min-h-[92px]
                    p-1 sm:p-2 rounded-xl sm:rounded-2xl border flex flex-col transition-colors
                    focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-1
                    ${isSelected
                      ? 'border-brand bg-brand-tint ring-2 ring-brand/40 shadow-sm'
                      : day.isToday
                        ? `border-emerald-500/40 dark:border-emerald-500/30 ${background || 'bg-emerald-500/5 dark:bg-emerald-500/10'} hover:bg-emerald-500/10`
                        : `border-line ${background || 'bg-surface'} hover:bg-surface-2 hover:border-line-strong`
                    }
                  `}>
                  <div className="flex sm:hidden flex-col items-center justify-between h-full w-full py-0.5">
                    <span className={`w-5 h-5 rounded-full flex items-center justify-center text-[11px] tabular-nums transition-colors ${
                      day.isToday ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold'
                        : isSelected ? 'text-brand-ink font-extrabold' : 'text-ink font-semibold'
                    }`}>{day.day}</span>
                    {(hasSubs || day.income > 0) && (
                      <div className="flex items-center justify-center gap-0.5 max-w-full">
                        {day.income > 0 && <span className="w-1.5 h-1.5 rounded-full shrink-0 bg-emerald-500" />}
                        {day.upcoming.slice(0, day.income > 0 ? 2 : 3).map(sub => <span key={sub.id} className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: sub.color }} />)}
                        {day.upcoming.length + Number(day.income > 0) > 3 && <span className="text-[8px] font-extrabold text-ink-soft leading-none">+{day.upcoming.length + Number(day.income > 0) - 3}</span>}
                      </div>
                    )}
                  </div>

                  <div className="hidden sm:flex flex-col justify-between h-full w-full">
                    <div className="flex items-center justify-between w-full">
                      <span className={`w-6 h-6 rounded-full flex items-center justify-center text-xs tabular-nums transition-colors ${
                        day.isToday ? 'bg-emerald-600 text-white dark:bg-emerald-500 dark:text-slate-950 font-bold'
                          : isSelected ? 'text-brand-ink font-extrabold' : 'text-ink font-semibold'
                      }`}>{day.day}</span>
                      {day.income > 0 ? <span className="h-2 w-2 rounded-full bg-emerald-500" />
                        : day.expectedPayroll && <span className="h-2 w-2 rounded-full border border-emerald-500 bg-transparent" />}
                    </div>
                    <div className="flex flex-col gap-1 mt-auto w-full text-left">
                      {day.spent > 0 && !isLocked && <span className="text-[11px] font-bold tabular-nums text-ink">−{day.spent.toLocaleString('es-ES', { maximumFractionDigits: 0 })} €</span>}
                      {hasSubs && (
                        <>
                          <div className="flex flex-wrap gap-1">
                            {day.upcoming.map(sub => <span key={sub.id} className="w-2 h-2 rounded-full shrink-0 border border-line" style={{ backgroundColor: sub.color }}
                              title={`${sub.nombre}: ${formatCurrency(sub.mi_parte ?? sub.importe)}`} />)}
                          </div>
                          <div className="hidden lg:flex flex-col gap-0.5 mt-0.5 w-full">
                            {day.upcoming.slice(0, 2).map(sub => <span key={sub.id} className="truncate text-[10px] font-medium text-ink leading-tight block w-full"
                              title={`${sub.nombre}: ${formatCurrency(sub.mi_parte ?? sub.importe)}`}>{sub.nombre}</span>)}
                            {day.upcoming.length > 2 && <span className="text-[10px] font-semibold text-ink-soft leading-tight">+{day.upcoming.length - 2} más</span>}
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>

          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px] text-ink-soft">
            <span className="flex items-center gap-1">
              Menos
              {SPENDING_BACKGROUNDS.slice(1).map(background => <span key={background} className={`h-3 w-3 rounded ${isLocked ? 'bg-surface-2' : background}`} />)}
              Más gasto
            </span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-emerald-500" />Ingreso</span>
            {hasExpectedPayroll && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full border border-emerald-500 bg-transparent" />Nómina prevista</span>}
            {totalCargos > 0 && <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-full bg-ink-faint" />Cargo previsto</span>}
          </div>
        </Card>

        <div className="space-y-6 flex flex-col lg:col-span-1">
          {selected && (
            <Card className="!p-4 sm:!p-5">
              <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3">
                <Calendar className="w-4 h-4 text-brand-ink shrink-0" /><span className="first-letter:uppercase">{selectedDayTitle}</span>
              </h3>
              {selected.movements.length > 0 && (
                <>
                  <p className="mb-3 text-xs text-ink-soft">Gastado {formatCurrency(selected.spent)}{selected.income > 0 && ` · Ingresado ${formatCurrency(selected.income)}`}</p>
                  <div className="divide-y divide-line">
                    {selected.movements.map(movement => {
                      const wallet = huchas.find(hucha => hucha.id === movement.hucha_id)?.nombre;
                      const detail = [movement.categoria ? categoryLabel(movement.categoria) : null, wallet].filter(Boolean).join(' · ');
                      return (
                        <div key={movement.id} className="flex items-center justify-between gap-3 py-2.5">
                          <div className="min-w-0">
                            <p className="truncate text-xs font-bold text-ink">{movement.concepto}</p>
                            {detail && <p className="text-[11px] text-ink-soft">{detail}</p>}
                          </div>
                          <span className={`text-xs font-extrabold tabular-nums shrink-0 ${movement.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-ink'}`}>
                            {movement.tipo === 'ingreso' ? '+' : '−'}{formatCurrency(importeEnEstadisticas(movement))}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}
              {selected.upcoming.length > 0 && (
                <>
                  <p className="dashboard-label mt-4 mb-2">Previsto</p>
                  <div className="space-y-3">
                    {selected.upcoming.map(sub => (
                      <div key={sub.id} className="p-3 rounded-2xl bg-surface-2 flex items-center justify-between">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-1.5">
                            <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-line" style={{ backgroundColor: sub.color }} />
                            <h4 className="truncate text-xs font-bold text-ink">{sub.nombre}</h4>
                          </div>
                          <span className="inline-block text-[11px] font-semibold text-brand-ink mt-1 bg-brand-tint px-2 py-0.5 rounded-lg">{sub.categoria}</span>
                        </div>
                        <div className="text-right shrink-0 ml-3">
                          <span className="text-xs font-extrabold text-ink tabular-nums">{formatCurrency(sub.mi_parte ?? sub.importe)}</span>
                          <p className="text-[11px] text-ink-soft font-semibold mt-0.5">{sub.frecuencia}</p>
                        </div>
                      </div>
                    ))}
                  </div>
                </>
              )}
              {selected.expectedPayroll && payroll && (
                <div className="flex items-center justify-between gap-3 py-2.5 text-xs">
                  <span className="font-bold text-ink">Nómina prevista</span>
                  <span className="font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">+{formatCurrency(payroll.importe)}</span>
                </div>
              )}
              {!selected.movements.length && !selected.upcoming.length && !selected.expectedPayroll && (
                <p className="flex items-center gap-2 text-xs text-ink-soft"><Info className="h-4 w-4 shrink-0 text-ink-faint" />Sin movimientos este día</p>
              )}
            </Card>
          )}

          <Card className="!p-4 sm:!p-5 flex-1 flex flex-col justify-between">
            <div>
              <h3 className="dashboard-heading mb-4 flex items-center gap-2 border-b border-line pb-3"><Clock className="w-4 h-4 text-brand-ink shrink-0" /><span>El mes</span></h3>
              {hasMovements || totalCargos > 0 ? (
                <div className="divide-y divide-line">
                  <div className="flex items-center justify-between py-2.5 text-xs"><span>Gastado</span><span className="font-bold text-ink tabular-nums">{formatCurrency(calendar.spent)}</span></div>
                  <div className="flex items-center justify-between py-2.5 text-xs"><span>Ingresado</span><span className="font-bold text-ink tabular-nums">{formatCurrency(calendar.income)}</span></div>
                  {calendar.dailyAverage !== null && <div className="flex items-center justify-between py-2.5 text-xs"><span>Media por día</span><span className="font-bold text-ink tabular-nums">{formatCurrency(calendar.dailyAverage)}</span></div>}
                  {calendar.costliest && (
                    <button type="button" onClick={() => setSelectedDay(calendar.costliest!.day)} className="flex w-full items-center justify-between py-2.5 text-xs">
                      <span>Día más caro</span><span className="font-bold text-ink tabular-nums">{WEEKDAYS_SHORT[calendar.costliest.date.getDay()]} {calendar.costliest.day} · {formatCurrency(calendar.costliest.spent)}</span>
                    </button>
                  )}
                </div>
              ) : (
                <div className="dashboard-empty p-6"><AlertCircle className="w-5 h-5 text-ink-faint mb-1" /><p className="dashboard-heading">Nada en este mes</p></div>
              )}
              {totalCargos > 0 && (
                <>
                  <p className="dashboard-label mt-4 mb-2">Por venir</p>
                  <div className="space-y-2">
                    {sortedAgenda.map(({ sub, day }) => (
                      <button key={sub.id} type="button" onClick={() => setSelectedDay(day.day)}
                        className={`w-full flex items-center justify-between p-2.5 rounded-2xl border text-left transition-colors ${effectiveSelectedDay === day.day ? 'border-brand bg-brand-tint' : 'border-transparent hover:bg-surface-2'}`}>
                        <div className="flex items-center gap-2 min-w-0">
                          <span className="text-[11px] font-bold text-brand-ink bg-brand-tint px-2 py-0.5 rounded-lg tabular-nums shrink-0">{WEEKDAYS_SHORT[day.date.getDay()]} {day.day}</span>
                          <span className="w-2.5 h-2.5 rounded-full shrink-0 border border-line" style={{ backgroundColor: sub.color }} />
                          <span className="text-xs font-semibold text-ink truncate">{sub.nombre}</span>
                        </div>
                        <span className="text-xs font-bold text-ink tabular-nums shrink-0 ml-3">{formatCurrency(sub.mi_parte ?? sub.importe)}</span>
                      </button>
                    ))}
                  </div>
                </>
              )}
            </div>
            {totalCargos > 0 && (
              <div className="mt-4 pt-3.5 border-t border-line shrink-0">
                <div className="flex justify-between items-center text-xs font-semibold text-ink-soft"><span>Queda por pagar</span><span className="font-bold text-ink tabular-nums">{formatCurrency(calendar.upcomingTotal)}</span></div>
              </div>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
};
