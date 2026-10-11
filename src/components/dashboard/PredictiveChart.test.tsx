import { Children, isValidElement, type ReactNode } from "react";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Movimiento, Suscripcion } from "../../types";
import { PredictiveChart } from "./PredictiveChart";
import { buildProjectionData, calculateProjectionEstimates, netVariability } from "../../utils/predictive";

const state = vi.hoisted(() => ({ locked: false, inicioPeriodo: 1, chartData: [] as Array<{ name: string; balance: number; low?: number; high?: number }> }));
const currency = (value: number) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(value);
vi.mock("../../context/PrivacyContext", () => ({
  usePrivacy: () => ({ isLocked: state.locked, formatCurrency: currency }),
}));
vi.mock("../../context/PreferencesContext", () => ({
  usePreferences: () => ({ inicioPeriodo: state.inicioPeriodo }),
}));
vi.mock("recharts", () => ({
  ResponsiveContainer: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  AreaChart: ({ children, data }: { children: ReactNode; data: typeof state.chartData }) => {
    state.chartData = data;
    return <div>{Children.map(children, (child) => isValidElement(child) && child.type === "defs" ? <svg>{child}</svg> : child)}</div>;
  },
  ComposedChart: ({ children, data }: { children: ReactNode; data: typeof state.chartData }) => {
    state.chartData = data;
    return <div>{Children.map(children, (child) => isValidElement(child) && child.type === "defs" ? <svg>{child}</svg> : child)}</div>;
  },
  Area: ({ stroke, fill }: { stroke: string; fill: string }) => <div data-testid={stroke === "none" ? "band" : "expected-line"} data-fill={fill} />,
  Line: ({ name, strokeDasharray }: { name: string; strokeDasharray: string }) => <div data-testid="scenario-line" data-name={name} data-dash={strokeDasharray} />,
  XAxis: () => null,
  YAxis: ({ domain }: { domain: number[] }) => <div data-testid="y-axis" data-domain={JSON.stringify(domain)} />,
  CartesianGrid: () => null,
  Tooltip: ({ content }: { content: (props: unknown) => ReactNode }) => {
    const point = state.chartData.at(-1);
    // The range series precedes balance: tooltip must read the point, not the first value.
    return content({ active: true, label: point?.name, payload: [{ value: [point?.low, point?.high], payload: point }] });
  },
}));

const now = new Date(2026, 3, 20, 12);
const movement = (month: number, amount: number, day = 1): Movimiento => ({
  id: String(month), concepto: "Ingreso", tipo: "ingreso", importe: amount, fecha_operacion: new Date(2026, month, day),
});
const history = [movement(0, 100), movement(1, 200), movement(2, 300)];
const show = (movements = history) => render(<PredictiveChart huchas={[]} suscripciones={[]} allMovimientos={movements} />);

