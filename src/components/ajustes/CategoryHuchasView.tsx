import { useState } from 'react';
import { LockKeyhole } from 'lucide-react';
import { usePrivacy } from '../../context/PrivacyContext';
import { useCategories } from '../../hooks/useCategories';
import { useCategoryHuchas } from '../../hooks/useCategoryHuchas';
import type { Hucha } from '../../types';

export function CategoryHuchasView({ userId, huchas, demo = false }: { userId?: string; huchas: Hucha[]; demo?: boolean }) {
  const { isLocked, openUnlockModal } = usePrivacy();
  const { categoryOptions } = useCategories();
  const { map, loading, saving, error, setCategoryHucha } = useCategoryHuchas(userId, huchas, demo);
  const [saveError, setSaveError] = useState('');
  const activeHuchas = huchas.filter(h => h.activa !== false && !h.es_metalico && !h.es_interno && (demo || h.id_propietario === userId));
  const categories = categoryOptions('gasto');
  const unavailableCategories = Object.keys(map).filter(id => !categories.some(c => c.id === id));

  const assign = async (category: string, target: string) => {
    setSaveError('');
    try { await setCategoryHucha(category, target); }
    catch (e) { setSaveError(e instanceof Error ? e.message : 'No se pudo guardar. Inténtalo de nuevo.'); }
  };

  return <section className="w-full max-w-4xl mx-auto bg-white/40 dark:bg-slate-900/40 rounded-2xl border border-white/20 dark:border-white/5 p-5 sm:p-6">
    <h3 className="text-lg font-bold text-slate-800 dark:text-white">Huchas por categoría</h3>
    {isLocked ? <div className="py-8 text-center">
      <p className="text-sm text-slate-500 mb-4">Desbloquea Flowt para configurar tus huchas.</p>
      <button onClick={() => openUnlockModal()} className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-indigo-600 text-white font-semibold"><LockKeyhole size={16} />Desbloquear</button>
    </div> : <>
      <p className="text-sm text-slate-500 dark:text-slate-400 mt-2 mb-5">Elige de qué hucha sale cada categoría de gasto. Los cambios se aplican a nuevas revisiones; no mueven tus gastos anteriores.</p>
      <p className="text-xs text-slate-500 dark:text-slate-400 mb-5">Tu elección manual en un movimiento tiene prioridad. Después se usa esta configuración, la hucha de su suscripción y, si no hay ninguna, la hucha actual.</p>
      {(error || saveError) && <p role="alert" className="text-sm text-red-600 mb-4">{saveError || error}</p>}
      {loading && !error ? <p role="status" className="text-sm text-slate-500">Cargando configuración…</p> : <>
        {activeHuchas.length === 0 && <p className="text-sm text-amber-700 dark:text-amber-400 mb-4">Crea o restaura una hucha para asignarle categorías.</p>}
        <div className="grid gap-5 md:grid-cols-[1fr_1.5fr]">
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Tus huchas</h4>
            {activeHuchas.map(h => <div key={h.id} className="p-3 rounded-xl bg-white/50 dark:bg-slate-800/50">
              <p className="font-semibold text-sm text-slate-800 dark:text-slate-100">{h.nombre}</p>
              <p className="text-xs text-slate-500 mt-1">{categories.filter(c => map[c.id] === h.id).map(c => c.label).join(', ') || 'Sin categorías asignadas'}</p>
            </div>)}
          </div>
          <div className="space-y-2">
            <h4 className="text-sm font-bold text-slate-700 dark:text-slate-200">Categorías de gasto</h4>
            {categories.map(category => {
              const target = map[category.id] ?? '';
              const unavailable = !!target && !activeHuchas.some(h => h.id === target);
              return <div key={category.id} className="p-3 rounded-xl bg-white/50 dark:bg-slate-800/50">
                <label className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between text-sm text-slate-800 dark:text-slate-100">
                  <span>{category.label}</span>
                  <select aria-label={`Hucha para ${category.label}`} value={target} disabled={saving || loading || !!error || (!demo && !userId)} onChange={e => void assign(category.id, e.target.value)} className="sm:w-48 min-w-0 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 px-2 py-2 text-sm disabled:opacity-50">
                    <option value="">Sin asignación</option>
                    {unavailable && <option value={target} disabled>Hucha no disponible</option>}
                    {activeHuchas.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                  </select>
                </label>
                {unavailable && <p className="text-xs text-amber-700 dark:text-amber-400 mt-2">Esta hucha está inactiva, ya no existe o no admite gastos bancarios. Elige otra o quita la asignación; tus gastos conservan su hucha actual.</p>}
              </div>;
            })}
            {unavailableCategories.map(id => <div key={id} className="p-3 rounded-xl text-sm bg-amber-50 dark:bg-amber-500/10">
              <p>Categoría no disponible</p>
              <button disabled={saving || loading || !!error} onClick={() => void assign(id, '')} className="text-indigo-600 font-semibold mt-2">Quitar asignación</button>
            </div>)}
          </div>
        </div>
        {saving && <p role="status" className="mt-3 text-sm text-slate-500">Guardando…</p>}
      </>}
    </>}
  </section>;
}
