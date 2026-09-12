import type { Movimiento, Suscripcion } from '../types';
import { parseMovimientoDate } from '../hooks/useFinanceData';

export interface AdvancedFinancialMetrics { observedDays: number; savingsRate: number; dailyBurnRate: number; subscriptionPressure: number; runwayMonths: number; monthlySubscriptions: number; }

export const calculateAdvancedFinancialMetrics = (movements: Movimiento[], huchaBalance: number, subscriptions: Suscripcion[], now = new Date()): AdvancedFinancialMetrics | null => {
  const dated = movements.map(movement => ({ movement, date: parseMovimientoDate(movement.fecha_operacion) })).filter((entry): entry is { movement: Movimiento; date: Date } => Boolean(entry.date));
  if (dated.length < 2) return null;
  const first = Math.min(...dated.map(entry => entry.date.getTime())); const last = Math.min(now.getTime(), Math.max(...dated.map(entry => entry.date.getTime()))); const observedDays = Math.ceil((last - first) / 86400000);
  if (observedDays < 7) return null;
  const income = dated.filter(entry => entry.movement.tipo === 'ingreso').reduce((sum, entry) => sum + entry.movement.importe, 0); const expense = dated.filter(entry => entry.movement.tipo === 'gasto').reduce((sum, entry) => sum + entry.movement.importe, 0);
  if (income <= 0) return null;
  const dailyBurnRate = expense / observedDays; const averageMonthlyExpense = dailyBurnRate * 30.4; const monthlySubscriptions = subscriptions.filter(subscription => subscription.activa).reduce((sum, subscription) => sum + (subscription.mi_parte ?? subscription.importe), 0); const monthlyIncome = income / (observedDays / 30.4);
  return { observedDays, savingsRate: Math.max(0, ((income - expense) / income) * 100), dailyBurnRate, subscriptionPressure: monthlyIncome > 0 ? (monthlySubscriptions / monthlyIncome) * 100 : 0, runwayMonths: averageMonthlyExpense > 0 ? huchaBalance / averageMonthlyExpense : 0, monthlySubscriptions };
};
