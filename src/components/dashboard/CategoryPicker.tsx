import { useState } from 'react';
import { Check, Tag } from 'lucide-react';
import type { Movimiento } from '../../types';
import { categoryOptions, categoryLabel, suggestCategory } from '../../utils/movementSuggestions';
import { usePrivacy } from '../../context/PrivacyContext';

export interface CategoryPickerProps {
  movimiento: Movimiento;
  onSave: (id: string, categoria: string) => Promise<void>;
}

export function CategoryPicker({ movimiento: m, onSave }: CategoryPickerProps) {
  const { isLocked } = usePrivacy();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const suggestion = suggestCategory(m);
  if (m.es_interno || m.transfer_id || isLocked) return null;
  const value = m.categoria ?? suggestion?.categoria ?? 'sin_categorizar';
  const save = async (category: string) => {
    setSaving(true);
    setError('');
    try { await onSave(m.id, category); }
    catch { setError('No se ha guardado. Inténtalo de nuevo.'); }
    finally { setSaving(false); }
  };
  return (
    <div className="mt-2" data-testid={`category-${m.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
        <label className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 ${suggestion && suggestion.confianza !== 'alta' ? 'border-amber-500/15 bg-amber-500/5 text-amber-700 dark:text-amber-400' : 'border-indigo-500/10 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400'}`} title={suggestion?.motivo}>
        <Tag size={11} className="shrink-0" aria-hidden="true" />
        <select
          aria-label={`Categoría de ${m.concepto}`}
          value={value}
          disabled={saving}
          onChange={e => void save(e.target.value)}
          className="min-w-0 max-w-[132px] cursor-pointer bg-transparent text-[11px] font-bold focus:outline-none focus:ring-2 focus:ring-indigo-500/30 disabled:opacity-50 [&>option]:bg-white [&>option]:text-slate-700 dark:[&>option]:bg-slate-900 dark:[&>option]:text-slate-200"
        >
          {categoryOptions(m.tipo).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        </label>
        {suggestion && (
          <>
            <span className={suggestion.confianza === 'alta' ? 'sr-only' : 'text-amber-700 dark:text-amber-300'} title={suggestion.motivo}>
              {suggestion.confianza === 'alta' ? 'Sugerida' : 'Revisar'}
            </span>
            <button type="button" disabled={saving} onClick={() => void save(value)}
              aria-label={`Confirmar ${categoryLabel(value)} para ${m.concepto}`}
              title={`Confirmar ${categoryLabel(value)}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/15 bg-emerald-500/10 text-emerald-600 transition-colors hover:bg-emerald-500/20 disabled:opacity-50 dark:text-emerald-400">
              <Check size={13} aria-hidden="true" />
            </button>
          </>
        )}
        {!suggestion && <Check size={11} className="text-slate-400" aria-label="Categoría confirmada" />}
        {saving && <span role="status" className="text-slate-400">Guardando…</span>}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
