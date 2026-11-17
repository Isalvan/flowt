import React, { useMemo } from 'react';
import { Sparkles } from 'lucide-react';
import type { Movimiento } from '../../types';
import { Modal } from '../common/Modal';
import { usePreferences } from '../../context/PreferencesContext';
import { periodRangeLabel } from '../../utils/periods';
import { availableWrappeds, type WrappedPeriod } from '../../utils/wrapped';

interface WrappedSelectorProps {
  isOpen: boolean;
  movimientos: readonly Movimiento[];
  onClose: () => void;
  onSelect: (period: WrappedPeriod) => void;
}

/** Lists every Wrapped that can be generated with the loaded movements: years first, then months. */
export const WrappedSelector: React.FC<WrappedSelectorProps> = ({ isOpen, movimientos, onClose, onSelect }) => {
  const { inicioPeriodo } = usePreferences();
  const wrappeds = useMemo(
    () => (isOpen ? availableWrappeds(movimientos, new Date(), inicioPeriodo) : []),
    [isOpen, movimientos, inicioPeriodo],
  );
  const annual = wrappeds.filter(p => p.scope === 'anio');
  const monthly = wrappeds.filter(p => p.scope === 'mes');
  const pick = (period: WrappedPeriod) => {
    onClose();
    onSelect(period);
  };

  return (
    <Modal isOpen={isOpen} onClose={onClose} title="Flowt Wrapped" size="sm">
      {wrappeds.length === 0 ? (
        <div className="dashboard-empty py-8">
          <p>Todavía no hay periodos cerrados con suficientes movimientos para generar un Wrapped.</p>
        </div>
      ) : (
        <div id="wrapped-selector-list" className="space-y-5">
          {annual.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Anual</p>
              <div className="space-y-2">
                {annual.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => pick(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line-strong bg-surface-2 px-4 py-3 text-left transition-colors hover:border-brand hover:bg-brand-tint"
                  >
                    <div className="flex min-w-0 items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-brand text-white">
                        <Sparkles size={16} />
                      </span>
                      <div className="min-w-0">
                        <span className="block text-sm font-bold text-ink">Tu {item.label} en Flowt</span>
                        <span className="block text-xs text-ink-soft">
                          {item.parcial ? 'Resumen del año hasta hoy' : 'Resumen anual completo'}
                        </span>
                      </div>
                    </div>
                    {item.parcial && (
                      <span className="shrink-0 rounded-full bg-sun-500/20 px-2.5 py-0.5 text-[10px] font-extrabold uppercase tracking-wider text-sun-600 dark:text-sun-300">
                        Hasta hoy
                      </span>
                    )}
                  </button>
                ))}
              </div>
            </div>
          )}

          {monthly.length > 0 && (
            <div>
              <p className="eyebrow mb-2">Mensual</p>
              <div className="space-y-2">
                {monthly.map(item => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => pick(item)}
                    className="flex w-full items-center justify-between gap-3 rounded-2xl border border-line bg-surface px-4 py-3 text-left transition-colors hover:border-brand hover:bg-surface-2"
                  >
                    <div className="min-w-0">
                      <span className="block text-sm font-bold capitalize text-ink">{item.label}</span>
                      <span className="block text-xs text-ink-soft">{periodRangeLabel(item)}</span>
                    </div>
                    <Sparkles size={15} className="shrink-0 text-brand-ink" />
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </Modal>
  );
};
