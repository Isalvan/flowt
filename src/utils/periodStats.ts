import type { Movimiento } from '../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';

export interface CategoryExpense {
  categoria: string;
  total: number;
  porcentaje: number;
}

/** `categoryOf` lets the caller fall back to a suggested category for movements the user has not classified. */
export const groupExpensesByCategory = (
  movimientos: readonly Movimiento[],
  categoryOf: (movement: Movimiento) => string | undefined = movement => movement.categoria,
): CategoryExpense[] => {
  const totals = new Map<string, number>();
  movimientos.forEach(movement => {
    if (movement.tipo !== 'gasto' || !cuentaEnEstadisticas(movement)) return;
    const categoria = categoryOf(movement) || 'sin_categoria';
    totals.set(categoria, (totals.get(categoria) ?? 0) + importeEnEstadisticas(movement));
  });
  const categories = [...totals].map(([categoria, amount]) => ({
    categoria,
    total: Math.round((amount + Number.EPSILON) * 100) / 100,
  })).filter(({ total }) => total > 0).sort((a, b) => b.total - a.total);
  const totalCents = categories.reduce((sum, category) => sum + Math.round(category.total * 100), 0);
  return categories.map(category => ({
    ...category,
    porcentaje: Math.round(category.total * 100 / totalCents * 10000) / 100,
  }));
};

export const parseMovimientoDate = (value: unknown): Date | null => {
  let date: unknown = value;
  if (value && typeof value === 'object' && 'toDate' in value && typeof value.toDate === 'function') {
    date = value.toDate();
  } else if (typeof value === 'string') {
    date = new Date(value);
  }
  return date instanceof Date && !Number.isNaN(date.getTime()) ? date : null;
};

export const getMovementWindowStart = (now = new Date()): Date =>
  new Date(now.getFullYear(), now.getMonth() - 12, 1);

export interface MonthlyStats {
  name: string;
  ingresos: number;
  gastos: number;
}

// Numeric month keys keep October, November and December in chronological order.
const monthKey = (date: Date): number => date.getFullYear() * 12 + date.getMonth();

export const groupMovementsByMonth = (
  movements: readonly Movimiento[],
  emptyMonths: readonly Date[] = [],
): MonthlyStats[] => {
  const months = new Map<number, MonthlyStats>();
  const emptyMonth = (date: Date): MonthlyStats => ({
    name: date.toLocaleDateString('es-ES', { month: 'short' }),
    ingresos: 0,
    gastos: 0,
  });
  emptyMonths.forEach(date => months.set(monthKey(date), emptyMonth(date)));
  movements.forEach(movement => {
    if (!cuentaEnEstadisticas(movement)) return;
    const date = parseMovimientoDate(movement.fecha_operacion);
    if (!date) return;
    const key = monthKey(date);
    if (emptyMonths.length && !months.has(key)) return;
    const entry = months.get(key) ?? emptyMonth(date);
    entry[movement.tipo === 'ingreso' ? 'ingresos' : 'gastos'] += importeEnEstadisticas(movement);
    months.set(key, entry);
  });
  return [...months.entries()].sort(([a], [b]) => a - b).map(([, stats]) => stats);
};

export const typicalMonthlyIncome = (movements: readonly Movimiento[], now = new Date()): number => {
  const windowStart = getMovementWindowStart(now);
  const currentMonth = new Date(now.getFullYear(), now.getMonth(), 1);
  const completeMonths = movements.filter(movement => {
    const date = parseMovimientoDate(movement.fecha_operacion);
    return date && date >= windowStart && date < currentMonth;
  });
  const incomes = groupMovementsByMonth(completeMonths)
    .map(month => month.ingresos).filter(income => income > 0).sort((a, b) => a - b);
  let income: number;
  if (incomes.length) {
    const middle = Math.floor(incomes.length / 2);
    income = incomes.length % 2 ? incomes[middle] : (incomes[middle - 1] + incomes[middle]) / 2;
  } else {
    income = groupMovementsByMonth(movements.filter(movement => {
      const date = parseMovimientoDate(movement.fecha_operacion);
      return date && date >= currentMonth && date <= now;
    })).reduce((sum, month) => sum + month.ingresos, 0);
  }
  return Number(income.toFixed(2));
};
