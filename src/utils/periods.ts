import type { Movimiento } from '../types';
import { isPayrollMovement } from './payroll';
import { parseMovimientoDate } from './periodStats';

export type InicioPeriodo = number | 'nomina';
export interface Period { start: Date; end: Date }
export interface PeriodConfig { inicioPeriodo: InicioPeriodo; nominas: readonly Date[] }

const localDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
const shortMonth = (date: Date) => ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'][date.getMonth()];
const naturalPeriod = (date: Date): Period => ({
  start: new Date(date.getFullYear(), date.getMonth(), 1),
  end: new Date(date.getFullYear(), date.getMonth() + 1, 1),
});
// Clamp the day rather than letting 31 January overflow into March.
const nextMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth() + 1,
  Math.min(date.getDate(), new Date(date.getFullYear(), date.getMonth() + 2, 0).getDate()));

export function payrollDates(movimientos: readonly Movimiento[]): Date[] {
  return [...new Set(movimientos.filter(isPayrollMovement).flatMap(m => {
    const date = parseMovimientoDate(m.fecha_operacion);
    return date ? [localDay(date).getTime()] : [];
  }))].sort((a, b) => a - b).map(time => new Date(time));
}

export function periodOf(date: Date, inicioPeriodo: InicioPeriodo = 1, nominas: readonly Date[] = []): Period {
  if (inicioPeriodo === 'nomina') {
    const dates = [...new Set(nominas.map(d => localDay(d).getTime()))].sort((a, b) => a - b);
    const index = dates.findLastIndex(time => time <= date.getTime());
    if (index < 0) return naturalPeriod(date);
    const start = new Date(dates[index]);
    return { start, end: dates[index + 1] === undefined ? nextMonth(start) : new Date(dates[index + 1]) };
  }
  const day = Number.isInteger(inicioPeriodo) && inicioPeriodo >= 1 && inicioPeriodo <= 28 ? inicioPeriodo : 1;
  const month = date.getMonth() - (date.getDate() < day ? 1 : 0);
  return { start: new Date(date.getFullYear(), month, day), end: new Date(date.getFullYear(), month + 1, day) };
}

export function previousPeriod(period: Period, inicioPeriodo: InicioPeriodo = 1, nominas: readonly Date[] = []): Period {
  return periodOf(new Date(period.start.getTime() - 1), inicioPeriodo, nominas);
}

export function periodName(period: Period): string {
  // Count calendar days, independent of daylight saving changes. Ties use the first month.
  const days = new Map<number, { date: Date; count: number }>();
  for (const date = localDay(period.start); date < period.end; date.setDate(date.getDate() + 1)) {
    const key = date.getFullYear() * 12 + date.getMonth();
    const entry = days.get(key) ?? { date: new Date(date), count: 0 };
    entry.count++;
    days.set(key, entry);
  }
  const majority = [...days.values()].sort((a, b) => b.count - a.count)[0]?.date ?? period.start;
  return shortMonth(majority);
}

export function periodRangeLabel(period: Period): string {
  const last = localDay(period.end);
  last.setDate(last.getDate() - 1);
  const label = (date: Date) => `${date.getDate()} ${shortMonth(date)}`;
  return `${label(period.start)} – ${label(last)}`;
}
