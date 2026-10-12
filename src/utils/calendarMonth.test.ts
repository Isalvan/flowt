import { describe, expect, it } from 'vitest';
import type { Movimiento, Suscripcion } from '../types';
import { buildCalendarMonth } from './calendarMonth';

const now = new Date(2026, 9, 12, 12);
const movement = (id: string, day: number, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id, tipo: 'gasto', concepto: id, importe, fecha_operacion: new Date(2026, 9, day, 10), ...extra,
});
const subscription = (id: string, day: number, extra: Partial<Suscripcion> = {}): Suscripcion => ({
  id, nombre: id, importe: 10, frecuencia: 'mensual', dia_pago: day, categoria: 'Ocio',
  color: '#123456', activa: true, fecha_inicio: '2026-01-01', ...extra,
});
const payroll = (day = 28): Movimiento => movement('payroll', day, 2150, {
  tipo: 'ingreso', categoria: 'nomina', fecha_operacion: new Date(2026, 8, day),
});

describe('buildCalendarMonth', () => {
  it('groups local dates, strings and timestamps and sorts each day newest first', () => {
    const date = new Date(2026, 9, 4, 0, 15);
    const first = movement('first', 4, 0.1, { fecha_operacion: date.toISOString() });
    const latest = movement('latest', 4, 0.2, { fecha_operacion: { toDate: () => new Date(2026, 9, 4, 23, 59) } });
    const input = [first, latest, movement('invalid', 4, 90, { fecha_operacion: 'invalid' }),
      movement('other-month', 4, 90, { fecha_operacion: new Date(2026, 8, 4) }),
      movement('other-year', 4, 90, { fecha_operacion: new Date(2025, 9, 4) })];
    const calendar = buildCalendarMonth(input, [], 2026, 9, now);
    expect(calendar.days).toHaveLength(31);
    expect(calendar.days[3].movements).toEqual([latest, first]);
    expect(calendar.days[3].date).toEqual(new Date(2026, 9, 4));
    expect(calendar.spent).toBe(0.3);
    expect(input[0]).toBe(first);
    expect(calendar.days[11]).toMatchObject({ isToday: true, isFuture: false });
    expect(calendar.days[12]).toMatchObject({ isToday: false, isFuture: true });
  });

  it('excludes internal transfers and compensated income and discounts partial compensation', () => {
    const expense = movement('expense', 4, 100, { compensado_por_detalles: [{ ingreso_id: 'refund', importe: 25.15 }] });
    const income = movement('income', 4, 50, { tipo: 'ingreso', compensaciones_destinos: [{ gasto_id: 'expense', importe: 10.1 }] });
    const calendar = buildCalendarMonth([
      expense, income, movement('net', 4, 30, { importe_neto: 12.5 }),
      movement('internal', 4, 1000, { es_interno: true }),
      movement('transfer', 4, 1000, { transfer_id: 'transfer' }),
      movement('refund', 4, 25.15, { tipo: 'ingreso', compensa_movimiento_id: 'expense' }),
      movement('full-refund', 4, 10, { tipo: 'ingreso', compensaciones_destinos: [{ gasto_id: 'expense', importe: 10 }] }),
    ], [], 2026, 9, now);
    expect(calendar.spent).toBe(87.35);
    expect(calendar.income).toBe(39.9);
    expect(calendar.days[3].movements.map(m => m.id)).toEqual(['expense', 'income', 'net']);
  });

  it('spreads the intensity by rank among the days with spending, so one huge day does not flatten the rest', () => {
    const amounts = [0, 25, 25.01, 50, 50.01, 75, 75.01, 100];
    const calendar = buildCalendarMonth(amounts.map((amount, i) => movement(String(i), i + 1, amount)), [], 2026, 9, now);
    expect(calendar.days.slice(0, 8).map(day => day.level)).toEqual([0, 1, 2, 2, 3, 3, 4, 4]);
    const skewed = buildCalendarMonth([5, 10, 20, 900].map((amount, i) => movement(String(i), i + 1, amount)), [], 2026, 9, now);
    expect(skewed.days.slice(0, 4).map(day => day.level)).toEqual([1, 2, 3, 4]);
    expect(calendar.costliest).toBe(calendar.days[7]);
  });

  it('keeps only active charges from today and avoids an already charged subscription today', () => {
    const todaySub = subscription('today', 12, { mi_parte: 0.1 });
    const futureSub = subscription('future', 20, { importe: 0.2 });
    const subs = [subscription('past', 11), subscription('paid', 12), todaySub, futureSub,
      subscription('inactive', 20, { activa: false }),
      subscription('annual', 20, { frecuencia: 'anual' })];
    const calendar = buildCalendarMonth([movement('charged', 12, 10, { suscripcion_id: 'paid' })], subs, 2026, 9, now);
    expect(calendar.days[10].upcoming).toEqual([]);
    expect(calendar.days[11].upcoming).toEqual([todaySub]);
    expect(calendar.days[19].upcoming).toEqual([futureSub]);
    expect(calendar.upcomingTotal).toBe(0.3);
    expect(buildCalendarMonth([], subs, 2026, 8, now).upcomingTotal).toBe(0);
    expect(buildCalendarMonth([], [todaySub, futureSub], 2026, 10, now).upcomingTotal).toBe(0.3);
  });

  it('does not suppress today because of a charge recorded on a different day', () => {
    const sub = subscription('sub', 12);
    expect(buildCalendarMonth([movement('yesterday', 11, 10, { suscripcion_id: sub.id })], [sub], 2026, 9, now).days[11].upcoming).toEqual([sub]);
  });

  it('uses the supplied date for subscriptions without an anchor', () => {
    expect(buildCalendarMonth([], [subscription('legacy', 12, { fecha_inicio: undefined })], 2026, 9, now).days[11].upcoming).toHaveLength(1);
  });

  it('predicts future payroll only while that month has no payroll', () => {
    expect(buildCalendarMonth([payroll()], [], 2026, 9, now).days[27].expectedPayroll).toBe(true);
    const received = movement('received', 1, 2150, { tipo: 'ingreso', categoria: 'nomina' });
    expect(buildCalendarMonth([payroll(), received], [], 2026, 9, now).days.some(day => day.expectedPayroll)).toBe(false);
    expect(buildCalendarMonth([payroll(12)], [], 2026, 9, now).days.some(day => day.expectedPayroll)).toBe(false);
    expect(buildCalendarMonth([payroll(11)], [], 2026, 9, now).days.some(day => day.expectedPayroll)).toBe(false);
    expect(buildCalendarMonth([payroll()], [], 2026, 7, now).days.some(day => day.expectedPayroll)).toBe(false);
    expect(buildCalendarMonth([], [], 2026, 9, now).days.some(day => day.expectedPayroll)).toBe(false);
  });

  it('rounds median payday and clamps it to the last day of the displayed month', () => {
    const rounded = buildCalendarMonth([payroll(28), payroll(29)], [], 2026, 9, now);
    expect(rounded.days[28].expectedPayroll).toBe(true);
    const february = buildCalendarMonth([payroll(30)], [], 2027, 1, now);
    expect(february.days).toHaveLength(28);
    expect(february.days[27].expectedPayroll).toBe(true);
  });

  it('computes totals, the first costliest day in a tie and the average over elapsed days', () => {
    const calendar = buildCalendarMonth([
      movement('one', 4, 60), movement('two', 5, 60), movement('income', 12, 200, { tipo: 'ingreso' }),
    ], [], 2026, 9, now);
    expect(calendar.spent).toBe(120);
    expect(calendar.income).toBe(200);
    expect(calendar.costliest?.day).toBe(4);
    expect(calendar.dailyAverage).toBe(10);
  });

  it('uses the whole past month and no average for a future or unspent month', () => {
    const past = movement('past', 4, 60, { fecha_operacion: new Date(2026, 8, 4) });
    expect(buildCalendarMonth([past], [], 2026, 8, now).dailyAverage).toBe(2);
    const future = movement('future', 4, 60, { fecha_operacion: new Date(2026, 10, 4) });
    expect(buildCalendarMonth([future], [], 2026, 10, now).dailyAverage).toBeNull();
    expect(buildCalendarMonth([], [], 2026, 9, now)).toMatchObject({ spent: 0, income: 0, costliest: null, dailyAverage: null, upcomingTotal: 0 });
  });
});
