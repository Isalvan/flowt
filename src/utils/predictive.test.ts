import { describe, expect, it } from "vitest";
import type { Movimiento, Suscripcion } from "../types";
import {
  buildProjectionData,
  calculateProjectionEstimates,
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
        movement("income", "ingreso", 1000, {
          toDate: () => new Date(2026, 0, 1, 23, 45),
        }),
        movement("expense", "gasto", 200, "2026-02-15T02:30:00+01:00"),
        movement("date", "gasto", 10, new Date(2026, 1, 1, 4)),
      ],
      [],
      now,
    );
    expect(estimates?.observedDays).toBe(45);
    expect(estimates?.dailyIncome).toBeCloseTo(22.22, 1);
    expect(estimates?.dailyVariableExpense).toBeCloseTo(4.67, 1);
  });

  it("ignores excluded movements and recognised subscription aliases", () => {
    const estimates = calculateProjectionEstimates(
      [
        movement("income", "ingreso", 900, "2026-01-01"),
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
        movement("income", "ingreso", 300, "2026-03-01"),
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
});
