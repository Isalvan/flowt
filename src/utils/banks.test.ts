import { describe, expect, it } from 'vitest';
import { BANK_CATALOG, anchorAge, bankInitials, banksSummary, detectedBanks, estimateBankBalance } from './banks';
import type { Movimiento } from '../types';
const anchored = { id: 'bbva', nombre: 'BBVA', anclaSaldo: 100, anclaFecha: new Date('2026-10-11T10:00:00Z') };
const movement = (overrides: Partial<Movimiento> = {}): Movimiento => ({ id: 'm', tipo: 'gasto', concepto: 'Compra', importe: 10, banco: ' bbVa ', fecha_operacion: '2026-10-11T11:00:00Z', ...overrides });

describe('estimateBankBalance', () => {
  it('returns null without a complete anchor, accepts zero', () => {
    expect(estimateBankBalance({ id: 'b', nombre: 'BBVA' }, [])).toBeNull();
    expect(estimateBankBalance({ ...anchored, anclaSaldo: 0 }, [])).toBe(0);
  });
  it('only counts the named bank and strictly later real times', () => {
    expect(estimateBankBalance(anchored, [movement(), movement({ banco: 'N26' }), movement({ fecha_operacion: '2026-10-11T09:59:00Z' }), movement({ fecha_operacion: anchored.anclaFecha })])).toBe(90);
  });
  it('uses created_at on the anchor day for dates without time', () => {
    expect(estimateBankBalance(anchored, [
      movement({ fecha_operacion: '2026-10-11', created_at: '2026-10-11T09:00:00Z' }),
      movement({ fecha_operacion: '2026-10-11', created_at: { toDate: () => new Date('2026-10-11T11:00:00Z') } }),
      movement({ fecha_operacion: '2026-10-11', created_at: anchored.anclaFecha }),
      movement({ fecha_operacion: '2026-10-11' }),
      movement({ fecha_operacion: '2026-10-10', created_at: '2026-10-12T11:00:00Z' }),
      movement({ fecha_operacion: '2026-10-12' }),
    ])).toBe(80);
  });
  it('excludes cash withdrawal income, includes internal bank movements using gross amounts', () => {
    expect(estimateBankBalance(anchored, [movement({ tipo: 'ingreso', es_metalico: true }), movement({ es_interno: true, transfer_id: 't', importe_neto: 0 }), movement({ tipo: 'ingreso', importe: 5 })])).toBe(95);
  });
  it('rounds to cents and ignores invalid dates', () => {
    expect(estimateBankBalance({ ...anchored, anclaSaldo: 0 }, [movement({ tipo: 'ingreso', importe: 0.1 }), movement({ tipo: 'ingreso', importe: 0.2 }), movement({ fecha_operacion: 'invalid' })])).toBe(0.3);
  });
});
describe('banksSummary', () => {
  it('totals only anchored banks and withholds comparison while any are missing', () => {
    expect(banksSummary([anchored, { id: 'n', nombre: 'N26' }], [movement()], 70)).toEqual({ total: 90, missing: 1, difference: null });
  });
  it('compares totals rounded to cents once every bank is anchored', () => {
    expect(banksSummary([anchored], [movement()], 70.123)).toEqual({ total: 90, missing: 0, difference: 19.88 });
    expect(banksSummary([], [], 0)).toEqual({ total: 0, missing: 0, difference: 0 });
  });
  it('counts calendar days across the daylight saving change', () => {
    expect(anchorAge(new Date('2026-10-24T22:30:00Z'), new Date('2026-10-25T23:30:00Z'))).toBe(1);
  });
});

describe('banks', () => {
  it.each([['Unicaja', 'UN'], ['Trade Republic', 'TR'], ['N26', 'N2'], [' A ', 'A'], ['', '']])('initials of %s', (name, initials) => {
    expect(bankInitials(name)).toBe(initials);
  });
  it('detects distinct names by frequency, ignoring generic and blank names', () => {
    expect(detectedBanks([{ banco: 'Unicaja' }, { banco: 'revolut' }, { banco: 'Revolut' }, { banco: ' Banco ' }, { banco: ' ' }, {}])).toEqual(['revolut', 'Unicaja']);
    expect(BANK_CATALOG).toHaveLength(9);
  });
});
