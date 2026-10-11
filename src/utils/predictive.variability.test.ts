import { describe, expect, it } from "vitest";
import type { Movimiento } from "../types";
import { buildProjectionData, netVariability, type ProjectionEstimates } from "./predictive";
import type { PeriodConfig } from "./periods";

const config: PeriodConfig = { inicioPeriodo: 1, nominas: [] };
const now = new Date(2026, 3, 20);
const movement = (month: number, amount: number, day = 1, overrides: Partial<Movimiento> = {}): Movimiento => ({
  id: `${month}-${day}-${amount}`,
  concepto: "Movimiento",
  tipo: "ingreso",
  importe: amount,
  fecha_operacion: new Date(2026, month, day),
  ...overrides,
});

describe("netVariability", () => {
  it("requires at least three complete periods", () => {
    expect(netVariability([], now, config)).toBeNull();
    expect(netVariability([movement(1, 100), movement(2, 200)], now, config)).toBeNull();
    // January is only partially covered.
    expect(netVariability([movement(0, 100, 2), movement(1, 200), movement(2, 300)], now, config)).toBeNull();
  });

  it("returns zero for identical net savings", () => {
    expect(netVariability([movement(0, 100), movement(1, 100), movement(2, 100)], now, config))
      .toEqual({ standardDeviation: 0, periods: 3 });
  });

  it("uses sample deviation: nets 100, 200, 300 have mean 200 and deviation 100", () => {
    const movements = [movement(0, 150), movement(0, 50, 5, { tipo: "gasto" }), movement(1, 200), movement(2, 300)];
    expect(netVariability(movements, now, config)).toEqual({ standardDeviation: 100, periods: 3 });
  });

  it("respects a fixed start other than the first day and ignores the current period", () => {
    const movements = [movement(0, 100, 15), movement(1, 200, 14), movement(1, 200, 15), movement(2, 100, 14), movement(2, 300, 15), movement(3, 9999, 15)];
    expect(netVariability(movements, now, { inicioPeriodo: 15, nominas: [] }))
      .toEqual({ standardDeviation: 0, periods: 3 });
  });

  it("ignores current and future movements", () => {
    expect(netVariability([movement(0, 100), movement(1, 200), movement(2, 300), movement(3, 9999), movement(4, 9999)], now, config))
      .toEqual({ standardDeviation: 100, periods: 3 });
  });

  it("uses statistical amounts and excludes internal, transfer and reimbursement income", () => {
    const movements = [movement(0, 100), movement(1, 100), movement(2, 150),
      movement(2, 100, 5, { tipo: "gasto", importe_neto: 50 }),
      movement(2, 9999, 5, { es_interno: true }),
      movement(2, 9999, 5, { transfer_id: "transfer" }),
      movement(2, 50, 5, { compensa_movimiento_id: "expense" })];
    expect(netVariability(movements, now, config)).toEqual({ standardDeviation: 0, periods: 3 });
  });

  it("includes empty periods and limits history to the six most recent", () => {
    expect(netVariability([movement(0, 300)], now, config))
      .toEqual({ standardDeviation: Math.sqrt(30000), periods: 3 });
    const movements = Array.from({ length: 9 }, (_, month) => movement(month, month < 3 ? 9999 : 100));
    expect(netVariability(movements, new Date(2026, 9, 20), config))
      .toEqual({ standardDeviation: 0, periods: 6 });
  });

  it("uses payroll boundaries, including irregular payroll dates", () => {
    const nominas = [new Date(2026, 0, 25), new Date(2026, 1, 24), new Date(2026, 2, 26), new Date(2026, 3, 23)];
    const movements = [movement(0, 100, 25), movement(1, 200, 24), movement(2, 300, 26), movement(3, 9999, 23)];
    expect(netVariability(movements, new Date(2026, 3, 25), { inicioPeriodo: "nomina", nominas }))
      .toEqual({ standardDeviation: 100, periods: 3 });
  });
});

describe("buildProjectionData with variability", () => {
  const estimates: ProjectionEstimates = { dailyIncome: 10, dailyVariableExpense: 2, activeSubscriptions: [], observedDays: 90, observedMonths: 3 };
  const variability = { standardDeviation: 100, periods: 3 };

  it("has zero width on day zero and grows with the square root of elapsed days", () => {
    const projected = buildProjectionData(1000, estimates, now, 120, variability);
    expect(projected[0]).toMatchObject({ balance: 1000, low: 1000, high: 1000 });
    const day30 = buildProjectionData(1000, estimates, now, 30, variability).at(-1)!;
    const day120 = projected.at(-1)!;
    expect(day30).toMatchObject({ balance: 1240, low: 1140, high: 1340 });
    expect(day120).toMatchObject({ balance: 1960, low: 1760, high: 2160 });
  });

  it("rounds bounds to cents and preserves the expected line", () => {
    const without = buildProjectionData(1000, estimates, now, 1);
    const withBand = buildProjectionData(1000, estimates, now, 1, variability);
    expect(withBand.at(-1)).toMatchObject({ balance: 1008, low: 989.74, high: 1026.26 });
    expect(withBand.map(({ name, balance, rawDate }) => ({ name, balance, rawDate }))).toEqual(without);
  });

  it("adds no bounds without variability", () => {
    for (const value of [undefined, null]) {
      const projected = buildProjectionData(1000, estimates, now, 30, value);
      expect(projected.every((point) => !("low" in point) && !("high" in point))).toBe(true);
    }
  });
});
