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

  return <section className="w-full max-w-4xl mx-auto dashboard-surface p-5 sm:p-6">
    <h3 className="dashboard-heading">Huchas por categoría</h3>
    {isLocked ? <div className="py-8 text-center">
      <p className="text-sm text-ink-soft mb-4">Desbloquea Flowt para configurar tus huchas.</p>
      <button onClick={() => openUnlockModal()} className="dashboard-primary-button"><LockKeyhole size={16} />Desbloquear</button>
    </div> : <>
      <p className="dashboard-subtitle mt-2 mb-2">Elige de qué hucha sale cada categoría de gasto. Los cambios se aplican a nuevas revisiones; no mueven tus gastos anteriores.</p>
      <p className="text-xs text-ink-faint mb-5">Tu elección manual en un movimiento tiene prioridad. Después se usa esta configuración, la hucha de su suscripción y, si no hay ninguna, la hucha actual.</p>
      {(error || saveError) && <p role="alert" className="notice is-danger mb-4">{saveError || error}</p>}
      {loading && !error ? <p role="status" className="text-sm text-ink-soft">Cargando configuración…</p> : <>
        {activeHuchas.length === 0 && <p className="notice is-warning mb-4">Crea o restaura una hucha para asignarle categorías.</p>}
        <div className="grid gap-5 md:grid-cols-[1fr_1.5fr]">
          <div className="space-y-2">
            <h4 className="font-bold text-sm text-ink">Tus huchas</h4>
            {activeHuchas.map(h => <div key={h.id} className="p-3 rounded-xl bg-surface-2">
              <p className="font-semibold text-sm text-ink">{h.nombre}</p>
              <p className="text-xs text-ink-soft mt-1">{categories.filter(c => map[c.id] === h.id).map(c => c.label).join(', ') || 'Sin categorías asignadas'}</p>
            </div>)}
          </div>
          <div className="space-y-2">
            <h4 className="font-bold text-sm text-ink">Categorías de gasto</h4>
            {categories.map(category => {
              const target = map[category.id] ?? '';
              const unavailable = !!target && !activeHuchas.some(h => h.id === target);
              return <div key={category.id} className="p-3 rounded-xl bg-surface-2">
                <label className="flex flex-col sm:flex-row sm:items-center gap-2 sm:justify-between text-sm text-ink">
                  <span>{category.label}</span>
                  <select aria-label={`Hucha para ${category.label}`} value={target} disabled={saving || loading || !!error || (!demo && !userId)} onChange={e => void assign(category.id, e.target.value)} className="field sm:w-48 min-w-0 bg-surface">
                    <option value="">Sin asignación</option>
                    {unavailable && <option value={target} disabled>Hucha no disponible</option>}
                    {activeHuchas.map(h => <option key={h.id} value={h.id}>{h.nombre}</option>)}
                  </select>
                </label>
                {unavailable && <p className="notice is-warning mt-2">Esta hucha está inactiva, ya no existe o no admite gastos bancarios. Elige otra o quita la asignación; tus gastos conservan su hucha actual.</p>}
              </div>;
            })}
            {unavailableCategories.map(id => <div key={id} className="notice is-warning flex-col items-start gap-1 p-3">
              <p>Categoría no disponible</p>
              <button disabled={saving || loading || !!error} onClick={() => void assign(id, '')} className="dashboard-secondary-button mt-2">Quitar asignación</button>
            </div>)}
          </div>
        </div>
        {saving && <p role="status" className="mt-3 text-sm text-ink-soft">Guardando…</p>}
      </>}
    </>}
  </section>;
}
