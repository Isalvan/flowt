import React, { useState, useEffect } from 'react';
import { Calendar, Sliders, Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Suscripcion, type Hucha } from '../../types';
import { SUBSCRIPTION_COLORS, CATEGORIA_OPTIONS, FRECUENCIA_OPTIONS } from '../../hooks/useFinanceData';
import { getSubscriptionAnchorDate, parseSubscriptionDate, toLocalDateKey } from '../../utils/subscriptions';

interface SuscripcionModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (newSub: any, editingSubId: string | null) => Promise<void>;
  editingSuscripcion: Suscripcion | null;
  huchas: Hucha[];
}

export const SuscripcionModal: React.FC<SuscripcionModalProps> = ({
  isOpen,
  onClose,
  onSave,
  editingSuscripcion,
  huchas,
}) => {
  const [nombre, setNombre] = useState('');
  const [importe, setImporte] = useState('');
  const [frecuencia, setFrecuencia] = useState<'mensual' | 'trimestral' | 'semestral' | 'anual'>('mensual');
  const [fechaInicio, setFechaInicio] = useState(toLocalDateKey(new Date()));
  const [categoria, setCategoria] = useState('otros');
  const [color, setColor] = useState(SUBSCRIPTION_COLORS[0]);
  const [activa, setActiva] = useState(true);
  const [huchaId, setHuchaId] = useState('');
  const [compartida, setCompartida] = useState(false);
  const [miParte, setMiParte] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize fields on open/edit change
  useEffect(() => {
    if (editingSuscripcion) {
      setNombre(editingSuscripcion.nombre);
      setImporte(editingSuscripcion.importe.toString());
      setFrecuencia(editingSuscripcion.frecuencia);
      setFechaInicio(toLocalDateKey(getSubscriptionAnchorDate(editingSuscripcion)));
      setCategoria(editingSuscripcion.categoria);
      setColor(editingSuscripcion.color);
      setActiva(editingSuscripcion.activa);
      setHuchaId(editingSuscripcion.hucha_id || '');
      setCompartida(editingSuscripcion.mi_parte !== null && editingSuscripcion.mi_parte !== undefined);
      setMiParte(editingSuscripcion.mi_parte?.toString() || '');
    } else {
      setNombre('');
      setImporte('');
      setFrecuencia('mensual');
      setFechaInicio(toLocalDateKey(new Date()));
      setCategoria('otros');
      setColor(SUBSCRIPTION_COLORS[0]);
      setActiva(true);
      // Auto pre-select Suscripciones system hucha if it exists
      const subHucha = huchas.find(h => h.es_suscripciones);
      setHuchaId(subHucha?.id || '');
      setCompartida(false);
      setMiParte('');
    }
  }, [editingSuscripcion, isOpen, huchas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const total = Number(importe);
    const share = compartida && miParte ? Number(miParte) : null;
    if (!nombre.trim() || !Number.isFinite(total) || total <= 0) return;
    if (share !== null && (!Number.isFinite(share) || share <= 0 || share > total)) return;

    setIsLoading(true);
    try {
      const chargeDate = parseSubscriptionDate(fechaInicio) ?? new Date();
      const data = {
        nombre: nombre.trim(),
        importe: total,
        frecuencia,
        fecha_inicio: toLocalDateKey(chargeDate),
        dia_pago: chargeDate.getDate(),
        categoria,
        color,
        activa,
        hucha_id: huchaId || null,
        mi_parte: share,
      };
      await onSave(data, editingSuscripcion?.id || null);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const handleImporteChange = (val: string) => {
    setImporte(val);
    // Auto-update miParte slider maximum value if shared
    if (compartida && (!miParte || Number(miParte) > Number(val))) {
      setMiParte((Number(val) / 2).toFixed(2));
    }
  };

  const totalImporte = Number(importe) || 0;
  const miParteImporte = Number(miParte) || 0;
  const reembolsoAmigos = Math.max(0, totalImporte - miParteImporte);

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={editingSuscripcion ? 'Editar suscripción recurrente' : 'Nueva suscripción recurrente'}
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nombre & Importe */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label htmlFor="sub-nombre" className="field-label">
              Nombre
            </label>
            <input
              id="sub-nombre"
              type="text"
              required
              placeholder="Ej. Netflix, Spotify…"
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="field"
            />
          </div>
          <div>
            <label htmlFor="sub-importe" className="field-label">
              Total (€)
            </label>
            <input
              id="sub-importe"
              type="number"
              required
              min="0.01"
              step="any"
              placeholder="Ej. 17.99"
              value={importe}
              onChange={(e) => handleImporteChange(e.target.value)}
              className="field tabular-nums"
            />
          </div>
        </div>

        {/* Frecuencia & Día Pago */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sub-frecuencia" className="field-label">
              Frecuencia
            </label>
            <select
              id="sub-frecuencia"
              value={frecuencia}
              onChange={(e) => setFrecuencia(e.target.value as any)}
              className="field"
            >
              {FRECUENCIA_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sub-fecha" className="field-label">
              Primer / próximo cobro
            </label>
            <div className="relative">
              <Calendar className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-ink-faint" size={14} />
              <input
                id="sub-fecha"
                type="date"
                required
                value={fechaInicio}
                onChange={(e) => setFechaInicio(e.target.value)}
                className="field pl-9"
              />
            </div>
          </div>
        </div>

        {/* Categoría & Cartera a la que se imputa */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label htmlFor="sub-categoria" className="field-label">
              Categoría
            </label>
            <select
              id="sub-categoria"
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="field"
            >
              {CATEGORIA_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sub-hucha" className="field-label">
              Imputar a cartera
            </label>
            <select
              id="sub-hucha"
              value={huchaId}
              onChange={(e) => setHuchaId(e.target.value)}
              className="field"
            >
              <option value="">Sin provisión de saldo</option>
              {huchas.filter(h => h.activa !== false).map(h => (
                <option key={h.id} value={h.id}>
                  {h.nombre} ({formatCurrency(h.saldo_acumulado)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Color Palette Picker */}
        <div>
          <span className="field-label">
            Identificador visual (color)
          </span>
          <div className="flex flex-wrap gap-2">
            {SUBSCRIPTION_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`h-6 w-6 rounded-full border-2 transition-transform duration-150 ${
                  color === c 
                    ? 'border-brand' 
                    : 'border-transparent'
                }`}
                style={{ backgroundColor: c }}
                aria-label={`Seleccionar color ${c}`}
                aria-pressed={color === c}
              />
            ))}
          </div>
        </div>

        {/* Shared Split Proximity Slider */}
        <div className="border-t border-line pt-3">
          <label htmlFor="sub-compartida" className="flex items-center gap-3 rounded-2xl bg-surface-2 p-3 cursor-pointer">
            <input
              id="sub-compartida"
              type="checkbox"
              checked={compartida}
              onChange={(e) => {
                setCompartida(e.target.checked);
                if (e.target.checked && totalImporte > 0) {
                  setMiParte((totalImporte / 2).toFixed(2));
                }
              }}
              className="rounded accent-brand"
            />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-ink">Suscripción compartida</span>
              <span className="text-[11px] text-ink-soft leading-normal">
                ¿Alguien te reembolsa una parte de esta cuota vía Bizum/transferencia?
              </span>
            </div>
          </label>

          {compartida && totalImporte > 0 && (
            <div className="rounded-2xl bg-surface-2 p-3 mt-2 space-y-3 animate-appear-up">
              <div className="flex items-center justify-between text-xs">
                <span className="font-semibold text-ink-soft">Mi parte real:</span>
                <span className="font-bold tabular-nums text-brand-ink">{formatCurrency(miParteImporte)}</span>
              </div>

              <div className="flex items-center gap-3">
                <Sliders size={14} className="text-ink-faint" />
                <input
                  type="range"
                  min="0.01"
                  max={totalImporte}
                  step="0.05"
                  value={miParte}
                  onChange={(e) => setMiParte(e.target.value)}
                  className="w-full h-1.5 rounded-lg appearance-none cursor-pointer accent-brand bg-surface"
                />
              </div>

              <div className="flex justify-between rounded-xl bg-surface p-2 text-[11px] font-medium text-ink-soft tabular-nums">
                <span>Total: {formatCurrency(totalImporte)}</span>
                <span>Bizum amigos: +{formatCurrency(reembolsoAmigos)}</span>
              </div>
            </div>
          )}
        </div>

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
            disabled={isLoading || !nombre.trim() || !importe}
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
                {editingSuscripcion ? 'Guardar suscripción' : 'Crear suscripción'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
