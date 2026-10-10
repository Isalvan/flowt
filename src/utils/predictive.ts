import type { Movimiento, Suscripcion } from "../types";
import { parseMovimientoDate } from "../hooks/useFinanceData";
import { getObservedCalendarDays } from "./financialDates";
import { cuentaEnEstadisticas, importeEnEstadisticas } from "./movements";
import { isSubscriptionMovement } from "./serviceNames";
import {
  getEffectiveSubscriptionAmount,
  getSubscriptionChargeForMonth,
} from "./subscriptions";

export interface ProjectionEstimates {
  dailyIncome: number;
  dailyVariableExpense: number;
  activeSubscriptions: Suscripcion[];
  observedDays: number;
}

export const calculateProjectionEstimates = (
  movements: Movimiento[],
  subscriptions: Suscripcion[],
  now = new Date(),
): ProjectionEstimates | null => {
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
    .reduce((sum, { movement }) => sum + importeEnEstadisticas(movement), 0);
  if (income <= 0) return null;

  const activeSubscriptions = subscriptions.filter(({ activa }) => activa);
  const subscriptionNames = activeSubscriptions.map(({ nombre }) => nombre);
  const variableExpenses = dated
    .filter(
      ({ movement }) =>
        movement.tipo === "gasto" &&
        !isSubscriptionMovement(movement.concepto, subscriptionNames),
    )
    .reduce((sum, { movement }) => sum + importeEnEstadisticas(movement), 0);

  return {
    dailyIncome: income / observedDays,
    dailyVariableExpense: variableExpenses / observedDays,
    activeSubscriptions,
    observedDays,
  };
};

export const buildProjectionData = (
  startingBalance: number,
  estimates: ProjectionEstimates,
  now = new Date(),
  days = 90,
) => {
  const data: Array<{ name: string; balance: number; rawDate: Date }> = [];
  let balance = startingBalance;
  // Roughly 30 points whatever the horizon, so long ranges stay readable.
  const step = Math.max(1, Math.round(days / 30));
  const withYear = days > 330;

  for (let day = 0; day <= days; day += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + day);
    if (day > 0)
      balance += estimates.dailyIncome - estimates.dailyVariableExpense;

    estimates.activeSubscriptions.forEach((subscription) => {
      const charge = getSubscriptionChargeForMonth(
        subscription,
        date.getFullYear(),
        date.getMonth(),
        now,
      );
      if (day > 0 && charge?.getDate() === date.getDate()) {
        balance -= getEffectiveSubscriptionAmount(subscription);
      }
    });

    balance = Math.round(balance * 100) / 100;
    if (day % step === 0 || day === days) {
      data.push({
        name: date.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
          ...(withYear && { year: "2-digit" }),
        }),
        balance,
        rawDate: date,
      });
    }
  }
  return data;
};
