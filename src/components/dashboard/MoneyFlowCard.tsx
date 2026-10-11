import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Share2, Waypoints } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import { buildMoneyFlow } from '../../utils/moneyFlow';
import { layoutMoneyFlow } from '../../utils/moneyFlowLayout';
import { ShareFlowModal } from '../modals/ShareFlowModal';

interface MoneyFlowCardProps {
  allMovimientos: readonly Movimiento[];
  periodLabel: string;
  periodStatus?: 'loading' | 'error';
}

export function MoneyFlowCard({ allMovimientos, periodLabel, periodStatus }: MoneyFlowCardProps) {
  const { isLocked, formatCurrency } = usePrivacy();
  const { categoryLabel, suggestCategory } = useCategories();
  const flow = useMemo(() => buildMoneyFlow(allMovimientos, movement => {
    if (movement.categoria) return movement.categoria;
    const suggestion = suggestCategory(movement);
    return suggestion && suggestion.confianza !== 'baja' ? suggestion.categoria : undefined;
  }, categoryLabel), [allMovimientos, categoryLabel, suggestCategory]);
  const gradientId = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [sharing, setSharing] = useState(false);
  const visible = !!flow && !isLocked && !periodStatus;
  useEffect(() => {
    const element = container.current;
    if (!visible || !element) return;
    const observer = new ResizeObserver(entries => {
      const { width, height } = entries[0].contentRect;
      setSize(width > 0 && height > 0 ? { width, height } : null);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [visible]);
  const wide = !!size && size.width >= 520;
  const layout = flow && size ? layoutMoneyFlow(flow, { ...size, left: wide ? 132 : 0, right: wide ? 176 : 108, hubAt: wide ? 0.36 : 0.62 }) : null;
  const chartLabel = flow ? `Flujo de tu dinero. ${[...flow.destinations].sort((a, b) => b.amount - a.amount).slice(0, 3).map(item => `${item.label}: ${item.percent} %`).join('; ')}` : '';
  return <section className="dashboard-surface p-5">
    <div className="mb-4 flex items-center justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink"><Waypoints size={18} /></span>
        <div className="min-w-0">
          <h3 className="dashboard-heading">A dónde va tu dinero</h3>
          <p className="dashboard-subtitle">{periodLabel} · % sobre lo que entra</p>
        </div>
      </div>
      {visible && <button type="button" className="dashboard-secondary-button shrink-0" aria-label="Compartir sin importes" onClick={() => setSharing(true)}>
        <Share2 size={15} /> <span className="hidden sm:inline">Compartir</span>
      </button>}
    </div>
    {isLocked ? <div className="grid h-72 place-items-center rounded-2xl bg-surface-2 text-sm font-semibold text-ink-faint">Gráfica protegida por privacidad</div>
      : periodStatus ? <div className="dashboard-empty h-72" aria-busy={periodStatus === 'loading'}><p>{periodStatus === 'error' ? 'No se pudieron cargar los movimientos históricos.' : 'Cargando movimientos…'}</p></div>
        : !flow ? <div className="dashboard-empty h-72"><p>Sin movimientos en este periodo</p></div>
          : <>
            <div ref={container} className="h-[26rem] w-full">
              {layout && <svg width={layout.width} height={layout.height} viewBox={`0 0 ${layout.width} ${layout.height}`} role="img" aria-label={chartLabel} className="block text-ink">
                <defs>
                  {layout.links.map(({ item, x0, x1 }, i) => item.color && <linearGradient key={i} id={`${gradientId}-${i}`} gradientUnits="userSpaceOnUse" x1={x0} x2={x1} y1={0} y2={0}>
                    <stop offset="0" stopColor={item.color} stopOpacity={0.28} />
                    <stop offset="1" stopColor={item.color} stopOpacity={0.55} />
                  </linearGradient>)}
                </defs>
                {layout.links.map(({ item, d }, i) => <path key={i} d={d}
                  fill={item.color ? `url(#${gradientId}-${i})` : 'currentColor'} fillOpacity={item.color ? 1 : 0.08} />)}
                <rect {...layout.hub} rx={3} fill="currentColor" fillOpacity={0.3} />
                {layout.nodes.map(({ item, side, x, y, width, height, center }) => {
                  // Labels sit outside the ribbons, on the plain card; a phone only has room for that on the right.
                  const inside = side === 'source' && !wide;
                  const textX = side === 'destination' ? x + width + 10 : inside ? x + width + 8 : x - 10;
                  const anchor = side === 'source' && wide ? 'end' : 'start';
                  const limit = wide ? 22 : 14;
                  return <g key={`${side}-${item.id}`}>
                    <rect x={x} y={y} width={width} height={height} rx={Math.min(3, height / 2)} fill={item.color ?? 'currentColor'} fillOpacity={item.color ? 1 : 0.65} />
                    <text x={textX} y={center - 3} textAnchor={anchor} fontSize={wide ? 13 : 12} fontWeight={700} fill="currentColor">{item.label.length > limit ? `${item.label.slice(0, limit - 1)}…` : item.label}</text>
                    <text x={textX} y={center + (wide ? 14 : 12)} textAnchor={anchor} fontSize={wide ? 12 : 11} className="fill-ink-soft" style={{ fontVariantNumeric: 'tabular-nums' }}>
                      {!inside && <tspan className="fill-ink" fontWeight={600}>{item.percent} %</tspan>}{!inside && ' · '}{formatCurrency(item.amount)}
                    </text>
                  </g>;
                })}
              </svg>}
            </div>
            <ul className="sr-only">{(['source', 'destination'] as const).flatMap(side => (side === 'source' ? flow.sources : flow.destinations).map(item => <li key={`${side}-${item.id}`}>{item.label}: {item.percent} %, {formatCurrency(item.amount)}</li>))}</ul>
          </>}
    {sharing && visible && flow && <ShareFlowModal flow={flow} periodLabel={periodLabel} onClose={() => setSharing(false)} />}
  </section>;
}
