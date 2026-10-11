import { describe, expect, it } from 'vitest';
import type { Hucha, Movimiento, Suscripcion } from '../types';
import { payrollSummary } from './payrollSummary';

const now = new Date(2026, 9, 11, 12);
const huchas: Hucha[] = [
  { id: 'free', nombre: 'Día a día', tipo_aportacion: 'resto', es_principal: true, saldo_acumulado: 0, objetivo: null, orden: 0 },
  { id: 'subs', nombre: 'Suscripciones', tipo_aportacion: 'flat', valor_aportacion: 100, es_suscripciones: true, saldo_acumulado: 0, objetivo: null, orden: 1 },
  { id: 'save', nombre: 'Ahorros', tipo_aportacion: 'porcentaje', valor_aportacion: 20, saldo_acumulado: 0, objetivo: null, orden: 2 },
];
const payroll = (extra: Partial<Movimiento> = {}): Movimiento => ({ id: 'pay', tipo: 'ingreso', concepto: 'Nómina', categoria: 'nomina', importe: 2000, fecha_operacion: new Date(2026, 8, 28), ...extra });
const expense = (extra: Partial<Movimiento> = {}): Movimiento => ({ id: 'expense', tipo: 'gasto', concepto: 'Compra', importe: 20, fecha_operacion: new Date(2026, 9, 1), ...extra });
const subscription = (extra: Partial<Suscripcion> = {}): Suscripcion => ({ id: 'sub', nombre: 'Netflix', importe: 10, frecuencia: 'mensual', fecha_inicio: '2026-01-16', dia_pago: 16, categoria: 'ocio', color: '#ff0000', activa: true, ...extra });

