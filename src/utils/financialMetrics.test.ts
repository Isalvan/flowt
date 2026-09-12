import { describe, expect, it } from "vitest";
import type { Movimiento, Suscripcion } from "../types";
import { calculateAdvancedFinancialMetrics } from "./financialMetrics";

const movement = (
  id: string,
  tipo: Movimiento["tipo"],
  importe: number,
  date: unknown,
  es_interno = false,
): Movimiento => ({
  id,
  tipo,
  importe,
  fecha_operacion: date,
  concepto: id,
  es_interno,
});
const sub = (overrides: Partial<Suscripcion>): Suscripcion => ({
  id: "sub",
  nombre: "Servicio",
  importe: 12,
  frecuencia: "mensual",
  dia_pago: 1,
  categoria: "software",
  color: "#000",
  activa: true,
  ...overrides,
});

describe("calculateAdvancedFinancialMetrics", () => {
  it("uses more than ten movements and excludes internal ones", () => {
    const movements = Array.from({ length: 12 }, (_, index) =>
      movement(
        String(index),
        index === 0 ? "ingreso" : "gasto",
        index === 0 ? 1200 : 10,
        new Date(2026, 0, index + 1),
      ),
    );
    movements.push(
      movement("internal", "gasto", 9999, new Date(2026, 0, 6), true),
    );
    const result = calculateAdvancedFinancialMetrics(
      movements,
      1000,
      [],
      new Date(2026, 0, 12),
    );
    expect(result?.observedDays).toBe(11);
    expect(result?.dailyBurnRate).toBe(10);
  });

  it("normalises cadence, shared amount and inactive subscriptions", () => {
    const result = calculateAdvancedFinancialMetrics(
      [
        movement("income", "ingreso", 1200, "2026-01-01"),
        movement("expense", "gasto", 100, {
          toDate: () => new Date(2026, 1, 1),
        }),
      ],
      1000,
      [
        sub({ id: "monthly" }),
        sub({ id: "annual", importe: 120, frecuencia: "anual" }),
        sub({ id: "shared", importe: 30, mi_parte: 6 }),
        sub({ id: "inactive", importe: 100, activa: false }),
      ],
      new Date(2026, 1, 1),
    );
    expect(result?.monthlySubscriptions).toBe(28);
  });
});
