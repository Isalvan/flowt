import type { Hucha, Movimiento, Suscripcion } from "../types";
import { parseMovimientoDate } from "../hooks/useFinanceData";
import { toUtcCalendarDay } from "./financialDates";
import { cuentaEnEstadisticas, importeEnEstadisticas } from "./movements";
import { isSubscriptionMovement, normalizeServiceName } from "./serviceNames";
import { periodOf, previousPeriod, type PeriodConfig } from "./periods";
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

export interface NetVariability {
  standardDeviation: number;
  periods: number;
}

export type ProjectionAdjustment =
  | { id: string; tipo: "puntual"; importe: number; fecha: Date }
  | { id: string; tipo: "mensual"; importe: number; desde?: Date }
  | { id: string; tipo: "cancelar_suscripcion"; suscripcionId: string };

export interface ProjectionPoint {
  name: string;
  balance: number;
  rawDate: Date;
  low?: number;
  high?: number;
  scenario?: number;
  /** Exact daily crossing, which may fall between chart samples. */
  scenarioFirstNegativeDate?: Date;
}

export const scenarioSummary = (data: readonly ProjectionPoint[]) => {
  const last = data.at(-1);
  return {
    difference: last?.scenario === undefined ? 0 : Math.round((last.scenario - last.balance) * 100) / 100,
    firstNegativeDate: data.find((point) => point.scenarioFirstNegativeDate)?.scenarioFirstNegativeDate
      ?? data.find((point) => point.scenario !== undefined && point.scenario < 0)?.rawDate ?? null,
  };
};

export const netVariability = (
  movements: Movimiento[],
  now: Date,
  periodConfig: PeriodConfig,
): NetVariability | null => {
  const dated = movements.flatMap((movement) => {
    const date = parseMovimientoDate(movement.fecha_operacion);
    return date && date <= now ? [{ movement, date }] : [];
  });
  if (!dated.length) return null;
  const firstDay = Math.min(...dated.map(({ date }) => toUtcCalendarDay(date)));
  const { inicioPeriodo, nominas } = periodConfig;
  const current = periodOf(now, inicioPeriodo, nominas);
  let period = previousPeriod(current, inicioPeriodo, nominas);
  const nets: number[] = [];
  // A movement on the first day establishes coverage of that entire day.
  // Periods use [start, end), including periods with no recorded movements.
  while (nets.length < 6 && toUtcCalendarDay(period.start) >= firstDay) {
    if (period.end <= current.start && period.end <= now) {
      nets.push(dated.reduce((net, { movement, date }) => {
        if (date < period.start || date >= period.end || !cuentaEnEstadisticas(movement)) return net;
        const amount = importeEnEstadisticas(movement);
        return net + (movement.tipo === "ingreso" ? amount : -amount);
      }, 0));
    }
    period = previousPeriod(period, inicioPeriodo, nominas);
  }
  if (nets.length < 3) return null;
  const mean = nets.reduce((sum, net) => sum + net, 0) / nets.length;
  return {
    standardDeviation: Math.sqrt(nets.reduce((sum, net) => sum + (net - mean) ** 2, 0) / (nets.length - 1)),
    periods: nets.length,
  };
};

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
  variability?: NetVariability | null,
  adjustments: readonly ProjectionAdjustment[] = [],
) => {
  const data: ProjectionPoint[] = [];
  let balance = startingBalance;
  let scenarioBalance = startingBalance;
  let firstNegativeDate: Date | null = null;
  const cancelledIds = new Set(adjustments.flatMap((adjustment) =>
    adjustment.tipo === "cancelar_suscripcion" ? [adjustment.suscripcionId] : [],
  ));
  // Roughly 30 points whatever the horizon, so long ranges stay readable.
  const step = Math.max(1, Math.round(days / 30));
  const withYear = days > 330;

  for (let day = 0; day <= days; day += 1) {
    const date = new Date(now);
    date.setDate(now.getDate() + day);
    if (day > 0) {
      balance += estimates.dailyIncome - estimates.dailyVariableExpense;
      scenarioBalance += estimates.dailyIncome - estimates.dailyVariableExpense;
    }

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
        if (!cancelledIds.has(subscription.id)) {
          scenarioBalance -= getEffectiveSubscriptionAmount(subscription);
        }
      }
    });

    balance = Math.round(balance * 100) / 100;
    adjustments.forEach((adjustment) => {
      if (adjustment.tipo === "cancelar_suscripcion") return;
      const anchor = adjustment.tipo === "puntual" ? adjustment.fecha : adjustment.desde ?? now;
      const scheduled = adjustment.tipo === "puntual" ? anchor : clampDayToMonth(date.getFullYear(), date.getMonth(), anchor.getDate());
      if (toUtcCalendarDay(date) >= toUtcCalendarDay(anchor) && toUtcCalendarDay(date) === toUtcCalendarDay(scheduled)) {
        scenarioBalance += Math.round(adjustment.importe * 100) / 100;
      }
    });
    scenarioBalance = Math.round(scenarioBalance * 100) / 100;
    const scenario = scenarioBalance;
    if (adjustments.length > 0 && scenario < 0 && !firstNegativeDate) firstNegativeDate = date;
    if (day % step === 0 || day === days) {
      data.push({
        name: date.toLocaleDateString("es-ES", {
          day: "numeric",
          month: "short",
          ...(withYear && { year: "2-digit" }),
        }),
        balance,
        rawDate: date,
        ...(adjustments.length > 0 && { scenario }),
        ...(day === days && firstNegativeDate && { scenarioFirstNegativeDate: firstNegativeDate }),
        ...(variability && {
          low: Math.round((balance - variability.standardDeviation * Math.sqrt(day / 30)) * 100) / 100,
          high: Math.round((balance + variability.standardDeviation * Math.sqrt(day / 30)) * 100) / 100,
        }),
      });
    }
  }
  return data;
};
