// @vitest-environment node
/** Wallet arithmetic used by the finance tools, without any storage. */
import { createHash } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import * as d from '../src/financeDomain.js';

function wallets(overrides = {}) {
  const huchas = {
    main: { nombre: 'Cuenta', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 1000, orden: 1 },
    trip: { nombre: 'Viaje', tipo_aportacion: 'porcentaje', valor_aportacion: 10, saldo_acumulado: 200, objetivo: 250, tope_objetivo: true, orden: 2 },
    fixed: { nombre: 'Fijos', tipo_aportacion: 'flat', valor_aportacion: 100, saldo_acumulado: 0, orden: 3 },
  };
  for (const [key, changes] of Object.entries(overrides)) huchas[key] = { ...huchas[key], ...changes };
  return huchas;
}
const code = (run) => {
  try { run(); } catch (error) { return error.code; }
  return null;
};

describe('income split', () => {
  it('fills fixed amounts, then percentages, then the rest, and respects caps', () => {
    // The trip wallet would take 10 % (100 €) but only 50 € fit under its capped goal.
    expect(d.distributeIncome(100_000, wallets())).toEqual({ saldos: { fixed: 10_000, trip: 5_000, main: 85_000 }, deudas: {} });
  });

  it('ignores caps in the plain split used to undo legacy incomes', () => {
    expect(d.distributeIncome(100_000, wallets(), true).saldos).toEqual({ fixed: 10_000, trip: 10_000, main: 80_000 });
  });

  it('never hands out more than the income has', () => {
    expect(d.distributeIncome(6_000, wallets()).saldos).toEqual({ fixed: 6_000 });
  });

  it('makes a wallet in debt repay its lender first', () => {
    const split = d.distributeIncome(100_000, wallets({ fixed: { deuda_pendiente: 30, deuda_con: 'main' } }));
    expect(split.deudas).toEqual({ fixed: { importe: 3_000, con: 'main' } });
    expect(split.saldos).toEqual({ fixed: 7_000, trip: 5_000, main: 88_000 });
  });

  it('gives nothing to archived or cash wallets', () => {
    const split = d.distributeIncome(50_000, wallets({ fixed: { activa: false }, cash: { es_metalico: true, tipo_aportacion: 'flat', valor_aportacion: 20, orden: 0 } }));
    expect(Object.keys(split.saldos).sort()).toEqual(['main', 'trip']);
  });

  it('refuses percentages over one hundred', () => {
    expect(code(() => d.distributeIncome(10_000, wallets({ extra: { tipo_aportacion: 'porcentaje', valor_aportacion: 95, orden: 4 } })))).toBe('invalid_distribution');
  });

  it('rounds fractional percentages half up without drift', () => {
    expect(d.percentOf(333, 12.5)).toBe(42); // 41.625
    expect(d.percentOf(1_000, 0.05)).toBe(1); // 0.5
    expect(d.percentOf(123_456_789, 33.333333)).toBe(41_152_263);
  });
});

describe('undoing an income', () => {
  it('uses the recorded split exactly, even after the rules change', () => {
    const huchas = wallets({ fixed: { deuda_pendiente: 30, deuda_con: 'main' } });
    const movement = { tipo: 'ingreso', importe: 1000, reparto_aplicado: d.recordedSplit(d.distributeIncome(100_000, huchas)) };
    expect(d.incomeReversal(movement, wallets({ fixed: { valor_aportacion: 999 } }))).toEqual({
      saldos: { fixed: -7_000, trip: -5_000, main: -88_000 },
      deudas: { fixed: { importe: 3_000, con: 'main' } },
    });
  });

  it('recomputes a legacy income and spares archived wallets', () => {
    expect(d.incomeReversal({ tipo: 'ingreso', importe: 1000 }, wallets())).toEqual({ saldos: { fixed: -10_000, trip: -10_000, main: -80_000 }, deudas: {} });
    const recorded = { tipo: 'ingreso', importe: 100, reparto_aplicado: { saldos: { fixed: 100 }, deudas: {} } };
    expect(d.incomeReversal(recorded, wallets({ fixed: { activa: false } })).saldos).toEqual({ main: -10_000 });
  });
});

describe('wallet fallbacks', () => {
  it('picks the main wallet for expenses and the rest wallet for leftovers', () => {
    expect(d.expenseHucha(wallets())).toBe('main');
    expect(d.fallbackHucha(wallets(), ['main'])).toBe('trip');
    expect(d.expenseHucha({ cash: { es_metalico: true } })).toBeNull();
  });
});

