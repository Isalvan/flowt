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
      <p className="flex items-center gap-1.5 text-[10px] font-extrabold uppercase tracking-wider text-emerald-600 dark:text-emerald-400">
        <Link2 size={12} className="shrink-0" /> ¿Compensa este gasto?
      </p>
      <p className="mt-1 text-xs font-semibold text-slate-700 dark:text-slate-300">
        {s.gasto.concepto} <span className="text-slate-400">· {formatCurrency(s.gasto.importe)}</span>
      </p>
      <details className="mt-1 text-[10px] text-slate-500 dark:text-slate-400">
        <summary className="cursor-pointer hover:text-slate-700 dark:hover:text-slate-200">Mismo día · {s.confianza === 'baja' ? 'Revisar coincidencia' : 'Ver coincidencia'}</summary>
        <p className="mt-1">{s.motivo} Gasto neto si aceptas: {formatCurrency(availableAmount(s.gasto) - s.importe)}.</p>
      </details>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2 text-[10px] font-bold sm:mt-0">
        <button type="button" disabled={busy} onClick={() => void act(true)} className="inline-flex items-center gap-1 rounded-xl border border-emerald-500/15 bg-emerald-500/10 px-2.5 py-1.5 text-emerald-700 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400"><Check size={12} /> Aceptar {formatCurrency(s.importe)}</button>
        <button type="button" disabled={busy} onClick={() => onAdjust(s.ingreso)} aria-label="Cambiar pareja o importe" className="rounded-xl px-2 py-1.5 text-slate-500 transition-colors hover:bg-slate-500/10 disabled:opacity-50 dark:text-slate-400">Cambiar</button>
        <button type="button" disabled={busy} onClick={() => void act(false)} aria-label={`Descartar compensación de ${s.ingreso.concepto} con ${s.gasto.concepto}`} title="No están relacionados" className="inline-flex h-7 w-7 items-center justify-center rounded-xl text-slate-400 transition-colors hover:bg-rose-500/10 hover:text-rose-500 disabled:opacity-50"><X size={13} /></button>
      </div>
      {busy && <p role="status" className="mt-1 text-[10px] text-slate-400">Guardando…</p>}
      {error && <p role="alert" className="mt-1 text-xs text-rose-600 sm:col-span-2">{error}</p>}
    </div>
  );
}
