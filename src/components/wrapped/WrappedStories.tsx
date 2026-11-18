import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Award, Pause, Play, RotateCcw, Share2, ShoppingBag, TrendingDown, TrendingUp, X } from 'lucide-react';
import type { Movimiento } from '../../types';
import { buildWrapped, type WrappedData, type WrappedPeriod, type WrappedTone } from '../../utils/wrapped';
import { periodRangeLabel } from '../../utils/periods';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import { CelebrationConfetti } from '../common/CelebrationConfetti';
import { Toast, type ToastType } from '../common/Toast';
import { ServiceIcon } from '../dashboard/ServiceIcon';
import { Bars, CalendarDots, Counter, Ranking, Ring, Visual } from './WrappedVisuals';
import { ICONS, delay, type VisualEnv } from './wrappedVisualUtils';
import './wrapped.css';

const AUTO_ADVANCE_MS = 6500;
const HOLD_THRESHOLD_MS = 220;
const MONTH_FULL = ['enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio', 'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre'];
const MONTH_SHORT = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/** Each tone: a deep base, three glowing blobs and the accent used for figures. */
const PALETTES: Record<WrappedTone, { base: string; a: string; b: string; c: string; accent: string }> = {
  indigo: { base: '#0a0a24', a: '#6366f1', b: '#a855f7', c: '#22d3ee', accent: '#c7d2fe' },
  rose: { base: '#24050f', a: '#f43f5e', b: '#fb923c', c: '#a855f7', accent: '#fecdd3' },
  sky: { base: '#03142a', a: '#0ea5e9', b: '#6366f1', c: '#2dd4bf', accent: '#bae6fd' },
  violet: { base: '#14082b', a: '#8b5cf6', b: '#ec4899', c: '#6366f1', accent: '#ddd6fe' },
  amber: { base: '#1f0f02', a: '#ff9f0a', b: '#f43f5e', c: '#facc15', accent: '#ffd88a' },
  emerald: { base: '#021c16', a: '#10b981', b: '#84cc16', c: '#06b6d4', accent: '#a7f3d0' },
  fuchsia: { base: '#220622', a: '#d946ef', b: '#f97316', c: '#8b5cf6', accent: '#f5d0fe' },
  teal: { base: '#031c1c', a: '#14b8a6', b: '#3b82f6', c: '#a3e635', accent: '#99f6e4' },
};
type Pattern = 'rings' | 'stripes' | 'dots' | 'arc' | 'waves' | 'none';
const PATTERNS: Pattern[] = ['stripes', 'dots', 'arc', 'waves', 'rings'];

export interface WrappedStoriesProps {
  isOpen?: boolean;
  data?: WrappedData | null;
  period?: WrappedPeriod | null;
  movimientos?: readonly Movimiento[];
  onClose: () => void;
  onShareToast?: (message: string, type?: ToastType) => void;
}

interface SlideDef {
  id: string;
  tone: WrappedTone;
  pattern?: Pattern;
  confetti?: boolean;
  render: () => React.ReactNode;
}

const useReducedMotion = (): boolean => {
  const [reduced, setReduced] = useState<boolean>(() =>
    typeof window !== 'undefined' && Boolean(window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches),
  );
  useEffect(() => {
    const mql = window.matchMedia?.('(prefers-reduced-motion: reduce)');
    if (!mql) return;
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches);
    mql.addEventListener?.('change', handler);
    return () => mql.removeEventListener?.('change', handler);
  }, []);
  return reduced;
};

const paletteStyle = (tone: WrappedTone) => {
  const p = PALETTES[tone];
  return { '--wr-base': p.base, '--wr-a': p.a, '--wr-b': p.b, '--wr-c': p.c, '--wr-accent': p.accent } as React.CSSProperties;
};

const PatternLayer: React.FC<{ pattern: Pattern }> = ({ pattern }) => {
  if (pattern === 'none') return null;
  if (pattern === 'stripes' || pattern === 'dots') return <div className={`wr-pattern wr-pattern--${pattern}`} />;
  return (
    <div className={`wr-pattern wr-pattern--${pattern}`}>
      {pattern === 'rings' && (
        <svg viewBox="0 0 400 400" fill="none" stroke="currentColor" strokeWidth="1.5">
          {[60, 100, 140, 180].map(r => <circle key={r} cx="200" cy="200" r={r} strokeDasharray={r === 140 ? '4 10' : undefined} />)}
        </svg>
      )}
      {pattern === 'arc' && (
        <svg viewBox="0 0 400 400" fill="none" stroke="currentColor" strokeWidth="38">
          <circle cx="200" cy="200" r="170" />
        </svg>
      )}
      {pattern === 'waves' && (
        <svg viewBox="0 0 400 160" fill="none" stroke="currentColor" strokeWidth="2">
          {[0, 18, 36, 54, 72].map(y => <path key={y} d={`M0 ${60 + y} C 70 ${20 + y}, 130 ${100 + y}, 200 ${60 + y} S 330 ${20 + y}, 400 ${60 + y}`} />)}
        </svg>
      )}
    </div>
  );
};