describe('compensations', () => {
  it('links and unlinks a refund round trip', () => {
    const gasto = { id: 'g', tipo: 'gasto', importe: 45 };
    const ingreso = { id: 'i', tipo: 'ingreso', importe: 22.5 };
    const updates = d.compensationUpdates(gasto, [[ingreso, 2_250]]);
    expect(updates.g).toEqual({ compensado_por_detalles: [{ ingreso_id: 'i', importe: 22.5 }], importe_neto: 22.5 });
    expect(updates.i).toEqual({ compensaciones_destinos: [{ gasto_id: 'g', importe: 22.5 }] });
    const linkedGasto = { ...gasto, ...updates.g };
    const linkedIngreso = { ...ingreso, ...updates.i };
    expect([d.available(linkedGasto), d.available(linkedIngreso)]).toEqual([2_250, 0]);
    expect(d.linkedIds(linkedGasto)).toEqual(['i']);
    const undone = d.unlinkUpdates(linkedGasto, [linkedIngreso]);
    expect(undone.g).toEqual({ compensado_por_detalles: null, compensado_por: null, importe_neto: null });
    expect(undone.i).toEqual({ compensaciones_destinos: null, compensa_movimiento_id: null });
  });

  it.each([
    [{ id: 'x', tipo: 'gasto', importe: 10 }, 500], // same type
    [{ id: 'i', tipo: 'ingreso', importe: 10 }, 1_500], // more than the income has
    [{ id: 'i', tipo: 'ingreso', importe: 10, es_interno: true }, 500],
    [{ id: 'i', tipo: 'ingreso', importe: 100 }, 5_000], // more than the expense has
  ])('refuses invalid compensation %#', (other, amount) => {
    expect(code(() => d.compensationUpdates({ id: 'g', tipo: 'gasto', importe: 45 }, [[other, amount]]))).toBe('invalid_compensation');
  });
});

describe('subscriptions', () => {
  it('counts only what the system wallet covers', () => {
    const subscriptions = [
      { activa: true, importe: 17.99, frecuencia: 'mensual', hucha_id: 'system' },
      { activa: true, importe: 14.99, mi_parte: 7.5, frecuencia: 'mensual' },
      { activa: true, importe: 49.9, frecuencia: 'anual', hucha_id: 'system' },
      { activa: true, importe: 30, frecuencia: 'mensual', hucha_id: 'elsewhere' },
      { activa: false, importe: 99, frecuencia: 'mensual' },
    ];
    expect(d.subscriptionsTarget(subscriptions, 'system')).toBe(29.65);
    expect(d.monthlyAmount(subscriptions[2])).toBeCloseTo(4.158, 3);
  });

  it('follows anchor, cadence and short months for the next charge', () => {
    const monthly = { frecuencia: 'mensual', dia_pago: 31, fecha_inicio: '2026-01-31' };
    expect(d.nextCharge(monthly, '2026-02-01')).toBe('2026-02-28');
    expect(d.nextCharge(monthly, '2026-02-28', false)).toBe('2026-03-31');
    expect(d.nextCharge({ frecuencia: 'trimestral', dia_pago: 5, fecha_inicio: '2026-01-05' }, '2026-01-06')).toBe('2026-04-05');
    const legacy = { frecuencia: 'anual', dia_pago: 12, created_at: new Date('2025-03-20T00:00:00Z') };
    expect(d.nextCharge(legacy, '2026-03-13')).toBe('2027-03-12');
  });
});

describe('ids, dates and amounts', () => {
  it('derives the same custom category id as the web', async () => {
    expect(await d.customCategoryId('Café', 'gasto')).toBe(`custom_${createHash('sha256').update('cafe:gasto').digest('hex')}`);
    expect(await d.customCategoryId('Café  ', 'gasto')).not.toBe(await d.customCategoryId('Cafe', 'ingreso'));
  });

  it('parses dates strictly', () => {
    expect(d.parseMoment('2026-10-09').toISOString()).toBe('2026-10-09T00:00:00.000Z');
    expect(d.parseMoment('2026-10-09T10:00:00+02:00').toISOString()).toBe('2026-10-09T08:00:00.000Z');
    expect(d.parseMoment('2026-10-09T10:00:00.123456+00:00').getTime()).toBe(Date.UTC(2026, 9, 9, 10, 0, 0, 123));
    for (const bad of ['ayer', '2026-13-01', '2026-02-30', 20261009, null]) expect(code(() => d.parseMoment(bad))).toBe('invalid_date');
  });

  it('reads calendar days in Madrid and finds its midnights across daylight saving', () => {
    expect(d.localDate(new Date('2026-09-30T22:30:00Z'))).toBe('2026-10-01');
    expect(d.localDate('2026-02-30')).toBeNull();
    expect(d.madridMidnight(2026, 10, 1).toISOString()).toBe('2026-09-30T22:00:00.000Z');
    expect(d.madridMidnight(2026, 1, 1).toISOString()).toBe('2025-12-31T23:00:00.000Z');
  });

  it('converts euros to cents rounding halves up on the written decimal', () => {
    expect([d.cents(12.345), d.cents(1.005), d.cents(0.285), d.cents(17.99), d.cents(84.5), d.cents(-2.675)]).toEqual([1235, 101, 29, 1799, 8450, -268]);
    expect(d.cents(0.1 + 0.2)).toBe(30);
    for (const bad of [0, -1, true, 'x', Number.NaN, 10_000_000]) expect(code(() => d.amountCents(bad))).toBe('invalid_amount');
    expect(d.cleanText('  Mercadona\u0000\n ', 200)).toBe('Mercadona');
  });
});
