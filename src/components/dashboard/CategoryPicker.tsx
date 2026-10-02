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
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <Tag size={12} className="text-indigo-500" aria-hidden="true" />
        <select
          aria-label={`Categoría de ${m.concepto}`}
          value={value}
          disabled={saving}
          onChange={e => void save(e.target.value)}
          className="max-w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-xs text-slate-700 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-200"
        >
          {categoryOptions(m.tipo).map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
        </select>
        {suggestion && (
          <>
            <span className={suggestion.confianza === 'alta' ? 'text-indigo-600 dark:text-indigo-300' : 'text-amber-700 dark:text-amber-300'} title={suggestion.motivo}>
              {suggestion.confianza === 'alta' ? 'Sugerida' : 'Sugerida · Revisar'}
            </span>
            <button type="button" disabled={saving} onClick={() => void save(value)}
              aria-label={`Confirmar ${categoryLabel(value)} para ${m.concepto}`}
              className="inline-flex items-center gap-1 rounded-lg bg-indigo-600 px-2.5 py-1.5 font-semibold text-white disabled:opacity-50">
              <Check size={12} /> {saving ? 'Guardando…' : 'Confirmar'}
            </button>
          </>
        )}
        {!suggestion && <span className="text-slate-400">{saving ? 'Guardando…' : 'Confirmada'}</span>}
      </div>
      {error && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
    </div>
  );
}
