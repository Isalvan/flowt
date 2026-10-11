import React, { useMemo, useState } from 'react';
import { ShoppingBag } from 'lucide-react';
import type { Movimiento } from '../../types';
import { summarizeSmallPurchases } from '../../utils/smallPurchases';
import { usePrivacy } from '../../context/PrivacyContext';
import { usePreferences } from '../../context/PreferencesContext';

export interface SmallPurchasesCardProps {
  movimientos: Movimiento[];
  periodLabel: string;
  totalGastos: number;
  umbral?: number;
}

export const SmallPurchasesCard: React.FC<SmallPurchasesCardProps> = ({
  movimientos,
  periodLabel,
  totalGastos,
  umbral: propUmbral,
}) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const { umbralCompraPequena } = usePreferences();
  const [expanded, setExpanded] = useState(false);

  const umbral = propUmbral ?? umbralCompraPequena;

  const summary = useMemo(
    () => summarizeSmallPurchases(movimientos, umbral),
    [movimientos, umbral],
  );

  if (isLocked || summary.count === 0) {
    return null;
  }

  const porcentajeGasto =
    totalGastos > 0 ? Math.round((summary.total / totalGastos) * 100) : 0;

  const visibleMerchants = expanded
    ? summary.porComercio
    : summary.porComercio.slice(0, 3);
  const hasMore = summary.porComercio.length > 3;

  return (
    <section className="dashboard-surface self-start p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink">
          <ShoppingBag size={18} />
        </span>
        <div className="min-w-0">
          <h3 className="dashboard-heading">Compras pequeñas</h3>
          <p className="dashboard-subtitle">
            Menos de {umbral} € · {periodLabel.toLowerCase()}
          </p>
        </div>
      </div>

      <div className="mb-4">
        <div className="text-2xl font-extrabold tabular-nums text-ink">
          {formatCurrency(summary.total)}
        </div>
        <p className="mt-0.5 text-xs text-ink-soft">
          <span>
            {summary.count} {summary.count === 1 ? 'compra' : 'compras'}
          </span>
          {totalGastos > 0 && (
            <>
              <span aria-hidden="true"> · </span>
              <span>{porcentajeGasto} % de tu gasto</span>
            </>
          )}
        </p>
      </div>

      <div className="divide-y divide-line border-t border-line pt-1">
        {visibleMerchants.map((comercio) => (
          <div
            key={comercio.nombre}
            className="flex items-center justify-between gap-3 py-2.5"
          >
            <div className="min-w-0 flex-1">
              <p className="truncate text-[13px] font-bold text-ink first-letter:uppercase">
                {comercio.nombre}
              </p>
              <p className="text-[11px] text-ink-soft">
                {comercio.count} {comercio.count === 1 ? 'compra' : 'compras'}
              </p>
            </div>
            <span className="text-[13px] font-extrabold tabular-nums text-ink">
              {formatCurrency(comercio.total)}
            </span>
          </div>
        ))}
      </div>

      {hasMore && (
        <button
          type="button"
          aria-expanded={expanded}
          onClick={() => setExpanded((prev) => !prev)}
          className="mt-3 w-full rounded-xl py-2 text-center text-xs font-bold text-brand-ink transition-colors hover:bg-surface-2"
        >
          {expanded ? 'Ver menos' : 'Ver todos'}
        </button>
      )}
    </section>
  );
};
