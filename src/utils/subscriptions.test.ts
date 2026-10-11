import { describe, expect, it } from 'vitest';
import type { Suscripcion } from '../types';
import { calcAnual } from './subscriptions';

const subscription: Suscripcion = {
  id: 'sub', nombre: 'Servicio', importe: 10, frecuencia: 'mensual',
  dia_pago: 1, categoria: 'otros', color: '#000000', activa: true,
};

describe('calcAnual', () => {
  it.each([
    ['mensual', 120],
    ['trimestral', 40],
    ['semestral', 20],
    ['anual', 10],
  ] as const)('anualiza el coste %s', (frecuencia, expected) => {
    expect(calcAnual({ ...subscription, frecuencia })).toBe(expected);
  });

  it.each([
    ['mensual', 48],
    ['trimestral', 16],
    ['semestral', 8],
    ['anual', 4],
  ] as const)('usa mi_parte para el coste %s', (frecuencia, expected) => {
    expect(calcAnual({ ...subscription, frecuencia, mi_parte: 4 })).toBe(expected);
  });

  it('respeta una parte de cero y redondea a céntimos', () => {
    expect(calcAnual({ ...subscription, mi_parte: 0 })).toBe(0);
    expect(calcAnual({ ...subscription, importe: 1.234 })).toBe(14.81);
    expect(calcAnual({ ...subscription, mi_parte: null })).toBe(120);
  });
});
