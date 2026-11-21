import { useMemo, useState } from 'react';
import { Tag } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { percentChange, personalInflation, RECENT_DAYS } from '../../utils/personalInflation';

const green = 'text-emerald-600 dark:text-emerald-400';
const rose = 'text-rose-500 dark:text-rose-400';
const VISIBLE = 5;
const shortDate = (date: Date) => date.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
/** Under half a percent reads as no change. */
const tone = (fraction: number) => Math.abs(fraction) < 0.005 ? 'text-ink-soft' : fraction > 0 ? rose : green;
const badge = (fraction: number) => Math.abs(fraction) < 0.005 ? 'bg-surface-2 text-ink-soft' : fraction > 0 ? `bg-rose-500/10 ${rose}` : `bg-emerald-500/10 ${green}`;

/** «Tu IPC personal»: what you pay per visit at your usual places, against a year ago. */
export function PersonalInflationCard({ movimientos, now }: { movimientos: Movimiento[]; now?: Date }) {
  const { isLocked, formatCurrency } = usePrivacy();
  const [expanded, setExpanded] = useState(false);
  const result = useMemo(() => isLocked ? null : personalInflation(movimientos, now), [isLocked, movimientos, now]);
  if (!result) return null;

  const { indice, extraMensual, comercios } = result;
  const visible = expanded ? comercios : comercios.slice(0, VISIBLE);
  const flat = Math.abs(indice) < 0.005;
  const headline = flat
    ? 'Pagas lo mismo que hace un año'
    : `Pagas un ${percentChange(Math.abs(indice)).replace('+', '')} ${indice > 0 ? 'más' : 'menos'} que hace un año`;
  const monthly = flat || Math.abs(extraMensual) < 0.5 ? null
    : `Por las mismas visitas, unos ${formatCurrency(Math.abs(extraMensual))} ${extraMensual > 0 ? 'más' : 'menos'} al mes.`;

  return <section className="dashboard-surface p-5">
    <div className="mb-4 flex items-center gap-3">
      <span className="dashboard-icon bg-brand-tint text-brand-ink"><Tag size={18} /></span>
      <div className="min-w-0">
        <h3 className="dashboard-heading">Tu IPC personal</h3>
        <p className="dashboard-subtitle">Lo que pagas por visita en tus sitios de siempre</p>
      </div>
    </div>
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
      <div>
        <p className={`figure text-4xl ${tone(indice)}`}>{percentChange(indice)}</p>
        <p className="mt-2 text-sm font-bold text-ink">{headline}</p>
        {monthly && <p className="mt-1 text-xs text-ink-soft">{monthly}</p>}
      </div>
      <div>
        <div className="divide-y divide-line">{visible.map(merchant => <div key={merchant.key} className="flex items-center gap-3 py-2.5 first:pt-0">
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-bold text-ink">{merchant.nombre}</p>
            <p className="text-[11px] tabular-nums text-ink-soft">{formatCurrency(merchant.antes)} → {formatCurrency(merchant.ahora)} por visita · {merchant.visitasAhora} {merchant.visitasAhora === 1 ? 'visita' : 'visitas'}</p>
          </div>
          <span className={`shrink-0 rounded-full px-2.5 py-1 text-xs font-bold tabular-nums ${badge(merchant.cambio)}`}>{percentChange(merchant.cambio)}</span>
        </div>)}</div>
        {comercios.length > VISIBLE && <button type="button" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}
          className="mt-2 rounded-lg py-1 text-xs font-bold text-brand-ink underline-offset-4 hover:underline">
          {expanded ? 'Ver menos' : `Ver los ${comercios.length} sitios`}
        </button>}
      </div>
    </div>
    <p className="mt-4 text-[11px] leading-relaxed text-ink-faint">
      Compara lo que sueles pagar por visita del {shortDate(result.antesDesde)} al {shortDate(result.antesHasta)} con los últimos {RECENT_DAYS} días, en los sitios con al menos tres visitas en cada tramo. Si compras más cosas en cada visita, también sube.
    </p>
  </section>;
}
