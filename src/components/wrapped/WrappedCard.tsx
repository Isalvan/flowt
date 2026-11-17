import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { Movimiento } from '../../types';
import type { InicioPeriodo } from '../../utils/periods';
import { featuredWrapped, type WrappedPeriod } from '../../utils/wrapped';
import { usePreferences } from '../../context/PreferencesContext';
import { useWrappedSeen } from '../../hooks/useWrappedSeen';

export interface WrappedCardProps {
  movimientos: readonly Movimiento[];
  inicioPeriodo?: InicioPeriodo;
  userId?: string | null;
  now?: Date;
  onOpen: (period: WrappedPeriod) => void;
  className?: string;
  style?: React.CSSProperties;
}

export const WrappedCard: React.FC<WrappedCardProps> = ({
  movimientos,
  inicioPeriodo,
  userId = 'demo',
  now,
  onOpen,
  className = '',
  style,
}) => {
  const prefs = usePreferences();
  const resolvedInicio = inicioPeriodo ?? prefs.inicioPeriodo;
  const { seen, markSeen } = useWrappedSeen(userId);

  const pending = useMemo(
    () => featuredWrapped(movimientos, now ?? new Date(), resolvedInicio, seen),
    [movimientos, now, resolvedInicio, seen],
  );

  if (!pending) return null;

  const subtitle = pending.parcial
    ? 'Descubre cómo va tu año hasta hoy en formato historias.'
    : pending.scope === 'anio'
      ? 'Repasa tus mejores momentos, hábitos y logros del año.'
      : 'Un recorrido visual por tus gastos, ahorros y curiosidades del periodo.';

  return (
    <section
      id="wrapped-card"
      aria-label="Wrapped disponible"
      style={style}
      className={`relative overflow-hidden rounded-[1.25rem] border border-brand/25 bg-gradient-to-r from-indigo-600/12 via-brand-tint to-sun-500/14 p-5 shadow-[var(--shadow-card)] ${className}`.trim()}
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex min-w-0 items-start gap-3.5">
          <span
            aria-hidden="true"
            className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-brand text-white shadow-[0_10px_22px_-10px_var(--brand)]"
          >
            <Sparkles size={20} />
          </span>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <span className="eyebrow text-brand-ink">Flowt Wrapped</span>
              {pending.parcial && (
                <span className="rounded-full bg-sun-500/20 px-2 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sun-600 dark:text-sun-300">
                  Hasta hoy
                </span>
              )}
            </div>
            <h3 className="font-title mt-0.5 text-lg font-bold text-ink sm:text-xl">
              Tu {pending.label} ya está listo ✨
            </h3>
            <p className="mt-0.5 text-xs text-ink-soft sm:text-[13px]">
              {subtitle}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:self-center">
          <button
            id="wrapped-card-open"
            type="button"
            onClick={() => {
              markSeen(pending.key);
              onOpen(pending);
            }}
            className="dashboard-primary-button flex-1 sm:flex-none"
          >
            <Sparkles size={15} />
            Ver mi Wrapped
          </button>
          <button
            id="wrapped-card-dismiss"
            type="button"
            onClick={() => markSeen(pending.key)}
            className="dashboard-secondary-button"
          >
            Ahora no
          </button>
        </div>
      </div>
    </section>
  );
};