const Backdrop: React.FC<{ slide: SlideDef; enter: boolean }> = ({ slide, enter }) => (
  <div className={`wr-backdrop ${enter ? 'wr-backdrop--enter' : ''}`} style={paletteStyle(slide.tone)} aria-hidden="true">
    <div className="wr-blob wr-blob--a" />
    <div className="wr-blob wr-blob--b" />
    <div className="wr-blob wr-blob--c" />
    <PatternLayer pattern={slide.pattern ?? 'none'} />
    <div className="wr-vignette" />
    <div className="wr-grain" />
  </div>
);

/** Rotating circular label, like a sticker on the cover. */
const CoverBadge: React.FC<{ text: string }> = ({ text }) => (
  <svg viewBox="0 0 120 120" className="wr-badge-spin h-28 w-28" aria-hidden="true">
    <defs><path id="wr-badge-circle" d="M60,60 m-46,0 a46,46 0 1,1 92,0 a46,46 0 1,1 -92,0" /></defs>
    <circle cx="60" cy="60" r="58" fill="var(--wr-accent)" />
    <text fontSize="12.5" fontWeight="800" letterSpacing="3" fill="#0b0b20">
      <textPath href="#wr-badge-circle" textLength="286" lengthAdjust="spacing">{text}</textPath>
    </text>
  </svg>
);

const Eyebrow: React.FC<{ children: React.ReactNode; d?: number; icon?: React.ReactNode }> = ({ children, d = 0, icon }) => (
  <span className="wr-eyebrow wr-in" style={delay(d)}>{icon}{children}</span>
);

const Headline: React.FC<{ text: string; d?: number; xl?: boolean; as?: 'h2' | 'h3'; className?: string }> = ({ text, d = 1, xl, as: Tag = 'h3', className = '' }) => (
  <Tag className={`wr-headline ${xl ? 'wr-headline--xl' : ''} ${className}`}>
    <span className="wr-mask"><span style={delay(d)}>{text}</span></span>
  </Tag>
);

