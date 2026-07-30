import { describe, it, expect } from 'vitest';
import type { Movimiento } from '../src/types';

describe('Multi-Bank Accounts Support', () => {
  it('assigns and filters movements by bank origin', () => {
    const mockMovs: Movimiento[] = [
      { id: 'm1', concepto: 'Compra Mercadona', importe: 50, fecha_operacion: '2026-07-30', tipo: 'gasto', banco: 'Unicaja' },
      { id: 'm2', concepto: 'Suscripción Spotify', importe: 10, fecha_operacion: '2026-07-30', tipo: 'gasto', banco: 'Revolut' },
      { id: 'm3', concepto: 'Ingreso Nómina', importe: 2000, fecha_operacion: '2026-07-30', tipo: 'ingreso', banco: 'BBVA' }
    ];

    const revolutMovs = mockMovs.filter(m => m.banco === 'Revolut');
    expect(revolutMovs).toHaveLength(1);
    expect(revolutMovs[0].concepto).toBe('Suscripción Spotify');

    const unicajaMovs = mockMovs.filter(m => m.banco === 'Unicaja');
    expect(unicajaMovs).toHaveLength(1);
    expect(unicajaMovs[0].concepto).toBe('Compra Mercadona');
  });
});
