import { useState } from 'react';
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
  return (
    <Modal isOpen onClose={close} size="sm" title="Crear categoría">
      <form noValidate className="space-y-4" onSubmit={async e => {
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
        <p className="dashboard-subtitle -mt-2">
          Organiza tus movimientos con tus propias categorías. Se guardarán en tu cuenta.
        </p>
        <div>
          <label htmlFor="create-category-name" className="field-label">Nombre</label>
          <input
            id="create-category-name"
            autoFocus
            maxLength={50}
            value={name}
            disabled={saving || !!created}
            onChange={e => setName(e.target.value)}
            placeholder="Ej. Regalos, mascotas, viajes"
            className="field"
          />
        </div>
        <fieldset className="block">
          <legend className="field-label">Disponible para</legend>
          <div className="grid grid-cols-2 gap-2">
            {[tipo, 'ambos'].map(option => (
              <button
                key={option}
                type="button"
                aria-pressed={direction === option}
                disabled={saving || !!created}
                onClick={() => setDirection(option as MovementCategory['tipo'])}
                className="choice-card items-center justify-center p-3 text-center"
              >
                {option === 'ambos' ? 'Gastos e ingresos' : tipo === 'gasto' ? 'Gastos' : 'Ingresos'}
              </button>
            ))}
          </div>
        </fieldset>
        {error && <div role="alert" className="notice is-danger">{error}</div>}
        <div className="modal-actions">
          <button type="button" onClick={close} disabled={saving} className="dashboard-secondary-button">
            Cancelar
          </button>
          <button disabled={saving} className="dashboard-primary-button">
            {saving ? 'Guardando…' : created ? 'Aplicar categoría' : 'Crear y aplicar'}
          </button>
        </div>
      </form>
    </Modal>
  );
}
