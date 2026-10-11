import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { summarizeSmallPurchases } from './smallPurchases';

const buildGasto = (overrides: Partial<Movimiento> = {}): Movimiento => ({
  id: 'gasto-1',
  tipo: 'gasto',
  concepto: 'Café',
  importe: 2.5,
  fecha_operacion: new Date('2026-10-01'),
  ...overrides,
});

describe('summarizeSmallPurchases', () => {
  it('aplica umbral estricto (< umbral) y excluye importes iguales o superiores', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Pan', importe: 4.99 }),
      buildGasto({ id: '2', concepto: 'Café', importe: 5.0 }),
      buildGasto({ id: '3', concepto: 'Libro', importe: 5.01 }),
      buildGasto({ id: '4', concepto: 'Cero', importe: 0 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(1);
    expect(result.total).toBe(4.99);
    expect(result.porComercio).toEqual([
      { nombre: 'Pan', count: 1, total: 4.99 },
    ]);
  });

  it('excluye ingresos aunque su importe sea menor que el umbral', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Café', importe: 2.0 }),
      {
        id: 'ingreso-1',
        tipo: 'ingreso',
        concepto: 'Propina recibida',
        importe: 1.5,
        fecha_operacion: new Date('2026-10-01'),
      },
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(1);
    expect(result.total).toBe(2.0);
    expect(result.porComercio).toHaveLength(1);
    expect(result.porComercio[0].nombre).toBe('Café');
  });

  it('excluye movimientos internos y transferencias entre carteras', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Prensa', importe: 2.0 }),
      buildGasto({ id: '2', concepto: 'Movimiento interno', importe: 3.0, es_interno: true }),
      buildGasto({ id: '3', concepto: 'Traspaso cartera', importe: 4.0, transfer_id: 'tr-1' }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(1);
    expect(result.total).toBe(2.0);
    expect(result.porComercio[0].nombre).toBe('Prensa');
  });

  it('excluye gastos asociados a una suscripción', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Café', importe: 2.0 }),
      buildGasto({ id: '2', concepto: 'iCloud 50 GB', importe: 0.99, suscripcion_id: 'sub-icloud' }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(1);
    expect(result.total).toBe(2.0);
  });

  it('usa el neto de gastos compensados', () => {
    const movimientos: Movimiento[] = [
      // Gasto de 15 € compensado con 12 € -> neto 3 € (< 5 €), cuenta como compra pequeña
      buildGasto({
        id: '1',
        concepto: 'Cena compartida',
        importe: 15.0,
        importe_neto: 3.0,
        compensado_por_detalles: [{ ingreso_id: 'ing-1', importe: 12.0 }],
      }),
      // Gasto de 4 € totalmente compensado -> neto 0 €, no debe contar
      buildGasto({
        id: '2',
        concepto: 'Café reembolsado',
        importe: 4.0,
        importe_neto: 0,
        compensado_por_detalles: [{ ingreso_id: 'ing-2', importe: 4.0 }],
      }),
      // Gasto normal no compensado de 1.80 €
      buildGasto({ id: '3', concepto: 'Fruta', importe: 1.8 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(2);
    expect(result.total).toBe(4.8);
    expect(result.porComercio).toEqual([
      { nombre: 'Cena compartida', count: 1, total: 3.0 },
      { nombre: 'Fruta', count: 1, total: 1.8 },
    ]);
  });

  it('agrupa por concepto normalizado y suma importes y compras', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Cafetería París', importe: 2.1 }),
      buildGasto({ id: '2', concepto: 'cafeteria paris', importe: 1.5 }),
      buildGasto({ id: '3', concepto: '  CAFETERÍA PARÍS  ', importe: 1.2 }),
      buildGasto({ id: '4', concepto: 'Panadería San Juan', importe: 0.9 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.count).toBe(4);
    expect(result.total).toBe(5.7);
    expect(result.porComercio).toHaveLength(2);
    expect(result.porComercio[0]).toEqual({
      nombre: 'Cafetería París',
      count: 3,
      total: 4.8,
    });
    expect(result.porComercio[1]).toEqual({
      nombre: 'Panadería San Juan',
      count: 1,
      total: 0.9,
    });
  });

  it('ordena por comercio por total descendente', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Kiosco', importe: 1.0 }),
      buildGasto({ id: '2', concepto: 'Supermercado Express', importe: 4.2 }),
      buildGasto({ id: '3', concepto: 'Kiosco', importe: 1.2 }),
      buildGasto({ id: '4', concepto: 'Panadería', importe: 3.1 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.porComercio.map(c => c.nombre)).toEqual([
      'Supermercado Express',
      'Panadería',
      'Kiosco',
    ]);
    expect(result.porComercio.map(c => c.total)).toEqual([4.2, 3.1, 2.2]);
  });

  it('redondea totales a céntimos evitando errores de punto flotante', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Chicle', importe: 0.1 }),
      buildGasto({ id: '2', concepto: 'Chicle', importe: 0.2 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result.total).toBe(0.3);
    expect(result.porComercio[0].total).toBe(0.3);
  });

  it('devuelve resumen vacío cuando no hay compras pequeñas', () => {
    const movimientos: Movimiento[] = [
      buildGasto({ id: '1', concepto: 'Compra grande', importe: 50.0 }),
    ];

    const result = summarizeSmallPurchases(movimientos, 5.0);
    expect(result).toEqual({
      count: 0,
      total: 0,
      porComercio: [],
    });
  });
});
