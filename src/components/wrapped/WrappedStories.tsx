import React, { useCallback, useEffect, useId, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import {
  Award,
  Calendar,
  Flame,
  RotateCcw,
  Share2,
  ShoppingBag,
  Sparkles,
  TrendingDown,
  TrendingUp,
  Wallet,
  X,
} from 'lucide-react';
import type { Movimiento } from '../../types';
import { buildWrapped, type WrappedData, type WrappedPeriod } from '../../utils/wrapped';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import { CountUp } from '../common/CountUp';
import { useCountUp } from '../../hooks/useCountUp';
import { CelebrationConfetti } from '../common/CelebrationConfetti';
import { Toast, type ToastType } from '../common/Toast';
import { ServiceIcon } from '../dashboard/ServiceIcon';

const AUTO_ADVANCE_MS = 6000;
const HOLD_THRESHOLD_MS = 220;
const MONTH_SHORT = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MONTH_FULL = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

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
  gradient: string;
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

const AnimatedMoney: React.FC<{
  value: number;
  reducedMotion: boolean;
  formatCurrency: (v: number) => string;
  className?: string;
}> = ({ value, reducedMotion, formatCurrency, className = '' }) => {
  const animated = useCountUp(value, reducedMotion ? 0.001 : 0.9);
  const finalFormatted = formatCurrency(value);
  return (
    <span className={className} aria-label={finalFormatted}>
      {reducedMotion ? finalFormatted : formatCurrency(animated)}
      {!reducedMotion && <span className="sr-only">{finalFormatted}</span>}
    </span>
  );
};

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
  const [paused, setPaused] = useState(false);
  const [localToast, setLocalToast] = useState<{ message: string; type: ToastType } | null>(null);
  const pointerDownAt = useRef<number | null>(null);
  const wasLongPress = useRef(false);

  // Restart from the cover whenever another Wrapped is shown or the overlay reopens.
  const resetKey = `${data?.period.key ?? ''}|${isOpen}`;
  const [lastResetKey, setLastResetKey] = useState(resetKey);
  if (lastResetKey !== resetKey) {
    setLastResetKey(resetKey);
    setIndex(0);
    setPaused(false);
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
    const enterClass = reducedMotion ? '' : 'animate-appear-up';
    const riseClass = reducedMotion ? '' : 'rise';
    const step = (i: number) => ({ '--i': i }) as React.CSSProperties;
    const formatShortDate = (d: Date) =>
      d.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });

    const list: SlideDef[] = [];

    // 1. Portada
    list.push({
      id: 'portada',
      gradient: 'from-indigo-950 via-indigo-900 to-slate-950',
      render: () => (
        <div className={`flex flex-col items-center text-center ${enterClass}`}>
          <span className="inline-flex items-center gap-2 rounded-full bg-white/10 px-4 py-1.5 text-xs font-extrabold uppercase tracking-widest text-sun-300 backdrop-blur-sm">
            <Sparkles size={14} /> Flowt Wrapped
          </span>
          <h2 className="font-title mt-6 text-4xl font-extrabold tracking-tight text-white sm:text-6xl">
            Tu {data.period.label} en Flowt
          </h2>
          {data.period.parcial && (
            <p className="mt-3 rounded-full bg-sun-500/20 px-3.5 py-1 text-sm font-bold text-sun-300">
              hasta hoy
            </p>
          )}
          <p className="mt-6 max-w-md text-base leading-relaxed text-indigo-100/85 sm:text-lg">
            Analizamos{' '}
            <span className="font-extrabold text-white">
              {reducedMotion ? data.totales.numGastos : <CountUp end={data.totales.numGastos} duration={0.8} />}
            </span>{' '}
            gastos para contarte la historia de tu dinero.
          </p>
        </div>
      ),
    });

    // 2. Gasto total + comparativa
    list.push({
      id: 'gasto-total',
      gradient: 'from-rose-950 via-indigo-950 to-slate-950',
      render: () => (
        <div className={`flex flex-col items-center text-center ${enterClass}`}>
          <span className="eyebrow !text-rose-300">Gasto total</span>
          <p className="figure mt-4 text-4xl font-extrabold text-white sm:text-6xl">
            <AnimatedMoney
              value={data.totales.gastos}
              reducedMotion={reducedMotion}
              formatCurrency={formatCurrency}
            />
          </p>
          <p className="mt-3 text-sm font-semibold text-indigo-100/80">
            Repartidos en {data.totales.numGastos} compras y {data.totales.numComercios}{' '}
            {data.totales.numComercios === 1 ? 'comercio' : 'comercios'}
          </p>
          {data.comparativa && (
            <div className="mt-7 inline-flex items-center gap-2.5 rounded-2xl border border-white/15 bg-white/10 px-4 py-3 text-sm font-bold text-white backdrop-blur-sm">
              {data.comparativa.deltaPct <= 0 ? (
                <TrendingDown size={18} className="text-emerald-300 shrink-0" />
              ) : (
                <TrendingUp size={18} className="text-sun-300 shrink-0" />
              )}
              <span>
                {data.comparativa.deltaPct === 0
                  ? `Exactamente igual que el periodo anterior (${formatCurrency(data.comparativa.gastosAnterior)})`
                  : `Un ${Math.abs(Math.round(data.comparativa.deltaPct))} % ${
                      data.comparativa.deltaPct < 0 ? 'menos' : 'más'
                    } que antes (${formatCurrency(data.comparativa.gastosAnterior)})`}
              </span>
            </div>
          )}
        </div>
      ),
    });

    // 3. Top categorías con barras animadas
    if (data.topCategorias.length > 0) {
      list.push({
        id: 'categorias',
        gradient: 'from-violet-950 via-indigo-950 to-slate-950',
        render: () => (
          <div className={`w-full max-w-md ${enterClass}`}>
            <p className="eyebrow text-center !text-violet-300">Tus categorías principales</p>
            <h3 className="font-title mt-2 text-center text-2xl font-bold text-white sm:text-4xl">
              A dónde se fue tu dinero
            </h3>
            <div className="mt-7 space-y-4">
              {data.topCategorias.map((cat, idx) => (
                <div
                  key={cat.categoria}
                  className={`rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur-sm ${riseClass}`}
                  style={step(idx)}
                >
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-base font-bold text-white">{cat.label}</span>
                    <span className="text-sm font-extrabold tabular-nums text-violet-200">
                      {formatCurrency(cat.total)} · {Math.round(cat.porcentaje)} %
                    </span>
                  </div>
                  <div className="mt-2.5 h-2.5 w-full overflow-hidden rounded-full bg-white/10">
                    <div
                      className="h-full rounded-full bg-gradient-to-r from-indigo-400 to-sun-400"
                      style={{
                        width: `${Math.min(100, Math.max(6, cat.porcentaje))}%`,
                        transformOrigin: 'left',
                        animation: reducedMotion ? 'none' : 'fill-up 650ms var(--ease-soft) backwards',
                      }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        ),
      });
    }

    // 4. Comercio favorito (+ comercioTop si es otro)
    if (data.comercioFavorito) {
      const fav = data.comercioFavorito;
      const topOther = data.comercioTop && data.comercioTop.key !== fav.key ? data.comercioTop : null;
      list.push({
        id: 'comercios',
        gradient: 'from-sky-950 via-indigo-950 to-slate-950',
        render: () => (
          <div className={`flex w-full max-w-md flex-col items-center text-center ${enterClass}`}>
            <span className="eyebrow !text-sky-300">Tu parada habitual</span>
            <div className="mt-6 grid h-20 w-20 place-items-center rounded-3xl border border-white/20 bg-white/10 shadow-xl backdrop-blur-md">
              <div className="scale-150">
                <ServiceIcon name={fav.nombre} />
              </div>
            </div>
            <h3 className="font-title mt-5 text-3xl font-extrabold text-white sm:text-4xl">
              {fav.nombre}
            </h3>
            <p className="mt-2 text-base font-semibold text-sky-200">
              <span className="font-extrabold text-white">
                {reducedMotion ? fav.visitas : <CountUp end={fav.visitas} duration={0.8} />}
              </span>{' '}
              {fav.visitas === 1 ? 'visita' : 'visitas'} · {formatCurrency(fav.total)}
            </p>
            {topOther && (
              <div className="mt-7 flex w-full items-center justify-between gap-3 rounded-2xl border border-white/15 bg-white/8 px-4 py-3.5 text-left backdrop-blur-sm">
                <div className="flex min-w-0 items-center gap-3">
                  <ServiceIcon name={topOther.nombre} />
                  <div className="min-w-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-sky-300">
                      Donde más gastaste
                    </p>
                    <p className="truncate text-sm font-bold text-white">{topOther.nombre}</p>
                  </div>
                </div>
                <span className="shrink-0 text-sm font-extrabold tabular-nums text-white">
                  {formatCurrency(topOther.total)}
                </span>
              </div>
            )}
          </div>
        ),
      });
    }

    // 5. Mensual: día más caro + mini gráfico SVG de serieDiaria / Anual: mes más caro y barato + 12 barras
    if (data.period.scope === 'mes' && data.diaMasCaro && data.serieDiaria.length > 0) {
      const peak = data.diaMasCaro;
      const maxDaily = Math.max(...data.serieDiaria.map(d => d.total), 1);
      list.push({
        id: 'ritmo',
        gradient: 'from-amber-950 via-indigo-950 to-slate-950',
        render: () => (
          <div className={`flex w-full max-w-md flex-col items-center text-center ${enterClass}`}>
            <span className="eyebrow !text-sun-300">Tu pico del mes</span>
            <h3 className="font-title mt-2 text-2xl font-extrabold text-white capitalize sm:text-4xl">
              {peak.fecha.toLocaleDateString('es-ES', {
                weekday: 'long',
                day: 'numeric',
                month: 'long',
              })}
            </h3>
            <p className="figure mt-3 text-3xl font-extrabold text-sun-300 sm:text-5xl">
              <AnimatedMoney
                value={peak.total}
                reducedMotion={reducedMotion}
                formatCurrency={formatCurrency}
              />
            </p>
            <div className="mt-7 w-full rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
              <svg
                viewBox={`0 0 ${data.serieDiaria.length * 10} 64`}
                role="img"
                aria-label="Evolución diaria de gastos"
                className="h-24 w-full overflow-visible"
              >
                {data.serieDiaria.map((d, i) => {
                  const ratio = maxDaily > 0 ? d.total / maxDaily : 0;
                  const barHeight = Math.max(3, Math.round(ratio * 56));
                  const isPeak = +d.fecha === +peak.fecha && d.total > 0;
                  return (
                    <rect
                      key={+d.fecha}
                      x={i * 10 + 1.5}
                      y={60 - barHeight}
                      width={7}
                      height={barHeight}
                      rx={3}
                      fill={isPeak ? '#ffb02e' : 'rgba(255,255,255,0.32)'}
                    />
                  );
                })}
              </svg>
              <div className="mt-2 flex justify-between text-[11px] font-semibold text-indigo-200/75">
                <span>{formatShortDate(data.serieDiaria[0].fecha)}</span>
                <span>{formatShortDate(data.serieDiaria[data.serieDiaria.length - 1].fecha)}</span>
              </div>
            </div>
          </div>
        ),
      });
    } else if (data.period.scope === 'anio' && data.mesMasCaro && data.serieMensual.length === 12) {
      const caro = data.mesMasCaro;
      const barato = data.mesMasBarato;
      const maxMonth = Math.max(...data.serieMensual, 1);
      list.push({
        id: 'ritmo',
        gradient: 'from-amber-950 via-indigo-950 to-slate-950',
        render: () => (
          <div className={`flex w-full max-w-md flex-col items-center text-center ${enterClass}`}>
            <span className="eyebrow !text-sun-300">Ritmo mes a mes</span>
            <h3 className="font-title mt-2 text-2xl font-extrabold text-white sm:text-4xl">
              {MONTH_FULL[caro.mes]} fue tu mes más intenso
            </h3>
            <p className="figure mt-2 text-3xl font-extrabold text-sun-300 sm:text-4xl">
              {formatCurrency(caro.total)}
            </p>
            {barato && barato.mes !== caro.mes && (
              <p className="mt-2 text-xs font-semibold text-indigo-200">
                El más tranquilo: <span className="font-bold text-white capitalize">{MONTH_FULL[barato.mes]}</span> ({formatCurrency(barato.total)})
              </p>
            )}
            <div className="mt-6 w-full rounded-2xl border border-white/10 bg-white/8 p-4 backdrop-blur-sm">
              <svg
                viewBox="0 0 240 80"
                role="img"
                aria-label="Gasto mensual del año"
                className="h-28 w-full overflow-visible"
              >
                {data.serieMensual.map((total, m) => {
                  const ratio = maxMonth > 0 ? total / maxMonth : 0;
                  const barHeight = Math.max(3, Math.round(ratio * 56));
                  const isCaro = m === caro.mes;
                  const isBarato = barato?.mes === m && !isCaro;
                  return (
                    <g key={m}>
                      <rect
                        x={m * 20 + 3}
                        y={62 - barHeight}
                        width={14}
                        height={barHeight}
                        rx={4}
                        fill={isCaro ? '#ffb02e' : isBarato ? '#34d399' : 'rgba(255,255,255,0.32)'}
                      />
                      <text
                        x={m * 20 + 10}
                        y={76}
                        textAnchor="middle"
                        fontSize="7"
                        fontWeight="700"
                        fill="rgba(255,255,255,0.75)"
                      >
                        {MONTH_SHORT[m]}
                      </text>
                    </g>
                  );
                })}
              </svg>
            </div>
          </div>
        ),
      });
    }

    // 6. Compra más grande
    if (data.compraMayor && data.compraMayor.importe > 0) {
      list.push({
        id: 'compra-mayor',
        gradient: 'from-fuchsia-950 via-indigo-950 to-slate-950',
        render: () => (
          <div className={`flex flex-col items-center text-center ${enterClass}`}>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-fuchsia-500/20 text-fuchsia-300">
              <ShoppingBag size={26} />
            </span>
            <span className="eyebrow mt-5 !text-fuchsia-300">Tu compra más grande</span>
            <h3 className="font-title mt-3 max-w-sm text-2xl font-extrabold text-white sm:text-4xl">
              {data.compraMayor.concepto}
            </h3>
            <p className="figure mt-4 text-4xl font-extrabold text-sun-300 sm:text-6xl">
              <AnimatedMoney
                value={data.compraMayor.importe}
                reducedMotion={reducedMotion}
                formatCurrency={formatCurrency}
              />
            </p>
            <p className="mt-3 inline-flex items-center gap-1.5 text-xs font-semibold text-indigo-200/80">
              <Calendar size={13} />
              {data.compraMayor.fecha.toLocaleDateString('es-ES', {
                day: 'numeric',
                month: 'long',
                year: 'numeric',
              })}
            </p>
          </div>
        ),
      });
    }

    // 7. Racha sin gastos
    if (data.rachaSinGastos.dias > 0) {
      list.push({
        id: 'racha',
        gradient: 'from-teal-950 via-emerald-950 to-slate-950',
        render: () => (
          <div className={`flex flex-col items-center text-center ${enterClass}`}>
            <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-300">
              <Flame size={28} />
            </span>
            <span className="eyebrow mt-5 !text-emerald-300">Mayor racha sin gastar</span>
            <p className="figure mt-3 text-6xl font-extrabold text-white sm:text-7xl">
              {reducedMotion ? (
                data.rachaSinGastos.dias
              ) : (
                <CountUp end={data.rachaSinGastos.dias} duration={0.8} />
              )}
            </p>
            <p className="font-title mt-2 text-xl font-bold text-emerald-200 sm:text-2xl">
              {data.rachaSinGastos.dias === 1 ? 'día sin gastos' : 'días seguidos sin gastar un euro'}
            </p>
            {data.rachaSinGastos.desde && data.rachaSinGastos.hasta && (
              <p className="mt-3 text-xs font-semibold text-emerald-100/75">
                Del {formatShortDate(data.rachaSinGastos.desde)} al{' '}
                {formatShortDate(data.rachaSinGastos.hasta)}
              </p>
            )}
          </div>
        ),
      });
    }

    // 8. Curiosidades escalonadas
    if (data.curiosidades.length > 0) {
      list.push({
        id: 'curiosidades',
        gradient: 'from-indigo-950 via-slate-900 to-amber-950',
        render: () => (
          <div className={`w-full max-w-md ${enterClass}`}>
            <p className="eyebrow text-center !text-sun-300">Curiosidades</p>
            <h3 className="font-title mt-2 text-center text-2xl font-bold text-white sm:text-4xl">
              Detalles que quizá no viste
            </h3>
            <ul className="mt-6 space-y-3">
              {data.curiosidades.map((texto, idx) => (
                <li
                  key={idx}
                  className={`flex items-start gap-3 rounded-2xl border border-white/12 bg-white/8 p-4 text-sm font-semibold leading-relaxed text-white backdrop-blur-sm ${riseClass}`}
                  style={step(idx)}
                >
                  <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-sun-500/25 text-xs font-extrabold text-sun-300">
                    {idx + 1}
                  </span>
                  <span>{texto}</span>
                </li>
              ))}
            </ul>
          </div>
        ),
      });
    }

    // 9. Ahorro con confeti si > 0
    list.push({
      id: 'ahorro',
      gradient: 'from-emerald-950 via-indigo-950 to-slate-950',
      confetti: data.totales.ahorro > 0 && !reducedMotion,
      render: () => (
        <div className={`flex flex-col items-center text-center ${enterClass}`}>
          <span className="grid h-14 w-14 place-items-center rounded-2xl bg-emerald-500/20 text-emerald-300">
            <Wallet size={26} />
          </span>
          <span className="eyebrow mt-5 !text-emerald-300">
            {data.totales.ahorro > 0 ? 'Lo que lograste ahorrar' : 'Balance del periodo'}
          </span>
          <p className="figure mt-3 text-4xl font-extrabold text-white sm:text-6xl">
            <AnimatedMoney
              value={data.totales.ahorro}
              reducedMotion={reducedMotion}
              formatCurrency={formatCurrency}
            />
          </p>
          {data.totales.tasaAhorro !== null && (
            <p className="mt-3 rounded-full bg-emerald-500/20 px-4 py-1 text-sm font-bold text-emerald-200">
              Tasa de ahorro: {Math.round(data.totales.tasaAhorro)} %
            </p>
          )}
          <div className="mt-6 grid grid-cols-2 gap-3 text-xs font-semibold text-indigo-100/85">
            <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2.5">
              <span className="block text-[10px] uppercase tracking-wider text-indigo-300">Ingresos</span>
              <span className="mt-0.5 block text-sm font-extrabold text-white">
                {formatCurrency(data.totales.ingresos)}
              </span>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/8 px-4 py-2.5">
              <span className="block text-[10px] uppercase tracking-wider text-indigo-300">Gastos</span>
              <span className="mt-0.5 block text-sm font-extrabold text-white">
                {formatCurrency(data.totales.gastos)}
              </span>
            </div>
          </div>
        </div>
      ),
    });

    // 10. Personalidad
    if (data.personalidad?.titulo) {
      list.push({
        id: 'personalidad',
        gradient: 'from-purple-950 via-indigo-950 to-amber-950',
        render: () => (
          <div className={`flex flex-col items-center text-center ${enterClass}`}>
            <span className="grid h-16 w-16 place-items-center rounded-3xl bg-sun-500/20 text-sun-300">
              <Award size={32} />
            </span>
            <span className="eyebrow mt-5 !text-sun-300">Tu personalidad en Flowt</span>
            <h3 className="font-title mt-3 text-4xl font-extrabold text-white sm:text-5xl">
              {data.personalidad.titulo}
            </h3>
            <p className="mt-4 max-w-sm text-base leading-relaxed text-indigo-100/90 sm:text-lg">
              {data.personalidad.descripcion}
            </p>
          </div>
        ),
      });
    }

    // 11. Resumen final con 4–5 cifras, Compartir y Ver otra vez
    list.push({
      id: 'resumen',
      gradient: 'from-indigo-950 via-slate-900 to-slate-950',
      render: () => (
        <div className={`flex w-full max-w-md flex-col items-center text-center ${enterClass}`}>
          <span className="eyebrow !text-sun-300">
            Resumen · {data.period.label}
            {data.period.parcial ? ' hasta hoy' : ''}
          </span>
          <h3 className="font-title mt-1.5 text-2xl font-extrabold text-white sm:text-3xl">
            Tu {data.period.label} de un vistazo
          </h3>

          <div className="mt-5 grid w-full grid-cols-2 gap-2.5 text-left">
            <div className="rounded-2xl border border-white/12 bg-white/8 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Gasto total</p>
              <p className="figure mt-1 text-lg font-extrabold text-white">
                {formatCurrency(data.totales.gastos)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/8 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Ahorro</p>
              <p className="figure mt-1 text-lg font-extrabold text-emerald-300">
                {formatCurrency(data.totales.ahorro)}
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/8 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Actividad</p>
              <p className="mt-1 text-sm font-extrabold text-white">
                {data.totales.numGastos} gastos · {data.totales.numComercios} comercios
              </p>
            </div>
            <div className="rounded-2xl border border-white/12 bg-white/8 p-3.5">
              <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Categoría top</p>
              <p className="mt-1 truncate text-sm font-extrabold text-white">
                {data.topCategorias[0]?.label ?? '—'}
              </p>
            </div>
            <div className="col-span-2 rounded-2xl border border-white/12 bg-white/8 p-3.5 flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="text-[11px] font-bold uppercase tracking-wider text-sun-300">Personalidad</p>
                <p className="mt-0.5 truncate text-base font-extrabold text-white">
                  {data.personalidad.titulo}
                </p>
              </div>
              {data.comercioFavorito && (
                <div className="text-right min-w-0">
                  <p className="text-[11px] font-bold uppercase tracking-wider text-indigo-300">Favorito</p>
                  <p className="mt-0.5 truncate text-xs font-bold text-white">
                    {data.comercioFavorito.nombre}
                  </p>
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 flex w-full flex-col gap-2.5 sm:flex-row">
            <button
              id="wrapped-share-button"
              type="button"
              data-wrapped-action="true"
              onClick={e => {
                e.stopPropagation();
                void handleShare();
              }}
              className="dashboard-primary-button flex-1 !py-3"
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
                setIndex(0);
              }}
              className="inline-flex flex-1 items-center justify-center gap-2 rounded-[0.8rem] border border-white/20 bg-white/10 px-4 py-3 text-xs font-bold text-white transition-colors hover:bg-white/15"
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

  const goNext = useCallback(() => {
    setIndex(prev => (prev < slides.length - 1 ? prev + 1 : prev));
  }, [slides.length]);

  const goPrev = useCallback(() => {
    setIndex(prev => (prev > 0 ? prev - 1 : prev));
  }, []);

  // Auto-advance (~6s) when not paused and not reduced-motion
  useEffect(() => {
    if (!isOpen || isLocked || !data || reducedMotion || paused) return;
    if (safeIndex >= slides.length - 1) return;
    const timer = window.setTimeout(() => {
      setIndex(prev => (prev < slides.length - 1 ? prev + 1 : prev));
    }, AUTO_ADVANCE_MS);
    return () => window.clearTimeout(timer);
  }, [isOpen, isLocked, data, reducedMotion, paused, safeIndex, slides.length]);

  // Keyboard navigation + Focus trap (like Modal)
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
        if (
          e.shiftKey &&
          (document.activeElement === first || document.activeElement === containerRef.current)
        ) {
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
    const rect = e.currentTarget.getBoundingClientRect();
    const width = rect.width > 0 ? rect.width : window.innerWidth || 1024;
    const midpoint = (rect.width > 0 ? rect.left : 0) + width / 2;
    if (e.clientX >= midpoint) {
      goNext();
    } else {
      goPrev();
    }
  };

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
      className={`fixed inset-0 z-50 flex flex-col justify-between overflow-hidden bg-gradient-to-br ${currentSlide.gradient} p-4 text-white select-none sm:p-8`}
    >
      {currentSlide.confetti && <CelebrationConfetti trigger={safeIndex + 1} />}

      {/* Top segmented progress bar & close button */}
      <header className="relative z-20 mx-auto flex w-full max-w-xl flex-col gap-3">
        <div
          role="progressbar"
          aria-label="Progreso del Wrapped"
          aria-valuemin={1}
          aria-valuemax={slides.length}
          aria-valuenow={safeIndex + 1}
          className="flex w-full gap-1.5"
        >
          {slides.map((s, idx) => {
            const completed = idx < safeIndex;
            const active = idx === safeIndex;
            return (
              <div key={s.id} className="h-1 flex-1 overflow-hidden rounded-full bg-white/20">
                <div
                  key={`${s.id}-${active ? 'active' : completed ? 'done' : 'idle'}`}
                  className="h-full rounded-full bg-white dark:bg-white"
                  style={
                    completed
                      ? { width: '100%' }
                      : active
                        ? reducedMotion || safeIndex >= slides.length - 1
                          ? { width: '100%' }
                          : {
                              width: '100%',
                              transformOrigin: 'left',
                              animation: `fill-up ${AUTO_ADVANCE_MS}ms linear forwards`,
                              animationPlayState: paused ? 'paused' : 'running',
                            }
                        : { width: '0%' }
                  }
                />
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between">
          <span className="text-xs font-bold tracking-wide text-white/75">
            {safeIndex + 1} / {slides.length}
          </span>
          <button
            id="wrapped-close-button"
            type="button"
            data-wrapped-action="true"
            onClick={e => {
              e.stopPropagation();
              onClose();
            }}
            aria-label="Cerrar Wrapped"
            className="grid h-9 w-9 place-items-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20"
          >
            <X size={18} />
          </button>
        </div>
      </header>

      {/* Left / Right tap zones for touch, mouse and screen readers */}
      <div className="pointer-events-none absolute inset-0 z-10 flex">
        <button
          id="wrapped-prev-zone"
          type="button"
          tabIndex={-1}
          data-wrapped-zone="prev"
          aria-label="Diapositiva anterior"
          className="pointer-events-auto h-full w-1/2 bg-transparent focus:outline-none"
        />
        <button
          id="wrapped-next-zone"
          type="button"
          tabIndex={-1}
          data-wrapped-zone="next"
          aria-label="Siguiente diapositiva"
          className="pointer-events-auto h-full w-1/2 bg-transparent focus:outline-none"
        />
      </div>

      {/* Active slide content */}
      <main
        key={currentSlide.id}
        data-slide-id={currentSlide.id}
        className="relative z-20 pointer-events-none mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center px-2 py-6 [&_button]:pointer-events-auto"
      >
        {currentSlide.render()}
      </main>

      {/* Footer hint */}
      <footer className="relative z-20 mx-auto flex w-full max-w-xl items-center justify-center pb-2 text-[11px] font-semibold text-white/55">
        <span>Toca a la derecha o pulsa → para avanzar · Esc para salir</span>
      </footer>

      {localToast && (
        <div
          data-wrapped-action="true"
          className="pointer-events-auto fixed bottom-6 right-6 z-50 w-full max-w-sm"
        >
          <Toast
            message={localToast.message}
            type={localToast.type}
            onClose={() => setLocalToast(null)}
          />
        </div>
      )}
    </div>,
    document.body,
  );
};
