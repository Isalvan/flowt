// @vitest-environment node
import { describe, expect, it } from 'vitest';
import * as d from '../src/financeDomain.js';

describe('payroll extra helpers', () => {
  it.each([
    [{ categoria: 'nomina', concepto: 'Ingreso' }, true],
    [{ categoria_sugerida: 'nomina' }, true],
    [{ concepto: 'Abono NÓMINA de agosto' }, true],
    [{ concepto: 'SALARIO' }, true],
    [{ concepto: 'Pago de sueldo.' }, true],
    [{ concepto: 'prenomina' }, false],
    [{ concepto: 'nominas' }, false],
    [{ concepto: 'nomina_extra' }, false],
    [{ categoria: 'otros', categoria_sugerida: 'nomina', concepto: 'Nómina' }, false],
    [{ categoria_sugerida: 'otros', concepto: 'Nómina' }, false],
    [{ categoria: '', categoria_sugerida: 'nomina' }, true],
    [{}, false],
  ])('recognizes payroll with category precedence: %j', (movement, expected) => {
    expect(d.isPayroll(movement)).toBe(expected);
  });

  it.each([
    ['2026-08-01', '2026-08'],
    ['2026-07-31T22:30:00Z', '2026-08'],
    ['2026-11-30T23:30:00Z', '2026-12'],
    ['2026-08-01T00:30:00+03:00', '2026-07'],
    ['2026-07-31T22:30:00', '2026-08'],
    [new Date('2026-07-31T22:30:00Z'), '2026-08'],
    [{ toDate: () => new Date('2026-07-31T22:30:00Z') }, '2026-08'],
    ['2026-02-30', null],
    ['2026-08-01T24:00:00Z', null],
    ['2026-08-01T12:00:00+00:60', null],
    ['invalid', null],
    [new Date(NaN), null],
    [null, null],
  ])('uses Madrid month and rejects invalid dates: %j', (value, expected) => {
    expect(d.extraMonth({ categoria: 'nomina', fecha_operacion: value })).toBe(expected);
    expect(d.extraMonth({ concepto: 'Regalo', fecha_operacion: value })).toBeNull();
  });

  it('records and reverses extras without converting the month', () => {
    const wallets = { personal: { tipo_aportacion: 'flat', extra_importe: 100, extra_meses: [8] }, rest: { tipo_aportacion: 'resto' } };
    const recorded = d.recordedSplit(d.distributeIncome(20000, wallets, false, '2026-08'));
    expect(recorded).toEqual({ saldos: { personal: 100, rest: 100 }, deudas: {}, extras: { personal: '2026-08' } });
    expect(d.incomeReversal({ importe: 200, reparto_aplicado: recorded }, wallets)).toEqual({ saldos: { personal: -10000, rest: -10000 }, deudas: {}, extras: { personal: '2026-08' } });
  });
});
