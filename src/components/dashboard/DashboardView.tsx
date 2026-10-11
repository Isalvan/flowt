import React, { useEffect, useMemo, useRef, useState } from "react";
import { CalendarClock, Check, ChevronDown, Lock, Plus } from "lucide-react";
import type { Hucha, Movimiento, Suscripcion } from "../../types";
import { usePrivacy } from "../../context/PrivacyContext";
import { groupMovementsByMonth, parseMovimientoDate } from "../../utils/periodStats";
import { getNextSubscriptionChargeDate } from "../../utils/subscriptions";
import { cuentaEnEstadisticas, importeEnEstadisticas } from "../../utils/movements";
import { EmptyIllustration } from "../common/EmptyIllustration";
import { HuchaCard } from "./HuchaCard";
import { ActivityList } from "./ActivityList";
import { AnalyticsSection, CategoryBreakdown } from "./LazyCharts";
import { FinancialOverview } from "./FinancialOverview";
import { MonthlySummary } from "./MonthlySummary";
import { SmallPurchasesCard } from "./SmallPurchasesCard";
import { MoreActionsMenu } from "./MoreActionsMenu";
import { PredictiveChart } from "./LazyCharts";
import { ServiceIcon } from "./ServiceIcon";
import { walletAccent } from "../../utils/walletAccent";

