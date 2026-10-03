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
      <div className="flex flex-wrap items-center gap-1.5 text-[10px] font-bold">
        <button type="button" disabled={saving} aria-haspopup="dialog" aria-label={`Categoría de ${m.concepto}`} onClick={() => { setSearch(''); setError(''); setOpen(true); }} className={`inline-flex max-w-full items-center gap-1 rounded-lg border px-2 py-1 text-[11px] ${suggestion && suggestion.confianza !== 'alta' ? 'border-amber-500/15 bg-amber-500/5 text-amber-700 dark:text-amber-400' : 'border-indigo-500/10 bg-indigo-500/5 text-indigo-600 dark:text-indigo-400'}`}>
          <Tag size={11} aria-hidden="true" /><span className="max-w-[132px] truncate">{categoryLabel(value)}</span><ChevronDown size={12} aria-hidden="true" />
        </button>
        {suggestion ? <>
          <span className={suggestion.confianza === 'alta' ? 'sr-only' : 'text-amber-700 dark:text-amber-300'} title={suggestion.motivo}>{suggestion.confianza === 'alta' ? 'Sugerida' : 'Revisar'}</span>
          <button type="button" disabled={saving} onClick={() => void save(value)} aria-label={`Confirmar ${categoryLabel(value)} para ${m.concepto}`} className="inline-flex h-7 w-7 items-center justify-center rounded-lg border border-emerald-500/15 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"><Check size={13} aria-hidden="true" /></button>
        </> : <Check size={11} className="text-slate-400" aria-label="Categoría confirmada" />}
        {saving && <span role="status" className="text-slate-400">Guardando…</span>}
      </div>
      {error && !open && <p role="alert" className="mt-1 text-xs text-rose-600">{error}</p>}
      {open && <Modal isOpen onClose={() => { if (!saving) setOpen(false); }} title="Elegir categoría" size="md">
        <p className="mb-4 text-sm text-slate-500 dark:text-slate-400">{m.concepto}</p>
        <input autoFocus aria-label="Buscar categoría" value={search} onChange={e => setSearch(e.target.value)} placeholder="Buscar categoría…" className="mb-4 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {options.map(c => <button key={c.id} type="button" disabled={saving} onClick={() => void save(c.id)} aria-pressed={value === c.id} className={`flex items-center justify-between gap-2 rounded-xl border p-3 text-left text-sm font-semibold transition-colors ${value === c.id ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-indigo-500/5'}`}>{c.label}{value === c.id && <Check size={15} aria-hidden="true" />}</button>)}
        </div>
        {!options.length && <p className="py-4 text-sm text-slate-500">No hay categorías con ese nombre.</p>}
        {error && <p role="alert" className="mt-3 text-sm text-rose-600">{error}</p>}
        {saving && <p role="status" className="mt-3 text-sm text-slate-500">Guardando categoría…</p>}
        {createCategory && <button type="button" disabled={saving} onClick={() => { setOpen(false); setCreating(true); }} className="mt-5 flex w-full items-center justify-center gap-2 rounded-xl bg-indigo-600 p-3 font-bold text-white"><Plus size={16} />Crear categoría</button>}
      </Modal>}
      {creating && <CreateCategoryModal tipo={m.tipo} onClose={() => setCreating(false)} onCreated={async category => { await onSave(m.id, category.id); }} />}
    </div>
  );
}
