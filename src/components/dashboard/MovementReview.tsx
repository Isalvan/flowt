import { useMemo, useState } from 'react';
import { Check, Link2, Sparkles, X } from 'lucide-react';
import type { Movimiento } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { availableAmount, suggestCategory, suggestCompensations, movementDate, type CompensationSuggestion } from '../../utils/movementSuggestions';
import { CategoryPicker } from './CategoryPicker';

interface MovementReviewProps {
  movimientos: Movimiento[];
  onCategory: (id: string, categoria: string) => Promise<void>;
  onAccept: (base: Movimiento, allocations: { mov: Movimiento; importe: number }[]) => Promise<void>;
  onDismiss: (ingresoId: string, gastoId: string) => Promise<void>;
  onAdjust: (m: Movimiento) => void;
}

export function MovementReview({ movimientos, onCategory, onAccept, onDismiss, onAdjust }: MovementReviewProps) {
  const { isLocked, formatCurrency } = usePrivacy();
  const [visible, setVisible] = useState(4);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const categories = useMemo(() => movimientos.filter(m => suggestCategory(m)), [movimientos]);
  const compensations = useMemo(() => suggestCompensations(movimientos), [movimientos]);
  if (isLocked || (!categories.length && !compensations.length)) return null;
  const act = async (s: CompensationSuggestion, accept: boolean) => {
    setBusy(true);
    setError('');
    try {
      if (accept) await onAccept(s.ingreso, [{ mov: s.gasto, importe: s.importe }]);
      else await onDismiss(s.ingreso.id, s.gasto.id);
    } catch (e) { setError(e instanceof Error ? e.message : 'No se ha guardado. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };
  const dateLabel = (m: Movimiento) => movementDate(m)?.toLocaleDateString('es-ES', { timeZone: 'Europe/Madrid', day: 'numeric', month: 'short' }) ?? '';
  return (
    <section aria-label="Propuestas de movimientos" className="mb-4 rounded-2xl border border-indigo-200 bg-indigo-50/70 p-4 dark:border-indigo-500/20 dark:bg-indigo-500/5 sm:p-5">
      <h3 className="flex items-center gap-2 font-bold text-slate-800 dark:text-slate-100"><Sparkles size={17} className="text-indigo-500" /> Propuestas para revisar</h3>
      <p className="mt-1 text-xs text-slate-500 dark:text-slate-400">Confirma o cambia las categorías. Las compensaciones solo se aplican cuando las aceptas.</p>
      {compensations.length > 0 && <div className="mt-4 space-y-3">
        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300">Posibles compensaciones · {compensations.length}</h4>
        {compensations.slice(0, visible).map(s => <article key={s.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="flex items-center gap-2 text-xs font-semibold text-indigo-600 dark:text-indigo-300"><Link2 size={14} /> {s.confianza === 'baja' ? 'Posible compensación · Revisar' : 'Posible compensación'} · {dateLabel(s.ingreso)}</p>
          <div className="mt-2 space-y-1 text-sm text-slate-700 dark:text-slate-200">
            <p>Ingreso: <strong>{s.ingreso.concepto}</strong> · {formatCurrency(s.ingreso.importe)}</p>
            <p>Gasto: <strong>{s.gasto.concepto}</strong> · {formatCurrency(s.gasto.importe)}</p>
          </div>
          <p className="mt-2 text-xs text-slate-500 dark:text-slate-400">{s.motivo}</p>
          <p className="mt-1 text-xs font-semibold text-slate-600 dark:text-slate-300">Gasto neto tras aceptar: {formatCurrency(availableAmount(s.gasto) - s.importe)}</p>
          <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
            <button type="button" disabled={busy} onClick={() => void act(s, true)} className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-3 py-2 text-white disabled:opacity-50"><Check size={13} /> Aceptar {formatCurrency(s.importe)}</button>
            <button type="button" disabled={busy} onClick={() => onAdjust(s.ingreso)} className="rounded-lg bg-slate-100 px-3 py-2 text-slate-700 dark:bg-slate-800 dark:text-slate-200">Cambiar pareja o importe</button>
            <button type="button" disabled={busy} onClick={() => void act(s, false)} aria-label={`Descartar compensación de ${s.ingreso.concepto} con ${s.gasto.concepto}`} className="inline-flex items-center gap-1 rounded-lg px-3 py-2 text-slate-500 dark:text-slate-400"><X size={13} /> No están relacionados</button>
          </div>
        </article>)}
      </div>}
      {error && <p role="alert" className="mt-3 text-xs text-rose-600">{error}</p>}
      {categories.length > 0 && <div className="mt-4 space-y-3">
        <h4 className="text-xs font-bold text-slate-600 dark:text-slate-300">Categorías pendientes · {categories.length}</h4>
        {categories.slice(0, visible).map(m => <div key={m.id} className="rounded-xl border border-slate-200 bg-white p-3 dark:border-slate-700 dark:bg-slate-900">
          <p className="text-sm text-slate-700 dark:text-slate-200"><strong>{m.concepto}</strong> · {m.tipo === 'gasto' ? '−' : '+'}{formatCurrency(m.importe)} <span className="ml-1 text-xs text-slate-400">{dateLabel(m)}</span></p>
          <CategoryPicker movimiento={m} onSave={onCategory} />
          {suggestCategory(m)?.confianza === 'baja' && <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">El concepto no basta para saber el motivo. Puedes elegir otra categoría.</p>}
        </div>)}
      </div>}
      {(categories.length > visible || compensations.length > visible) && <button type="button" onClick={() => setVisible(n => n + 4)} className="mt-3 text-xs font-semibold text-indigo-600 dark:text-indigo-300">Ver más propuestas</button>}
      <p className="mt-3 text-[11px] text-slate-400">Propuestas sobre los movimientos recientes cargados.</p>
    </section>
  );
}
