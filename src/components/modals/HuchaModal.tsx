import React, { useState, useEffect } from 'react';
import { Target, Info, Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';

interface HuchaModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (huchaData: any, editingId: string | null) => Promise<void>;
  editingHucha: Hucha | null;
  allHuchas: Hucha[];
}

export const HuchaModal: React.FC<HuchaModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingHucha,
  allHuchas,
}) => {
  const [nombre, setNombre] = useState('');
  const [tipoAportacion, setTipoAportacion] = useState<'flat' | 'porcentaje' | 'resto'>('porcentaje');
  const [valorAportacion, setValorAportacion] = useState('');
  const [objetivo, setObjetivo] = useState('');
  const [esPrincipal, setEsPrincipal] = useState(false);
  const [topeObjetivo, setTopeObjetivo] = useState(false);
  const [subsanarHasta, setSubsanarHasta] = useState('0');
  const [subsanarCon, setSubsanarCon] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(false);

  // Initialize fields on open/edit change
  useEffect(() => {
    if (editingHucha) {
      setNombre(editingHucha.nombre);
      setTipoAportacion(editingHucha.tipo_aportacion);
      setValorAportacion(editingHucha.valor_aportacion?.toString() || '');
      setObjetivo(editingHucha.objetivo?.toString() || '');
      setEsPrincipal(!!editingHucha.es_principal);
      setTopeObjetivo(!!editingHucha.tope_objetivo);
      setSubsanarHasta(editingHucha.subsanar_hasta?.toString() || '0');
      setSubsanarCon(editingHucha.subsanar_con || null);
    } else {
      setNombre('');
      setTipoAportacion('porcentaje');
      setValorAportacion('');
      setObjetivo('');
      setEsPrincipal(allHuchas.length === 0); // first pocket defaults to principal
      setTopeObjetivo(false);
      setSubsanarHasta('0');
      setSubsanarCon(null);
    }
  }, [editingHucha, isOpen, allHuchas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!nombre.trim()) return;

    setIsLoading(true);
    try {
      const huchaData = {
        nombre: nombre.trim(),
        tipo_aportacion: tipoAportacion,
        valor_aportacion: tipoAportacion === 'resto' ? 0 : Number(valorAportacion) || 0,
        objetivo: objetivo ? Number(objetivo) : null,
        es_principal: esPrincipal,
        tope_objetivo: objetivo ? topeObjetivo : false,
        subsanar_hasta: Number(subsanarHasta) || 0,
        subsanar_con: subsanarCon,
      };
      await onSave(huchaData, editingHucha?.id || null);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingHucha ? 'Editar cartera de ahorro' : 'Nueva cartera de ahorro'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Nombre */}
        <div>
          <label htmlFor="hucha-nombre" className="field-label">
            Nombre de la cartera
          </label>
          <input
            id="hucha-nombre"
            type="text"
            required
            placeholder="Ej. Vacaciones, coche, emergencias…"
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={editingHucha?.es_suscripciones}
            className="field"
          />
        </div>

        {/* Info label for system pockets */}
        {editingHucha?.es_suscripciones && (
          <div className="notice">
            <Info size={16} className="shrink-0 mt-0.5 text-brand-ink" />
            <span>Esta cartera está protegida porque gestiona tus cargos de suscripciones.</span>
          </div>
        )}

        {/* Tipo de aportación */}
        {!editingHucha?.es_suscripciones && (
          <div>
            <span className="field-label">
              Regla de distribución de ingresos
            </span>
            <div className="grid grid-cols-3 gap-2">
              {(['porcentaje', 'flat', 'resto'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTipoAportacion(mode)}
                  aria-pressed={tipoAportacion === mode}
                  className="choice-card items-center justify-center text-center p-3"
                >
                  <span className="text-sm font-bold text-ink">
                    {mode === 'porcentaje' ? '%' : mode === 'flat' ? '€' : 'Resto'}
                  </span>
                  <span className="text-[11px] text-ink-faint">
                    {mode === 'porcentaje' ? 'Porcentaje' : mode === 'flat' ? 'Importe fijo' : 'Sobrante'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Valor de aportación */}
        {tipoAportacion !== 'resto' && !editingHucha?.es_suscripciones && (
          <div className="animate-appear-up">
            <label htmlFor="hucha-valor-aportacion" className="field-label">
              {tipoAportacion === 'porcentaje' ? 'Porcentaje asignado (%)' : 'Cantidad fija por ingreso (€)'}
            </label>
            <input
              id="hucha-valor-aportacion"
              type="number"
              required
              min="0"
              max={tipoAportacion === 'porcentaje' ? '100' : undefined}
              step="any"
              placeholder={tipoAportacion === 'porcentaje' ? 'Ej. 15' : 'Ej. 100'}
              value={valorAportacion}
              onChange={(e) => setValorAportacion(e.target.value)}
              className="field tabular-nums"
            />
          </div>
        )}

        {/* Objetivo (Savings Goal) */}
        <div>
          <div className="flex items-center justify-between mb-1">
            <label htmlFor="hucha-objetivo" className="field-label mb-0">
              Objetivo de ahorro (€)
            </label>
            <span className="text-[11px] font-semibold text-ink-faint">(Opcional)</span>
          </div>
          <div className="relative">
            <Target className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={16} />
            <input
              id="hucha-objetivo"
              type="number"
              min="0"
              step="any"
              placeholder="Sin objetivo"
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              className="field pl-9 tabular-nums"
            />
          </div>
        </div>

        {/* Options grid (Principal & Limit) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-1">
          {/* Es Principal */}
          {!editingHucha?.es_suscripciones && (
            <label htmlFor="hucha-es-principal" className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3.5 cursor-pointer">
              <input
                id="hucha-es-principal"
                type="checkbox"
                checked={esPrincipal}
                onChange={(e) => setEsPrincipal(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-brand"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-ink">Cartera principal</span>
                <span className="text-[11px] text-ink-soft leading-normal">
                  Aquí se restarán todos los gastos generales por defecto.
                </span>
              </div>
            </label>
          )}

          {/* Tope Objetivo */}
          {objetivo && Number(objetivo) > 0 && (
            <label htmlFor="hucha-tope-objetivo" className="flex items-start gap-3 rounded-2xl bg-surface-2 p-3.5 cursor-pointer animate-appear-up">
              <input
                id="hucha-tope-objetivo"
                type="checkbox"
                checked={topeObjetivo}
                onChange={(e) => setTopeObjetivo(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-brand"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-ink">Tope de objetivo</span>
                <span className="text-[11px] text-ink-soft leading-normal">
                  Frenar ingresos al alcanzar el objetivo. El exceso se enviará a "Resto".
                </span>
              </div>
            </label>
          )}
        </div>

        {/* Opciones de Subsanación (Deuda) */}
        {!editingHucha?.es_suscripciones && (
          <div className="pt-4 border-t border-line space-y-3">
            <h4 className="dashboard-heading">
              Opciones de subsanación automática
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <div>
                <label htmlFor="hucha-subsanar-hasta" className="field-label">
                  Subsanar hasta (€)
                </label>
                <input
                  id="hucha-subsanar-hasta"
                  type="number"
                  step="any"
                  value={subsanarHasta}
                  onChange={(e) => setSubsanarHasta(e.target.value)}
                  className="field tabular-nums"
                  title="Balance objetivo cuando pulses 'Subsanar' por saldo negativo"
                />
              </div>
              <div>
                <label htmlFor="hucha-subsanar-con" className="field-label">
                  Tomar dinero de (prestamista)
                </label>
                <select
                  id="hucha-subsanar-con"
                  value={subsanarCon || ''}
                  onChange={(e) => setSubsanarCon(e.target.value || null)}
                  className="field"
                >
                  <option value="">Por defecto (resto/principal)</option>
                  {allHuchas
                    .filter(h => h.id !== editingHucha?.id)
                    .map(h => (
                      <option key={h.id} value={h.id}>{h.nombre}</option>
                    ))
                  }
                </select>
              </div>
            </div>
            <p className="field-hint">
              Si tu saldo cae en negativo, podrás subsanarlo. Los próximos ingresos irán destinados a pagar la deuda a la cartera prestamista automáticamente.
            </p>
          </div>
        )}

        {/* Buttons */}
        <div className="modal-actions">
          <button
            type="button"
            onClick={onClose}
            className="dashboard-secondary-button"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isLoading || !nombre.trim()}
            className="dashboard-primary-button"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Guardando…
              </>
            ) : (
              <>
                <Sparkles size={14} />
                {editingHucha ? 'Guardar cambios' : 'Crear cartera'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
