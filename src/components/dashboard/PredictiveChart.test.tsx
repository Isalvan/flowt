import { Children, isValidElement, type ReactNode } from "react";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Movimiento } from "../../types";
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
  Area: ({ stroke, fill }: { stroke: string; fill: string }) => <div data-testid={stroke === "none" ? "band" : "expected-line"} data-fill={fill} />,
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
  });
});
