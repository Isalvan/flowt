/** Placeholder for a tab while its code or its data loads: a heading and a few rows. */
export const TabLoading = () => (
  <div className="space-y-5" role="status" aria-busy="true">
    <span className="sr-only">Cargando…</span>
    <div className="space-y-2.5">
      <div className="h-8 w-48 rounded-xl shimmer-placeholder" />
      <div className="h-4 w-64 max-w-full rounded shimmer-placeholder" />
    </div>
    <div className="dashboard-surface space-y-4 p-5">
      {[...Array(5)].map((_, i) => (
        <div key={i} className="flex items-center gap-3">
          <div className="h-10 w-10 shrink-0 rounded-xl shimmer-placeholder" />
          <div className="flex-1 space-y-2">
            <div className="h-3.5 w-2/5 rounded shimmer-placeholder" />
            <div className="h-2.5 w-1/4 rounded shimmer-placeholder" />
          </div>
          <div className="h-4 w-16 rounded shimmer-placeholder" />
        </div>
      ))}
    </div>
  </div>
);
