import { describe, expect, it } from "vitest";
import type { Movimiento, Suscripcion } from "../types";
import {
  buildProjectionData,
  calculateProjectionEstimates,
  scenarioSummary,
  type ProjectionEstimates,
} from "./predictive";

const now = new Date(2026, 2, 31, 18, 30);
const movement = (
  id: string,
  tipo: Movimiento["tipo"],
  importe: number,
  fecha_operacion: unknown,
  overrides: Partial<Movimiento> = {},
): Movimiento => ({
  id,
  tipo,
  importe,
  fecha_operacion,
  concepto: id,
  ...overrides,
});
const subscription: Suscripcion = {
  id: "sub",
  nombre: "Netflix Premium",
  importe: 15,
  frecuencia: "mensual",
  dia_pago: 10,
  categoria: "streaming",
  color: "#000",
  activa: true,
};

describe("calculateProjectionEstimates", () => {
  it("returns no projection without representative history", () => {
    expect(calculateProjectionEstimates([], [], now)).toBeNull();
    expect(
      calculateProjectionEstimates(
        [movement("income", "ingreso", 100, new Date(2026, 2, 1))],
        [],
        now,
      ),
    ).toBeNull();
  });

  it("uses calendar days with times, ISO, Date and Timestamp", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("history", "gasto", 0, {
          toDate: () => new Date(2026, 0, 1, 23, 45),
        }),
        movement("income", "ingreso", 1000, "2026-03-01"),
        movement("expense", "gasto", 200, "2026-02-15T02:30:00+01:00"),
        movement("date", "gasto", 10, new Date(2026, 1, 1, 4)),
      ],
      [],
      now,
    );
    expect(estimates?.observedMonths).toBe(2);
    expect(estimates?.observedDays).toBe(59);
    expect(estimates?.dailyIncome).toBeCloseTo(1000 / 59);
    expect(estimates?.dailyVariableExpense).toBeCloseTo(210 / 59);
  });

  it("ignores excluded movements and recognised subscription aliases", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("history", "gasto", 0, "2026-01-01"),
        movement("income", "ingreso", 900, "2026-03-01"),
        movement("SPOTIFY AB", "gasto", 15, "2026-02-15"),
        movement("internal", "gasto", 9000, "2026-02-01", { es_interno: true }),
      ],
      [{ ...subscription, nombre: "Spotify Duo" }],
      now,
    );
    expect(estimates?.dailyVariableExpense).toBe(0);
  });

  it("projects average income daily without a hardcoded payday", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("history", "gasto", 0, "2026-02-28"),
        movement("income", "ingreso", 310, "2026-03-01"),
        movement("expense", "gasto", 0, "2026-03-31"),
      ],
      [],
      now,
    );
    const projected = buildProjectionData(
      100,
      estimates!,
      new Date(2026, 3, 1),
    );
    expect(projected[1].balance).toBe(130);
    expect(projected[2].balance).toBe(160);
  });

  it("uses one month for five weeks containing a single salary", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("history", "gasto", 20, "2026-02-24"),
        movement("salary", "ingreso", 3100, "2026-03-25"),
      ],
      [],
      now,
    );
    expect(estimates?.observedMonths).toBe(1);
    expect(estimates?.observedDays).toBe(31);
    expect(estimates?.dailyIncome).toBe(100);
    expect(estimates?.dailyVariableExpense).toBe(0);
  });

  it("caps history at three months and excludes old and future movements", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("old salary", "ingreso", 9000, "2025-03-01"),
        movement("old expense", "gasto", 9000, "2025-12-30"),
        movement("start boundary", "ingreso", 9000, "2025-12-31"),
        movement("January", "ingreso", 3000, "2026-01-31"),
        movement("February", "ingreso", 3000, "2026-02-28"),
        movement("March", "ingreso", 3000, "2026-03-31"),
        movement("expense", "gasto", 90, "2026-02-01"),
        movement("future", "ingreso", 9000, "2026-04-01"),
      ],
      [],
      now,
    );
    expect(estimates?.observedMonths).toBe(3);
    expect(estimates?.observedDays).toBe(90);
    expect(estimates?.dailyIncome).toBe(100);
    expect(estimates?.dailyVariableExpense).toBe(1);
  });

  it("requires a whole month of counting history and income inside the window", () => {
    expect(calculateProjectionEstimates([
      movement("excluded history", "gasto", 10, "2025-01-01", { es_interno: true }),
      movement("salary", "ingreso", 3000, "2026-03-01"),
      movement("expense", "gasto", 10, "2026-03-31"),
    ], [], now)).toBeNull();
    expect(calculateProjectionEstimates([
      movement("old salary", "ingreso", 3000, "2025-01-01"),
      movement("expense", "gasto", 10, "2026-03-31"),
    ], [], now)).toBeNull();
  });

  it("excludes charges in subscription wallets but keeps other wallet expenses", () => {
    const estimates = calculateProjectionEstimates([
      movement("history", "gasto", 0, "2026-02-28"),
      movement("salary", "ingreso", 3100, "2026-03-01"),
      movement("unrecognised charge", "gasto", 50, "2026-03-10", { hucha_id: "subs" }),
      movement("groceries", "gasto", 31, "2026-03-10", { hucha_id: "main" }),
    ], [], now, [
      { id: "subs", es_suscripciones: true },
      { id: "main", es_suscripciones: false },
    ]);
    expect(estimates?.dailyVariableExpense).toBe(1);
  });

  it("matches normalized names on word boundaries and requires four characters", () => {
    const estimates = calculateProjectionEstimates([
      movement("history", "gasto", 0, "2026-02-28"),
      movement("salary", "ingreso", 3100, "2026-03-01"),
      movement("PAGO ÁMAZON-PRIME ES 1234", "gasto", 50, "2026-03-10"),
      movement("pago xamazon prime es", "gasto", 31, "2026-03-10"),
      movement("pago amazon primer es", "gasto", 31, "2026-03-10"),
      movement("pago ACME 1234", "gasto", 50, "2026-03-10"),
      movement("pago ABC 1234", "gasto", 31, "2026-03-10"),
    ], [
      { ...subscription, nombre: "Amazon Prime" },
      { ...subscription, id: "four", nombre: "Acme" },
      { ...subscription, id: "short", nombre: "ABC" },
    ], now);
    expect(estimates?.dailyVariableExpense).toBe(3);
  });

  it("excludes past inactive subscription charges without scheduling them forward", () => {
    const estimates = calculateProjectionEstimates([
      movement("history", "gasto", 0, "2026-02-28"),
      movement("salary", "ingreso", 3100, "2026-03-01"),
      movement("pago amazon prime es 1234", "gasto", 50, "2026-03-10"),
      movement("SPOTIFY AB", "gasto", 15, "2026-03-10"),
    ], [
      { ...subscription, nombre: "Amazon Prime", activa: false },
      { ...subscription, id: "spotify", nombre: "Spotify Duo", activa: false },
    ], now);
    expect(estimates?.dailyVariableExpense).toBe(0);
    expect(estimates?.activeSubscriptions).toEqual([]);
    expect(buildProjectionData(100, estimates!, now, 60).at(-1)?.balance).toBe(6100);
  });
});