type TimePeriod = "este_mes" | "mes_pasado" | "este_anio" | "historico";
const PERIODS: { value: TimePeriod; label: string }[] = [
  { value: "este_mes", label: "Este mes" },
  { value: "mes_pasado", label: "Mes pasado" },
  { value: "este_anio", label: "Este año" },
  { value: "historico", label: "Histórico" },
];
const greetingFor = (date: Date) => {
  const hour = date.getHours();
  if (hour >= 6 && hour < 13) return "Buenos días";
  if (hour >= 13 && hour < 21) return "Buenas tardes";
  return "Buenas noches";
};
interface ChartDatum {
  name: string;
  ingresos: number;
  gastos: number;
}
interface DashboardViewProps {
  /** First name for the greeting; left out while data is locked. */
  userName?: string;
  /** Whether a privacy PIN exists yet; picks the wording of the locked state. */
  hasPin?: boolean;
  /** Opens the PIN prompt. With it, a locked dashboard shows one clear way in. */
  onUnlock?: () => void;
  movimientos: Movimiento[];
  chartMovements: Movimiento[];
  chartMovementsLoading?: boolean;
  olderMovements?: Movimiento[];
  olderMovementsLoading?: boolean;
  olderMovementsLoaded?: boolean;
  olderMovementsError?: boolean;
  loadOlderMovements?: () => Promise<void>;
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  balance: number;
  huchaMonthlyBudgets: Record<string, number>;
  chartData: ChartDatum[];
  onUpdateConcepto: (id: string, concepto: string) => void;
  onUpdateCategoria?: (id: string, categoria: string) => Promise<void>;
  onAcceptCompensation?: (base: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => Promise<void>;
  onDismissCompensation?: (ingresoId: string, gastoId: string) => Promise<void>;
  onDismissDuplicate?: (aId: string, bId: string) => Promise<void>;
  onConvert: (m: Movimiento) => void;
  onLink: (m: Movimiento) => void;
  onUnlink: (m: Movimiento) => void;
  onChangeHucha: (m: Movimiento, id: string) => void;
  onDeleteMovimiento: (m: Movimiento) => void;
  onSubsanar?: (h: Hucha) => void;
  onRevertirDeuda?: (h: Hucha) => void;
  onOpenHuchaModal: (h: Hucha | null) => void;
  onDeleteHucha: (h: Hucha) => void;
  onOpenTransferModal: () => void;
  onOpenHistoryModal: () => void;
  onOpenManualMovimientoModal: () => void;
  onOpenCalendar?: () => void;
}

export const DashboardView: React.FC<DashboardViewProps> = (props) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const [period, setPeriod] = useState<TimePeriod>("historico");
  const [periodOpen, setPeriodOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const periodRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!periodOpen) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!periodRef.current?.contains(event.target as Node))
        setPeriodOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setPeriodOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [periodOpen]);
  const { loadOlderMovements } = props;
  useEffect(() => {
    if (period === "historico" && !isLocked) void loadOlderMovements?.();
  }, [period, isLocked, loadOlderMovements]);
  const historicalError = !isLocked && period === "historico" && props.olderMovementsError;
  const periodLoading = !isLocked && Boolean(props.chartMovementsLoading || (period === "historico" && !historicalError && (
    props.olderMovementsLoading || (loadOlderMovements && !props.olderMovementsLoaded)
  )));
  const periodStatus = historicalError ? "error" : periodLoading ? "loading" : undefined;
  const filtered = useMemo(() => {
    if (period === "historico")
      return [...props.chartMovements, ...(props.olderMovements ?? [])].filter(cuentaEnEstadisticas);
    const now = new Date();
    return props.chartMovements.filter((m) => {
      if (!cuentaEnEstadisticas(m)) return false;
      const d = parseMovimientoDate(m.fecha_operacion);
      if (!d) return false;
      if (period === "este_mes")
        return (
          d.getMonth() === now.getMonth() &&
          d.getFullYear() === now.getFullYear()
        );
      if (period === "este_anio") return d.getFullYear() === now.getFullYear();
      const previous = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return (
        d.getMonth() === previous.getMonth() &&
        d.getFullYear() === previous.getFullYear()
      );
    });
  }, [props.chartMovements, props.olderMovements, period]);
  const ingresos = filtered
    .filter((m) => m.tipo === "ingreso")
    .reduce((sum, m) => sum + importeEnEstadisticas(m), 0);
  const gastos = filtered
    .filter((m) => m.tipo === "gasto")
    .reduce((sum, m) => sum + importeEnEstadisticas(m), 0);
  const periodChartData = useMemo(() => groupMovementsByMonth(filtered), [filtered]);
  const trend = useMemo(
    () =>
      filtered
        .map((m) => ({
          time: parseMovimientoDate(m.fecha_operacion)?.getTime() ?? 0,
          value: (m.tipo === "ingreso" ? 1 : -1) * importeEnEstadisticas(m),
        }))
        .sort((a, b) => a.time - b.time)
        .reduce<number[]>(
          (running, point) => [
            ...running,
            (running[running.length - 1] ?? 0) + point.value,
          ],
          [],
        ),
    [filtered],
  );
  const upcoming = useMemo(
    () =>
      props.suscripciones
        .filter((s) => s.activa)
        .map((sub) => {
          const date = getNextSubscriptionChargeDate(sub);
          const daysLeft = Math.max(
            0,
            Math.ceil(
              (date.getTime() -
                new Date(new Date().setHours(0, 0, 0, 0)).getTime()) /
                86400000,
            ),
          );
          return { sub, date, daysLeft };
        })
        .sort((a, b) => a.daysLeft - b.daysLeft)
        .slice(0, 3),
    [props.suscripciones],
  );
  const periodLabel =
    PERIODS.find((p) => p.value === period)?.label ?? "Histórico";
  const wallets = props.huchas.filter((h) => h.activa !== false);
  const walletsTotal = wallets.reduce(
    (sum, h) => sum + Math.max(0, h.saldo_acumulado),
    0,
  );
  const now = new Date();
  const today = now.toLocaleDateString("es-ES", {
    weekday: "long",
    day: "numeric",
    month: "long",
  });
  const step = (i: number) => ({ "--i": i }) as React.CSSProperties;
  const dueLabel = (daysLeft: number) =>
    daysLeft === 0
      ? "Vence hoy"
      : daysLeft === 1
        ? "Vence mañana"
        : `Vence en ${daysLeft} días`;

  const greeting = (
    <div className="min-w-0">
      <h2 className="font-title text-[1.75rem] font-bold leading-tight text-ink sm:text-4xl">
        {greetingFor(now)}
        {props.userName ? `, ${props.userName}` : ""}
      </h2>
      <p className="mt-1 text-sm text-ink-soft first-letter:uppercase">
        {today}
      </p>
    </div>
  );

  // Locked: the data is not even loaded, so say so instead of showing empty lists.
  if (isLocked && props.onUnlock) {
    return (
      <div className="space-y-5 sm:space-y-7">
        <header className="rise" style={step(0)}>
          {greeting}
        </header>
        <section
          className="rise dashboard-surface grid place-items-center px-6 py-14 text-center sm:py-20"
          style={step(1)}
        >
          <span className="grid h-16 w-16 place-items-center rounded-full border-[3px] border-sun-500 text-ink">
            <Lock size={22} />
          </span>
          <h3 className="font-title mt-6 text-balance text-2xl font-bold text-ink sm:text-3xl">
            {props.hasPin ? "Tus datos están ocultos" : "Protege tus datos con un PIN"}
          </h3>
          <p className="mt-2 max-w-sm text-sm leading-relaxed text-ink-soft">
            {props.hasPin
              ? "Introduce tu PIN para ver tus saldos, carteras y movimientos."
              : "Flowt mantiene tus saldos ocultos hasta que introduces un PIN de 4 dígitos. Créalo para empezar."}
          </p>
          <button
            type="button"
            onClick={props.onUnlock}
            className="dashboard-primary-button mt-7 !px-6 !py-3.5 !text-sm"
          >
            <Lock size={15} />
            {props.hasPin ? "Desbloquear" : "Crear PIN"}
          </button>
          <p className="mt-4 hidden text-xs text-ink-faint md:block">
            o pulsa{" "}
            <kbd className="rounded-md border border-line-strong bg-surface-2 px-1.5 py-0.5 font-sans text-[11px] font-bold text-ink-soft">
              P
            </kbd>
          </p>
        </section>
      </div>
    );
  }

  return (
    <div className="space-y-5 sm:space-y-7">
      <header
        className="rise flex flex-col gap-4 md:flex-row md:items-end md:justify-between"
        style={step(0)}
      >
        {greeting}
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={props.onOpenManualMovimientoModal}
            className="dashboard-primary-button flex-1 md:order-last md:flex-none"
          >
            <Plus size={16} /> Añadir movimiento
          </button>
          <div ref={periodRef} className="relative">
            <button
              type="button"
              aria-haspopup="listbox"
              aria-expanded={periodOpen}
              onClick={() => setPeriodOpen(!periodOpen)}
              className="dashboard-period-button"
            >
              {periodLabel}
              <ChevronDown
                size={14}
                className={`transition-transform duration-200 ${periodOpen ? "rotate-180" : ""}`}
              />
            </button>
            {periodOpen && (
              <div
                role="listbox"
                aria-label="Periodo"
                className="glass-panel animate-in fade-in slide-in-from-top-1 absolute right-0 top-[calc(100%+6px)] z-40 w-40 rounded-2xl p-1 duration-150 md:left-0 md:right-auto"
              >
                {PERIODS.map(({ value, label }) => (
                  <button
                    role="option"
                    aria-selected={period === value}
                    type="button"
                    key={value}
                    onClick={() => {
                      setPeriod(value);
                      setPeriodOpen(false);
                    }}
                    className={`flex w-full items-center justify-between rounded-xl px-3 py-2 text-left text-xs font-bold transition-colors hover:bg-surface-2 ${period === value ? "text-brand-ink" : "text-ink"}`}
                  >
                    {label}
                    {period === value && <Check size={14} aria-hidden="true" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          <MoreActionsMenu
            open={actionsOpen}
            onToggle={() => setActionsOpen(!actionsOpen)}
            onClose={() => setActionsOpen(false)}
            onNewHucha={() => props.onOpenHuchaModal(null)}
            onTransfer={props.onOpenTransferModal}
            onHistory={props.onOpenHistoryModal}
          />
        </div>
      </header>

      <div className="rise" style={step(1)}>
        <FinancialOverview
          balance={props.balance}
          ingresos={ingresos}
          gastos={gastos}
          periodLabel={periodLabel}
          periodStatus={periodStatus}
          trend={trend}
        />
      </div>

      <section className="rise" style={step(2)}>
        <div className="mb-3 flex items-end justify-between gap-3">
          <div className="min-w-0">
            <h3 className="dashboard-heading">Mis carteras</h3>
            <p className="dashboard-subtitle">
              {wallets.length} {wallets.length === 1 ? "activa" : "activas"}
              {!isLocked && walletsTotal > 0 && (
                <> · {formatCurrency(walletsTotal)} repartidos</>
              )}
            </p>
          </div>
        </div>
        {!isLocked && walletsTotal > 0 && wallets.length > 1 && (
          <div
            role="img"
            aria-label="Cómo se reparte tu saldo entre las carteras"
            className="mb-3 flex h-1.5 gap-0.5"
          >
            {wallets.map((h, i) => {
              const share = Math.max(0, h.saldo_acumulado) / walletsTotal;
              return share > 0 ? (
                <span
                  key={h.id}
                  title={`${h.nombre} · ${Math.round(share * 100)}%`}
                  className={`h-full min-w-1 rounded-full ${walletAccent(i).fill}`}
                  style={{ width: `${share * 100}%` }}
                />
              ) : null;
            })}
          </div>
        )}
        <div className="flowt-wallets-grid -mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-2 sm:mx-0 sm:grid sm:grid-cols-2 sm:overflow-visible sm:px-0 sm:pb-0 lg:grid-cols-3 xl:grid-cols-[repeat(auto-fit,minmax(13rem,1fr))]">
          {wallets.length ? (
            <>
              {wallets.map((h, i) => (
                <div key={h.id} className="min-w-[78vw] snap-start sm:min-w-0">
                  <HuchaCard
                    hucha={h}
                    index={i}
                    onEdit={props.onOpenHuchaModal}
                    onDelete={props.onDeleteHucha}
                    onSubsanar={props.onSubsanar}
                    onRevertirDeuda={props.onRevertirDeuda}
                  />
                </div>
              ))}
              <button
                type="button"
                onClick={() => props.onOpenHuchaModal(null)}
                className="grid min-h-36 min-w-[44vw] snap-start place-items-center content-center gap-2 rounded-[1.25rem] border border-dashed border-line-strong text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-brand hover:bg-brand-tint hover:text-brand-ink sm:min-w-0"
              >
                <span className="grid h-9 w-9 place-items-center rounded-full bg-surface-2">
                  <Plus size={16} />
                </span>
                Nueva cartera
              </button>
            </>
          ) : (
            <div className="dashboard-empty w-full py-6 sm:col-span-2 lg:col-span-3 xl:col-span-full">
              <EmptyIllustration />
              <p>No tienes carteras activas</p>
              <button
                type="button"
                onClick={() => props.onOpenHuchaModal(null)}
                className="dashboard-secondary-button mt-2"
              >
                <Plus size={15} /> Crear la primera
              </button>
            </div>
          )}
        </div>
      </section>

      <div
        className="rise grid grid-cols-1 items-start gap-4 lg:grid-cols-3"
        style={step(3)}
      >
        <div className="min-w-0 space-y-4 lg:col-span-2">
          <AnalyticsSection
            chartData={periodChartData}
            huchas={props.huchas}
            suscripciones={props.suscripciones}
            allMovimientos={filtered}
            periodStatus={periodStatus}
          />
          <CategoryBreakdown
            allMovimientos={filtered}
            periodLabel={periodLabel}
            periodStatus={periodStatus}
          />
          <PredictiveChart
            huchas={props.huchas}
            suscripciones={props.suscripciones}
            allMovimientos={props.chartMovements}
          />
        </div>
        <section className="dashboard-surface min-w-0 p-5">
          <div className="mb-3 flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="dashboard-icon bg-brand-tint text-brand-ink">
                <CalendarClock size={18} />
              </span>
              <div className="min-w-0">
                <h3 className="dashboard-heading">Próximos cargos</h3>
                <p className="dashboard-subtitle">Movimientos programados</p>
              </div>
            </div>
            <button
              type="button"
              onClick={props.onOpenCalendar}
              className="shrink-0 rounded-lg py-1 text-xs font-bold text-brand-ink underline-offset-4 hover:underline"
            >
              Ver calendario
            </button>
          </div>
          {upcoming.length ? (
            <div className="divide-y divide-line">
              {upcoming.map(({ sub, date, daysLeft }) => (
                <div key={sub.id} className="flex items-center gap-3 py-3">
                  <ServiceIcon name={sub.nombre} color={sub.color} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-[13px] font-bold text-ink">
                      {sub.nombre}
                    </p>
                    <p className="text-[11px] text-ink-soft">
                      <span
                        className={
                          daysLeft <= 3
                            ? "font-bold text-sun-600 dark:text-sun-300"
                            : ""
                        }
                      >
                        {dueLabel(daysLeft)}
                      </span>{" "}
                      ·{" "}
                      {date.toLocaleDateString("es-ES", {
                        day: "numeric",
                        month: "short",
                      })}
                    </p>
                  </div>
                  <span className="text-[13px] font-extrabold tabular-nums text-ink">
                    {isLocked
                      ? "•• €"
                      : formatCurrency(sub.mi_parte ?? sub.importe)}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <div className="dashboard-empty">
              <p>No hay cargos próximos</p>
            </div>
          )}
          {upcoming.length > 0 && (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-faint">
              Las fechas se calculan desde tus suscripciones activas.
            </p>
          )}
        </section>
      </div>

      <div
        className="rise grid grid-cols-1 items-start gap-4 lg:grid-cols-3"
        style={step(4)}
      >
        <div className="min-w-0 lg:col-span-2">
          <ActivityList
            movimientos={props.movimientos}
            allMovimientos={props.chartMovements}
            huchas={props.huchas}
            huchaMonthlyBudgets={props.huchaMonthlyBudgets}
            onUpdateConcepto={props.onUpdateConcepto}
            onUpdateCategoria={props.onUpdateCategoria}
            onAcceptCompensation={props.onAcceptCompensation}
            onDismissCompensation={props.onDismissCompensation}
          onDismissDuplicate={props.onDismissDuplicate}
            onConvert={props.onConvert}
            onLink={props.onLink}
            onUnlink={props.onUnlink}
            onChangeHucha={props.onChangeHucha}
            onDeleteMovimiento={props.onDeleteMovimiento}
          />
        </div>
        <div className="min-w-0 space-y-4">
          <MonthlySummary movimientos={props.chartMovements} />
          <SmallPurchasesCard
            movimientos={filtered}
            periodLabel={periodLabel}
            totalGastos={gastos}
          />
        </div>
      </div>
    </div>
  );
};
