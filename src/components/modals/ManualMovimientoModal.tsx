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
      setIsLoading(false);
    }
  }, [isOpen]);

  // Handle smart defaults when tipo or metodo changes
  useEffect(() => {
    if (!isOpen) return;

    if (metodo === 'efectivo') {
      // Find existing cash pocket if any, otherwise it will auto-create
      const cashHucha = huchas.find(h => h.es_metalico || h.nombre.toLowerCase().includes('metalico') || h.nombre.toLowerCase().includes('efectivo'));
      setHuchaId(cashHucha ? cashHucha.id : 'efectivo_auto');
    } else {
      // Banco
      if (tipo === 'gasto') {
        // Default to principal hucha for bank expenses
        const principal = huchas.find(h => h.es_principal) || huchas[0];
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
      title={
        <div className="flex items-center gap-2">
          <Plus className="text-sky-500" size={24} />
          <span>Registrar Movimiento Manual</span>
        </div>
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* 1. Sliding Tabs: Gasto vs Ingreso */}
        <div className="p-1 bg-slate-100 dark:bg-slate-900 border border-slate-200/40 dark:border-white/5 rounded-2xl flex gap-1 relative overflow-hidden">
          <button
            type="button"
            onClick={() => setTipo('gasto')}
            className={`flex-1 py-3 text-xs font-extrabold uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer ${
              tipo === 'gasto'
                ? 'bg-rose-500 text-white shadow-lg shadow-rose-500/20'
                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
            }`}
          >
            <span>Gasto</span>
          </button>
          <button
            type="button"
            onClick={() => setTipo('ingreso')}
            className={`flex-1 py-3 text-xs font-extrabold uppercase tracking-widest rounded-xl transition-all duration-300 flex items-center justify-center gap-1.5 cursor-pointer ${
              tipo === 'ingreso'
                ? 'bg-emerald-500 text-white shadow-lg shadow-emerald-500/20'
                : 'text-slate-400 hover:text-slate-650 dark:hover:text-slate-200'
            }`}
          >
            <span>Ingreso</span>
          </button>
        </div>

        {/* 2. Concept & Amount Row */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
              Concepto
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Compra súper, Cena amigos, Bizum cobrado"
              value={concepto}
              onChange={(e) => setConcepto(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all font-semibold text-sm"
            />
          </div>

          <div>
            <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
              Importe (€)
            </label>
            <div className="relative">
              <input
                type="number"
                required
                min="0.01"
                step="any"
                placeholder="0.00"
                value={importe}
                onChange={(e) => setImporte(e.target.value)}
                className="w-full pl-8 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all font-bold text-sm"
              />
              <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 font-bold text-sm">
                €
              </span>
            </div>
          </div>
        </div>

        {/* 3. Date Selection */}
        <div>
          <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1">
            <Calendar size={13} />
            Fecha de Operación
          </label>
          <input
            type="date"
            required
            value={fechaOperacion}
            onChange={(e) => setFechaOperacion(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all font-semibold"
          />
        </div>

        {/* 4. Payment Method Visual Selector Cards */}
        <div>
          <label className="block text-xs font-black uppercase tracking-wider text-slate-400 mb-2">
            Método de Pago
          </label>
          <div className="grid grid-cols-2 gap-4">
            {/* Metálico Card */}
            <button
              type="button"
              onClick={() => setMetodo('efectivo')}
              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all hover:scale-[1.02] cursor-pointer ${
                metodo === 'efectivo'
                  ? 'bg-sky-500/10 border-sky-500 text-sky-600 dark:text-sky-400 shadow-md shadow-sky-500/5'
                  : 'bg-white/40 dark:bg-slate-900/20 border-slate-200 dark:border-slate-850 text-slate-450 hover:border-slate-350 dark:hover:border-white/10'
              }`}
            >
              <Banknote size={24} className={metodo === 'efectivo' ? 'text-sky-500' : 'text-slate-400'} />
              <div className="mt-4">
                <span className="block font-black text-xs uppercase tracking-wide">
                  Efectivo
                </span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                  Dinero en metálico
                </span>
              </div>
            </button>

            {/* Banco Card */}
            <button
              type="button"
              onClick={() => setMetodo('banco')}
              className={`p-4 rounded-2xl border text-left flex flex-col justify-between transition-all hover:scale-[1.02] cursor-pointer ${
                metodo === 'banco'
                  ? 'bg-indigo-500/10 border-indigo-500 text-indigo-600 dark:text-indigo-400 shadow-md shadow-indigo-500/5'
                  : 'bg-white/40 dark:bg-slate-900/20 border-slate-200 dark:border-slate-850 text-slate-450 hover:border-slate-350 dark:hover:border-white/10'
              }`}
            >
              <CreditCard size={24} className={metodo === 'banco' ? 'text-indigo-500' : 'text-slate-400'} />
              <div className="mt-4">
                <span className="block font-black text-xs uppercase tracking-wide">
                  Banco
                </span>
                <span className="block text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-0.5">
                  Tarjeta o cuenta bancaria
                </span>
              </div>
            </button>
          </div>
        </div>

        {/* 5. Dynamic Wallet Allocator */}
        <div className="p-4 rounded-2xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/20 animate-in fade-in duration-300">
          {metodo === 'efectivo' ? (
            <div className="flex gap-3 text-xs leading-relaxed text-sky-700 dark:text-sky-300">
              <Info size={16} className="shrink-0 mt-0.5 text-sky-500" />
              <div>
                <p className="font-extrabold uppercase text-[10px] tracking-wider mb-0.5">Asignación Automática de Efectivo</p>
                <p className="font-semibold text-slate-500 dark:text-slate-400">
                  {tipo === 'gasto'
                    ? 'Este gasto se restará directamente del saldo acumulado de tu cartera de Efectivo.'
                    : 'Este ingreso se sumará al saldo acumulado de tu cartera de Efectivo.'}
                </p>
              </div>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="flex gap-2 items-center mb-1">
                <Info size={14} className="text-indigo-500" />
                <span className="text-[10px] font-black uppercase tracking-wider text-slate-400">
                  {tipo === 'gasto' ? 'Cartera de Deducción' : 'Cartera de Depósito'}
                </span>
              </div>

              {tipo === 'gasto' ? (
                <div>
                  <select
                    value={huchaId}
                    onChange={(e) => setHuchaId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="" disabled>Seleccionar cartera...</option>
                    {huchas
                      .filter(h => !h.es_suscripciones && !h.es_metalico)
                      .map(h => (
                        <option key={h.id} value={h.id}>
                          {h.nombre} (Saldo: {h.saldo_acumulado.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' })})
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-1.5 ml-0.5">
                    El gasto se descontará del saldo acumulado en la cartera seleccionada.
                  </p>
                </div>
              ) : (
                <div>
                  <select
                    value={huchaId}
                    onChange={(e) => setHuchaId(e.target.value)}
                    className="w-full px-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-white text-xs font-bold focus:outline-none cursor-pointer"
                  >
                    <option value="" className="font-extrabold text-indigo-500">
                      ★ Autoreparto estándar (Repartir automáticamente)
                    </option>
                    {huchas
                      .filter(h => !h.es_suscripciones && !h.es_metalico)
                      .map(h => (
                        <option key={h.id} value={h.id} className="font-semibold">
                          Ingresar 100% en: {h.nombre}
                        </option>
                      ))}
                  </select>
                  <p className="text-[10px] text-slate-400 dark:text-slate-500 font-semibold mt-1.5 ml-0.5">
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
        <div className="flex items-center gap-3 pt-4 border-t border-slate-100 dark:border-slate-800/60">
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-3 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold tracking-wide uppercase hover:bg-slate-50 dark:hover:bg-slate-900/30 transition-colors"
          >
            Cancelar
          </button>
          <button
            type="submit"
            disabled={isLoading || !concepto.trim() || !importe || parseFloat(importe) <= 0}
            className={`flex-1 py-3 rounded-xl text-white text-xs font-bold tracking-wide uppercase shadow-md flex items-center justify-center gap-2 disabled:opacity-50 ${
              tipo === 'gasto'
                ? 'bg-gradient-to-r from-rose-500 to-red-600 hover:from-rose-600 hover:to-red-700 shadow-rose-500/10 hover:shadow-rose-500/20'
                : 'bg-gradient-to-r from-emerald-500 to-teal-650 hover:from-emerald-600 hover:to-teal-700 shadow-emerald-500/10 hover:shadow-emerald-500/20'
            }`}
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Guardando...
              </>
            ) : (
              <>
                <Plus size={14} />
                Registrar Movimiento
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