describe("buildProjectionData", () => {
  it.each(["2026-04-10", "2026-04-05"])(
    "never charges on or after cancellation at %s",
    (cancel_at) => {
      const projected = buildProjectionData(100, {
        dailyIncome: 0,
        dailyVariableExpense: 0,
        observedDays: 31,
        observedMonths: 1,
        activeSubscriptions: [{ ...subscription, cancel_at }],
      }, new Date(2026, 2, 1, 18, 30), 100);
      expect(projected.find(({ rawDate }) => rawDate.getMonth() === 2 && rawDate.getDate() === 10)?.balance).toBe(85);
      expect(projected.filter(({ rawDate }) => rawDate >= new Date(2026, 3, 1)).every(({ balance }) => balance === 85)).toBe(true);
      expect(projected.at(-1)?.balance).toBe(85);
    },
  );
});

describe("projection adjustments", () => {
  const start = new Date(2026, 0, 31, 18, 30);
  const estimates: ProjectionEstimates = {
    dailyIncome: 0, dailyVariableExpense: 0,
    observedDays: 31, observedMonths: 1, activeSubscriptions: [],
  };

  it("applies a one-off amount from its calendar date, rounded to cents", () => {
    const points = buildProjectionData(100, estimates, start, 5, null, [
      { id: "car", tipo: "puntual", importe: -40.126, fecha: new Date(2026, 1, 2) },
    ]);
    expect(points.map((point) => point.scenario)).toEqual([100, 100, 59.87, 59.87, 59.87, 59.87]);
    expect(points.every((point) => point.balance === 100)).toBe(true);
  });

  it("repeats monthly from desde and clamps the anchor day in short months", () => {
    const points = buildProjectionData(100, estimates, start, 90, null, [
      { id: "salary", tipo: "mensual", importe: 150, desde: new Date(2026, 1, 28) },
    ]);
    expect(points[0].scenario).toBe(100);
    expect(points.find((point) => point.rawDate.getMonth() === 1 && point.rawDate.getDate() === 27)?.scenario).toBe(100);
    expect(points.at(-1)?.scenario).toBe(550);
    const monthEnd = buildProjectionData(100, estimates, start, 59, null, [
      { id: "salary", tipo: "mensual", importe: 10 },
    ]);
    expect(monthEnd[0].scenario).toBe(110);
    expect(monthEnd.at(-1)?.scenario).toBe(130);
  });

  it("cancels only actual charges, respecting personal share, cadence and cancellation date", () => {
    const withSubscriptions = { ...estimates, activeSubscriptions: [
      { ...subscription, frecuencia: "trimestral" as const, fecha_inicio: "2026-01-10", mi_parte: 6.25, cancel_at: "2026-07-10" },
    ] };
    const points = buildProjectionData(100, withSubscriptions, start, 200, null, [
      { id: "cancel", tipo: "cancelar_suscripcion", suscripcionId: subscription.id },
      { id: "duplicate", tipo: "cancelar_suscripcion", suscripcionId: subscription.id },
    ]);
    expect(points.at(-1)?.balance).toBe(93.75);
    expect(points.every((point) => point.scenario === 100)).toBe(true);
  });

  it("combines multiple adjustments without modifying baseline or uncertainty samples", () => {
    const withSubscriptions = { ...estimates, activeSubscriptions: [subscription] };
    const variability = { standardDeviation: 12.345, periods: 3 };
    const baseline = buildProjectionData(100, withSubscriptions, start, 90, variability);
    const points = buildProjectionData(100, withSubscriptions, start, 90, variability, [
      { id: "purchase", tipo: "puntual", importe: -200, fecha: start },
      { id: "salary", tipo: "mensual", importe: 20 },
      { id: "cancel", tipo: "cancelar_suscripcion", suscripcionId: subscription.id },
    ]);
    expect(points.map(({ name, balance, rawDate, low, high }) => ({ name, balance, rawDate, low, high }))).toEqual(baseline);
    expect(points.at(-1)?.scenario).toBe(-20);
    expect(scenarioSummary(points)).toEqual({ difference: -75, firstNegativeDate: start });
  });

  it("does not add any scenario fields without adjustments", () => {
    const baseline = buildProjectionData(100, estimates, start, 5);
    expect(buildProjectionData(100, estimates, start, 5, null, [])).toEqual(baseline);
    baseline.forEach((point) => expect(point).not.toHaveProperty("scenario"));
  });

  it("rounds recurring subscription amounts independently in the scenario", () => {
    const points = buildProjectionData(100, {
      ...estimates, activeSubscriptions: [{ ...subscription, importe: 6.256 }],
    }, start, 90, null, [{ id: "cancel", tipo: "cancelar_suscripcion", suscripcionId: subscription.id }]);
    expect(points.every((point) => point.scenario === 100)).toBe(true);
    expect(points.at(-1)?.balance).toBe(81.22);
  });

  it("reports an exact crossing between samples even if the scenario recovers", () => {
    const points = buildProjectionData(100, estimates, start, 90, null, [
      { id: "expense", tipo: "puntual", importe: -150, fecha: new Date(2026, 1, 1) },
      { id: "income", tipo: "puntual", importe: 200, fecha: new Date(2026, 1, 2) },
    ]);
    expect(points.every((point) => point.scenario! >= 0)).toBe(true);
    expect(scenarioSummary(points)).toEqual({ difference: 50, firstNegativeDate: new Date(2026, 1, 1, 18, 30) });
  });

  it("summarises supplied points and handles absent scenarios and empty data", () => {
    expect(scenarioSummary([])).toEqual({ difference: 0, firstNegativeDate: null });
    expect(scenarioSummary(buildProjectionData(100, estimates, start, 5))).toEqual({ difference: 0, firstNegativeDate: null });
    expect(scenarioSummary([
      { name: "a", balance: 100, scenario: 0, rawDate: start },
      { name: "b", balance: 100, scenario: -2.123, rawDate: new Date(2026, 1, 1) },
      { name: "c", balance: 100, scenario: 110.126, rawDate: new Date(2026, 1, 2) },
    ])).toEqual({ difference: 10.13, firstNegativeDate: new Date(2026, 1, 1) });
  });
});
