import { describe, expect, it } from 'vitest';
import { payrollDates, periodOf, previousPeriod, periodName, periodRangeLabel } from './periods';
import type { Movimiento } from '../types';

const d = (year: number, month: number, day: number) => new Date(year, month - 1, day);
const nominas = [d(2026, 8, 28), d(2026, 9, 29), d(2026, 10, 28)];

describe('periods in local time', () => {
  it('uses natural months by default', () => {
    expect(periodOf(d(2026, 2, 12), 1, [])).toEqual({ start: d(2026, 2, 1), end: d(2026, 3, 1) });
  });
  it('uses a fixed day across February, year changes and exact boundaries', () => {
    expect(periodOf(d(2026, 2, 27), 28, [])).toEqual({ start: d(2026, 1, 28), end: d(2026, 2, 28) });
    expect(periodOf(d(2026, 2, 28), 28, [])).toEqual({ start: d(2026, 2, 28), end: d(2026, 3, 28) });
    expect(periodOf(d(2027, 1, 3), 28, [])).toEqual({ start: d(2026, 12, 28), end: d(2027, 1, 28) });
  });
  it('uses actual payroll boundaries and projects the latest end with clamping', () => {
    expect(periodOf(d(2026, 11, 2), 'nomina', nominas)).toEqual({ start: d(2026, 10, 28), end: d(2026, 11, 28) });
    expect(periodOf(d(2026, 9, 28), 'nomina', nominas)).toEqual({ start: d(2026, 8, 28), end: d(2026, 9, 29) });
    expect(periodOf(d(2026, 9, 29), 'nomina', nominas)).toEqual({ start: d(2026, 9, 29), end: d(2026, 10, 28) });
    expect(periodOf(d(2026, 2, 2), 'nomina', [d(2026, 1, 31)])).toEqual({ start: d(2026, 1, 31), end: d(2026, 2, 28) });
  });
  it('falls back to natural months without payroll or before the first one', () => {
    const date = d(2026, 7, 20);
    expect(periodOf(date, 'nomina', [])).toEqual(periodOf(date, 1, []));
    expect(periodOf(date, 'nomina', nominas)).toEqual(periodOf(date, 1, []));
  });
  it('finds previous natural, fixed and payroll periods', () => {
    expect(previousPeriod(periodOf(d(2027, 1, 5), 1), 1)).toEqual({ start: d(2026, 12, 1), end: d(2027, 1, 1) });
    expect(previousPeriod(periodOf(d(2026, 3, 3), 28), 28)).toEqual({ start: d(2026, 1, 28), end: d(2026, 2, 28) });
    expect(previousPeriod(periodOf(d(2026, 11, 2), 'nomina', nominas), 'nomina', nominas)).toEqual({ start: d(2026, 9, 29), end: d(2026, 10, 28) });
    expect(previousPeriod(periodOf(d(2026, 8, 30), 'nomina', nominas), 'nomina', nominas)).toEqual(periodOf(d(2026, 8, 27), 1));
  });
  it('names the majority month and labels the last included day', () => {
    const period = periodOf(d(2026, 10, 3), 28);
    expect(periodName(period)).toBe('oct');
    expect(periodRangeLabel(period)).toBe('28 sep – 27 oct');
    expect(periodName(periodOf(d(2026, 10, 3), 2))).toBe('oct');
    expect(periodRangeLabel(periodOf(d(2027, 1, 2), 28))).toBe('28 dic – 27 ene');
  });
  it('shares payroll recognition, skips invalid dates and transfers, sorts and deduplicates days', () => {
    const movement = (extra: Partial<Movimiento>): Movimiento => ({ id: 'x', tipo: 'ingreso', concepto: 'Nómina', importe: 100, fecha_operacion: d(2026, 9, 29), ...extra });
    expect(payrollDates([
      movement({ fecha_operacion: d(2026, 10, 28), categoria: 'nomina' }),
      movement({}), movement({}), movement({ tipo: 'gasto' }), movement({ es_interno: true }),
      movement({ fecha_operacion: 'invalid' }), movement({ categoria: 'otros' }),
    ])).toEqual([d(2026, 9, 29), d(2026, 10, 28)]);
  });
});
