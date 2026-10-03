import { useState } from 'react';
import { Tag } from 'lucide-react';
import { Modal } from '../common/Modal';
import { useCategories } from '../../hooks/useCategories';
import type { MovementCategory } from '../../utils/movementSuggestions';

export function CreateCategoryModal({ tipo, onClose, onCreated }: {
  tipo: 'gasto' | 'ingreso'; onClose: () => void; onCreated: (category: MovementCategory) => Promise<void>;
}) {
  const { createCategory } = useCategories();
  const [name, setName] = useState('');
  const [direction, setDirection] = useState<MovementCategory['tipo']>(tipo);
  const [saving, setSaving] = useState(false);
  const [created, setCreated] = useState<MovementCategory | null>(null);
  const [error, setError] = useState('');
  const close = () => { if (!saving) onClose(); };
  return <Modal isOpen onClose={close} size="sm" title={<span className="flex items-center gap-2"><Tag size={20} className="text-indigo-500" />Crear categoría</span>}>
    <form noValidate className="space-y-5" onSubmit={async e => {
      e.preventDefault();
      if (saving || !createCategory) return;
      setSaving(true); setError('');
      try {
        const category = created ?? await createCategory(name, direction);
        setCreated(category);
        await onCreated(category);
        onClose();
      } catch (err) { setError(err instanceof Error ? err.message : 'No se ha podido guardar. Inténtalo de nuevo.'); }
      finally { setSaving(false); }
    }}>
      <p className="text-sm text-slate-500 dark:text-slate-400">Organiza tus movimientos con tus propias categorías. Se guardarán en tu cuenta.</p>
      <label className="block text-sm font-semibold text-slate-700 dark:text-slate-200">Nombre
        <input autoFocus maxLength={50} value={name} disabled={saving || !!created} onChange={e => setName(e.target.value)} placeholder="Ej. Regalos, Mascotas, Viajes" className="mt-2 w-full rounded-xl border border-slate-200 dark:border-slate-700 bg-white/60 dark:bg-slate-900/60 p-3 focus:outline-none focus:ring-2 focus:ring-indigo-500" />
      </label>
      <fieldset className="block text-sm font-semibold text-slate-700 dark:text-slate-200"><legend>Disponible para</legend>
        <span className="mt-2 grid grid-cols-2 gap-2">
          {[tipo, 'ambos'].map(option => <button key={option} type="button" aria-pressed={direction === option} disabled={saving || !!created} onClick={() => setDirection(option as MovementCategory['tipo'])} className={`rounded-xl border p-3 ${direction === option ? 'border-indigo-500 bg-indigo-500/10 text-indigo-600 dark:text-indigo-300' : 'border-slate-200 dark:border-slate-700'}`}>{option === 'ambos' ? 'Gastos e ingresos' : tipo === 'gasto' ? 'Gastos' : 'Ingresos'}</button>)}
        </span>
      </fieldset>
      {error && <p role="alert" className="text-sm text-rose-600">{error}</p>}
      <div className="flex justify-end gap-3"><button type="button" onClick={close} disabled={saving} className="rounded-xl px-4 py-2 text-slate-500">Cancelar</button><button disabled={saving} className="rounded-xl bg-indigo-600 px-4 py-2 font-bold text-white disabled:opacity-50">{saving ? 'Guardando…' : created ? 'Aplicar categoría' : 'Crear y aplicar'}</button></div>
    </form>
  </Modal>;
}
