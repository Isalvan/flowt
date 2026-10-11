import { lazy, Suspense, type ComponentProps } from "react";

const LazyAnalytics = lazy(() => import("./AnalyticsSection").then((m) => ({ default: m.AnalyticsSection })));
const LazyPredictive = lazy(() => import("./PredictiveChart").then((m) => ({ default: m.PredictiveChart })));
const LazyCategoryBreakdown = lazy(() => import("./CategoryBreakdown").then((m) => ({ default: m.CategoryBreakdown })));

const CategoryBreakdownPlaceholder = () => (
  <section className="dashboard-surface p-5" aria-busy="true">
    <div className="mb-3 h-10 w-48 rounded-xl bg-surface-2" />
    <div className="h-64 w-full rounded-2xl bg-surface-2" />
  </section>
);

const ChartHeader = ({ title, subtitle }: { title: string; subtitle: string }) => (
  <div className="flex min-w-0 items-center gap-3">
    <span className="dashboard-icon bg-surface-2" />
    <div className="min-w-0">
      <h3 className="dashboard-heading">{title}</h3>
      <p className="dashboard-subtitle">{subtitle}</p>
    </div>
  </div>
);

const AnalyticsPlaceholder = () => (
  <section className="dashboard-surface p-5" aria-busy="true" aria-label="Cargando evolución de finanzas">
    <div className="mb-3 flex items-center justify-between gap-3">
      <ChartHeader title="Evolución de finanzas" subtitle="Tus ingresos y gastos mes a mes" />
      <div className="h-[30px] w-14 shrink-0 rounded-xl bg-surface-2" />
    </div>
    <div className="h-64 w-full animate-pulse rounded-2xl bg-surface-2" />
    <div className="mt-2 flex justify-center gap-5 text-[11px] font-semibold text-ink-soft">
      <span>Ingresos</span><span>Gastos</span>
    </div>
  </section>
);

// About as tall as the card with a projection in it, so the page barely moves when the chart arrives.
const PredictivePlaceholder = () => (
  <section className="dashboard-surface p-5" aria-busy="true" aria-label="Cargando proyección de saldo">
    <div className="mb-3">
      <ChartHeader title="Proyección de saldo" subtitle="Próximos meses" />
    </div>
    <div className="h-72 w-full animate-pulse rounded-2xl bg-surface-2" />
  </section>
);

export const AnalyticsSection = (props: ComponentProps<typeof LazyAnalytics>) => (
  <Suspense fallback={<AnalyticsPlaceholder />}><LazyAnalytics {...props} /></Suspense>
);

export const PredictiveChart = (props: ComponentProps<typeof LazyPredictive>) => (
  <Suspense fallback={<PredictivePlaceholder />}><LazyPredictive {...props} /></Suspense>
);

export const CategoryBreakdown = (props: ComponentProps<typeof LazyCategoryBreakdown>) => (
  <Suspense fallback={<CategoryBreakdownPlaceholder />}><LazyCategoryBreakdown {...props} /></Suspense>
);
