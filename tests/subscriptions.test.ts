import { describe, expect, it } from 'vitest';
import type { Suscripcion } from '../src/types';
import {
  getMonthlySubscriptionAmount,
  getNextSubscriptionChargeDate,
  getSubscriptionChargeForMonth,
  isCancellationExpired,
} from '../src/utils/subscriptions';

const subscription = (overrides: Partial<Suscripcion> = {}): Suscripcion => ({
  id: 'sub-1',
  nombre: 'Servicio',
  importe: 120,
  frecuencia: 'anual',
  fecha_inicio: '2026-07-31',
  dia_pago: 31,
  categoria: 'otros',
  color: '#000000',
  activa: true,
  ...overrides,
});

describe('ciclos de suscripciones', () => {
  it('solo coloca una suscripción anual en el mes de su ciclo', () => {
    expect(getSubscriptionChargeForMonth(subscription(), 2026, 6)?.getDate()).toBe(31);
    expect(getSubscriptionChargeForMonth(subscription(), 2026, 7)).toBeNull();
    expect(getSubscriptionChargeForMonth(subscription(), 2027, 6)?.getDate()).toBe(31);
  });

  it('ajusta el día 31 al último día de un mes corto', () => {
    const monthly = subscription({ frecuencia: 'mensual', fecha_inicio: '2026-01-31' });
    expect(getSubscriptionChargeForMonth(monthly, 2026, 1)?.getDate()).toBe(28);
  });

  it('calcula el siguiente cobro respetando frecuencia y año', () => {
    const next = getNextSubscriptionChargeDate(subscription(), new Date(2026, 7, 1));
    expect(next).toEqual(new Date(2027, 6, 31));
  });

  it('mensualiza la parte real de una suscripción compartida', () => {
    expect(getMonthlySubscriptionAmount(subscription({ mi_parte: 60 }))).toBe(5);
  });

  it('vence una baja usando la fecha persistida', () => {
    const cancelling = subscription({ cancelando: true, cancel_at: '2026-08-15' });
    expect(isCancellationExpired(cancelling, new Date(2026, 7, 14))).toBe(false);
    expect(isCancellationExpired(cancelling, new Date(2026, 7, 15))).toBe(true);
  });
});
