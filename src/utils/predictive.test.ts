import { describe, expect, it } from 'vitest';
import type { Movimiento, Suscripcion } from '../types';
import { calculateProjectionEstimates } from './predictive';

const now = new Date(2026, 2, 31);
const movement = (id: string, tipo: Movimiento['tipo'], importe: number, fecha_operacion: unknown): Movimiento => ({ id, tipo, importe, fecha_operacion, concepto: id });
const subscription: Suscripcion = { id: 'sub', nombre: 'Netflix', importe: 15, frecuencia: 'mensual', dia_pago: 10, categoria: 'streaming', color: '#000', activa: true };

describe('calculateProjectionEstimates', () => {
  it('returns no projection without representative history', () => {
    expect(calculateProjectionEstimates([], [], now)).toBeNull();
    expect(calculateProjectionEstimates([movement('income', 'ingreso', 100, new Date(2026, 2, 1))], [], now)).toBeNull();
    expect(calculateProjectionEstimates([movement('bad', 'gasto', 10, 'invalid'), movement('empty', 'ingreso', 20, null)], [], now)).toBeNull();
  });

  it('uses real dates and variable expenses', () => {
    const estimates = calculateProjectionEstimates([movement('income', 'ingreso', 1000, { toDate: () => new Date(2026, 0, 1) }), movement('expense', 'gasto', 200, '2026-02-15')], [], now);
    expect(estimates?.observedDays).toBe(45);
    expect(estimates?.monthlyIncome).toBeCloseTo(675.55, 1);
    expect(estimates?.dailyVariable).toBeCloseTo(4.44, 1);
  });

  it('allows zero variable spending when all expenses are subscriptions', () => {
    const estimates = calculateProjectionEstimates([movement('income', 'ingreso', 1000, new Date(2026, 0, 1)), movement('Netflix', 'gasto', 15, '2026-02-15')], [subscription], now);
    expect(estimates?.dailyVariable).toBe(0);
  });
});
