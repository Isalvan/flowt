import React, { useState, useEffect } from 'react';
import { PiggyBank, Target, Info, Sparkles } from 'lucide-react';
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
      title={
        <div className="flex items-center gap-2">
          <PiggyBank className="text-sky-500" size={24} />
          <span>{editingHucha ? 'Editar Cartera de Ahorro' : 'Nueva Cartera de Ahorro'}</span>
        </div>
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Nombre */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Nombre de la Cartera
          </label>
          <input
            type="text"
            required
            placeholder="Ej. Vacaciones, Coche, Emergencias..."
            value={nombre}
            onChange={(e) => setNombre(e.target.value)}
            disabled={editingHucha?.es_suscripciones}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all disabled:opacity-50"
          />
        </div>

        {/* Info label for system pockets */}
        {editingHucha?.es_suscripciones && (
          <div className="flex gap-2 p-3 bg-indigo-500/10 border border-indigo-500/20 text-indigo-800 dark:text-indigo-300 rounded-xl text-xs">
            <Info size={16} className="shrink-0" />
            <span>Esta cartera está protegida porque gestiona tus cargos de suscripciones.</span>
          </div>
        )}

        {/* Tipo de aportación */}
        {!editingHucha?.es_suscripciones && (
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              Regla de Distribución de Ingresos
            </label>
            <div className="grid grid-cols-3 gap-2">
              {(['porcentaje', 'flat', 'resto'] as const).map((mode) => (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setTipoAportacion(mode)}
                  className={`
                    py-3.5 
                    px-2 
                    rounded-xl 
                    border 
                    text-xs 
                    font-bold 
                    capitalize 
                    transition-all 
                    duration-200
                    flex 
                    flex-col 
                    items-center 
                    justify-center 
                    gap-1
                    ${tipoAportacion === mode
                      ? 'border-sky-500 bg-sky-500/10 text-sky-600 dark:text-sky-400 shadow-sm'
                      : 'border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800/40'
                    }
                  `}
                >
                  <span className="text-sm font-extrabold">
                    {mode === 'porcentaje' ? '%' : mode === 'flat' ? '€' : 'Resto'}
                  </span>
                  <span className="text-[10px] tracking-wide text-slate-400">
                    {mode === 'porcentaje' ? 'Porcentaje' : mode === 'flat' ? 'Importe Fijo' : 'Sobrante'}
                  </span>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Valor de aportación */}
        {tipoAportacion !== 'resto' && !editingHucha?.es_suscripciones && (
          <div className="animate-appear-up">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
              {tipoAportacion === 'porcentaje' ? 'Porcentaje Asignado (%)' : 'Cantidad Fija por Ingreso (€)'}
            </label>
            <input
              type="number"
              required
              min="0"
              max={tipoAportacion === 'porcentaje' ? '100' : undefined}
              step="any"
              placeholder={tipoAportacion === 'porcentaje' ? 'Ej. 15' : 'Ej. 100'}
              value={valorAportacion}
              onChange={(e) => setValorAportacion(e.target.value)}
              className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
            />
          </div>
        )}

        {/* Objetivo (Savings Goal) */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400">
              Objetivo de Ahorro (€)
            </label>
            <span className="text-[10px] font-semibold text-slate-400 dark:text-slate-500">(Opcional)</span>
          </div>
          <div className="relative">
            <Target className="absolute left-4 top-3.5 text-slate-400" size={16} />
            <input
              type="number"
              min="0"
              step="any"
              placeholder="Sin objetivo"
              value={objetivo}
              onChange={(e) => setObjetivo(e.target.value)}
              className="w-full pl-11 pr-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
            />
          </div>
        </div>

        {/* Options grid (Principal & Limit) */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
          {/* Es Principal */}
          {!editingHucha?.es_suscripciones && (
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors">
              <input
                type="checkbox"
                checked={esPrincipal}
                onChange={(e) => setEsPrincipal(e.target.checked)}
                className="mt-1 rounded text-sky-500 focus:ring-sky-500"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Cartera Principal</span>
                <span className="text-[10px] text-slate-400 leading-normal">
                  Aquí se restarán todos los gastos generales por defecto.
                </span>
              </div>
            </label>
          )}

          {/* Tope Objetivo */}
          {objetivo && Number(objetivo) > 0 && (
            <label className="flex items-start gap-3 p-3.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/20 dark:bg-slate-950/20 cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-900/40 transition-colors animate-appear-up">
              <input
                type="checkbox"
                checked={topeObjetivo}
                onChange={(e) => setTopeObjetivo(e.target.checked)}
                className="mt-1 rounded text-sky-500 focus:ring-sky-500"
              />
              <div className="flex flex-col">
                <span className="text-xs font-bold text-slate-700 dark:text-slate-300">Tope de Objetivo</span>
                <span className="text-[10px] text-slate-400 leading-normal">
                  Frenar ingresos al alcanzar el objetivo. El exceso se enviará a "Resto".
                </span>
              </div>
            </label>
          )}
        </div>

        {/* Opciones de Subsanación (Deuda) */}
        {!editingHucha?.es_suscripciones && (
          <div className="pt-4 border-t border-slate-100 dark:border-slate-800/60">
            <h4 className="text-xs font-bold uppercase tracking-wider text-slate-700 dark:text-slate-300 mb-3 flex items-center gap-2">
              Opciones de Subsanación Automática
            </h4>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Subsanar hasta (€)
                </label>
                <input
                  type="number"
                  step="any"
                  value={subsanarHasta}
                  onChange={(e) => setSubsanarHasta(e.target.value)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
                  title="Balance objetivo cuando pulses 'Subsanar' por saldo negativo"
                />
              </div>
              <div>
                <label className="block text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-1.5">
                  Tomar dinero de (Prestamista)
                </label>
                <select
                  value={subsanarCon || ''}
                  onChange={(e) => setSubsanarCon(e.target.value || null)}
                  className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
                >
                  <option value="">Por defecto (Resto/Principal)</option>
                  {allHuchas
                    .filter(h => h.id !== editingHucha?.id)
                    .map(h => (
                      <option key={h.id} value={h.id}>{h.nombre}</option>
                    ))
                  }
                </select>
              </div>
            </div>
            <p className="text-[9px] text-slate-400 mt-2 leading-relaxed">
              Si tu saldo cae en negativo, podrás subsanarlo. Los próximos ingresos irán destinados a pagar la deuda a la cartera prestamista automáticamente.
            </p>
          </div>
        )}

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
            disabled={isLoading || !nombre.trim()}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-sky-500 to-blue-600 hover:from-sky-600 hover:to-blue-700 text-white text-xs font-bold tracking-wide uppercase shadow-md hover:shadow-sky-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
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
                {editingHucha ? 'Guardar Cambios' : 'Crear Cartera'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
