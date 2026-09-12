import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { Movimiento } from "../../types";
import { DashboardView } from "./DashboardView";

vi.mock("../../context/PrivacyContext", () => ({
  usePrivacy: () => ({
    isLocked: false,
    formatCurrency: (value: number) => String(value),
  }),
}));
vi.mock("./ActivityList", () => ({ ActivityList: () => <div>Actividad</div> }));
vi.mock("./HuchaCard", () => ({ HuchaCard: () => <div>Hucha</div> }));
vi.mock("./MonthlySummary", () => ({
  MonthlySummary: () => <div>Resumen</div>,
}));
vi.mock("./ServiceIcon", () => ({ ServiceIcon: () => <div>Servicio</div> }));
vi.mock("../common/EmptyIllustration", () => ({
  EmptyIllustration: () => <div />,
}));
vi.mock("./MoreActionsMenu", () => ({
  MoreActionsMenu: () => <button>Más acciones</button>,
}));
vi.mock("./FinancialOverview", () => ({
  FinancialOverview: ({
    balance,
    ingresos,
    gastos,
  }: {
    balance: number;
    ingresos: number;
    gastos: number;
  }) => (
    <div
      data-testid="overview"
      data-balance={balance}
      data-income={ingresos}
      data-expense={gastos}
    >
      Saldo actual
    </div>
  ),
}));
vi.mock("./AnalyticsSection", () => ({
  AnalyticsSection: ({ chartData }: { chartData: unknown }) => (
    <output data-testid="chart-data">{JSON.stringify(chartData)}</output>
  ),
}));

const dateAt = (year: number, month: number, day: number) =>
  new Date(year, month, day);
const movement = (
  id: string,
  tipo: Movimiento["tipo"],
  importe: number,
  date: Date,
): Movimiento => ({
  id,
  tipo,
  importe,
  fecha_operacion: date,
  concepto: id,
});

const renderDashboard = () => {
  const now = new Date();
  const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const older = new Date(now.getFullYear() - 1, 5, 1);
  const chartMovements = [
    movement(
      "current-income",
      "ingreso",
      1000,
      dateAt(now.getFullYear(), now.getMonth(), 2),
    ),
    movement(
      "current-expense",
      "gasto",
      100,
      dateAt(now.getFullYear(), now.getMonth(), 3),
    ),
    movement("previous-income", "ingreso", 500, previous),
    movement(
      "previous-expense",
      "gasto",
      50,
      dateAt(previous.getFullYear(), previous.getMonth(), 2),
    ),
    movement("older-income", "ingreso", 200, older),
  ];
  render(
    <DashboardView
      movimientos={chartMovements.slice(0, 2)}
      chartMovements={chartMovements}
      huchas={[]}
      suscripciones={[]}
      balance={4321}
      huchaMonthlyBudgets={{}}
      chartData={[]}
      onUpdateConcepto={vi.fn()}
      onConvert={vi.fn()}
      onLink={vi.fn()}
      onUnlink={vi.fn()}
      onChangeHucha={vi.fn()}
      onDeleteMovimiento={vi.fn()}
      onOpenHuchaModal={vi.fn()}
      onDeleteHucha={vi.fn()}
      onOpenTransferModal={vi.fn()}
      onOpenHistoryModal={vi.fn()}
      onOpenManualMovimientoModal={vi.fn()}
    />,
  );
};

const choosePeriod = (name: string) => {
  fireEvent.click(
    screen.getByRole("button", { name: /histórico|este mes|mes pasado/i }),
  );
  fireEvent.click(screen.getByRole("option", { name }));
};

describe("Dashboard period selector", () => {
  it("starts with historical figures and chart data", () => {
    renderDashboard();
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-income",
      "1700",
    );
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-expense",
      "150",
    );
    expect(screen.getByTestId("chart-data").textContent).toContain("200");
  });

  it("filters this month and preserves the current balance", () => {
    renderDashboard();
    choosePeriod("Este mes");
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-income",
      "1000",
    );
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-expense",
      "100",
    );
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-balance",
      "4321",
    );
    expect(screen.getByText("Saldo actual")).toBeInTheDocument();
    expect(screen.getByTestId("chart-data").textContent).not.toContain("500");
  });

  it("filters last month figures and chart data", () => {
    renderDashboard();
    choosePeriod("Mes pasado");
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-income",
      "500",
    );
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-expense",
      "50",
    );
    expect(screen.getByTestId("chart-data").textContent).toContain("500");
    expect(screen.getByTestId("chart-data").textContent).not.toContain("1000");
  });
});
