import React, { useState, useEffect } from 'react';
import { CreditCard, Calendar, Sliders, Sparkles } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Suscripcion, type Hucha } from '../../types';
import { SUBSCRIPTION_COLORS, CATEGORIA_OPTIONS, FRECUENCIA_OPTIONS } from '../../hooks/useFinanceData';

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
  const [diaPago, setDiaPago] = useState('1');
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
      setDiaPago(editingSuscripcion.dia_pago.toString());
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
      setDiaPago('1');
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
    if (!nombre.trim() || !importe) return;

    setIsLoading(true);
    try {
      const data = {
        nombre: nombre.trim(),
        importe: Number(importe),
        frecuencia,
        dia_pago: Number(diaPago),
        categoria,
        color,
        activa,
        hucha_id: huchaId || null,
        mi_parte: compartida && miParte ? Number(miParte) : null,
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
      title={
        <div className="flex items-center gap-2">
          <CreditCard className="text-violet-500" size={24} />
          <span>{editingSuscripcion ? 'Editar Suscripción Recurrente' : 'Nueva Suscripción Recurrente'}</span>
        </div>
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Nombre & Importe */}
        <div className="grid grid-cols-3 gap-3">
          <div className="col-span-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Nombre
            </label>
            <input
              type="text"
              required
              placeholder="Ej. Netflix, Spotify..."
              value={nombre}
              onChange={(e) => setNombre(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
            />
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Total (€)
            </label>
            <input
              type="number"
              required
              min="0.01"
              step="any"
              placeholder="Ej. 17.99"
              value={importe}
              onChange={(e) => handleImporteChange(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
            />
          </div>
        </div>

        {/* Frecuencia & Día Pago */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Frecuencia
            </label>
            <select
              value={frecuencia}
              onChange={(e) => setFrecuencia(e.target.value as any)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all cursor-pointer"
            >
              {FRECUENCIA_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Día de Cobro (1-31)
            </label>
            <div className="relative">
              <Calendar className="absolute left-3.5 top-3.5 text-slate-400" size={14} />
              <input
                type="number"
                required
                min="1"
                max="31"
                value={diaPago}
                onChange={(e) => setDiaPago(e.target.value)}
                className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all"
              />
            </div>
          </div>
        </div>

        {/* Categoría & Cartera a la que se imputa */}
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Categoría
            </label>
            <select
              value={categoria}
              onChange={(e) => setCategoria(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all cursor-pointer"
            >
              {CATEGORIA_OPTIONS.map(o => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Imputar a Cartera
            </label>
            <select
              value={huchaId}
              onChange={(e) => setHuchaId(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-xs text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all cursor-pointer"
            >
              <option value="">Sin provisión de saldo</option>
              {huchas.map(h => (
                <option key={h.id} value={h.id}>
                  {h.nombre} ({formatCurrency(h.saldo_acumulado)})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Color Palette Picker */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Identificador Visual (Color)
          </label>
          <div className="flex flex-wrap gap-2">
            {SUBSCRIPTION_COLORS.map(c => (
              <button
                key={c}
                type="button"
                onClick={() => setColor(c)}
                className={`
                  w-6 h-6 
                  rounded-full 
                  border-2 
                  transition-transform 
                  duration-150 
                  ${color === c 
                    ? 'border-white dark:border-slate-950 scale-125 shadow-md' 
                    : 'border-transparent scale-100 hover:scale-110'
                  }
                `}
                style={{ backgroundColor: c }}
                aria-label={`Seleccionar color ${c}`}
              />
            ))}
          </div>
        </div>

        {/* Shared Split Proximity Slider */}
        <div className="border-t border-slate-100 dark:border-slate-800/60 pt-3">
          <label className="flex items-center gap-3 p-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
            <input
              type="checkbox"
              checked={compartida}
              onChange={(e) => {
                setCompartida(e.target.checked);
                if (e.target.checked && totalImporte > 0) {
                  setMiParte((totalImporte / 2).toFixed(2));
                }
              }}
              className="rounded text-sky-500 focus:ring-sky-500"
            />
            <div className="flex flex-col">
              <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Suscripción Compartida</span>
              <span className="text-[10px] text-slate-400 leading-normal">
                ¿Alguien te reembolsa una parte de esta cuota vía Bizum/transferencia?
              </span>
            </div>
          </label>

          {compartida && totalImporte > 0 && (
            <div className="p-3 mt-2 border border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-950/20 rounded-xl space-y-3 animate-appear-up">
              <div className="flex items-center justify-between text-xs">
                <span className="font-bold text-slate-500">Mi Parte Real:</span>
                <span className="font-extrabold text-sky-500">{formatCurrency(miParteImporte)}</span>
              </div>

              <div className="flex items-center gap-3">
                <Sliders size={14} className="text-slate-400" />
                <input
                  type="range"
                  min="0.01"
                  max={totalImporte}
                  step="0.05"
                  value={miParte}
                  onChange={(e) => setMiParte(e.target.value)}
                  className="w-full h-1.5 bg-slate-200 dark:bg-slate-800 rounded-lg appearance-none cursor-pointer accent-sky-500"
                />
              </div>

              <div className="flex gap-2 p-2 bg-sky-500/5 text-[10px] text-slate-400 leading-relaxed justify-between">
                <span>Total: {formatCurrency(totalImporte)}</span>
                <span>Bizum amigos: +{formatCurrency(reembolsoAmigos)}</span>
              </div>
            </div>
          )}
        </div>

        {/* Buttons */}
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
            disabled={isLoading || !nombre.trim() || !importe}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-violet-500 to-indigo-600 hover:from-violet-600 hover:to-indigo-700 text-white text-xs font-bold tracking-wide uppercase shadow-md hover:shadow-violet-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
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
                <Sparkles size={14} />
                {editingSuscripcion ? 'Guardar Suscripción' : 'Crear Suscripción'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
