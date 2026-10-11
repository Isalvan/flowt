import type { Hucha, Movimiento, Suscripcion } from "../types";
import { parseMovimientoDate } from "./periodStats";
import { toUtcCalendarDay } from "./financialDates";
import { cuentaEnEstadisticas, importeEnEstadisticas } from "./movements";
import { isSubscriptionMovement, normalizeServiceName } from "./serviceNames";
import {
  clampDayToMonth,
  getCancellationDate,
  getEffectiveSubscriptionAmount,
  getSubscriptionChargeForMonth,
} from "./subscriptions";

export interface ProjectionEstimates {
  dailyIncome: number;
  dailyVariableExpense: number;
  activeSubscriptions: Suscripcion[];
  observedDays: number;
  observedMonths: number;
}

export const calculateProjectionEstimates = (
  movements: Movimiento[],
  subscriptions: Suscripcion[],
  now = new Date(),
  wallets: Pick<Hucha, "id" | "es_suscripciones">[] = [],
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
  if (!dated.length) return null;

  const firstDay = Math.min(...dated.map(({ date }) => toUtcCalendarDay(date)));
  const today = toUtcCalendarDay(now);
  const windowStart = (months: number) =>
    toUtcCalendarDay(
      clampDayToMonth(now.getFullYear(), now.getMonth() - months, now.getDate()),
    );
  let observedMonths = 3;
  while (observedMonths > 0 && firstDay > windowStart(observedMonths)) {
    observedMonths -= 1;
  }
  if (observedMonths < 1) return null;

  const start = windowStart(observedMonths);
  const observedDays = (today - start) / 86_400_000;
  // Include today and exclude the start day to count boundary events only once.
  const windowMovements = dated.filter(({ date }) => {
    const day = toUtcCalendarDay(date);
    return day > start && day <= today;
  });

  const income = windowMovements
    .filter(({ movement }) => movement.tipo === "ingreso")
    .reduce((sum, { movement }) => sum + importeEnEstadisticas(movement), 0);
  if (income <= 0) return null;

  const activeSubscriptions = subscriptions.filter(({ activa }) => activa);
  const subscriptionNames = subscriptions.map(({ nombre }) => nombre);
  const normalizedNames = subscriptionNames
    .map(normalizeServiceName)
    .filter((name) => name.length >= 4);
  const subscriptionWalletIds = new Set(
    wallets.filter(({ es_suscripciones }) => es_suscripciones).map(({ id }) => id),
  );
  const variableExpenses = windowMovements
    .filter(({ movement }) => {
      const normalizedConcept = normalizeServiceName(movement.concepto);
      return (
        movement.tipo === "gasto" &&
        !subscriptionWalletIds.has(movement.hucha_id ?? "") &&
        !isSubscriptionMovement(movement.concepto, subscriptionNames) &&
        !normalizedNames.some((name) =>
          ` ${normalizedConcept} `.includes(` ${name} `),
        )
      );
    })
    .reduce((sum, { movement }) => sum + importeEnEstadisticas(movement), 0);

  return {
    dailyIncome: income / observedDays,
    dailyVariableExpense: variableExpenses / observedDays,
    activeSubscriptions,
    observedDays,
    observedMonths,
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
      const cancellationDate = getCancellationDate(subscription);
      if (
        day > 0 &&
        charge?.getDate() === date.getDate() &&
        (!cancellationDate || charge < cancellationDate)
      ) {
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
