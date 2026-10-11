import { useState } from 'react';
import { Check } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { hasMovementTime, movementDate, type DuplicateChargePair } from '../../utils/movementSuggestions';

export function DuplicateChargeReview({ pair: { a, b }, onDismiss }: {
  pair: DuplicateChargePair;
  onDismiss: (aId: string, bId: string) => Promise<void>;
}) {
  const { isLocked } = usePrivacy();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  if (isLocked) return null;
  const minutes = Math.round(Math.abs(movementDate(b)!.getTime() - movementDate(a)!.getTime()) / 60_000);
  const timing = hasMovementTime(a) && hasMovementTime(b) ? (minutes < 1 ? 'hecho en el mismo minuto' : `hecho ${minutes} min antes`) : 'del mismo día';
  const dismiss = async () => {
    setBusy(true);
    setError('');
    try { await onDismiss(a.id, b.id); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha guardado. Inténtalo de nuevo.'); }
    finally { setBusy(false); }
  };
  return <div aria-label={`Revisar duplicado de ${b.concepto}`} className="w-full border-t border-amber-500/10 pt-2.5 sm:grid sm:grid-cols-[1fr_auto] sm:items-center sm:gap-3">
    <p className="text-xs font-semibold text-amber-700 dark:text-amber-400">Mismo importe y comercio que otro cargo {timing}</p>
    <button type="button" disabled={busy} onClick={() => void dismiss()} className="mt-2 inline-flex items-center gap-1 rounded-xl bg-amber-500/10 px-2.5 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-500/15 disabled:opacity-50 dark:text-amber-400 sm:mt-0"><Check size={14} /> Es correcto</button>
    {busy && <p role="status" className="mt-1 text-[11px] text-ink-faint">Guardando…</p>}
    {error && <p role="alert" className="mt-1 text-xs font-semibold text-rose-500 dark:text-rose-400 sm:col-span-2">{error}</p>}
  </div>;
}
