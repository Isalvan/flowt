import { describe, expect, it } from 'vitest';
import type { Movimiento } from '../types';
import { getMovementWindowStart, groupExpensesByCategory, groupMovementsByMonth, typicalMonthlyIncome } from './periodStats';

const income = (year: number, month: number, amount: number, extra: Partial<Movimiento> = {}): Movimiento => ({
  id: `${year}-${month}-${amount}`,
  tipo: 'ingreso',
  concepto: 'Income',
  importe: amount,
  fecha_operacion: new Date(year, month, 2),
  ...extra,
});

describe('groupExpensesByCategory', () => {
  const expense = (amount: number, extra: Partial<Movimiento> = {}) => income(2026, 9, amount, { tipo: 'gasto', ...extra });

  it('groups expenses, skips income and internal transfers, and sorts by net total', () => {
    expect(groupExpensesByCategory([
      expense(20, { categoria: 'compras' }),
      expense(30, { categoria: 'compras' }),
      expense(200, { categoria: 'vivienda', importe_neto: 60 }),
      expense(30, { categoria: 'vivienda', compensado_por_detalles: [{ ingreso_id: 'refund', importe: 10 }] }),
      expense(500, { categoria: 'compras', es_interno: true }),
      expense(500, { categoria: 'compras', transfer_id: 'transfer' }),
      income(2026, 9, 500, { categoria: 'compras' }),
      expense(10),
      expense(20, { categoria: '', importe_neto: 0 }),
      expense(10, { categoria: 'salud', importe_neto: 0 }),
    ])).toEqual([
      { categoria: 'vivienda', total: 80, porcentaje: 57.14 },
      { categoria: 'compras', total: 50, porcentaje: 35.71 },
      { categoria: 'sin_categoria', total: 10, porcentaje: 7.14 },
    ]);
  });

  it('rounds category totals to cents and percentages sum to 100 within rounding tolerance', () => {
    const stats = groupExpensesByCategory([
      expense(1, { categoria: 'a', importe_neto: 0.104 }),
      expense(1, { categoria: 'a', importe_neto: 0.104 }),
      expense(1, { categoria: 'b', importe_neto: 0.211 }),
      expense(1, { categoria: 'c', importe_neto: 0.212 }),
      expense(1, { categoria: 'zero', importe_neto: 0.001 }),
    ]);
    expect(stats.map(category => category.total)).toEqual([0.21, 0.21, 0.21]);
    expect(Math.abs(stats.reduce((sum, category) => sum + category.porcentaje, 0) - 100)).toBeLessThanOrEqual(0.02);
    expect(groupExpensesByCategory([])).toEqual([]);
    expect(groupExpensesByCategory([expense(10, { categoria: '' })])[0].categoria).toBe('sin_categoria');
  });
});

describe('dashboard period statistics', () => {
  it('starts twelve months before the current month in local time', () => {
    expect(getMovementWindowStart(new Date(2026, 0, 19))).toEqual(new Date(2025, 0, 1));
    expect(getMovementWindowStart(new Date(2026, 11, 31))).toEqual(new Date(2025, 11, 1));
  });

  it('orders month indexes 9, 10 and 11 and the following year chronologically', () => {
    const dates = [new Date(2026, 0, 2), new Date(2025, 11, 2), new Date(2025, 9, 2), new Date(2025, 10, 2)];
    const stats = groupMovementsByMonth(dates.map((date, i) => income(date.getFullYear(), date.getMonth(), i + 1)));
    expect(stats.map(month => month.ingresos)).toEqual([3, 4, 2, 1]);
    expect(stats.map(month => month.name)).toEqual([9, 10, 11, 12].map(month =>
      new Date(2025, month, 1).toLocaleDateString('es-ES', { month: 'short' })));
  });

  it('groups net expenses and unallocated refund income and fills empty chart months', () => {
    const stats = groupMovementsByMonth([
      income(2026, 8, 200, { compensaciones_destinos: [{ gasto_id: 'expense', importe: 150 }] }),
      income(2026, 8, 100, { tipo: 'gasto', importe_neto: 25 }),
      income(2026, 8, 900, { es_interno: true }),
      income(2024, 8, 1000),
    ], [new Date(2026, 7, 1), new Date(2026, 8, 1)]);
    expect(stats.map(({ ingresos, gastos }) => ({ ingresos, gastos }))).toEqual([
      { ingresos: 0, gastos: 0 }, { ingresos: 50, gastos: 25 },
    ]);
  });

  it('takes the median of positive complete monthly net income, including amounts below 900', () => {
    const movements = [
      income(2025, 9, 200),
      income(2026, 7, 400),
      income(2026, 8, 10000),
      income(2026, 7, 5000, { es_interno: true }),
      income(2026, 7, 5000, { transfer_id: 'cash-withdrawal' }),
      income(2026, 7, 5000, { compensa_movimiento_id: 'expense' }),
      income(2026, 7, 5000, { compensaciones_destinos: [{ gasto_id: 'expense', importe: 5000 }] }),
      income(2026, 9, 90000), // Current month is incomplete.
      income(2025, 8, 90000), // Outside the window.
      income(2026, 10, 90000), // Future month.
    ];
    expect(typicalMonthlyIncome(movements, new Date(2026, 9, 11))).toBe(400);
  });

  it('averages the middle pair and rounds to two decimals', () => {
    expect(typicalMonthlyIncome([
      income(2026, 7, 100.01), income(2026, 8, 200.02),
    ], new Date(2026, 9, 11))).toBe(150.02);
  });

  it('falls back to current income to date when complete months have no income', () => {
    expect(typicalMonthlyIncome([
      income(2026, 8, 1000, { es_interno: true }),
      income(2026, 9, 100),
      income(2026, 9, 200, { compensaciones_destinos: [{ gasto_id: 'expense', importe: 150 }] }),
      income(2026, 9, 300, { compensa_movimiento_id: 'expense' }),
      income(2026, 9, 9000, { fecha_operacion: new Date(2026, 9, 20) }),
    ], new Date(2026, 9, 11))).toBe(150);
    expect(typicalMonthlyIncome([], new Date(2026, 9, 11))).toBe(0);
  });
});

describe('groupExpensesByCategory con categoría sugerida', () => {
  it('usa la función que recibe para los movimientos sin categoría elegida', () => {
    const movimientos = [
      { id: 'a', tipo: 'gasto', concepto: 'Mercadona', importe: 30, fecha_operacion: '2026-10-01' },
      { id: 'b', tipo: 'gasto', concepto: 'Cine', importe: 10, categoria: 'ocio', fecha_operacion: '2026-10-02' },
    ] as Movimiento[];
    const result = groupExpensesByCategory(movimientos, m => m.categoria || (m.concepto === 'Mercadona' ? 'alimentacion' : undefined));
    expect(result.map(c => [c.categoria, c.total])).toEqual([['alimentacion', 30], ['ocio', 10]]);
  });
});
