import type { Movimiento, Suscripcion } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { detectPayroll, isPayrollMovement } from './payroll';
import { parseMovimientoDate } from './periodStats';
import { getSubscriptionChargeForMonth } from './subscriptions';

export interface CalendarDay {
  day: number;
  date: Date;
  isToday: boolean;
  isFuture: boolean;
  spent: number;
  income: number;
  level: 0 | 1 | 2 | 3 | 4;
  movements: Movimiento[];
  upcoming: Suscripcion[];
  expectedPayroll: boolean;
}

export interface CalendarMonth {
  days: CalendarDay[];
  spent: number;
  income: number;
  costliest: CalendarDay | null;
  dailyAverage: number | null;
  upcomingTotal: number;
}

export function buildCalendarMonth(
  movimientos: readonly Movimiento[],
  suscripciones: readonly Suscripcion[],
  year: number,
  month: number,
  now = new Date(),
): CalendarMonth {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const days: CalendarDay[] = Array.from({ length: new Date(year, month + 1, 0).getDate() }, (_, i) => {
    const date = new Date(year, month, i + 1);
    return {
      day: i + 1, date, isToday: date.getTime() === today.getTime(), isFuture: date > today,
      spent: 0, income: 0, level: 0, movements: [], upcoming: [], expectedPayroll: false,
    };
  });
  const spentCents = days.map(() => 0);
  const incomeCents = days.map(() => 0);
  const chargedToday = new Set<string>();
  let hasPayroll = false;

  for (const movement of movimientos) {
    const date = parseMovimientoDate(movement.fecha_operacion);
    if (!date || date.getFullYear() !== year || date.getMonth() !== month) continue;
    const index = date.getDate() - 1;
    if (days[index].isToday && movement.suscripcion_id) chargedToday.add(movement.suscripcion_id);
    if (isPayrollMovement(movement)) hasPayroll = true;
    if (!cuentaEnEstadisticas(movement)) continue;
    const cents = Math.round(importeEnEstadisticas(movement) * 100);
    if (movement.tipo === 'gasto') spentCents[index] += cents;
    else incomeCents[index] += cents;
    days[index].movements.push(movement);
  }

  let upcomingCents = 0;
  for (const sub of suscripciones) {
    if (!sub.activa) continue;
    const charge = getSubscriptionChargeForMonth(sub, year, month, now);
    if (!charge || charge < today) continue;
    const day = days[charge.getDate() - 1];
    if (day.isToday && chargedToday.has(sub.id)) continue;
    day.upcoming.push(sub);
    upcomingCents += Math.round((sub.mi_parte ?? sub.importe) * 100);
  }

  const payroll = detectPayroll([...movimientos], now);
  if (payroll && !hasPayroll) {
    const day = days[Math.min(days.length, Math.max(1, Math.round(payroll.diaHabitual))) - 1];
    day.expectedPayroll = day.isFuture;
  }

  // By rank among the days with spending, not by share of the costliest one: a single rent day would leave every other day looking the same.
  const maxSpent = Math.max(...spentCents);
  const ranked = [...new Set(spentCents.filter(cents => cents > 0))].sort((a, b) => a - b);
  for (const [index, day] of days.entries()) {
    day.spent = spentCents[index] / 100;
    day.income = incomeCents[index] / 100;
    day.level = spentCents[index] === 0 ? 0
      : Math.ceil((ranked.indexOf(spentCents[index]) + 1) * 4 / ranked.length) as CalendarDay['level'];
    day.movements.sort((a, b) =>
      parseMovimientoDate(b.fecha_operacion)!.getTime() - parseMovimientoDate(a.fecha_operacion)!.getTime());
  }
  const spent = spentCents.reduce((sum, cents) => sum + cents, 0) / 100;
  const isFutureMonth = days[0].date > today;
  const elapsedDays = days.at(-1)!.date < today ? days.length : now.getDate();
  return {
    days, spent,
    income: incomeCents.reduce((sum, cents) => sum + cents, 0) / 100,
    costliest: maxSpent > 0 ? days[spentCents.indexOf(maxSpent)] : null,
    dailyAverage: !isFutureMonth && spent > 0 ? spent / elapsedDays : null,
    upcomingTotal: upcomingCents / 100,
  };
}
