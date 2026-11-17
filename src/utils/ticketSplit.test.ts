import { describe, expect, it } from 'vitest';
import type { Movimiento, TicketScanResult } from '../types';
import { findTicketMatch, splitTicket, ticketSummaryText } from './ticketSplit';

const people = [{ nombre: 'Yo', yo: true }, { nombre: 'Ana' }, { nombre: 'Luis' }];
const receipt = (total: number, amounts: number[]): TicketScanResult => ({ comercio: 'Mercadona', fecha: '2026-11-17', total, moneda: 'EUR', categoria_sugerida: 'alimentacion', lineas: amounts.map(importe => ({ descripcion: 'Artículo', cantidad: 1, importe })), cuadra: true, diferencia: 0 });

describe('splitTicket', () => {
  it('splits unassigned lines between everyone with stable cent remainders', () => {
    expect(splitTicket(receipt(10, [10]), people).map(p => p.importe)).toEqual([3.34, 3.33, 3.33]);
    expect(splitTicket(receipt(0.03, [0.01, 0.01, 0.01]), people.slice(0, 2)).map(p => p.importe)).toEqual([0.02, 0.01]);
  });
  it('splits shared lines and applies the global difference proportionally', () => {
    expect(splitTicket(receipt(27, [10, 20]), people, [[0], [1, 2]]).map(p => p.importe)).toEqual([9, 9, 9]);
    expect(splitTicket(receipt(9, [8, 2]), people.slice(0, 2), [[0], [1]]).map(p => p.importe)).toEqual([7.2, 1.8]);
  });
  it('handles coupons, zero subtotals, empty lines and invalid assignment indices', () => {
    expect(splitTicket(receipt(9, [10, -1]), people.slice(0, 2), [[0], []]).map(p => p.importe)).toEqual([9.5, -0.5]);
    expect(splitTicket(receipt(1, [0]), people).map(p => p.importe)).toEqual([0.34, 0.33, 0.33]);
    expect(splitTicket(receipt(1, []), people).map(p => p.importe)).toEqual([0.34, 0.33, 0.33]);
    expect(splitTicket(receipt(10, [10]), people, [[1, 1, 22, -1]]).map(p => p.importe)).toEqual([0, 10, 0]);
  });
  it('preserves the total across 150 lines, discounts and 12 people without mutation', () => {
    const ticket = receipt(837.91, Array.from({ length: 150 }, (_, i) => i % 7 ? i / 10 : -i / 20));
    const persons = Array.from({ length: 12 }, (_, i) => ({ nombre: `Persona ${i}` }));
    const before = JSON.stringify(ticket);
    for (let size = 1; size <= 12; size++) {
      const shares = splitTicket(ticket, persons.slice(0, size), ticket.lineas.map((_, i) => i % 3 ? [] : [i % size]));
      expect(shares.reduce((sum, p) => sum + Math.round(p.importe * 100), 0)).toBe(83791);
    }
    expect(JSON.stringify(ticket)).toBe(before);
  });
  it('rejects invalid totals and person counts', () => {
    expect(() => splitTicket(receipt(10, [10]), [])).toThrow();
    expect(() => splitTicket(receipt(NaN, [10]), people)).toThrow();
    expect(() => splitTicket(receipt(10001, [10]), people)).toThrow();
  });
});

describe('findTicketMatch', () => {
  const expense = (id: string, props: Partial<Movimiento> = {}): Movimiento => ({ id, tipo: 'gasto', concepto: 'Compra', importe: 10, fecha_operacion: '2026-11-17', ...props });
  it('prefers the normalized merchant over a closer anonymous expense', () => {
    const named = expense('named', { concepto: 'Tarjeta MÉRCADONA Sevilla', fecha_operacion: '2026-11-20', importe: 10.01 });
    expect(findTicketMatch([expense('other'), named], receipt(10, [10]))).toBe(named);
  });
  it('excludes incomes, internals, attached receipts, dates beyond three days and other amounts', () => {
    for (const props of [{ tipo: 'ingreso' as const }, { es_interno: true }, { transfer_id: 'x' }, { ticket: { comercio: 'Tienda', lineas: [] } }, { fecha_operacion: '2026-11-21' }, { importe: 10.02 }]) {
      expect(findTicketMatch([expense('g', props)], receipt(10, [10]))).toBeNull();
    }
    expect(findTicketMatch([expense('g')], { ...receipt(10, [10]), fecha: null })).toBeNull();
  });
});

it('formats a shareable receipt in Spanish', () => {
  expect(ticketSummaryText(receipt(23.45, []), [{ nombre: 'Ana', importe: 12.3 }, { nombre: 'Luis', importe: 11.15 }]))
    .toBe('Ticket Mercadona (17/11): Ana 12,30 €, Luis 11,15 €. Total 23,45 €');
});