describe('payrollSummary', () => {
  it('returns null without a valid past payroll', () => {
    expect(payrollSummary([], huchas, [], now)).toBeNull();
    expect(payrollSummary([expense(), payroll({ fecha_operacion: 'invalid' }), payroll({ fecha_operacion: new Date(2027, 0, 1) }), payroll({ es_interno: true })], huchas, [], now)).toBeNull();
  });
  it('uses current rules for one payroll without previous data and preserves inputs', () => {
    const movement = payroll();
    const summary = payrollSummary([movement], huchas, [], now)!;
    expect(summary.anterior).toBeNull();
    expect(summary.diferencia).toBeNull();
    expect(summary.periodoAnterior).toBeNull();
    expect(summary.repartoRegistrado).toBe(false);
    expect(summary.reparto.map(row => row.importe)).toEqual([1500, 400, 100]);
    expect(summary.ahorro + summary.suscripciones + summary.libre).toBe(2000);
    expect(summary.proxima).toEqual({ fecha: new Date(2026, 9, 28), dias: 17 });
    expect(summary.porDia).toBe(88.24);
    expect(movement.reparto_aplicado).toBeUndefined();
  });
  it('compares two payrolls and totals the previous exclusive-end period with statistical amounts', () => {
    const summary = payrollSummary([
      payroll(), payroll({ id: 'previous', importe: 1900, fecha_operacion: new Date(2026, 7, 28) }),
      expense({ importe: 200, importe_neto: 150, fecha_operacion: new Date(2026, 8, 1) }),
      expense({ es_interno: true, fecha_operacion: new Date(2026, 8, 1) }),
      payroll({ categoria: 'otros', importe: 50, fecha_operacion: new Date(2026, 8, 10) }),
      expense({ fecha_operacion: new Date(2026, 8, 28) }),
    ], huchas, [], now)!;
    expect(summary.anterior).toBe(1900);
    expect(summary.diferencia).toBe(100);
    expect(summary.periodoAnterior).toEqual({ period: { start: new Date(2026, 7, 28), end: new Date(2026, 8, 28) }, ingresos: 1950, gastos: 150, neto: 1800 });
  });
  it('uses recorded allocations, labels deleted wallets and includes debt repayment in savings', () => {
    const summary = payrollSummary([payroll({ reparto_aplicado: { saldos: { free: 1000, subs: 200, deleted: 700 }, deudas: { save: { importe: 100, con: 'free' } } } })], huchas, [], now)!;
    expect(summary.repartoRegistrado).toBe(true);
    expect(summary.reparto[1]).toEqual({ huchaId: 'deleted', nombre: 'Cartera eliminada', importe: 700, porcentaje: 35 });
    expect([summary.ahorro, summary.suscripciones, summary.libre]).toEqual([800, 200, 1000]);
    expect(summary.ahorro + summary.suscripciones + summary.libre).toBe(2000);
  });
  it('counts only eligible expenses since payroll up to now, leaving out those charged to another wallet', () => {
    const summary = payrollSummary([payroll(), expense({ importe: 100, importe_neto: 75 }),
      expense({ es_interno: true }), expense({ transfer_id: 'transfer' }), expense({ hucha_id: 'subs' }),
      expense({ hucha_id: 'save' }), expense({ hucha_id: 'free', importe: 4 }), expense({ hucha_id: 'deleted', importe: 1 }),
      expense({ fecha_operacion: new Date(2026, 8, 27) }), expense({ fecha_operacion: new Date(2026, 9, 12) }),
      payroll({ categoria: 'otros', importe: 100, fecha_operacion: new Date(2026, 9, 1) }),
    ], huchas, [], now)!;
    expect(summary.gastado).toBe(80);
    expect(summary.queda).toBe(1420);
  });
  it('includes today and next payroll charges, respects cadence, shared amounts and scheduled cancellations', () => {
    const summary = payrollSummary([payroll()], huchas, [
      subscription({ id: 'end', dia_pago: 28 }), subscription({ id: 'today', dia_pago: 11, mi_parte: 3.125 }),
      subscription({ id: 'past', dia_pago: 10 }), subscription({ id: 'later', dia_pago: 29 }),
      subscription({ id: 'inactive', activa: false }), subscription({ id: 'cancelled', cancel_at: '2026-10-16' }),
      subscription({ id: 'before-cancel', cancel_at: '2026-10-17' }),
      subscription({ id: 'annual', frecuencia: 'anual' }),
      subscription({ id: 'legacy-cancelling', cancelando: true }),
    ], now)!;
    expect(summary.cargos.map(cargo => cargo.sub.id)).toEqual(['today', 'before-cancel', 'end']);
    expect(summary.totalCargos).toBe(23.13);
  });
  it('returns a negative remainder and no daily budget after overspending', () => {
    const summary = payrollSummary([payroll(), expense({ importe: 1600 })], huchas, [], now)!;
    expect(summary.queda).toBe(-100);
    expect(summary.porDia).toBeNull();
  });
  it('uses calendar days across DST and clamps overdue payroll days to zero', () => {
    expect(payrollSummary([payroll()], huchas, [], new Date(2026, 9, 28, 12))?.proxima.dias).toBe(0);
    expect(payrollSummary([payroll()], huchas, [], new Date(2026, 10, 3))?.porDia).toBeNull();
  });
  it('falls back to the principal wallet when there is no remainder wallet', () => {
    const summary = payrollSummary([payroll({ reparto_aplicado: { saldos: { free: 1500, subs: 100, save: 400 }, deudas: {} } })], huchas.map(h => h.id === 'free' ? { ...h, tipo_aportacion: 'flat' } : h), [], now)!;
    expect(summary.libre).toBe(1500);
  });
  it('still shows an old payroll when no bank wallets remain', () => {
    for (const wallets of [[], [{ ...huchas[0], es_metalico: true }]]) {
      const summary = payrollSummary([payroll()], wallets, [], now)!;
      expect(summary.reparto).toEqual([]);
      expect(summary.ahorro + summary.suscripciones + summary.libre).toBe(2000);
    }
  });
});
