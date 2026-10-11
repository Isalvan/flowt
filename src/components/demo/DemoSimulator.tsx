import React, { useState } from 'react';
import { type Hucha } from '../../types';
import { Sparkles, Plus, ArrowUpRight, ArrowDownRight } from 'lucide-react';

interface DemoSimulatorProps {
  injectDemoMovement: (tipo: 'ingreso' | 'gasto', concepto: string, importe: number, selectedHuchaId?: string) => void;
  huchas: Hucha[];
}

export const DemoSimulator: React.FC<DemoSimulatorProps> = ({ injectDemoMovement, huchas }) => {
  const [isOpen, setIsOpen] = useState(false);
  const [customTipo, setCustomTipo] = useState<'ingreso' | 'gasto'>('ingreso');
  const [customConcepto, setCustomConcepto] = useState('');
  const [customImporte, setCustomImporte] = useState('');
  const [customHuchaId, setCustomHuchaId] = useState('');

  const handleInjectCustom = (e: React.FormEvent) => {
    e.preventDefault();
    const importe = parseFloat(customImporte);
    if (!customConcepto.trim() || isNaN(importe) || importe <= 0) return;
    
    injectDemoMovement(
      customTipo,
      customConcepto.trim(),
      importe,
      customTipo === 'gasto' ? (customHuchaId || undefined) : undefined
    );

    // Reset form
    setCustomConcepto('');
    setCustomImporte('');
    setCustomHuchaId('');
  };

  const presets = [
    { label: 'Nómina mensual', tipo: 'ingreso' as const, concepto: 'Nómina trabajo', importe: 2100 },
    { label: 'Bizum de amigo', tipo: 'ingreso' as const, concepto: 'Bizum: cena de ayer', importe: 20 },
    { label: 'Compra semanal', tipo: 'gasto' as const, concepto: 'Supermercado Mercadona', importe: 65 },
    { label: 'Suscripción streaming', tipo: 'gasto' as const, concepto: 'Netflix Premium', importe: 17.99 },
    { label: 'Cenita pareja', tipo: 'gasto' as const, concepto: 'Cena restaurante japones', importe: 54 },
  ];

  return (
    <div className="fixed bottom-24 right-3 z-40 md:bottom-6 md:right-6">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          aria-label="Simulador demo"
          className="flex items-center gap-2 rounded-full bg-ink px-4 py-3 text-page shadow-[var(--shadow-pop)] transition-transform duration-150 active:translate-y-px"
        >
          <Sparkles className="h-4 w-4 text-sun-500" />
          <span className="hidden text-[13px] font-bold sm:inline">Simulador demo</span>
        </button>
      ) : (
        <div className="animate-in fade-in slide-in-from-bottom-5 w-[calc(100vw-1.5rem)] max-w-96 duration-300">
          <div className="dashboard-surface p-5">
            <div className="flex items-center justify-between border-b border-line pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-brand-ink" />
                <h3 className="dashboard-heading">Simulador de transacciones</h3>
              </div>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="text-xs font-semibold text-ink-soft hover:text-ink transition-colors"
              >
                Cerrar
              </button>
            </div>

            {/* Presets Grid */}
            <div className="mb-4">
              <span className="dashboard-label mb-2 block">
                Acciones rápidas (inyección con 1 click)
              </span>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => injectDemoMovement(preset.tipo, preset.concepto, preset.importe)}
                    className="choice-card p-2.5 w-full hover:bg-surface-2 transition-colors cursor-pointer"
                  >
                    <span className="text-xs font-semibold text-ink truncate w-full">
                      {preset.label}
                    </span>
                    <span className={`text-[11px] font-bold tabular-nums mt-1 flex items-center gap-1 ${
                      preset.tipo === 'ingreso' ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'
                    }`}>
                      {preset.tipo === 'ingreso' ? '+' : '-'}{preset.importe} €
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="h-[1px] bg-line my-4" />

            {/* Custom transaction form */}
            <form onSubmit={handleInjectCustom} className="space-y-3">
              <span className="dashboard-label mb-2 block">
                Crear movimiento personalizado
              </span>
              
              {/* Tipo selector */}
              <div role="group" aria-label="Tipo de movimiento" className="segmented w-full grid grid-cols-2">
                <button
                  type="button"
                  onClick={() => setCustomTipo('ingreso')}
                  aria-pressed={customTipo === 'ingreso'}
                  className={`segmented-item justify-center ${customTipo === 'ingreso' ? '!text-emerald-600 dark:!text-emerald-400' : ''}`}
                >
                  <ArrowUpRight size={14} />
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setCustomTipo('gasto')}
                  aria-pressed={customTipo === 'gasto'}
                  className={`segmented-item justify-center ${customTipo === 'gasto' ? '!text-rose-500 dark:!text-rose-400' : ''}`}
                >
                  <ArrowDownRight size={14} />
                  Gasto
                </button>
              </div>

              {/* Concepto input */}
              <div>
                <label htmlFor="custom-concepto" className="sr-only">Concepto</label>
                <input
                  id="custom-concepto"
                  type="text"
                  placeholder="Concepto (ej. compra Mercadona)"
                  value={customConcepto}
                  onChange={(e) => setCustomConcepto(e.target.value)}
                  className="field text-xs"
                  required
                />
              </div>

              {/* Importe input */}
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <label htmlFor="custom-importe" className="sr-only">Importe</label>
                  <input
                    id="custom-importe"
                    type="number"
                    step="0.01"
                    placeholder="Importe"
                    value={customImporte}
                    onChange={(e) => setCustomImporte(e.target.value)}
                    className="field text-xs pr-7 tabular-nums"
                    required
                  />
                  <span className="absolute right-2.5 top-2.5 text-xs text-ink-faint">€</span>
                </div>

                {/* Optional: Hucha to subtract expense from */}
                {customTipo === 'gasto' ? (
                  <div>
                    <label htmlFor="custom-hucha" className="sr-only">Cartera</label>
                    <select
                      id="custom-hucha"
                      value={customHuchaId}
                      onChange={(e) => setCustomHuchaId(e.target.value)}
                      className="field text-xs"
                    >
                      <option value="">Hucha principal</option>
                      {huchas
                        .filter(h => !h.es_suscripciones)
                        .map(h => (
                          <option key={h.id} value={h.id}>
                            {h.nombre} ({h.saldo_acumulado.toFixed(1)} €)
                          </option>
                        ))}
                    </select>
                  </div>
                ) : (
                  <div className="notice text-[11px] justify-center text-center">
                    Se distribuirá en cascada por reglas
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="dashboard-primary-button w-full"
              >
                <Plus size={16} />
                Inyectar transacción
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
