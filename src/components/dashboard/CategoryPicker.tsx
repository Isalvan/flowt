import { useState } from 'react';
import { Check, Tag, Plus, ChevronDown } from 'lucide-react';
import type { Movimiento } from '../../types';
import { useCategories } from '../../hooks/useCategories';
import { usePrivacy } from '../../context/PrivacyContext';
import { Modal } from '../common/Modal';
import { CreateCategoryModal } from '../modals/CreateCategoryModal';

export interface CategoryPickerProps {
  movimiento: Movimiento;
  onSave: (id: string, categoria: string) => Promise<void>;
}

export function CategoryPicker({ movimiento: m, onSave }: CategoryPickerProps) {
  const { isLocked } = usePrivacy();
  const { categoryOptions, categoryLabel, suggestCategory, createCategory } = useCategories();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [search, setSearch] = useState('');
  const suggestion = suggestCategory(m);
  if (m.es_interno || m.transfer_id || isLocked) return null;
  const value = m.categoria ?? suggestion?.categoria ?? 'sin_categorizar';
  const save = async (category: string) => {
    setSaving(true); setError('');
    try { await onSave(m.id, category); setOpen(false); }
    catch { setError('No se ha guardado. Inténtalo de nuevo.'); }
    finally { setSaving(false); }
  };
  const options = categoryOptions(m.tipo).filter(c => c.label.toLocaleLowerCase('es').includes(search.toLocaleLowerCase('es')));
  return (
    <div className="mt-2" data-testid={`category-${m.id}`}>
      <div className="flex flex-wrap items-center gap-1.5 text-[11px] font-bold">
        <button
          type="button"
          disabled={saving}
          aria-haspopup="dialog"
          aria-label={`Categoría de ${m.concepto}`}
          onClick={() => { setSearch(''); setError(''); setOpen(true); }}
          className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-[11px] font-semibold transition-colors ${
            suggestion && suggestion.confianza !== 'alta'
              ? 'border-amber-500/20 bg-amber-500/12 text-amber-700 dark:text-amber-400'
              : 'border-line bg-brand-tint text-brand-ink'
          }`}
        >
          <Tag size={12} aria-hidden="true" />
          <span className="max-w-[132px] truncate">{categoryLabel(value)}</span>
          <ChevronDown size={12} aria-hidden="true" />
        </button>
        {suggestion ? (
          <>
            <span
              className={suggestion.confianza === 'alta' ? 'sr-only' : 'text-amber-700 dark:text-amber-400 text-[11px] font-semibold'}
              title={suggestion.motivo}
            >
              {suggestion.confianza === 'alta' ? 'Sugerida' : 'Revisar'}
            </span>
            <button
              type="button"
              disabled={saving}
              onClick={() => void save(value)}
              aria-label={`Confirmar ${categoryLabel(value)} para ${m.concepto}`}
              className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/20 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 transition-colors"
            >
              <Check size={13} aria-hidden="true" />
            </button>
          </>
        ) : (
          <Check size={12} className="text-ink-faint" aria-label="Categoría confirmada" />
        )}
        {saving && <span role="status" className="text-ink-faint text-[11px]">Guardando…</span>}
      </div>
      {error && !open && <p role="alert" className="mt-1 text-xs text-rose-500 dark:text-rose-400">{error}</p>}
      {open && (
        <Modal isOpen onClose={() => { if (!saving) setOpen(false); }} title="Elegir categoría" size="md">
          <p className="dashboard-subtitle -mt-2 mb-4">{m.concepto}</p>
          <input
            autoFocus
            aria-label="Buscar categoría"
            value={search}
            onChange={e => setSearch(e.target.value)}
            placeholder="Buscar categoría…"
            className="field mb-4"
          />
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {options.map(c => (
              <button
                key={c.id}
                type="button"
                disabled={saving}
                onClick={() => void save(c.id)}
                aria-pressed={value === c.id}
                className="choice-card w-full flex-row items-center justify-between p-3 text-sm font-semibold"
              >
                <span>{c.label}</span>
                {value === c.id && <Check size={15} aria-hidden="true" className="shrink-0" />}
              </button>
            ))}
          </div>
          {!options.length && (
            <p className="py-4 text-center text-sm text-ink-soft">No hay categorías con ese nombre.</p>
          )}
          {error && <div role="alert" className="notice is-danger mt-3">{error}</div>}
          {saving && <p role="status" className="mt-3 text-xs text-ink-soft">Guardando categoría…</p>}
          {createCategory && (
            <button
              type="button"
              disabled={saving}
              onClick={() => { setOpen(false); setCreating(true); }}
              className="dashboard-primary-button mt-5 w-full"
            >
              <Plus size={16} />
              Crear categoría
            </button>
          )}
        </Modal>
      )}
      {creating && (
        <CreateCategoryModal
          tipo={m.tipo}
          onClose={() => setCreating(false)}
          onCreated={async category => { await onSave(m.id, category.id); }}
        />
      )}
    </div>
  );
}
