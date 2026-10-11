import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { detectPayroll, formatWorkTime, hourlyRate } from './payroll';

const now = new Date(2026, 9, 11, 12);
const income = (extra: Partial<Movimiento> = {}): Movimiento => ({
  id: 'payroll', tipo: 'ingreso', concepto: 'Abono empresa', categoria: 'nomina',
  importe: 2000, fecha_operacion: new Date(2026, 8, 28), ...extra,
});

describe('detectPayroll', () => {
  it('uses the latest payroll category and its statistical amount without mutating the input', () => {
    const latest = income({ compensaciones_destinos: [{ gasto_id: 'expense', importe: 100 }] });
    const movements = [income({ importe: 1500, fecha_operacion: new Date(2026, 7, 28) }), latest];
    expect(detectPayroll(movements, now)).toEqual({ importe: 1900, fecha: latest.fecha_operacion, diaHabitual: 28 });
    expect(movements[1]).toBe(latest);
  });

  it.each(['NÓMINA de septiembre', 'SALARIO mensual', 'Ingreso sueldo'])('matches %s only without a category', concepto => {
    expect(detectPayroll([income({ concepto, categoria: undefined })], now)?.importe).toBe(2000);
    expect(detectPayroll([income({ concepto, categoria: 'otros_ingresos' })], now)).toBeNull();
  });

  it('ignores expenses, internal transfers and fully compensated income', () => {
    expect(detectPayroll([
      income({ tipo: 'gasto' }), income({ es_interno: true }), income({ transfer_id: 'transfer' }),
      income({ compensa_movimiento_id: 'expense' }),
      income({ compensaciones_destinos: [{ gasto_id: 'expense', importe: 2000 }] }),
    ], now)).toBeNull();
  });

  it('includes the 190-day boundary and excludes older, future and invalid dates', () => {
    const boundary = new Date(now.getTime() - 190 * 86_400_000);
    expect(detectPayroll([income({ fecha_operacion: boundary })], now)?.fecha).toEqual(boundary);
    expect(detectPayroll([
      income({ fecha_operacion: new Date(boundary.getTime() - 1) }),
      income({ fecha_operacion: new Date(now.getTime() + 1) }),
      income({ fecha_operacion: 'invalid' }),
    ], now)).toBeNull();
  });

  it('uses the median of at most the six latest payroll days, averaging an even middle pair', () => {
    const movements = [1, 20, 22, 24, 26, 28, 30].map((day, i) => income({ fecha_operacion: new Date(2026, 8, day), importe: i }));
    expect(detectPayroll(movements, now)?.diaHabitual).toBe(25);
    expect(detectPayroll(movements.slice(1, 4), now)?.diaHabitual).toBe(22);
  });

  it('parses Firestore timestamps and strings and returns null without candidates', () => {
    const fecha = new Date(2026, 8, 28);
    expect(detectPayroll([income({ fecha_operacion: { toDate: () => fecha } })], now)?.fecha).toEqual(fecha);
    expect(detectPayroll([income({ fecha_operacion: fecha.toISOString() })], now)?.fecha).toEqual(fecha);
    expect(detectPayroll([], now)).toBeNull();
  });
});

describe('hourlyRate', () => {
  const payroll = { importe: 2000, fecha: now, diaHabitual: 28 };
  it('converts monthly payroll to an hourly rate with 52 weeks per year', () => {
    expect(hourlyRate(payroll, 40)).toBeCloseTo(2000 / (40 * 52 / 12));
  });
  it('returns null for missing payroll or missing, nonpositive or nonfinite hours', () => {
    expect(hourlyRate(null, 40)).toBeNull();
    expect(hourlyRate(undefined, 40)).toBeNull();
    for (const hours of [null, undefined, 0, -1, NaN, Infinity]) expect(hourlyRate(payroll, hours)).toBeNull();
  });
});

describe('formatWorkTime', () => {
  it('escribe minutos, horas con minutos y horas redondas', () => {
    expect(formatWorkTime(0.75)).toBe('45 min');
    expect(formatWorkTime(4 + 20 / 60)).toBe('4 h 20 min');
    expect(formatWorkTime(3)).toBe('3 h');
    expect(formatWorkTime(120.4)).toBe('120 h');
  });
});
