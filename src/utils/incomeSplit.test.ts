import { describe, expect, it } from 'vitest';
import cases from '../../tracker-backend/finance/distribution_cases.json';
import type { Hucha, Movimiento } from '../types';
import { splitIncome, reverseIncome, applySplit, recordedSplit, explicitIncomeSplit, cappedWalletCredit } from './incomeSplit';

const wallet = (id: string, fields: Partial<Hucha> = {}): Hucha => ({
  id, nombre: id, saldo_acumulado: 0, objetivo: null, orden: 0, tipo_aportacion: 'resto', ...fields,
});
const income = (fields: Partial<Movimiento> = {}): Movimiento => ({
  id: 'income', tipo: 'ingreso', concepto: 'Ingreso', importe: 100, fecha_operacion: '2026-10-01', ...fields,
});
const toEuros = (split: { saldos: Record<string, number>; deudas: Record<string, { importe: number; con: string }>; extras?: Record<string, string> }) => ({
  saldos: Object.fromEntries(Object.entries(split.saldos).map(([id, value]) => [id, value / 100])),
  deudas: Object.fromEntries(Object.entries(split.deudas).map(([id, debt]) => [id, { ...debt, importe: debt.importe / 100 }])),
  ...(split.extras ? { extras: split.extras } : {}),
});

describe('splitIncome: todos los casos compartidos con Python', () => {
  it.each(cases)('$nombre', entry => {
    const wallets = Object.entries(entry.huchas).map(([id, data]) => wallet(id, data as Partial<Hucha>));
    const before = structuredClone(wallets);
    if (entry.error) {
      expect(() => splitIncome(entry.importe / 100, wallets, { plain: entry.plain })).toThrowError(expect.objectContaining({ code: entry.error }));
    } else {
      const split = splitIncome(entry.importe / 100, wallets, { plain: entry.plain, extraMonth: 'mes' in entry ? entry.mes : null });
      expect(split).toEqual(toEuros(entry.esperado as unknown as Parameters<typeof toEuros>[0]));
      expect(recordedSplit(split)).toEqual(split);
    }
    expect(wallets).toEqual(before);
  });
});

describe('reversión y aplicación', () => {
  it('revierte saldos registrados con reglas diferentes y restaura la deuda saldada', () => {
    const wallets = [wallet('rest', { saldo_acumulado: 80 }), wallet('borrower', { saldo_acumulado: 20, tipo_aportacion: 'porcentaje', valor_aportacion: 150 })];
    const split = reverseIncome(income({ reparto_aplicado: { saldos: { rest: 80, borrower: 20 }, deudas: { borrower: { importe: 30, con: 'rest' } } } }), wallets);
    expect(split).toEqual({ saldos: { rest: -80, borrower: -20 }, deudas: { borrower: { importe: -30, con: 'rest' } } });
    expect(applySplit(wallets, split)).toEqual([wallet('rest'), wallet('borrower', { tipo_aportacion: 'porcentaje', valor_aportacion: 150, deuda_pendiente: 30, deuda_con: 'rest' })]);
  });

  it('sin registro usa plain, ignorando topes, deuda y porcentajes superiores a 100', () => {
    const wallets = [wallet('rest'), wallet('borrower', { tipo_aportacion: 'porcentaje', valor_aportacion: 150, objetivo: 10, saldo_acumulado: 10, tope_objetivo: true, deuda_pendiente: 50, deuda_con: 'rest' })];
    expect(reverseIncome(income(), wallets)).toEqual({ saldos: { borrower: -100 }, deudas: {} });
  });

  it('desvía créditos de carteras archivadas o ausentes al resto y no restaura deuda archivada', () => {
    const wallets = [wallet('rest'), wallet('archived', { activa: false })];
    expect(reverseIncome(income({ reparto_aplicado: { saldos: { missing: 60, archived: 40 }, deudas: { archived: { importe: 5, con: 'rest' } } } }), wallets))
      .toEqual({ saldos: { rest: -100 }, deudas: {} });
    expect(() => reverseIncome(income({ reparto_aplicado: { saldos: { missing: 100 }, deudas: {} } }), [])).toThrowError(expect.objectContaining({ code: 'no_hucha' }));
  });

  it('un ingreso dirigido revierte su cartera, o el resto si fue archivada', () => {
    expect(reverseIncome(income({ hucha_id: 'own' }), [wallet('own'), wallet('rest')])).toEqual({ saldos: { own: -100 }, deudas: {} });
    expect(reverseIncome(income({ hucha_id: 'own' }), [wallet('own', { activa: false }), wallet('rest')])).toEqual({ saldos: { rest: -100 }, deudas: {} });
  });

  it.each([10, 30])('aplica un pago de %s, redondea y elimina el acreedor al saldar', payment => {
    const wallets = [wallet('borrower', { saldo_acumulado: 1.005, deuda_pendiente: 20, deuda_con: 'rest' }), wallet('rest')];
    const before = structuredClone(wallets);
    const result = applySplit(wallets, { saldos: { borrower: 0.005, rest: payment }, deudas: { borrower: { importe: payment, con: 'rest' } } });
    expect(result[0]).toMatchObject({ saldo_acumulado: 1.02, deuda_pendiente: Math.max(0, 20 - payment), deuda_con: payment < 20 ? 'rest' : null });
    expect(result[1].saldo_acumulado).toBe(payment);
    expect(wallets).toEqual(before);
  });
});

