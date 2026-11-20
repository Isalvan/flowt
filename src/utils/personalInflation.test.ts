import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { merchantKey, percentChange, personalInflation } from './personalInflation';

// Fictitious places and prices. "Now" is 20 Nov 2026: the recent stretch starts on 23 Aug 2026,
// and the year-ago stretch runs from 21 Sep to 20 Dec 2025.
const now = new Date(2026, 10, 20, 18);
let ids = 0;
const expense = (fecha: Date, concepto: string, importe: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `e${ids++}`, tipo: 'gasto', concepto, importe, fecha_operacion: fecha, ...extra,
});
/** One visit per amount, a week apart, from `start`. */
const visits = (start: Date, concepto: string, amounts: number[]) => amounts.map((amount, index) =>
  expense(new Date(start.getFullYear(), start.getMonth(), start.getDate() + index * 7, 12), concepto, amount));
const lastYear = new Date(2025, 9, 1);
const recent = new Date(2026, 8, 1);
// The loading window starts on 1 Oct 2025.
const oldest = expense(new Date(2025, 9, 1, 9), 'Panadería Lola', 2);

describe('personalInflation', () => {
  it('compares the typical price per visit now with a year ago', () => {
    const result = personalInflation([
      oldest,
      ...visits(lastYear, 'Super Norte 4512 Torrelavega', [40, 42, 38, 41]),
      ...visits(recent, 'Super Norte 9921 Torrelavega', [44, 46, 45, 50]),
      ...visits(lastYear, 'Bar El Puerto', [10, 10, 10]),
      ...visits(recent, 'Bar El Puerto', [9, 9, 9, 9, 9, 9]),
    ], now)!;
    expect(result.antesDesde).toEqual(new Date(2025, 9, 1));
    expect(result.antesHasta).toEqual(new Date(2025, 11, 20));
    const [super_, bar] = result.comercios;
    expect(super_).toMatchObject({ key: 'super norte', antes: 40.5, ahora: 45.5, visitasAntes: 4, visitasAhora: 4, extra: 20 });
    expect(super_.cambio).toBeCloseTo(5 / 40.5);
    expect(bar).toMatchObject({ antes: 10, ahora: 9, visitasAhora: 6, extra: -6 });
    // Today's basket: 4 × 45.5 + 6 × 9 = 236, against 4 × 40.5 + 6 × 10 = 222.
    expect(result.indice).toBeCloseTo(236 / 222 - 1);
    expect(result.extraMensual).toBe(4.67);
  });

  it('keeps the merchant name from the latest visit and ignores reference numbers', () => {
    expect(merchantKey('MERCADONA 1234 SANTANDER')).toBe('mercadona');
    const result = personalInflation([
      oldest,
      ...visits(lastYear, 'Mercadona 1111 Santander', [30, 30, 30]),
      ...visits(recent, 'MERCADONA 2222 TORRELAVEGA', [33, 33, 33]),
      ...visits(lastYear, 'Gasolinera Sol', [50, 50, 50]),
      ...visits(recent, 'Gasolinera Sol', [55, 55, 55]),
    ], now)!;
    expect(result.comercios.map(merchant => merchant.nombre)).toEqual(['Gasolinera Sol', 'MERCADONA 2222 TORRELAVEGA']);
  });

  it('needs three visits in each stretch and at least two places', () => {
    const base = [oldest, ...visits(lastYear, 'Bar El Puerto', [10, 10, 10]), ...visits(recent, 'Bar El Puerto', [11, 11, 11])];
    expect(personalInflation(base, now)).toBeNull();
    expect(personalInflation([...base, ...visits(lastYear, 'Gasolinera Sol', [50, 50]), ...visits(recent, 'Gasolinera Sol', [55, 55, 55])], now)).toBeNull();
    expect(personalInflation([...base, ...visits(lastYear, 'Gasolinera Sol', [50, 50, 50]), ...visits(recent, 'Gasolinera Sol', [55, 55, 55])], now)!.comercios).toHaveLength(2);
  });

  it('leaves out bills, internal moves, refunds and income', () => {
    const bills = [
      ...visits(lastYear, 'Alquiler piso', [500, 500, 500]).map(m => ({ ...m, categoria: 'vivienda' })),
      ...visits(recent, 'Alquiler piso', [550, 550, 550]).map(m => ({ ...m, categoria: 'vivienda' })),
      ...visits(lastYear, 'Streaming Plus', [9, 9, 9]).map(m => ({ ...m, suscripcion_id: 's1' })),
      ...visits(recent, 'Streaming Plus', [12, 12, 12]).map(m => ({ ...m, suscripcion_id: 's1' })),
      ...visits(lastYear, 'Traspaso ahorro', [100, 100, 100]).map(m => ({ ...m, es_interno: true })),
      ...visits(recent, 'Traspaso ahorro', [100, 100, 100]).map(m => ({ ...m, es_interno: true })),
      ...visits(lastYear, 'Tienda Devuelta', [20, 20, 20]),
      ...visits(recent, 'Tienda Devuelta', [20, 20, 20]).map(m => ({ ...m, importe_neto: 0 })),
    ];
    const places = [...visits(lastYear, 'Bar El Puerto', [10, 10, 10]), ...visits(recent, 'Bar El Puerto', [11, 11, 11])];
    expect(personalInflation([oldest, ...bills, ...places], now)).toBeNull();
  });

  it('needs a month of data around a year ago', () => {
    const late = expense(new Date(2025, 11, 1, 9), 'Panadería Lola', 2);
    const movements = [
      late,
      ...visits(new Date(2025, 11, 2), 'Bar El Puerto', [10, 10, 10]), ...visits(recent, 'Bar El Puerto', [11, 11, 11]),
      ...visits(new Date(2025, 11, 2), 'Gasolinera Sol', [50, 50, 50]), ...visits(recent, 'Gasolinera Sol', [55, 55, 55]),
    ];
    expect(personalInflation(movements, now)).toBeNull();
    expect(personalInflation([], now)).toBeNull();
  });

  it('ignores the stretch between the two windows and the future', () => {
    const result = personalInflation([
      oldest,
      ...visits(lastYear, 'Bar El Puerto', [10, 10, 10]), ...visits(recent, 'Bar El Puerto', [11, 11, 11]),
      ...visits(lastYear, 'Gasolinera Sol', [50, 50, 50]), ...visits(recent, 'Gasolinera Sol', [55, 55, 55]),
      ...visits(new Date(2026, 3, 1), 'Bar El Puerto', [99, 99, 99]),
      expense(new Date(2026, 10, 25), 'Bar El Puerto', 99),
    ], now)!;
    expect(result.comercios.find(merchant => merchant.nombre === 'Bar El Puerto')).toMatchObject({ ahora: 11, visitasAhora: 3 });
  });
});

describe('percentChange', () => {
  it('signs the change and writes the decimal comma', () => {
    expect(percentChange(0.0423)).toBe('+4,2 %');
    expect(percentChange(-0.1)).toBe('−10 %');
    expect(percentChange(0.0004)).toBe('0 %');
  });
});
