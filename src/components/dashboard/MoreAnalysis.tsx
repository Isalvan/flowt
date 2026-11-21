import React, { useId, useState } from "react";
import { type LucideIcon } from "lucide-react";

export interface AnalysisItem {
  id: string;
  /** Full name, read out by screen readers and shown as the tooltip. */
  title: string;
  /** One-line name for the tile. */
  short: string;
  icon: LucideIcon;
  content: React.ReactNode;
}

const COLUMNS = 3;

/**
 * On a phone the analysis cards sit folded in a compact grid. Tapping a tile opens
 * its card right under that row of tiles; tapping it again, or another tile, closes it.
 */
export const MoreAnalysis: React.FC<{ items: AnalysisItem[] }> = ({ items }) => {
  const [openId, setOpenId] = useState<string | null>(null);
  const bodyId = useId();
  const openIndex = items.findIndex((item) => item.id === openId);
  const open = openIndex >= 0 ? items[openIndex] : null;
  // The card goes after the last tile of the open tile's row.
  const rowEnd = open ? Math.min(items.length, (Math.floor(openIndex / COLUMNS) + 1) * COLUMNS) - 1 : -1;

  return (
    <section aria-label="Más análisis" className="dashboard-surface !p-3">
      <h3 className="dashboard-heading px-1 pb-2 pt-1">Más análisis</h3>
      <div className="grid grid-cols-3 gap-2">
        {items.map((item, i) => {
          const Icon = item.icon;
          const isOpen = item.id === openId;
          return (
            <React.Fragment key={item.id}>
              <button
                type="button"
                aria-label={item.title}
                title={item.title}
                aria-expanded={isOpen}
                aria-controls={isOpen ? bodyId : undefined}
                onClick={() => setOpenId(isOpen ? null : item.id)}
                className={`flex min-w-0 flex-col items-center gap-1.5 rounded-2xl border px-1 py-3 transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand ${
                  isOpen ? "border-brand bg-brand-tint text-brand-ink" : "border-transparent bg-surface-2 text-ink hover:border-line"
                }`}
              >
                <Icon size={18} aria-hidden="true" className="text-brand-ink" />
                <span className="block w-full truncate text-center text-[12px] font-bold">{item.short}</span>
              </button>
              {/* Only the open card mounts, so the charts cost nothing until asked for. */}
              {open && i === rowEnd && (
                <div id={bodyId} className="more-analysis-body col-span-3">
                  {open.content}
                </div>
              )}
            </React.Fragment>
          );
        })}
      </div>
    </section>
  );
};
