import { fireEvent, render, renderHook, screen } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComponentProps } from "react";
import type { Movimiento } from "../../types";
import { DashboardView } from "./DashboardView";
import { useFinanceData } from "../../hooks/useFinanceData";
import { PreferencesProvider } from "../../context/PreferencesContext";
import { walletAccent } from "../../utils/walletAccent";

const privacy = vi.hoisted(() => ({ isLocked: false }));
beforeEach(() => { privacy.isLocked = false; });
vi.mock("../../context/PrivacyContext", () => ({
  usePrivacy: () => ({
    isLocked: privacy.isLocked,
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
    periodStatus,
    featured,
  }: {
    balance: number;
    ingresos: number;
    gastos: number;
    periodStatus?: "loading" | "error";
    featured?: { nombre: string; saldo: number; accent: string };
  }) => (
    <div
      data-testid="overview"
      data-balance={balance}
      data-income={periodStatus ? "—" : ingresos}
      data-expense={periodStatus ? "—" : gastos}
      data-featured={featured ? JSON.stringify(featured) : undefined}
    >
      Saldo actual
      {periodStatus && <p role={periodStatus === "error" ? "alert" : "status"}>
        {periodStatus === "error" ? "No se pudieron cargar los movimientos históricos." : "Cargando movimientos…"}
      </p>}
    </div>
  ),
}));
vi.mock("./AnalyticsSection", () => ({
  AnalyticsSection: ({ chartData, periodStatus }: { chartData: unknown; periodStatus?: "loading" | "error" }) => periodStatus ? (
    <div>{periodStatus === "error" ? "No se pudieron cargar los movimientos históricos." : "Cargando movimientos…"}</div>
  ) : (
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

const renderDashboard = (overrides: Partial<ComponentProps<typeof DashboardView>> = {}, withPreferences = false) => {
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
  const dashboard = (
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
      {...overrides}
    />
  );
  const view = render(withPreferences ? <PreferencesProvider forceDemo>{dashboard}</PreferencesProvider> : dashboard);
  return {
    ...view,
    update: (next: Partial<ComponentProps<typeof DashboardView>>) =>
      view.rerender(<DashboardView {...dashboard.props} {...overrides} {...next} />),
  };
};

const choosePeriod = (name: string) => {
  fireEvent.click(
    screen.getByRole("button", { name: /histórico|este mes|mes pasado/i }),
  );
  fireEvent.click(screen.getByRole("option", { name }));
};

describe("Dashboard period selector", () => {
  it.each(['ocio', 'missing', 'archived'])('resolves the featured preference %s using only active wallets', selected => {
    localStorage.setItem('flowt:prefs:demo', JSON.stringify({ cifraDestacada: selected }));
    renderDashboard({ huchas: [
      { id: 'archived', nombre: 'Archivada', activa: false, saldo_acumulado: 999, objetivo: null, tipo_aportacion: 'flat', orden: 0 },
      { id: 'ahorro', nombre: 'Ahorro', saldo_acumulado: 456, objetivo: null, tipo_aportacion: 'flat', orden: 1 },
      { id: 'ocio', nombre: 'Ocio', activa: true, saldo_acumulado: 123, objetivo: null, tipo_aportacion: 'flat', orden: 2 },
    ] }, true);
    const overview = screen.getByTestId('overview');
    if (selected === 'ocio') expect(JSON.parse(overview.getAttribute('data-featured')!)).toEqual({ nombre: 'Ocio', saldo: 123, accent: walletAccent(1).fill });
    else {
      expect(overview).not.toHaveAttribute('data-featured');
      expect(overview).toHaveAttribute('data-balance', '4321');
    }
    expect(JSON.parse(localStorage.getItem('flowt:prefs:demo')!).cifraDestacada).toBe(selected);
    localStorage.clear();
  });
  it("renders complete historical figures from the demo mocks", async () => {
    localStorage.clear();
    const { result } = renderHook(() => useFinanceData(true));
    renderDashboard({
      chartMovements: result.current.chartMovements,
      chartMovementsLoading: result.current.chartMovementsLoading,
      olderMovements: result.current.olderMovements,
      olderMovementsLoaded: result.current.olderMovementsLoaded,
      loadOlderMovements: result.current.loadOlderMovements,
    });
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "2570");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-expense", "124.99");
    expect((await screen.findByTestId("chart-data")).textContent).toContain("2450");
  });

  it("requests older movements for histórico and hides partial figures until they arrive", async () => {
    const loadOlderMovements = vi.fn().mockResolvedValue(undefined);
    const view = renderDashboard({ loadOlderMovements, olderMovementsLoading: true, olderMovementsLoaded: false });
    expect(loadOlderMovements).toHaveBeenCalledTimes(1);
    expect(screen.getByRole("status")).toHaveTextContent("Cargando movimientos");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-balance", "4321");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "—");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-expense", "—");
    expect(screen.queryByTestId("chart-data")).not.toBeInTheDocument();

    choosePeriod("Este mes");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "1000");
    choosePeriod("Histórico");
    expect(loadOlderMovements).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "—");

    view.update({
      olderMovements: [movement("old", "ingreso", 300, new Date(2020, 0, 1))],
      loadOlderMovements,
      olderMovementsLoading: false,
      olderMovementsLoaded: true,
    });
    expect(screen.queryByText(/Cargando movimientos/)).not.toBeInTheDocument();
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "2000");
    expect((await screen.findByTestId("chart-data")).textContent).toContain("300");
  });

  it("shows a historical error without partial totals or charts", () => {
    renderDashboard({ loadOlderMovements: vi.fn().mockResolvedValue(undefined), olderMovementsError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar los movimientos históricos.");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-balance", "4321");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "—");
    expect(screen.getByTestId("overview")).toHaveAttribute("data-expense", "—");
    expect(screen.queryByTestId("chart-data")).not.toBeInTheDocument();
  });

  it("never reports loading while locked, even without an unlock action", () => {
    privacy.isLocked = true;
    const loadOlderMovements = vi.fn().mockResolvedValue(undefined);
    renderDashboard({ chartMovementsLoading: true, olderMovementsLoading: true, loadOlderMovements });
    expect(screen.queryByText(/Cargando movimientos/)).not.toBeInTheDocument();
    expect(screen.queryByRole("status", { name: /Cargando/ })).not.toBeInTheDocument();
    expect(loadOlderMovements).not.toHaveBeenCalled();
  });

  it("retries after returning to histórico and shows the successful totals without a retry loop", async () => {
    const loadOlderMovements = vi.fn().mockResolvedValue(undefined);
    const view = renderDashboard({ loadOlderMovements, olderMovementsLoading: true });
    expect(loadOlderMovements).toHaveBeenCalledTimes(1);
    view.update({ olderMovementsLoading: false, olderMovementsError: true });
    expect(screen.getByRole("alert")).toHaveTextContent("No se pudieron cargar");
    expect(loadOlderMovements).toHaveBeenCalledTimes(1);
    choosePeriod("Este mes");
    choosePeriod("Histórico");
    expect(loadOlderMovements).toHaveBeenCalledTimes(2);
    view.update({ olderMovementsLoading: true, olderMovementsError: false });
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "—");
    view.update({
      olderMovementsLoading: false,
      olderMovementsError: false,
      olderMovementsLoaded: true,
      olderMovements: [movement("old", "ingreso", 300, new Date(2020, 0, 1))],
    });
    expect(screen.getByTestId("overview")).toHaveAttribute("data-income", "2000");
    expect((await screen.findByTestId("chart-data")).textContent).toContain("300");
    expect(loadOlderMovements).toHaveBeenCalledTimes(2);
  });

  it("starts with historical figures and chart data", async () => {
    renderDashboard();
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-income",
      "1700",
    );
    expect(screen.getByTestId("overview")).toHaveAttribute(
      "data-expense",
      "150",
    );
    expect((await screen.findByTestId("chart-data")).textContent).toContain("200");
  });

  it("filters this month and preserves the current balance", async () => {
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
    expect((await screen.findByTestId("chart-data")).textContent).not.toContain("500");
  });

  it("filters last month figures and chart data", async () => {
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
    expect((await screen.findByTestId("chart-data")).textContent).toContain("500");
    expect((await screen.findByTestId("chart-data")).textContent).not.toContain("1000");
  });
});
