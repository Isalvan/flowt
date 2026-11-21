import React, { useId, useState } from "react";
import { ChevronRight, type LucideIcon } from "lucide-react";

export interface AnalysisItem {
  id: string;
  title: string;
  subtitle: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

const AnalysisRow: React.FC<{ item: AnalysisItem }> = ({ item }) => {
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const Icon = item.icon;
  return (
    <div className="border-t border-line first:border-t-0">
      <button
        type="button"
        aria-expanded={open}
        aria-controls={bodyId}
        onClick={() => setOpen(!open)}
        className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors duration-150 hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand"
      >
        <span className="dashboard-icon !h-8 !w-8 bg-brand-tint text-brand-ink">
          <Icon size={15} />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[13px] font-bold text-ink">{item.title}</span>
          <span className="block truncate text-[11px] text-ink-soft">{item.subtitle}</span>
        </span>
        <ChevronRight
          size={16}
          aria-hidden="true"
          className={`shrink-0 text-ink-faint transition-transform duration-200 motion-reduce:transition-none ${open ? "rotate-90" : ""}`}
        />
      </button>
      {/* Only an open row mounts its card, so the charts cost nothing until asked for. */}
      {open && (
        <div id={bodyId} className="more-analysis-body px-2 pb-3 sm:px-3">
          {item.content}
        </div>
      )}
    </div>
  );
};

/** On a phone the analysis cards sit folded in one list, each opening in place. */
export const MoreAnalysis: React.FC<{ items: AnalysisItem[] }> = ({ items }) => (
  <section aria-label="Más análisis" className="dashboard-surface overflow-hidden !p-0">
    <div className="px-4 pb-1 pt-4">
      <h3 className="dashboard-heading">Más análisis</h3>
      <p className="dashboard-subtitle">Toca una para abrirla</p>
    </div>
    <div>
      {items.map((item) => (
        <AnalysisRow key={item.id} item={item} />
      ))}
    </div>
  </section>
);