export const WrappedStories: React.FC<WrappedStoriesProps> = ({
  isOpen = true,
  data: propData,
  period,
  movimientos,
  onClose,
  onShareToast,
}) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const { categoryLabel } = useCategories();
  const reducedMotion = useReducedMotion();
  const dialogId = useId();
  const containerRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  }, [onClose]);

  const data = useMemo<WrappedData | null>(() => {
    if (propData !== undefined) return propData;
    if (!period || !movimientos) return null;
    return buildWrapped(movimientos, period, { categoryLabel });
  }, [propData, period, movimientos, categoryLabel]);

  const [index, setIndex] = useState(0);
  const [previousIndex, setPreviousIndex] = useState<number | null>(null);
  const [paused, setPaused] = useState(false);
  const [userPaused, setUserPaused] = useState(false);
  const [localToast, setLocalToast] = useState<{ message: string; type: ToastType } | null>(null);
  const pointerDownAt = useRef<number | null>(null);
  const wasLongPress = useRef(false);

  // Restart from the cover whenever another Wrapped is shown or the overlay reopens.
  const resetKey = `${data?.period.key ?? ''}|${isOpen}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setIndex(0);
    setPreviousIndex(null);
    setPaused(false);
    setUserPaused(false);
    setLocalToast(null);
  }

  const notify = useCallback(
    (message: string, type: ToastType = 'success') => {
      setLocalToast({ message, type });
      onShareToast?.(message, type);
    },
    [onShareToast],
  );

  const handleShare = useCallback(async () => {
    if (!data) return;
    const title = `Mi ${data.period.label}${data.period.parcial ? ' hasta hoy' : ''} en Flowt`;
    const lines = [
      `✨ ${title}`,
      `💸 Gasto total: ${formatCurrency(data.totales.gastos)} (${data.totales.numGastos} gastos)`,
      data.totales.ingresos > 0 ? `🐷 Ahorro: ${formatCurrency(data.totales.ahorro)}` : null,
      data.topCategorias[0] ? `📊 Categoría top: ${data.topCategorias[0].label} (${Math.round(data.topCategorias[0].porcentaje)} %)` : null,
      data.comercioFavorito ? `🏪 Favorito: ${data.comercioFavorito.nombre} (${data.comercioFavorito.visitas} visitas)` : null,
      `🎭 Personalidad: ${data.personalidad.titulo}`,
    ].filter(Boolean);
    const text = lines.join('\n');

    try {
      if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
        await navigator.share({ title, text });
        return;
      }
    } catch (err) {
      if (err && typeof err === 'object' && 'name' in err && err.name === 'AbortError') return;
    }

    try {
      await navigator.clipboard?.writeText(text);
      notify('Resumen copiado al portapapeles', 'success');
    } catch {
      notify('No se pudo copiar el resumen', 'error');
    }
  }, [data, formatCurrency, notify]);

  const slides = useMemo<SlideDef[]>(() => {
    if (!data) return [];
    const env: VisualEnv = { reducedMotion, formatCurrency };
    const isMonth = data.period.scope === 'mes';
    const range = isMonth && !(data.period.start.getDate() === 1 && data.period.end.getDate() === 1) ? periodRangeLabel(data.period) : null;
    const shortDate = (d: Date) => d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
    const list: SlideDef[] = [];

    // ── Cover ──────────────────────────────────────────────────────────
    list.push({
      id: 'portada',
      tone: 'indigo',
      pattern: 'rings',
      render: () => (
        <div className="flex w-full flex-col items-start text-left">
          <div className="wr-pop absolute right-5 top-24 sm:right-7" style={delay(5)}>
            <CoverBadge text={`FLOWT WRAPPED • ${data.period.label.toUpperCase()} • `} />
          </div>
          <Eyebrow d={0}>Flowt Wrapped</Eyebrow>
          <h2 className="wr-headline wr-headline--xl mt-6">
            <span className="wr-mask"><span style={delay(1)}>Tu</span></span>
            <span className="wr-mask"><span className="wr-accent" style={delay(2)}>{data.period.label}</span></span>
            <span className="wr-mask"><span style={delay(3)}>en Flowt</span></span>
          </h2>
          {data.period.parcial && (
            <span className="wr-in mt-4 rounded-full bg-white px-3.5 py-1 text-sm font-extrabold text-slate-900" style={delay(4)}>hasta hoy</span>
          )}
          {range && (
            <span className="wr-in mt-4 rounded-full bg-white px-3.5 py-1 text-sm font-extrabold text-slate-900" style={delay(4)}>{range}</span>
          )}
          <p className="wr-detail wr-in mt-7 max-w-xs" style={delay(5)}>
            Hemos repasado tus{' '}
            <Counter value={data.totales.numGastos} env={env} className="font-extrabold text-white" />{' '}
            gastos. Esto es lo que cuentan de ti.
          </p>
        </div>
      ),
    });

    // ── Total spent ────────────────────────────────────────────────────
    const history = data.historia.slice(-5);
    list.push({
      id: 'gasto-total',
      tone: 'rose',
      pattern: 'stripes',
      render: () => (
        <div className="flex w-full flex-col items-center text-center">
          <Eyebrow>Gasto total</Eyebrow>
          <p className="mt-5 text-lg font-bold text-white/80 wr-in" style={delay(1)}>
            En {data.period.label}{data.period.parcial ? ' (hasta hoy)' : ''} se fueron
          </p>
          <Counter value={data.totales.gastos} formato="dinero" env={env} className="wr-figure wr-pop mt-1" style={delay(2)} />
          <p className="wr-detail wr-in mt-3" style={delay(3)}>
            en {data.totales.numGastos} compras y {data.totales.numComercios} {data.totales.numComercios === 1 ? 'comercio' : 'comercios'}
          </p>
          {data.comparativa && (
            <span className="wr-in mt-6 inline-flex items-center gap-2 rounded-full bg-white px-4 py-2 text-sm font-extrabold text-slate-900" style={delay(4)}>
              {data.comparativa.deltaPct <= 0 ? <TrendingDown size={17} className="text-emerald-600" /> : <TrendingUp size={17} className="text-rose-600" />}
              {data.comparativa.deltaPct === 0
                ? 'Igual que el periodo anterior'
                : `${Math.abs(Math.round(data.comparativa.deltaPct))} % ${data.comparativa.deltaPct < 0 ? 'menos' : 'más'} que antes`}
            </span>
          )}
          {history.length >= 2 && (
            <div className="wr-glass wr-in mt-7 w-full max-w-xs px-4 pb-3 pt-4" style={delay(5)}>
              <Bars
                valores={[...history.map(h => h.gastos), data.totales.gastos]}
                etiquetas={[...history.map(h => h.corto), isMonth ? data.period.label.slice(0, 3) : data.period.label]}
                destacado={history.length}
                formato="dinero"
                env={env}
                height={92}
                showValue={false}
              />
            </div>
          )}
        </div>
      ),
    });

    // ── Bespoke screens for some inventory cards ───────────────────────
    const bespoke: Record<string, Omit<SlideDef, 'id' | 'pattern'>> = {};

    if (data.topCategorias.length > 0) {
      bespoke.categorias = {
        tone: 'violet',
        render: () => (
          <div className="flex w-full flex-col items-start">
            <Eyebrow>Tus categorías</Eyebrow>
            <Headline text="Así se repartió tu dinero" className="mt-4" />
            <div className="mt-8 w-full">
              <Ranking
                items={data.topCategorias.map(c => ({ nombre: c.label, valor: c.total, nota: `${Math.round(c.porcentaje)} % del total` }))}
                formato="dinero"
                env={env}
              />
            </div>
          </div>
        ),
      };
    }

    if (data.comercioFavorito) {
      const fav = data.comercioFavorito;
      const topOther = data.comercioTop && data.comercioTop.key !== fav.key ? data.comercioTop : null;
      bespoke.comercios = {
        tone: 'sky',
        render: () => (
          <div className="flex w-full flex-col items-center text-center">
            <Eyebrow>Tu parada habitual</Eyebrow>
            <span className="wr-pop wr-float mt-7 grid h-24 w-24 place-items-center rounded-[1.8rem] bg-white shadow-2xl" style={delay(1)}>
              <span className="scale-[1.75]"><ServiceIcon name={fav.nombre} /></span>
            </span>
            <Headline text={fav.nombre} d={2} className="mt-6" />
            <div className="mt-4 flex items-baseline gap-2">
              <Counter value={fav.visitas} env={env} className="wr-figure wr-figure--md wr-pop" style={delay(3)} />
              <span className="text-lg font-extrabold text-white/80">{fav.visitas === 1 ? 'visita' : 'visitas'}</span>
            </div>
            <p className="wr-detail wr-in mt-1" style={delay(4)}>{formatCurrency(fav.total)} en total</p>
            {topOther && (
              <div className="wr-glass wr-in mt-7 flex w-full max-w-xs items-center justify-between gap-3 px-4 py-3 text-left" style={delay(5)}>
                <div className="flex min-w-0 items-center gap-3">
                  <ServiceIcon name={topOther.nombre} />
                  <div className="min-w-0">
                    <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/60">Donde más gastaste</p>
                    <p className="truncate text-sm font-extrabold text-white">{topOther.nombre}</p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-extrabold tabular-nums text-white">{formatCurrency(topOther.total)}</span>
              </div>
            )}
          </div>
        ),
      };
    }

    if (isMonth && data.diaMasCaro && data.serieDiaria.length > 0) {
      const peak = data.diaMasCaro;
      const peakIndex = data.serieDiaria.findIndex(d => +d.fecha === +peak.fecha);
      bespoke.ritmo = {
        tone: 'amber',
        render: () => (
          <div className="flex w-full flex-col items-start">
            <Eyebrow>Tu pico del mes</Eyebrow>
            <Headline text={peak.fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })} className="mt-4 first-letter:uppercase" />
            <Counter value={peak.total} formato="dinero" env={env} className="wr-figure wr-figure--md wr-pop mt-4" style={delay(2)} />
            <p className="wr-detail wr-in mt-2" style={delay(3)}>fue tu día más caro (sin contar alquiler ni suscripciones).</p>
            <div className="wr-in mt-8 w-full" style={delay(3)}>
              <Bars valores={data.serieDiaria.map(d => d.total)} etiquetas={data.serieDiaria.map(d => shortDate(d.fecha))} destacado={peakIndex} formato="dinero" env={env} height={130} />
              <div className="mt-2 flex justify-between text-[11px] font-bold text-white/60">
                <span>{shortDate(data.serieDiaria[0].fecha)}</span>
                <span>{shortDate(data.serieDiaria[data.serieDiaria.length - 1].fecha)}</span>
              </div>
            </div>
          </div>
        ),
      };
    } else if (!isMonth && data.mesMasCaro && data.serieMensual.length === 12) {
      const caro = data.mesMasCaro;
      const barato = data.mesMasBarato;
      bespoke.ritmo = {
        tone: 'amber',
        render: () => (
          <div className="flex w-full flex-col items-start">
            <Eyebrow>Mes a mes</Eyebrow>
            <Headline text={`${MONTH_FULL[caro.mes]} fue tu mes más intenso`} className="mt-4 first-letter:uppercase" />
            <Counter value={caro.total} formato="dinero" env={env} className="wr-figure wr-figure--md wr-pop mt-4" style={delay(2)} />
            {barato && barato.mes !== caro.mes && (
              <p className="wr-detail wr-in mt-2" style={delay(3)}>
                El más tranquilo: <span className="font-extrabold text-white">{MONTH_FULL[barato.mes]}</span> ({formatCurrency(barato.total)})
              </p>
            )}
            <div className="wr-in mt-8 w-full" style={delay(3)}>
              <Bars valores={data.serieMensual} etiquetas={MONTH_SHORT} destacado={caro.mes} formato="dinero" env={env} height={140} showValue={false} />
            </div>
          </div>
        ),
      };
    }

    if (data.compraMayor.importe > 0) {
      bespoke['compra-mayor'] = {
        tone: 'fuchsia',
        render: () => (
          <div className="flex w-full flex-col items-center text-center">
            <Eyebrow icon={<ShoppingBag size={13} />}>Tu compra más grande</Eyebrow>
            <Counter value={data.compraMayor.importe} formato="dinero" env={env} className="wr-figure wr-pop mt-8" style={delay(1)} />
            <Headline text={data.compraMayor.concepto} d={2} className="mt-5 !text-[clamp(1.6rem,7cqw,2.4rem)]" />
            <p className="wr-detail wr-in mt-3" style={delay(3)}>
              {data.compraMayor.fecha.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}
            </p>
            {data.totales.gastos > 0 && (
              <p className="wr-in mt-6 rounded-full bg-white/14 px-4 py-2 text-sm font-extrabold text-white" style={delay(4)}>
                El {Math.max(1, Math.round(data.compraMayor.importe / data.totales.gastos * 100))} % de todo tu gasto
              </p>
            )}
          </div>
        ),
      };
    }

    if (data.rachaSinGastos.dias > 0) {
      const streak = data.rachaSinGastos;
      const today = new Date();
      const days = isMonth ? data.serieDiaria.filter(d => d.fecha <= today).length : 0;
      bespoke.racha = {
        tone: 'teal',
        render: () => (
          <div className="flex w-full flex-col items-center text-center">
            <Eyebrow>Mayor racha sin gastar</Eyebrow>
            <Counter value={streak.dias} env={env} className="wr-figure wr-pop mt-6 !text-[clamp(5rem,26cqw,8rem)]" style={delay(1)} />
            <Headline text={streak.dias === 1 ? 'día sin gastos' : 'días seguidos sin gastar un euro'} d={2} className="mt-1 !text-[clamp(1.5rem,6.5cqw,2.2rem)]" />
            {streak.desde && streak.hasta && (
              <p className="wr-detail wr-in mt-3" style={delay(3)}>Del {shortDate(streak.desde)} al {shortDate(streak.hasta)}</p>
            )}
            {isMonth && streak.desde && days > 0 && (
              <div className="wr-in mt-6 w-full" style={delay(4)}>
                <CalendarDots
                  inicio={data.period.start}
                  dias={data.serieDiaria.slice(0, days).map(d => (d.total > 0 ? 2 : 0))}
                  marcados={[
                    Math.round((+streak.desde! - +data.period.start) / 86_400_000),
                    Math.round((+streak.hasta! - +data.period.start) / 86_400_000),
                  ]}
                />
              </div>
            )}
          </div>
        ),
      };
    }

    if (data.totales.ingresos > 0) {
      const saved = data.totales.ahorro > 0;
      bespoke.ahorro = {
        tone: 'emerald',
        confetti: saved && !reducedMotion,
        render: () => (
          <div className="flex w-full flex-col items-center text-center">
            <Eyebrow>{saved ? 'Lo que conseguiste guardar' : 'Balance del periodo'}</Eyebrow>
            <Counter value={data.totales.ahorro} formato="dinero" env={env} className="wr-figure wr-pop mt-6" style={delay(1)} />
            {data.totales.tasaAhorro !== null && data.totales.tasaAhorro > 0 && (
              <div className="wr-pop mt-6" style={delay(2)}>
                <Ring pct={data.totales.tasaAhorro} etiqueta="ahorrado" size={150} />
              </div>
            )}
            <div className="wr-in mt-6 grid w-full max-w-xs grid-cols-2 gap-2.5" style={delay(3)}>
              <div className="wr-glass px-4 py-3 text-left">
                <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/60">Entró</span>
                <span className="mt-0.5 block text-base font-extrabold tabular-nums text-white">{formatCurrency(data.totales.ingresos)}</span>
              </div>
              <div className="wr-glass px-4 py-3 text-left">
                <span className="block text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/60">Salió</span>
                <span className="mt-0.5 block text-base font-extrabold tabular-nums text-white">{formatCurrency(data.totales.gastos)}</span>
              </div>
            </div>
          </div>
        ),
      };
    }

    // ── The highlights this Wrapped picked from the inventory ──────────
    const byId = new Map(data.inventario.map(card => [card.id, card]));
    data.destacados.forEach((id, n) => {
      const pattern = PATTERNS[n % PATTERNS.length];
      const special = bespoke[id];
      if (special) {
        list.push({ id, pattern, ...special });
        return;
      }
      const card = byId.get(id);
      if (!card || card.especial) return;
      const Icon = ICONS[card.icono ?? 'sparkles'];
      const centered = card.visual?.tipo !== 'ranking' && card.visual?.tipo !== 'barras';
      list.push({
        id: card.id,
        tone: card.tono ?? 'indigo',
        pattern,
        render: () => (
          <div className={`flex w-full flex-col ${centered ? 'items-center text-center' : 'items-start text-left'}`}>
            {card.eyebrow && <Eyebrow icon={<Icon size={13} />}>{card.eyebrow}</Eyebrow>}
            {card.titulo && <Headline text={card.titulo} className="mt-4" />}
            {card.visual && <div className="mt-8 w-full">{<Visual visual={card.visual} env={env} />}</div>}
            {card.detalle && (
              <p className="wr-detail wr-in mt-7 max-w-sm" style={delay(5)}>{card.detalle}</p>
            )}
          </div>
        ),
      });
    });

    // ── Personality ────────────────────────────────────────────────────
    list.push({
      id: 'personalidad',
      tone: 'fuchsia',
      pattern: 'rings',
      render: () => (
        <div className="flex w-full flex-col items-center text-center">
          <Eyebrow>Tu personalidad en Flowt</Eyebrow>
          <div className="wr-holo wr-pop mt-8 w-full max-w-[18rem]" style={delay(1)}>
            <div className="rounded-[1.65rem] bg-[#16061a]/90 px-6 pb-7 pt-8">
              <span className="wr-float mx-auto grid h-20 w-20 place-items-center rounded-full bg-white text-fuchsia-600 shadow-[0_0_50px_-5px_var(--wr-a)]">
                <Award size={38} strokeWidth={2.2} />
              </span>
              <Headline text={data.personalidad.titulo} d={3} as="h3" className="mt-6" />
              <p className="wr-detail wr-in mt-4 !text-base" style={delay(4)}>{data.personalidad.descripcion}</p>
            </div>
          </div>
        </div>
      ),
    });

    // ── Shareable summary ──────────────────────────────────────────────
    list.push({
      id: 'resumen',
      tone: 'indigo',
      pattern: 'dots',
      render: () => (
        <div className="flex w-full flex-col items-center">
          <div
            className="wr-pop w-full max-w-[20rem] overflow-hidden rounded-[1.75rem] p-5 text-left shadow-2xl"
            style={{ ...delay(0), background: 'linear-gradient(150deg, var(--wr-a), var(--wr-b) 55%, #f97316)' }}
          >
            <div className="flex items-center justify-between">
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/80">Flowt Wrapped</span>
              <span className="text-[10px] font-extrabold uppercase tracking-[0.2em] text-white/80">{data.period.label}{data.period.parcial ? ' · hasta hoy' : ''}</span>
            </div>
            <h3 className="font-title mt-3 text-[2rem] font-extrabold leading-none tracking-tight text-white">Mi {data.period.label}</h3>
            <div className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3.5">
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Gasto total</p>
                <p className="font-title text-xl font-extrabold text-white">{formatCurrency(data.totales.gastos)}</p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Ahorro</p>
                <p className="font-title text-xl font-extrabold text-white">{formatCurrency(data.totales.ahorro)}</p>
              </div>
              <div>
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Compras</p>
                <p className="font-title text-xl font-extrabold text-white">{data.totales.numGastos}</p>
              </div>
              <div className="min-w-0">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Favorito</p>
                <p className="truncate font-title text-xl font-extrabold text-white">{data.comercioFavorito?.nombre ?? '—'}</p>
              </div>
            </div>
            {data.topCategorias.length > 0 && (
              <div className="mt-4 border-t border-white/25 pt-3">
                <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Top categorías</p>
                <ol className="mt-1.5 space-y-0.5">
                  {data.topCategorias.map((c, i) => (
                    <li key={c.categoria} className="flex justify-between gap-2 text-sm font-bold text-white">
                      <span className="truncate">{i + 1}. {c.label}</span>
                      <span className="shrink-0 tabular-nums text-white/85">{Math.round(c.porcentaje)} %</span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
            <div className="mt-4 rounded-2xl bg-black/20 px-3.5 py-2.5">
              <p className="text-[10px] font-extrabold uppercase tracking-[0.14em] text-white/70">Personalidad</p>
              <p className="font-title text-lg font-extrabold text-white">{data.personalidad.titulo}</p>
            </div>
          </div>

          <div className="wr-in mt-5 flex w-full max-w-[20rem] gap-2.5" style={delay(2)}>
            <button
              id="wrapped-share-button"
              type="button"
              data-wrapped-action="true"
              onClick={e => {
                e.stopPropagation();
                void handleShare();
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 py-3.5 text-sm font-extrabold text-slate-900 transition-transform active:scale-95"
            >
              <Share2 size={16} />
              Compartir
            </button>
            <button
              id="wrapped-replay-button"
              type="button"
              data-wrapped-action="true"
              onClick={e => {
                e.stopPropagation();
                setPreviousIndex(null);
                setIndex(0);
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-full bg-white/14 px-4 py-3.5 text-sm font-extrabold text-white ring-1 ring-white/25 transition-transform active:scale-95"
            >
              <RotateCcw size={15} />
              Ver otra vez
            </button>
          </div>
        </div>
      ),
    });

    return list;
  }, [data, formatCurrency, handleShare, reducedMotion]);

  const safeIndex = Math.min(index, Math.max(0, slides.length - 1));
  const currentSlide = slides[safeIndex];
  const previousSlide = previousIndex !== null && previousIndex !== safeIndex ? slides[previousIndex] : undefined;

  const goTo = useCallback((next: number) => {
    const target = Math.max(0, Math.min(slides.length - 1, next));
    if (target === safeIndex) return;
    setPreviousIndex(safeIndex);
    setIndex(target);
  }, [slides.length, safeIndex]);
  const goNext = useCallback(() => goTo(safeIndex + 1), [goTo, safeIndex]);
  const goPrev = useCallback(() => goTo(safeIndex - 1), [goTo, safeIndex]);

  const isPaused = paused || userPaused;

  // The previous backdrop only exists for the cross-fade; drop it afterwards so a
  // single set of animated layers is painted while the slide is on screen.
  useEffect(() => {
    if (previousIndex === null) return;
    const timer = window.setTimeout(() => setPreviousIndex(null), 750);
    return () => window.clearTimeout(timer);
  }, [previousIndex, safeIndex]);

  // Auto-advance when not paused and not reduced-motion.
  useEffect(() => {
    if (!isOpen || isLocked || !data || reducedMotion || isPaused) return;
    if (safeIndex >= slides.length - 1) return;
    const timer = window.setTimeout(() => goTo(safeIndex + 1), AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, isLocked, data, reducedMotion, isPaused, safeIndex, slides.length, goTo]);

  // Keyboard navigation + focus trap (like Modal).
  useEffect(() => {
    if (!isOpen || isLocked || !data) return;
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    if (!containerRef.current?.contains(document.activeElement)) {
      containerRef.current?.focus();
    }

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeRef.current();
        return;
      }
      if (e.key === 'ArrowRight') {
        e.preventDefault();
        goNext();
        return;
      }
      if (e.key === 'ArrowLeft') {
        e.preventDefault();
        goPrev();
        return;
      }
      if (e.key === ' ' && (e.target === containerRef.current || e.target === document.body)) {
        e.preventDefault();
        setUserPaused(p => !p);
        return;
      }
      if (e.key === 'Tab') {
        const controls = containerRef.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), [tabindex="0"]',
        );
        if (!controls?.length) {
          e.preventDefault();
          containerRef.current?.focus();
          return;
        }
        const first = controls[0];
        const last = controls[controls.length - 1];
        if (e.shiftKey && (document.activeElement === first || document.activeElement === containerRef.current)) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener('keydown', handleKeyDown);
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, [isOpen, isLocked, data, goNext, goPrev]);

  if (!isOpen || isLocked || !data || !currentSlide) return null;

  const handlePointerDown = (e: React.PointerEvent<HTMLElement>) => {
    if ((e.target as HTMLElement).closest('[data-wrapped-action="true"]')) return;
    pointerDownAt.current = Date.now();
    wasLongPress.current = false;
    setPaused(true);
  };

  const handlePointerUp = () => {
    if (pointerDownAt.current !== null && Date.now() - pointerDownAt.current >= HOLD_THRESHOLD_MS) {
      wasLongPress.current = true;
    }
    pointerDownAt.current = null;
    setPaused(false);
  };

  const handleStageClick = (e: React.MouseEvent<HTMLElement>) => {
    const target = e.target as HTMLElement;
    if (target.closest('[data-wrapped-action="true"]')) return;
    if (wasLongPress.current) {
      wasLongPress.current = false;
      return;
    }
    const zone = target.closest('[data-wrapped-zone]')?.getAttribute('data-wrapped-zone');
    if (zone === 'prev' && e.clientX === 0) {
      goPrev();
      return;
    }
    if (zone === 'next' && e.clientX === 0) {
      goNext();
      return;
    }
    const rect = (containerRef.current?.querySelector('.wr-stage') ?? e.currentTarget).getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : window.innerWidth || 1024;
    // Like stories: the left third goes back, the rest goes forward.
    const split = (rect.width > 0 ? rect.left : 0) + width / 3;
    if (e.clientX >= split) {
      goNext();
    } else {
      goPrev();
    }
  };

  const isLast = safeIndex >= slides.length - 1;

  return createPortal(
    <div
      id="wrapped-stories-overlay"
      ref={containerRef}
      role="dialog"
      aria-modal="true"
      aria-label={`Wrapped de ${data.period.label}`}
      data-dialog-id={dialogId}
      tabIndex={-1}
      onPointerDown={handlePointerDown}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      onClick={handleStageClick}
      className={`wr-root fixed inset-0 z-50 flex items-center justify-center bg-black text-white select-none outline-none ${reducedMotion ? 'wr-reduced' : ''}`}
      style={paletteStyle(currentSlide.tone)}
    >
      {/* Desktop: the slide's colours bleed behind the phone-shaped stage. */}
      <div className="pointer-events-none absolute inset-0 hidden opacity-60 blur-3xl sm:block" aria-hidden="true">
        <Backdrop slide={currentSlide} enter={false} />
      </div>

      <div className="wr-stage">
        {previousSlide && <Backdrop key={`prev-${previousSlide.id}`} slide={previousSlide} enter={false} />}
        <Backdrop key={`bg-${currentSlide.id}`} slide={currentSlide} enter={Boolean(previousSlide)} />
        {currentSlide.confetti && <CelebrationConfetti trigger={safeIndex + 1} />}

        {/* Segmented progress + controls */}
        <header className="absolute inset-x-0 top-0 z-30 px-3 pt-[max(0.75rem,env(safe-area-inset-top))]">
          <div
            role="progressbar"
            aria-label="Progreso del Wrapped"
            aria-valuemin={1}
            aria-valuemax={slides.length}
            aria-valuenow={safeIndex + 1}
            className="flex w-full gap-1"
          >
            {slides.map((s, idx) => {
              const completed = idx < safeIndex;
              const active = idx === safeIndex;
              const full = completed || (active && (reducedMotion || isLast));
              return (
                <div key={s.id} className="wr-progress-track">
                  <div
                    key={`${s.id}-${active ? 'active' : completed ? 'done' : 'idle'}`}
                    className="wr-progress-fill"
                    style={
                      full
                        ? undefined
                        : active
                          ? {
                              animation: `wr-fill ${AUTO_ADVANCE_MS}ms linear forwards`,
                              animationPlayState: isPaused ? 'paused' : 'running',
                            }
                          : { transform: 'scaleX(0)' }
                    }
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <span className="grid h-7 w-7 place-items-center rounded-full bg-white text-[11px] font-black text-slate-900">F</span>
              <div className="leading-tight">
                <p className="text-xs font-extrabold text-white">Flowt Wrapped</p>
                <p className="text-[11px] font-semibold text-white/70 first-letter:uppercase">
                  {data.period.label}{data.period.parcial ? ' · hasta hoy' : ''} · {safeIndex + 1}/{slides.length}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              {!reducedMotion && !isLast && (
                <button
                  type="button"
                  data-wrapped-action="true"
                  onClick={e => {
                    e.stopPropagation();
                    setUserPaused(p => !p);
                  }}
                  aria-label={userPaused ? 'Reanudar' : 'Pausar'}
                  className="wr-icon-button"
                >
                  {userPaused ? <Play size={16} /> : <Pause size={16} />}
                </button>
              )}
              <button
                id="wrapped-close-button"
                type="button"
                data-wrapped-action="true"
                onClick={e => {
                  e.stopPropagation();
                  onClose();
                }}
                aria-label="Cerrar Wrapped"
                className="wr-icon-button"
              >
                <X size={18} />
              </button>
            </div>
          </div>
        </header>

        {/* Tap zones for touch, mouse and screen readers */}
        <div className="pointer-events-none absolute inset-0 z-10 flex">
          <button
            id="wrapped-prev-zone"
            type="button"
            tabIndex={-1}
            data-wrapped-zone="prev"
            aria-label="Diapositiva anterior"
            className="pointer-events-auto h-full w-1/3 bg-transparent focus:outline-none"
          />
          <button
            id="wrapped-next-zone"
            type="button"
            tabIndex={-1}
            data-wrapped-zone="next"
            aria-label="Siguiente diapositiva"
            className="pointer-events-auto h-full w-2/3 bg-transparent focus:outline-none"
          />
        </div>

        {/* Active slide */}
        <main
          key={currentSlide.id}
          data-slide-id={currentSlide.id}
          className="pointer-events-none absolute inset-0 z-20 flex flex-col justify-center overflow-y-auto px-6 pb-12 pt-28 [&_button]:pointer-events-auto"
        >
          {currentSlide.render()}
        </main>

        <footer className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex justify-center pb-[max(0.9rem,env(safe-area-inset-bottom))] text-[11px] font-semibold text-white/55">
          <span>{isLast ? 'Fin · Esc para salir' : 'Toca para avanzar · mantén para pausar'}</span>
        </footer>

        {localToast && (
          <div data-wrapped-action="true" className="pointer-events-auto absolute inset-x-4 bottom-14 z-40">
            <Toast message={localToast.message} type={localToast.type} onClose={() => setLocalToast(null)} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
};
