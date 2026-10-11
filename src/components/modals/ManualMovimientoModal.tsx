import React, { useState, useEffect } from 'react';
import { CreditCard, Banknote, Calendar, Info, Plus } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';

interface ManualMovimientoModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (movData: {
    tipo: 'gasto' | 'ingreso';
    concepto: string;
    importe: number;
    fecha_operacion: string;
    hucha_id?: string;
    es_metalico?: boolean;
    es_retirada_efectivo?: boolean;
    hucha_origen_id?: string;
  }) => Promise<void>;
  huchas: Hucha[];
}

export const ManualMovimientoModal: React.FC<ManualMovimientoModalProps> = ({
  isOpen,
  onClose,
  onSave,
  huchas,
}) => {
  const [tipo, setTipo] = useState<'gasto' | 'ingreso'>('gasto');
  const [concepto, setConcepto] = useState('');
  const [importe, setImporte] = useState('');
  const [fechaOperacion, setFechaOperacion] = useState('');
  const [metodo, setMetodo] = useState<'banco' | 'efectivo'>('efectivo');
  const [huchaId, setHuchaId] = useState('');
  const [esRetiradaEfectivo, setEsRetiradaEfectivo] = useState(false);
  const [huchaOrigenId, setHuchaOrigenId] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Initialize form when opening
  useEffect(() => {
    if (isOpen) {
      setTipo('gasto');
      setConcepto('');
      setImporte('');
      setFechaOperacion(new Date().toISOString().slice(0, 10));
      setMetodo('efectivo');
      setHuchaId('');
      setEsRetiradaEfectivo(false);
      setHuchaOrigenId('');
      setIsLoading(false);
    }
  }, [isOpen]);

  // Handle smart defaults when tipo or metodo changes
  useEffect(() => {
    if (!isOpen) return;

    if (metodo !== 'efectivo' || tipo !== 'ingreso') {
      setEsRetiradaEfectivo(false);
      setHuchaOrigenId('');
    }

    if (metodo === 'efectivo') {
      // Find existing cash pocket if any, otherwise it will auto-create
      const cashHucha = huchas.find(h => (h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo')) && h.activa !== false);
      setHuchaId(cashHucha ? cashHucha.id : 'efectivo_auto');
    } else {
      // Banco
      if (tipo === 'gasto') {
        // Default to principal hucha for bank expenses
        const activeHuchas = huchas.filter(h => h.activa !== false);
        const principal = activeHuchas.find(h => h.es_principal) || activeHuchas[0];
        setHuchaId(principal ? principal.id : '');
      } else {
        // Default to "autoreparto" (empty string) for bank incomes
        setHuchaId('');
      }
    }
  }, [tipo, metodo, isOpen, huchas]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const parsedImporte = parseFloat(importe);
    if (!concepto.trim() || isNaN(parsedImporte) || parsedImporte <= 0 || !fechaOperacion) {
      return;
    }

    setIsLoading(true);
    try {
      const isMetalico = metodo === 'efectivo';
    const actualHuchaId = isMetalico || huchaId === '' ? undefined : huchaId;

      await onSave({
        tipo,
        concepto: concepto.trim(),
        importe: parsedImporte,
        fecha_operacion: fechaOperacion,
        hucha_id: actualHuchaId,
        es_metalico: isMetalico,
        es_retirada_efectivo: esRetiradaEfectivo,
        hucha_origen_id: esRetiradaEfectivo ? huchaOrigenId : undefined,
      });
      onClose();
    } catch (err) {
      console.error('Error saving manual movement:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title="Registrar movimiento manual"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Sliding Tabs: Gasto vs Ingreso */}
        <div className="segmented flex w-full">
          <button
            type="button"
            onClick={() => setTipo('gasto')}
            aria-pressed={tipo === 'gasto'}
            className="segmented-item flex-1 justify-center"
          >
            Gasto
          </button>
          <button
            type="button"
            onClick={() => setTipo('ingreso')}
            aria-pressed={tipo === 'ingreso'}
            className="segmented-item flex-1 justify-center"
          >
            Ingreso
          </button>
        </div>

        {/* 2. Concept & Amount Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label htmlFor="manual-concepto" className="field-label">
              Concepto
            </label>
            <input
              id="manual-concepto"
              type="text"
              required
              placeholder="Ej. Compra súper, cena amigos, Bizum cobrado"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="field"
            />
          </div>

          <div>
            <label htmlFor="manual-importe" className="field-label">
              Importe (€)
            </label>
            <div className="relative">
              <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-ink-faint">
                €
              </span>
              <input
                id="manual-importe"
                type="number"
                required
                min="0.01"
                step="any"
                placeholder="0.00"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className="field pl-8 tabular-nums"
              />
            </div>
          </div>
        </div>

        {/* 3. Date Selection */}
        <div>
          <label htmlFor="manual-fecha" className="field-label flex items-center gap-1.5">
            <Calendar size={14} />
            Fecha de operación
          </label>
          <input
            id="manual-fecha"
            type="date"
            required
            value={fechaOperacion}
            onChange={(e) => setFechaOperacion(e.target.value)}
            className="field"
          />
        </div>

        {/* 4. Payment Method Visual Selector Cards */}
        <div>
          <span className="field-label">
            Método de pago
          </span>
          <div className="grid grid-cols-2 gap-3">
            {/* Metálico Card */}
            <button
              type="button"
              onClick={() => setMetodo('efectivo')}
              aria-pressed={metodo === 'efectivo'}
              className="choice-card w-full"
            >
              <Banknote size={18} />
              <div>
                <span className="block text-xs font-bold text-ink">
                  Efectivo
                </span>
                <span className="block text-[11px] text-ink-faint font-medium mt-0.5">
                  Dinero en metálico
                </span>
              </div>
            </button>

            {/* Banco Card */}
            <button
              type="button"
              onClick={() => setMetodo('banco')}
              aria-pressed={metodo === 'banco'}
              className="choice-card w-full"
            >
              <CreditCard size={18} />
              <div>
                <span className="block text-xs font-bold text-ink">
                  Banco
                </span>
                <span className="block text-[11px] text-ink-faint font-medium mt-0.5">
                  Tarjeta o cuenta bancaria
                </span>
              </div>
            </button>
          </div>
        </div>

        {metodo === 'efectivo' && tipo === 'ingreso' && (
          <div className="rounded-2xl bg-surface-2 p-4 space-y-3">
            <label htmlFor="manual-retirada" className="flex cursor-pointer items-start gap-3 text-sm text-ink">
              <input
                id="manual-retirada"
                type="checkbox"
                checked={esRetiradaEfectivo}
                onChange={(e) => setEsRetiradaEfectivo(e.target.checked)}
                className="mt-0.5 h-4 w-4 rounded accent-brand"
              />
              <span>
                <span className="block font-bold">Es una retirada de efectivo desde una cartera</span>
                <span className="block text-xs text-ink-soft">Se registrarán dos patas internas y no afectará a ingresos ni gastos.</span>
              </span>
            </label>

            {esRetiradaEfectivo && (
              <div>
                <label htmlFor="manual-hucha-origen" className="sr-only">
                  Cartera de origen
                </label>
                <select
                  id="manual-hucha-origen"
                  required
                  value={huchaOrigenId}
                  onChange={(e) => setHuchaOrigenId(e.target.value)}
                  className="field"
                >
                  <option value="" disabled>Selecciona la cartera de origen…</option>
                  {huchas.filter(h => !h.es_metalico && !h.es_suscripciones && h.activa !== false).map(h => (
                    <option key={h.id} value={h.id}>{h.nombre}</option>
                  ))}
                </select>
              </div>
            )}
          </div>
        )}

        {/* 5. Dynamic Wallet Allocator */}
        <div className="rounded-2xl bg-surface-2 p-4 animate-in fade-in">
          {metodo === 'efectivo' ? (
            <div className="notice">
              <Info size={16} className="shrink-0 mt-0.5 text-brand-ink" />
              <div>
                <p className="font-bold text-ink mb-0.5">Asignación automática de efectivo</p>
                <p className="text-ink-soft">
                  {tipo === 'gasto'
                    ? 'Este gasto se restará directamente del saldo acumulado de tu cartera de Efectivo.'
                    : esRetiradaEfectivo
                      ? 'El importe se moverá desde la cartera seleccionada a Efectivo como transferencia interna.'
                      : 'Este ingreso se sumará al saldo acumulado de tu cartera de Efectivo.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-2">
              <label htmlFor="manual-hucha-id" className="field-label flex items-center gap-1.5">
                <Info size={14} className="text-brand-ink" />
                {tipo === 'gasto' ? 'Cartera de deducción' : 'Cartera de depósito'}
              </label>

              {tipo === 'gasto' ? (
                <div>
                  <select
                    id="manual-hucha-id"
                    value={huchaId}
                    onChange={(e) => setHuchaId(e.target.value)}
                    className="field"
                  >
                    <option value="" disabled>Seleccionar cartera…</option>
                    {huchas
                      .filter(h => !h.es_suscripciones && !h.es_metalico && h.activa !== false)
                      .map(h => (
                        <option key={h.id} value={h.id}>
                          {h.nombre} (Saldo: {h.saldo_acumulado.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })})
                        </option>
                      ))}
                  </select>
                  <p className="field-hint">
                    El gasto se descontará del saldo acumulado en la cartera seleccionada.
                  </p>
                </div>
              ) : (
                <div>
                  <select
                    id="manual-hucha-id"
                    value={huchaId}
                    onChange={(e) => setHuchaId(e.target.value)}
                    className="field"
                  >
                    <option value="">
                      ★ Autoreparto estándar (repartir automáticamente)
                    </option>
                    {huchas
                      .filter(h => !h.es_suscripciones && !h.es_metalico && h.activa !== false)
                      .map(h => (
                        <option key={h.id} value={h.id}>
                          Ingresar 100% en: {h.nombre}
                        </option>
                      ))}
                  </select>
                  <p className="field-hint">
                    {huchaId === ''
                      ? 'El dinero se dividirá automáticamente entre tus carteras de ahorro activas según las reglas definidas (porcentajes o cantidades fijas).'
                      : 'El ingreso se asignará íntegramente a la cartera seleccionada.'}
                  </p>
                </div>
              )}
            </div>
          )}
        </div>

        {/* 6. Form Submission Actions */}
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
            disabled={isLoading || !concepto.trim() || !importe || parseFloat(importe) <= 0 || (esRetiradaEfectivo && !huchaOrigenId)}
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
                <Plus size={14} />
                Registrar movimiento
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
