import { describe, expect, it } from 'vitest';
import type { Hucha, Movimiento } from '../types';
import { freeWalletOf, isFreeSpending, payrollLibre } from './payrollFree';

const huchas: Hucha[] = [
  { id: 'main', nombre: 'Principal', tipo_aportacion: 'flat', valor_aportacion: 0, es_principal: true, saldo_acumulado: 0, objetivo: null, orden: 0 },
  { id: 'free', nombre: 'Día a día', tipo_aportacion: 'resto', saldo_acumulado: 0, objetivo: null, orden: 1 },
  { id: 'save', nombre: 'Ahorros', tipo_aportacion: 'porcentaje', valor_aportacion: 25, saldo_acumulado: 0, objetivo: null, orden: 2 },
];
const payroll = (extra: Partial<Movimiento> = {}): Movimiento => ({ id: 'pay', tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 2000, fecha_operacion: new Date(2026, 8, 28), ...extra });
const expense = (extra: Partial<Movimiento> = {}): Movimiento => ({ id: 'exp', tipo: 'gasto', concepto: 'Compra', importe: 20, fecha_operacion: new Date(2026, 9, 1), ...extra });

describe('payrollFree', () => {
  it('prefers the remainder wallet, then the main one, among active wallets', () => {
    expect(freeWalletOf(huchas)?.id).toBe('free');
    expect(freeWalletOf(huchas.map(hucha => hucha.id === 'free' ? { ...hucha, activa: false } : hucha))?.id).toBe('main');
    expect(freeWalletOf([])).toBeUndefined();
  });
  it('reads the recorded split, or applies the current rules', () => {
    expect(payrollLibre(payroll({ reparto_aplicado: { saldos: { free: 1234, save: 766 }, deudas: {} } }), huchas)).toBe(1234);
    expect(payrollLibre(payroll(), huchas)).toBe(1500);
    expect(payrollLibre(payroll(), huchas.map(hucha => hucha.id === 'free' ? { ...hucha, es_suscripciones: true } : hucha))).toBe(0);
  });
  it('counts only statistical expenses not charged to another wallet', () => {
    expect(isFreeSpending(expense(), huchas)).toBe(true);
    expect(isFreeSpending(expense({ hucha_id: 'free' }), huchas)).toBe(true);
    expect(isFreeSpending(expense({ hucha_id: 'main' }), huchas)).toBe(true);
    expect(isFreeSpending(expense({ hucha_id: 'save' }), huchas)).toBe(false);
    expect(isFreeSpending(expense({ es_interno: true }), huchas)).toBe(false);
    expect(isFreeSpending(payroll(), huchas)).toBe(false);
  });
});
