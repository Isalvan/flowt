import React from 'react';
import type { WrappedFormat, WrappedIcon, WrappedVisual } from '../../utils/wrapped';
import { ICONS, delay, formatValue, type VisualEnv } from './wrappedVisualUtils';
import { useCountUp } from '../../hooks/useCountUp';
import { ServiceIcon } from '../dashboard/ServiceIcon';

/** A number that counts up, with the final value exposed to screen readers from the start. */
export const Counter: React.FC<{ value: number; formato?: WrappedFormat; env: VisualEnv; className?: string; style?: React.CSSProperties }> = ({
  value, formato = 'numero', env, className = '', style,
}) => {
  const animated = useCountUp(value, env.reducedMotion ? 0.001 : 1.1);
  const final = formatValue(value, formato, env);
  const shown = env.reducedMotion ? final : formatValue(formato === 'numero' ? Math.round(animated) : animated, formato, env);
  return (
    <span className={className} style={style} aria-label={final}>
      <span aria-hidden="true">{shown}</span>
    </span>
  );
};

/** Vertical bars that grow in turn; the highlighted one glows in the accent colour. */
export const Bars: React.FC<{ valores: number[]; etiquetas: string[]; destacado: number; formato?: WrappedFormat; env: VisualEnv; height?: number; showValue?: boolean }> = ({
  valores, etiquetas, destacado, formato, env, height = 150, showValue = true,
}) => {
  const max = Math.max(...valores, 0.0001);
  const dense = valores.length > 14;
  return (
    <div className="w-full" role="img" aria-label={etiquetas.map((l, i) => `${l}: ${formatValue(valores[i], formato, env)}`).join(', ')}>
      <div className="flex items-end justify-between gap-[3px]" style={{ height }}>
        {valores.map((v, i) => {
          const isHot = i === destacado;
          const ratio = v / max;
          return (
            <div key={i} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end">
              {isHot && showValue && !dense && (
                <span className={`wr-in mb-1.5 whitespace-nowrap text-[11px] font-extrabold text-white ${i === valores.length - 1 && i > 0 ? 'self-end' : i === 0 ? 'self-start' : ''}`} style={delay(6)}>
                  {formatValue(v, formato, env)}
                </span>
              )}
              <div
                className="wr-grow-y w-full"
                style={{
                  ...delay(i),
                  height: `${Math.max(4, ratio * 100)}%`,
                  maxHeight: isHot && showValue && !dense ? 'calc(100% - 1.4rem)' : undefined,
                  borderRadius: dense ? 3 : 8,
                  background: isHot ? 'linear-gradient(180deg, #fff, var(--wr-accent))' : 'rgba(255,255,255,0.22)',
                  boxShadow: isHot ? '0 0 24px -2px var(--wr-accent)' : undefined,
                }}
              />
            </div>
          );
        })}
      </div>
      {!dense && (
        <div className="mt-2 flex justify-between gap-[3px]">
          {etiquetas.map((label, i) => (
            <span key={i} className={`min-w-0 flex-1 truncate text-center text-[10px] font-bold uppercase tracking-wide ${i === destacado ? 'text-white' : 'text-white/55'}`}>
              {label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
};

export const Ring: React.FC<{ pct: number; etiqueta?: string; size?: number }> = ({ pct, etiqueta, size = 200 }) => {
  const r = 84;
  const len = 2 * Math.PI * r;
  const value = Math.max(0, Math.min(100, pct));
  return (
    <div className="relative mx-auto" style={{ width: size, height: size }}>
      <svg viewBox="0 0 200 200" className="h-full w-full -rotate-90" aria-hidden="true">
        <circle cx="100" cy="100" r={r} fill="none" stroke="rgba(255,255,255,0.14)" strokeWidth="18" />
        <circle
          cx="100" cy="100" r={r} fill="none" stroke="url(#wr-ring-grad)" strokeWidth="18" strokeLinecap="round"
          className="wr-ring-value"
          style={{ '--len': len, '--off': len * (1 - value / 100) } as React.CSSProperties}
        />
        <defs>
          <linearGradient id="wr-ring-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#fff" />
            <stop offset="100%" stopColor="var(--wr-accent)" />
          </linearGradient>
        </defs>
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="font-title text-5xl font-extrabold tracking-tight text-white">{Math.round(value)}<span className="text-2xl">%</span></span>
        {etiqueta && <span className="mt-1 text-[11px] font-bold uppercase tracking-[0.14em] text-white/70">{etiqueta}</span>}
      </div>
    </div>
  );
};

/** One dot per day, seven per row, coloured by how much was spent; an optional run is outlined. */
export const CalendarDots: React.FC<{ inicio: Date; dias: number[]; marcados?: [number, number]; invert?: boolean }> = ({ inicio, dias, marcados, invert }) => {
  const offset = (inicio.getDay() + 6) % 7;
  const cells = [...Array(offset).fill(null), ...dias];
  const fills = ['rgba(255,255,255,0.12)', 'rgba(255,255,255,0.38)', 'rgba(255,255,255,0.7)', '#fff'];
  return (
    <div className="mx-auto w-full max-w-[19rem]" role="img" aria-label={`${dias.filter(l => l === 0).length} días sin gastos de ${dias.length}`}>
      <div className="mb-2 grid grid-cols-7 gap-2 text-center text-[10px] font-bold text-white/50">
        {['L', 'M', 'X', 'J', 'V', 'S', 'D'].map(d => <span key={d}>{d}</span>)}
      </div>
      <div className="grid grid-cols-7 gap-2">
        {cells.map((level, i) => {
          if (level === null) return <span key={i} />;
          const day = i - offset;
          const inRun = marcados && day >= marcados[0] && day <= marcados[1];
          const free = level === 0;
          const highlight = invert ? free : inRun;
          return (
            <span
              key={i}
              className={`wr-dot grid aspect-square place-items-center rounded-full text-[10px] font-extrabold ${highlight ? 'wr-streak' : ''}`}
              style={{
                ...delay(day),
                background: invert ? (free ? 'var(--wr-accent)' : 'rgba(255,255,255,0.12)') : fills[level],
                color: (invert ? free : level >= 2) ? 'rgba(0,0,0,0.7)' : 'rgba(255,255,255,0.75)',
                boxShadow: inRun ? '0 0 0 2px var(--wr-accent), 0 0 16px var(--wr-accent)' : undefined,
              }}
            >
              {day + 1}
            </span>
          );
        })}
      </div>
    </div>
  );
};

export const Versus: React.FC<{ antes: { label: string; valor: number }; ahora: { label: string; valor: number }; formato: WrappedFormat; env: VisualEnv }> = ({
  antes, ahora, formato, env,
}) => {
  const max = Math.max(antes.valor, ahora.valor, 0.0001);
  const cols = [{ ...antes, now: false }, { ...ahora, now: true }];
  return (
    <div className="mx-auto flex h-52 w-full max-w-[17rem] items-end justify-center gap-5">
      {cols.map((col, i) => (
        <div key={col.label + i} className="flex h-full flex-1 flex-col items-center justify-end">
          <span className={`wr-in mb-2 text-lg font-extrabold tabular-nums ${col.now ? 'text-white' : 'text-white/65'}`} style={delay(3 + i)}>
            {formatValue(col.valor, formato, env)}
          </span>
          <div
            className="wr-grow-y w-full rounded-2xl"
            style={{
              ...delay(i * 6),
              height: `${Math.max(3, col.valor / max * 100)}%`,
              maxHeight: 'calc(100% - 2.2rem)',
              background: col.now ? 'linear-gradient(180deg, #fff, var(--wr-accent))' : 'rgba(255,255,255,0.2)',
              boxShadow: col.now ? '0 10px 40px -8px var(--wr-accent)' : undefined,
            }}
          />
          <span className={`mt-2 text-xs font-bold uppercase tracking-wider ${col.now ? 'text-white' : 'text-white/55'}`}>{col.label}</span>
        </div>
      ))}
    </div>
  );
};

export const Ranking: React.FC<{ items: { nombre: string; valor: number; nota?: string }[]; formato: WrappedFormat; env: VisualEnv; showIcon?: boolean }> = ({
  items, formato, env, showIcon,
}) => {
  const max = Math.max(...items.map(item => item.valor), 0.0001);
  return (
    <ol className="w-full space-y-3">
      {items.map((item, i) => (
        <li key={item.nombre + i} className="wr-in flex items-center gap-3" style={delay(2 + i)}>
          <span className="font-title w-9 shrink-0 text-center text-4xl font-extrabold leading-none text-white/90">{i + 1}</span>
          {showIcon && <span className="shrink-0"><ServiceIcon name={item.nombre} /></span>}
          <div className="min-w-0 flex-1">
            <div className="flex items-baseline justify-between gap-2">
              <span className="truncate text-base font-extrabold text-white">{item.nombre}</span>
              <span className="shrink-0 text-sm font-extrabold tabular-nums text-white/85">{formatValue(item.valor, formato, env)}{formato === 'numero' ? '×' : ''}</span>
            </div>
            <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/12">
              <div
                className="wr-grow-x h-full rounded-full"
                style={{ ...delay(i), width: `${Math.max(6, item.valor / max * 100)}%`, background: i === 0 ? 'linear-gradient(90deg, #fff, var(--wr-accent))' : 'rgba(255,255,255,0.55)' }}
              />
            </div>
            {item.nota && <span className="mt-1 block text-[11px] font-semibold text-white/60">{item.nota}</span>}
          </div>
        </li>
      ))}
    </ol>
  );
};

const MAX_ICONS = 40;
export const IconGrid: React.FC<{ cantidad: number; icono: WrappedIcon }> = ({ cantidad, icono }) => {
  const Icon = ICONS[icono];
  const shown = Math.min(cantidad, MAX_ICONS);
  return (
    <div className="mx-auto grid w-full max-w-[18rem] grid-cols-8 gap-2" aria-hidden="true">
      {Array.from({ length: shown }, (_, i) => (
        <span key={i} className="wr-dot grid aspect-square place-items-center rounded-xl bg-white/12 text-white" style={delay(i)}>
          <Icon size={16} strokeWidth={2.4} />
        </span>
      ))}
      {cantidad > MAX_ICONS && (
        <span className="wr-dot col-span-8 mt-1 text-center text-xs font-extrabold text-white/80" style={delay(shown)}>
          y {cantidad - MAX_ICONS} más
        </span>
      )}
    </div>
  );
};

export const Visual: React.FC<{ visual: WrappedVisual; env: VisualEnv }> = ({ visual, env }) => {
  switch (visual.tipo) {
    case 'cifra':
      return (
        <div className="flex flex-col items-center">
          <Counter value={visual.valor} formato={visual.formato} env={env} className="wr-figure wr-pop" style={delay(2)} />
          {visual.sufijo && <span className="wr-in mt-2 text-sm font-extrabold uppercase tracking-[0.14em] text-white/75" style={delay(3)}>{visual.sufijo}</span>}
        </div>
      );
    case 'versus':
      return <Versus antes={visual.antes} ahora={visual.ahora} formato={visual.formato} env={env} />;
    case 'ranking':
      return <Ranking items={visual.items} formato={visual.formato} env={env} showIcon />;
    case 'anillo':
      return <div className="wr-pop" style={delay(1)}><Ring pct={visual.pct} etiqueta={visual.etiqueta} /></div>;
    case 'calendario':
      return <CalendarDots inicio={visual.inicio} dias={visual.dias} marcados={visual.marcados} invert={!visual.marcados} />;
    case 'barras':
      return <Bars valores={visual.valores} etiquetas={visual.etiquetas} destacado={visual.destacado} formato={visual.formato} env={env} />;
    case 'iconos':
      return <IconGrid cantidad={visual.cantidad} icono={visual.icono} />;
    case 'comercio':
      return (
        <div className="flex flex-col items-center">
          <span className="wr-pop grid h-24 w-24 place-items-center rounded-[1.75rem] bg-white shadow-2xl" style={delay(1)}>
            <span className="scale-[1.8]"><ServiceIcon name={visual.nombre} /></span>
          </span>
          <Counter value={visual.valor} formato="dinero" env={env} className="wr-figure wr-figure--md wr-in mt-5" style={delay(2)} />
          {visual.nota && <span className="mt-1 text-sm font-bold text-white/70">{visual.nota}</span>}
        </div>
      );
  }
};