describe("PredictiveChart", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    localStorage.clear();
    state.locked = false;
    state.inicioPeriodo = 1;
  });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it("shows horizon-end scenarios, the full band and an accessible summary", () => {
    show();
    for (const label of ["Prudente", "Esperado", "Optimista"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.queryByText("Mínimo")).not.toBeInTheDocument();
    expect(screen.getByText("La franja refleja lo que ha variado tu ahorro en tus últimos 3 periodos.")).toBeInTheDocument();
    expect(screen.getByTestId("band")).toHaveAttribute("data-fill", "var(--brand)");
    expect(screen.getByTestId("expected-line")).toHaveAttribute("data-fill", "none");
    const estimates = calculateProjectionEstimates(history, [], now)!;
    const points = buildProjectionData(0, estimates, now, 91, netVariability(history, now, { inicioPeriodo: 1, nominas: [] }));
    const last = points.at(-1)!;
    expect(screen.getByRole("img")).toHaveAttribute("aria-label", expect.stringContaining(`entre ${currency(last.low!)} y ${currency(last.high!)}`));
    expect(screen.getByText(/^Saldo esperado:/)).toHaveTextContent(`Saldo esperado: ${currency(last.balance)}`.replace(/\s/g, " "));
    expect(screen.getByText(/^entre /)).toHaveTextContent(`entre ${currency(last.low!)} y ${currency(last.high!)}`.replace(/\s/g, " "));
    const domain = JSON.parse(screen.getByTestId("y-axis").getAttribute("data-domain")!) as number[];
    expect(domain[0]).toBeLessThanOrEqual(Math.min(...points.map((point) => point.low!)));
    expect(domain[1]).toBeGreaterThanOrEqual(Math.max(...points.map((point) => point.high!)));
  });

  it("keeps original figures and explains missing complete history without a band", () => {
    show([movement(1, 200), movement(2, 300)]);
    for (const label of ["Mínimo", "Máximo", "Variación"]) expect(screen.getByText(label)).toBeInTheDocument();
    expect(screen.getByText("Con tres periodos completos de historial verás también una franja de incertidumbre.")).toBeInTheDocument();
    expect(screen.queryByTestId("band")).not.toBeInTheDocument();
    expect(screen.queryByText(/^entre /)).not.toBeInTheDocument();
  });

  it("uses the user's period preference", () => {
    state.inicioPeriodo = 15;
    show([movement(0, 100, 15), movement(1, 200, 15), movement(2, 300, 15)]);
    expect(screen.getByText("Prudente")).toBeInTheDocument();
    expect(screen.getByText(/últimos 3 periodos/)).toBeInTheDocument();
  });

  it("hides figures, tooltip, range summary and help when locked", () => {
    state.locked = true;
    show();
    expect(screen.getByText("Gráfica protegida por privacidad")).toBeInTheDocument();
    expect(screen.queryByText("Prudente")).not.toBeInTheDocument();
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
    expect(screen.queryByText(/Saldo esperado:/)).not.toBeInTheDocument();
    expect(screen.queryByText(/La franja refleja/)).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Añadir supuesto" })).not.toBeInTheDocument();
    expect(screen.queryByText(/Los supuestos son para probar/)).not.toBeInTheDocument();
  });

  it("adds and removes a one-off scenario, shows its summary and expands the axis", () => {
    show();
    const add = screen.getByRole("button", { name: "Añadir supuesto" });
    fireEvent.click(add);
    expect(screen.getByLabelText("Tipo de supuesto")).toHaveFocus();
    fireEvent.change(screen.getByLabelText("Descripción (opcional)"), { target: { value: "Coche" } });
    fireEvent.change(screen.getByLabelText("Importe (€)"), { target: { value: "9000" } });
    fireEvent.click(screen.getByRole("button", { name: "Añadir" }));
    expect(screen.getByText(/^Coche ·/)).toHaveTextContent("−9000");
    expect(screen.getByRole("status")).toHaveTextContent(`Con tus supuestos acabarías con ${currency(9000)} menos`.replace(/\s/g, " "));
    expect(screen.getByRole("status")).toHaveTextContent("y te quedarías sin saldo el 20 abr");
    expect(screen.getByTestId("scenario-line")).toHaveAttribute("data-dash", "6 4");
    expect(screen.getByText(/^Con tus supuestos:/)).toBeInTheDocument();
    expect(JSON.parse(screen.getByTestId("y-axis").getAttribute("data-domain")!)[0]).toBeLessThanOrEqual(-9000);
    expect(add).toHaveFocus();
    fireEvent.click(screen.getByRole("button", { name: /^Quitar supuesto Coche/ }));
    expect(screen.queryByText(/^Coche ·/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scenario-line")).not.toBeInTheDocument();
  });

  it("cancels with Escape and restores focus without adding an adjustment", () => {
    show();
    const add = screen.getByRole("button", { name: "Añadir supuesto" });
    fireEvent.click(add);
    fireEvent.keyDown(screen.getByLabelText("Descripción (opcional)"), { key: "Escape" });
    expect(screen.queryByRole("form")).not.toBeInTheDocument();
    expect(add).toHaveFocus();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("adds monthly income and clears multiple assumptions without persisting them", () => {
    show();
    for (let index = 0; index < 2; index += 1) {
      fireEvent.click(screen.getByRole("button", { name: "Añadir supuesto" }));
      fireEvent.change(screen.getByLabelText("Tipo de supuesto"), { target: { value: "mensual" } });
      fireEvent.change(screen.getByLabelText("Descripción (opcional)"), { target: { value: "Sueldo" } });
      fireEvent.change(screen.getByLabelText("Importe al mes (€)"), { target: { value: "150" } });
      fireEvent.change(screen.getByLabelText("Gasto o ingreso"), { target: { value: "ingreso" } });
      fireEvent.submit(screen.getByRole("form"));
    }
    expect(screen.getAllByText(/^Sueldo ·/)).toHaveLength(2);
    expect(screen.getByRole("status")).toHaveTextContent("más");
    expect(localStorage.length).toBe(0);
    fireEvent.click(screen.getByRole("button", { name: "Quitar todos" }));
    expect(screen.queryByText(/^Sueldo ·/)).not.toBeInTheDocument();
  });

  it("offers active subscriptions and removes future charges in the scenario", () => {
    const subscription: Suscripcion = {
      id: "netflix", nombre: "Netflix", importe: 15, frecuencia: "mensual",
      activa: true, dia_pago: 25, categoria: "streaming", color: "#000",
    };
    render(<PredictiveChart huchas={[]} suscripciones={[subscription, { ...subscription, id: "inactive", nombre: "Inactiva", activa: false }]} allMovimientos={history} />);
    fireEvent.click(screen.getByRole("button", { name: "Añadir supuesto" }));
    fireEvent.change(screen.getByLabelText("Tipo de supuesto"), { target: { value: "cancelar_suscripcion" } });
    expect(screen.getByRole("option", { name: "Netflix" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "Inactiva" })).not.toBeInTheDocument();
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByText("Sin Netflix")).toBeInTheDocument();
    expect(screen.getByRole("status")).toHaveTextContent(`Con tus supuestos acabarías con ${currency(45)} más`.replace(/\s/g, " "));
  });

  it("rejects out-of-range dates and discards assumptions on remount", () => {
    const view = show();
    fireEvent.click(screen.getByRole("button", { name: "Añadir supuesto" }));
    fireEvent.change(screen.getByLabelText("Importe (€)"), { target: { value: "10" } });
    const date = screen.getByLabelText("Fecha");
    expect(date).toHaveAttribute("min", "2026-04-20");
    expect(date).toHaveAttribute("max", "2031-04-20");
    for (const value of ["2026-04-19", "2031-04-21"]) {
      fireEvent.change(date, { target: { value } });
      fireEvent.submit(screen.getByRole("form"));
      expect(screen.queryByRole("status")).not.toBeInTheDocument();
    }
    fireEvent.change(date, { target: { value: "2026-04-20" } });
    fireEvent.submit(screen.getByRole("form"));
    expect(screen.getByRole("status")).toBeInTheDocument();
    view.unmount();
    show();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
    expect(screen.queryByTestId("scenario-line")).not.toBeInTheDocument();
  });
});
