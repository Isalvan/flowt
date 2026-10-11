import { useMemo } from 'react';
import { ChartPie } from 'lucide-react';
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip } from 'recharts';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import { groupExpensesByCategory } from '../../utils/periodStats';
import { walletAccent } from '../../utils/walletAccent';

interface CategoryBreakdownProps {
  allMovimientos: readonly Movimiento[];
  periodLabel: string;
  periodStatus?: 'loading' | 'error';
}

const formatPercentage = (value: number) => `${value.toLocaleString('es-ES', { maximumFractionDigits: 2 })} %`;

export const CategoryBreakdown = ({ allMovimientos, periodLabel, periodStatus }: CategoryBreakdownProps) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const { categoryLabel, suggestCategory } = useCategories();
  // The chosen category, else a confident suggestion; a low-confidence guess stays uncategorised.
  const categories = useMemo(
    () => groupExpensesByCategory(allMovimientos, m => {
      if (m.categoria) return m.categoria;
      const suggestion = suggestCategory(m);
      return suggestion && suggestion.confianza !== 'baja' ? suggestion.categoria : undefined;
    }),
    [allMovimientos, suggestCategory],
  );
  const totalCents = categories.reduce((sum, category) => sum + Math.round(category.total * 100), 0);
  const total = totalCents / 100;
  const visible = categories.slice(0, 6).map(category => ({
    ...category,
    name: category.categoria === 'sin_categoria' ? 'Sin categoría' : categoryLabel(category.categoria),
  }));
  if (categories.length > 6) {
    const otherCents = categories.slice(6).reduce((sum, category) => sum + Math.round(category.total * 100), 0);
    visible.push({ categoria: 'otras', name: 'Otras', total: otherCents / 100, porcentaje: Math.round(otherCents / totalCents * 10000) / 100 });
  }
  const chartLabel = `Gasto por categorías. ${visible.slice(0, 3).map(category => `${category.name}: ${formatPercentage(category.porcentaje)}`).join('; ')}`;

  return (
    <section className="dashboard-surface flex flex-col p-5">
      <div className="mb-3 flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink"><ChartPie size={18} /></span>
        <div>
          <h3 className="dashboard-heading">Gasto por categorías</h3>
          <p className="dashboard-subtitle">{periodLabel}</p>
        </div>
      </div>
      {isLocked ? (
        <div className="grid h-64 place-items-center rounded-2xl bg-surface-2 text-sm font-semibold text-ink-faint">
          Gráfica protegida por privacidad
        </div>
      ) : periodStatus ? (
        <div className="dashboard-empty h-64" aria-busy={periodStatus === 'loading'}>
          <p>{periodStatus === 'error' ? 'No se pudieron cargar los movimientos históricos.' : 'Cargando movimientos…'}</p>
        </div>
      ) : !categories.length ? (
        <div className="dashboard-empty h-64"><p>Sin gastos en este periodo</p></div>
      ) : (
        <div className="flex flex-1 flex-col items-center gap-4 sm:flex-row">
          <div className="relative h-64 w-full sm:w-1/2" role="img" aria-label={chartLabel}>
            <ResponsiveContainer width="100%" height="100%">
              <PieChart accessibilityLayer={false}>
                <Pie data={visible} dataKey="total" nameKey="name" innerRadius="65%" outerRadius="90%" stroke="var(--surface)" isAnimationActive={false}>
                  {visible.map((category, index) => <Cell key={category.categoria} fill={walletAccent(index).hex} />)}
                </Pie>
                <Tooltip formatter={value => formatCurrency(Number(value))} />
              </PieChart>
            </ResponsiveContainer>
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center" aria-hidden="true">
              <span className="text-xs text-ink-soft">Gasto total</span>
              <span className="font-bold tabular-nums text-ink">{formatCurrency(total)}</span>
            </div>
          </div>
          <ul className="w-full min-w-0 space-y-3 sm:w-1/2" aria-label="Detalle del gasto por categorías">
            {visible.map((category, index) => (
              <li key={category.categoria} className="flex items-center gap-2 text-sm">
                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: walletAccent(index).hex }} aria-hidden="true" />
                <span className="min-w-0 flex-1 text-ink">{category.name}</span>
                <span className="text-xs tabular-nums text-ink-soft">{formatPercentage(category.porcentaje)}</span>
                <span className="font-semibold tabular-nums text-ink">{formatCurrency(category.total)}</span>
              </li>
            ))}
            <li className="flex justify-between border-t border-line pt-3 text-sm font-semibold text-ink">
              <span>Gasto total</span><span className="tabular-nums">{formatCurrency(total)}</span>
            </li>
          </ul>
        </div>
      )}
    </section>
  );
};
