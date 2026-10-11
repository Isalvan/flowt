import { useState } from 'react';
import { Check, Link2, X } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { availableAmount, type CompensationSuggestion } from '../../utils/movementSuggestions';

interface MovementReviewProps {
  suggestion: CompensationSuggestion;
  onAccept: (base: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => Promise<void>;
  onDismiss: (ingresoId: string, gastoId: string) => Promise<void>;
  onAdjust: (m: Movimiento) => void;
}

/** A contextual suggestion inside the income's existing activity row. */
export function MovementReview({ suggestion: s, onAccept, onDismiss, onAdjust }: MovementReviewProps) {
  const { isLocked, formatCurrency } = usePrivacy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (isLocked) return null;
  const act = async (accept: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (accept) await onAccept(s.ingreso, [{ mov: s.gasto, importe: s.importe }]);
      else await onDismiss(s.ingreso.id, s.gasto.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha guardado. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };
  return (
    <div aria-label={`Posible compensación de ${s.ingreso.concepto}`} className="w-full border-t border-emerald-500/10 pt-2.5 sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3">
      <div className="min-w-0">
      <p className="flex items-center gap-1.5 text-[11px] font-bold text-emerald-600 dark:text-emerald-400">
        <Link2 size={14} className="shrink-0" /> ¿Compensa este gasto?
      </p>
      <p className="mt-1 text-xs font-semibold text-ink">
        {s.gasto.concepto} <span className="text-ink-faint">· {formatCurrency(s.gasto.importe)}</span>
      </p>
      <details className="mt-1 text-[11px] text-ink-soft">
        <summary className="cursor-pointer hover:text-ink">Mismo día · {s.confianza === 'baja' ? 'Revisar coincidencia' : 'Ver coincidencia'}</summary>
        <p className="mt-1">{s.motivo} Gasto neto si aceptas: {formatCurrency(availableAmount(s.gasto) - s.importe)}.</p>
      </details>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-xs font-bold sm:mt-0">
        <button type="button" disabled={busy} onClick={() => void act(true)} className="inline-flex items-center gap-1 rounded-xl bg-emerald-500/10 px-2.5 py-1.5 text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:bg-emerald-500/15 disabled:opacity-50 transition-colors"><Check size={14} /> Aceptar {formatCurrency(s.importe)}</button>
        <button type="button" disabled={busy} onClick={() => onAdjust(s.ingreso)} aria-label="Cambiar pareja o importe" className="dashboard-secondary-button !px-2.5 !py-1.5 !text-xs">Cambiar</button>
        <button type="button" disabled={busy} onClick={() => void act(false)} aria-label={`Descartar compensación de ${s.ingreso.concepto} con ${s.gasto.concepto}`} title="No están relacionados" className="dashboard-icon-button is-danger !h-7 !w-7"><X size={14} /></button>
      </div>
      {busy && <p role="status" className="mt-1 text-[11px] text-ink-faint">Guardando…</p>}
      {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-500 dark:text-rose-400 sm:col-span-2">{error}</p>}
    </div>
  );
}
