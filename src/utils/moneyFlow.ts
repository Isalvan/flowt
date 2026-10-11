import type { Movimiento } from '../types';
import { groupExpensesByCategory } from './periodStats';
import { cuentaEnEstadisticas, importeEnEstadisticas } from './movements';
import { isPayrollMovement } from './payroll';
import { walletAccent } from './walletAccent';

export interface FlowItem { id: string; label: string; amount: number; percent: number; color: string | null }
export interface MoneyFlow { total: number; sources: FlowItem[]; destinations: FlowItem[] }

const TOP_CATEGORIES = 6;

function apportion(items: FlowItem[], totalCents: number): FlowItem[] {
  const shares = items.map(item => Math.round(item.amount * 100) / totalCents * 100);
  const percentages = shares.map(Math.floor);
  const order = shares.map((share, i) => ({ i, remainder: share - percentages[i] }))
    .sort((a, b) => b.remainder - a.remainder);
  const missing = 100 - percentages.reduce((sum, value) => sum + value, 0);
  for (let i = 0; i < missing; i++) percentages[order[i].i]++;
  percentages.forEach((value, i) => {
    if (value !== 0) return;
    const largest = percentages.indexOf(Math.max(...percentages));
    percentages[i] = 1;
    percentages[largest]--;
  });
  return items.map((item, i) => ({ ...item, percent: percentages[i] }));
}

export function buildMoneyFlow(
  movimientos: readonly Movimiento[],
  categoryOf: (m: Movimiento) => string | undefined,
  categoryLabel: (id: string) => string,
): MoneyFlow | null {
  let payroll = 0, other = 0;
  for (const movement of movimientos) {
    if (movement.tipo !== 'ingreso' || !cuentaEnEstadisticas(movement)) continue;
    const cents = Math.round(importeEnEstadisticas(movement) * 100);
    if (isPayrollMovement(movement)) payroll += cents;
    else other += cents;
  }
  const categories = groupExpensesByCategory(movimientos.map(movement => movement.tipo === 'gasto'
    ? { ...movement, importe_neto: Math.round(importeEnEstadisticas(movement) * 100) / 100 }
    : movement), categoryOf);
  const expenses = categories.reduce((sum, item) => sum + Math.round(item.total * 100), 0);
  const income = payroll + other;
  const total = Math.max(income, expenses);
  if (!total) return null;
  const item = (id: string, label: string, cents: number, color: string | null = null): FlowItem =>
    ({ id, label, amount: cents / 100, percent: 0, color });
  const sources: FlowItem[] = [];
  if (payroll > 0) sources.push(item('nomina', 'Nómina', payroll));
  if (other > 0) sources.push(item('otros_ingresos', 'Otros ingresos', other));
  if (expenses > income) sources.push(item('ahorrado', 'De lo ahorrado', expenses - income));
  // Same categories and colours as the category chart, so both cards read alike.
  const destinations = categories.slice(0, TOP_CATEGORIES).map((category, i) => item(
    category.categoria, category.categoria === 'sin_categoria' ? 'Sin categoría' : categoryLabel(category.categoria),
    Math.round(category.total * 100), walletAccent(i).hex,
  ));
  if (categories.length > TOP_CATEGORIES) destinations.push(item('otras', 'Otras',
    categories.slice(TOP_CATEGORIES).reduce((sum, category) => sum + Math.round(category.total * 100), 0), walletAccent(TOP_CATEGORIES).hex));
  // What was not spent keeps the neutral colour it came in with.
  if (income > expenses) destinations.push(item('sin_gastar', 'Sin gastar', income - expenses));
  return { total: total / 100, sources: apportion(sources, total), destinations: apportion(destinations, total) };
}
