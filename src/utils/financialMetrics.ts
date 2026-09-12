import type { Movimiento, Suscripcion } from "../types";
import { parseMovimientoDate } from "../hooks/useFinanceData";
import { getObservedCalendarDays } from "./financialDates";
import { cuentaEnEstadisticas } from "./movements";
import { getMonthlySubscriptionAmount } from "./subscriptions";

export interface AdvancedFinancialMetrics {
  observedDays: number;
  savingsRate: number;
  dailyBurnRate: number;
  subscriptionPressure: number;
  runwayMonths: number;
  monthlySubscriptions: number;
}

export const calculateAdvancedFinancialMetrics = (
  movements: Movimiento[],
  huchaBalance: number,
  subscriptions: Suscripcion[],
  now = new Date(),
): AdvancedFinancialMetrics | null => {
  const dated = movements
    .filter(cuentaEnEstadisticas)
    .map((movement) => ({
      movement,
      date: parseMovimientoDate(movement.fecha_operacion),
    }))
    .filter((entry): entry is { movement: Movimiento; date: Date } =>
      Boolean(entry.date),
    );
  const observedDays = getObservedCalendarDays(
    dated.map(({ date }) => date),
    now,
  );
  if (dated.length < 2 || observedDays < 7) return null;

  const income = dated
    .filter(({ movement }) => movement.tipo === "ingreso")
    .reduce((sum, { movement }) => sum + movement.importe, 0);
  const expense = dated
    .filter(({ movement }) => movement.tipo === "gasto")
    .reduce((sum, { movement }) => sum + movement.importe, 0);
  if (income <= 0) return null;

  const dailyBurnRate = expense / observedDays;
  const averageMonthlyExpense = dailyBurnRate * 30.4;
  const monthlySubscriptions = subscriptions
    .filter(({ activa }) => activa)
    .reduce(
      (sum, subscription) => sum + getMonthlySubscriptionAmount(subscription),
      0,
    );
  const averageMonthlyIncome = (income / observedDays) * 30.4;

  return {
    observedDays,
    savingsRate: Math.max(0, ((income - expense) / income) * 100),
    dailyBurnRate,
    subscriptionPressure:
      averageMonthlyIncome > 0
        ? (monthlySubscriptions / averageMonthlyIncome) * 100
        : 0,
    runwayMonths:
      averageMonthlyExpense > 0 ? huchaBalance / averageMonthlyExpense : 0,
    monthlySubscriptions,
  };
};