describe('filas explícitas', () => {
  const wallets = [wallet('fixed', { objetivo: 10, tope_objetivo: true, deuda_pendiente: 100, deuda_con: 'rest' }), wallet('rest')];
  it('respeta fijos, porcentajes y resto sin topes ni pagos de deuda', () => {
    expect(explicitIncomeSplit(0.03, wallets, [
      { huchaId: 'fixed', tipoAportacion: 'porcentaje', value: 50 }, { huchaId: 'rest', tipoAportacion: 'resto', value: 0 },
    ])).toEqual({ saldos: { fixed: 0.02, rest: 0.01 }, deudas: {} });
    expect(explicitIncomeSplit(100, wallets, [{ huchaId: 'fixed', tipoAportacion: 'flat', value: 100 }])).toEqual({ saldos: { fixed: 100 }, deudas: {} });
    expect(explicitIncomeSplit(100, wallets, [
      { huchaId: 'fixed', tipoAportacion: 'flat', value: 50 }, { huchaId: 'fixed', tipoAportacion: 'flat', value: 50 },
    ])).toEqual({ saldos: { fixed: 100 }, deudas: {} });
  });
  it.each([
    [{ huchaId: 'fixed', tipoAportacion: 'flat' as const, value: 99 }],
    [{ huchaId: 'fixed', tipoAportacion: 'flat' as const, value: 101 }, { huchaId: 'rest', tipoAportacion: 'resto' as const, value: 0 }],
    [{ huchaId: 'fixed', tipoAportacion: 'porcentaje' as const, value: 120 }],
    [{ huchaId: 'absent', tipoAportacion: 'flat' as const, value: 100 }],
    [{ huchaId: 'fixed', tipoAportacion: 'flat' as const, value: -1 }, { huchaId: 'rest', tipoAportacion: 'resto' as const, value: 0 }],
  ].map(rows => ({ rows })))('rechaza filas no válidas ($rows)', ({ rows }) => {
    expect(() => explicitIncomeSplit(100, wallets, rows)).toThrowError(expect.objectContaining({ code: 'invalid_distribution' }));
  });
});

describe('crédito dirigido de transferencias', () => {
  it('redirige a resto con capacidad y conserva el excedente si también está lleno', () => {
    const wallets = [wallet('fixed', { tipo_aportacion: 'flat', objetivo: 10, tope_objetivo: true, saldo_acumulado: 5 }), wallet('rest', { objetivo: 8, tope_objetivo: true, saldo_acumulado: 5 })];
    expect(cappedWalletCredit('fixed', 10, wallets)).toEqual({ adjusted: { fixed: 5, rest: 3 }, overflow: 2, restoId: 'rest' });
    expect(cappedWalletCredit(undefined, 10, wallets)).toEqual({ adjusted: {}, overflow: 0, restoId: null });
  });
});
