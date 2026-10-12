import { describe, expect, it } from 'vitest';
import { buildDemoData, sortDemoMovements } from './demoData';
import { estimateBankBalance } from './banks';
import { applySplit, extraMonth, recordedSplit, roundMoney, splitIncome } from './incomeSplit';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { findDuplicateCharges } from './movementSuggestions';
import { getMonthlySubscriptionAmount, getSubscriptionChargeForMonth, toLocalDateKey } from './subscriptions';
import type { Hucha } from '../types';

const now = new Date(2026, 9, 12, 13, 30);

describe('buildDemoData', () => {
  it.each([now, new Date(2026, 0, 1), new Date(2028, 1, 29), new Date(2026, 6, 28), new Date(2026, 11, 31)])('covers six calendar periods plus the opening payroll up to %s, with descending dates', date => {
    const { movimientos } = buildDemoData(date);
    const monthKeys = Array.from({ length: 6 }, (_, index) => toLocalDateKey(new Date(date.getFullYear(), date.getMonth() - 5 + index, 1)).slice(0, 7));
    const openingMonth = toLocalDateKey(new Date(date.getFullYear(), date.getMonth() - 6, 28)).slice(0, 7);
    expect([...new Set(movimientos.map(m => toLocalDateKey(m.fecha_operacion).slice(0, 7)))].sort()).toEqual([openingMonth, ...monthKeys]);
    expect(movimientos.every(m => m.fecha_operacion <= date)).toBe(true);
    const payrolls = movimientos.filter(m => m.categoria === 'nomina');
    expect(payrolls.map(m => toLocalDateKey(m.fecha_operacion).slice(0, 7)).reverse()).toEqual([openingMonth, ...(date.getDate() < 28 ? monthKeys.slice(0, 5) : monthKeys)]);
    expect(movimientos.at(-1)).toMatchObject({ id: 'm-nomina-inicial', tipo: 'ingreso', categoria: 'nomina' });
    expect(movimientos.filter(m => toLocalDateKey(m.fecha_operacion).slice(0, 7) === openingMonth)).toHaveLength(1);
    expect(payrolls.every(m => m.importe === 2150 && m.fecha_operacion.getDate() === 28)).toBe(true);
    expect(movimientos).toEqual(sortDemoMovements(movimientos));
    expect(new Set(movimientos.map(m => m.id)).size).toBe(movimientos.length);
  });

  it('is deterministic and creates independent data on each call', () => {
    const first = buildDemoData(now);
    expect(first).toEqual(buildDemoData(now));
    first.huchas[0].saldo_acumulado = 0;
    first.movimientos[0].concepto = 'Changed';
    expect(buildDemoData(now)).not.toEqual(first);
  });

  it.each([now, ...Array.from({ length: 12 }, (_, month) => [new Date(2026, month, 1), new Date(2026, month, 27), new Date(2026, month, 28)]).flat()])('replays every wallet balance from zero and every payroll split without going negative at %s', date => {
    const data = buildDemoData(date);
    let wallets: Hucha[] = data.huchas.map(h => ({ ...h, saldo_acumulado: 0, extra_ultimo: undefined }));
    for (const movement of [...data.movimientos].reverse()) {
      if (movement.categoria === 'nomina') {
        const split = splitIncome(movement.importe, wallets, { extraMonth: extraMonth(movement) });
        expect(movement.reparto_aplicado).toEqual(recordedSplit(split));
        expect(roundMoney(Object.values(split.saldos).reduce((sum, amount) => sum + amount, 0))).toBe(2150);
        wallets = applySplit(wallets, split);
      } else {
        wallets = wallets.map(h => h.id === movement.hucha_id ? { ...h, saldo_acumulado: roundMoney(h.saldo_acumulado + (movement.tipo === 'ingreso' ? movement.importe : -movement.importe)) } : h);
      }
      expect(wallets.every(h => h.saldo_acumulado >= 0)).toBe(true);
    }
    expect(wallets.map(h => h.saldo_acumulado)).toEqual(data.huchas.map(h => h.saldo_acumulado));
    const walletCents = data.huchas.reduce((sum, h) => sum + Math.round(h.saldo_acumulado * 100), 0);
    expect(walletCents).toBe(Math.round(data.stats.total_ingresos * 100) - Math.round(data.stats.total_gastos * 100));
    expect(data.huchas.find(h => h.id === 'h-2')).toMatchObject({ valor_aportacion: 10, objetivo: 4000, tope_objetivo: true });
    expect(data.huchas.find(h => h.id === 'h-5')).toMatchObject({ valor_aportacion: 15, objetivo: 8000 });
  });

  it('reconciles Unicaja with non-cash wallets and calculates net statistics', () => {
    const data = buildDemoData(now);
    const unicaja = data.bancos.find(b => b.nombre === 'Unicaja')!;
    expect(unicaja.anclaFecha).toEqual(new Date(2026, 9, 1));
    expect(estimateBankBalance(unicaja, data.movimientos)).toBe(roundMoney(data.huchas.filter(h => !h.es_metalico).reduce((sum, h) => sum + h.saldo_acumulado, 0)));
    expect(estimateBankBalance(data.bancos.find(b => b.nombre === 'Revolut')!, data.movimientos)).toBeNull();
    for (const tipo of ['ingreso', 'gasto'] as const) {
      const total = data.movimientos.filter(m => m.tipo === tipo && cuentaEnEstadisticas(m)).reduce((sum, m) => sum + importeEnEstadisticas(m), 0);
      expect(data.stats[tipo === 'ingreso' ? 'total_ingresos' : 'total_gastos']).toBe(roundMoney(total));
    }
  });

  it('funds the balances for 12 October 2026 entirely from the recorded income and expenses', () => {
    const data = buildDemoData(now);
    expect(Object.fromEntries(data.huchas.map(h => [h.nombre, h.saldo_acumulado]))).toEqual({
      'Día a día': 2293.65,
      'Viaje a Japón': 1290,
      Suscripciones: 32.46,
      Ocio: 697,
      Colchón: 1935,
      Efectivo: 41.50,
    });
    expect(data.stats).toEqual({ total_ingresos: 13020, total_gastos: 6730.39 });
    expect(roundMoney(data.huchas.reduce((sum, h) => sum + h.saldo_acumulado, 0))).toBe(6289.61);
    expect(estimateBankBalance(data.bancos.find(b => b.nombre === 'Unicaja')!, data.movimientos)).toBe(6248.11);
    expect(data.huchas.every(h => !h.objetivo || h.saldo_acumulado < h.objetivo)).toBe(true);
  });

  it('includes duplicates, a compensated expense, cash transfers and manual movements', () => {
    const { movimientos } = buildDemoData(now);
    const duplicates = findDuplicateCharges(movimientos, now);
    expect(duplicates.some(pair => [pair.a.id, pair.b.id].sort().join(',') === 'm-duplicado-0,m-duplicado-1')).toBe(true);
    expect(movimientos.filter(m => m.id.startsWith('m-duplicado')).every(m => now.getTime() - m.fecha_operacion.getTime() <= 7 * 86_400_000)).toBe(true);
    const expense = movimientos.find(m => m.id === 'm-compartido')!;
    const refund = movimientos.find(m => m.id === 'm-bizum')!;
    expect(expense.compensado_por).toEqual([refund.id]);
    expect(refund.compensa_movimiento_id).toBe(expense.id);
    expect(expense.importe_neto).toBe(expense.importe - refund.importe);
    const withdrawal = movimientos.filter(m => m.transfer_id === 'demo-retirada');
    expect(withdrawal).toHaveLength(2);
    expect(withdrawal.every(m => m.es_interno && !cuentaEnEstadisticas(m))).toBe(true);
    expect(withdrawal.reduce((sum, m) => sum + (m.tipo === 'ingreso' ? m.importe : -m.importe), 0)).toBe(0);
    expect(movimientos.find(m => m.id === 'm-efectivo')).toMatchObject({ tipo: 'gasto', es_metalico: true, hucha_id: 'h-6' });
    expect(movimientos.filter(m => !m.banco && !m.es_interno)).toHaveLength(4);
    expect(movimientos.filter(m => m.banco === 'Unicaja').length).toBeGreaterThan(movimientos.length / 2);
    expect(movimientos.some(m => m.banco === 'Revolut')).toBe(true);
    for (let offset = 1; offset <= 5; offset++) {
      const month = new Date(now.getFullYear(), now.getMonth() - offset, 1);
      const small = movimientos.filter(m => m.id.includes('-pequeno-') && m.fecha_operacion.getMonth() === month.getMonth());
      expect(small.length).toBeGreaterThanOrEqual(6);
      expect(small.length).toBeLessThanOrEqual(10);
      expect(small.every(m => m.importe < 5)).toBe(true);
    }
  });

  it('charges active subscriptions on their cadence and dates, budgeting only the personal share', () => {
    const { suscripciones, huchas, movimientos } = buildDemoData(now);
    expect(suscripciones.filter(s => !s.activa)).toHaveLength(1);
    expect(huchas.find(h => h.es_suscripciones)?.valor_aportacion).toBe(roundMoney(suscripciones.filter(s => s.activa).reduce((sum, s) => sum + getMonthlySubscriptionAmount(s), 0)));
    for (const subscription of suscripciones) {
      const charges = movimientos.filter(m => m.suscripcion_id === subscription.id);
      const expectedDates = Array.from({ length: 6 }, (_, index) => getSubscriptionChargeForMonth(subscription, 2026, 4 + index)).filter(d => subscription.activa && d && d <= now);
      expect(charges.map(m => toLocalDateKey(m.fecha_operacion)).sort()).toEqual(expectedDates.map(d => toLocalDateKey(d!)).sort());
      expect(charges.every(m => m.hucha_id === 'h-3')).toBe(true);
    }
    expect(movimientos.find(m => m.suscripcion_id === 's-2')?.importe).toBe(7.50);
  });

  it.each([now, new Date(2026, 9, 18), new Date(2026, 9, 26), new Date(2026, 0, 1)])('dates pending mail within this week and before %s', date => {
    const monday = new Date(date.getFullYear(), date.getMonth(), date.getDate() - (date.getDay() + 6) % 7);
    for (const email of buildDemoData(date).pending) {
      expect(new Date(email.fecha_envio).getTime()).toBeGreaterThanOrEqual(monday.getTime());
      expect(new Date(email.fecha_envio).getTime()).toBeLessThanOrEqual(date.getTime());
      expect(email.cuerpo).toContain(new Date(email.fecha_envio).toLocaleDateString('es-ES'));
    }
  });
});
