import React, { useState } from 'react';
import { Card } from '../common/Card';
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
    { label: 'Nómina Mensual', tipo: 'ingreso' as const, concepto: 'Nómina Trabajo', importe: 2100 },
    { label: 'Bizum de Amigo', tipo: 'ingreso' as const, concepto: 'Bizum: Cena de ayer', importe: 20 },
    { label: 'Compra Semanal', tipo: 'gasto' as const, concepto: 'Supermercado Mercadona', importe: 65 },
    { label: 'Suscripción Streaming', tipo: 'gasto' as const, concepto: 'Netflix Premium', importe: 17.99 },
    { label: 'Cenita Pareja', tipo: 'gasto' as const, concepto: 'Cena Restaurante Japones', importe: 54 },
  ];

  return (
    <div className="fixed bottom-6 right-6 z-40 transition-all duration-300">
      {!isOpen ? (
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 bg-gradient-to-r from-violet-600 via-indigo-600 to-blue-600 hover:from-violet-500 hover:to-blue-500 text-white px-5 py-3 rounded-full shadow-lg hover:shadow-xl hover:shadow-indigo-500/20 active:scale-95 transition-all duration-200 border border-white/10"
        >
          <Sparkles className="w-5 h-5 animate-pulse text-yellow-300" />
          <span className="font-semibold text-sm">Simulador Demo</span>
        </button>
      ) : (
        <div className="w-96 animate-in slide-in-from-bottom-5 duration-300">
          <Card className="border border-indigo-500/30 shadow-2xl shadow-indigo-950/20">
            <div className="flex items-center justify-between border-b border-white/10 pb-3 mb-4">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-indigo-400" />
                <h3 className="font-bold text-slate-800 dark:text-slate-100">Simulador de Transacciones</h3>
              </div>
              <button
                onClick={() => setIsOpen(false)}
                className="text-slate-400 hover:text-slate-200 text-sm px-2 py-1 rounded hover:bg-white/5 transition-colors"
              >
                Cerrar
              </button>
            </div>

            {/* Presets Grid */}
            <div className="mb-4">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block mb-2">
                Acciones Rápidas (Inyección con 1 click)
              </span>
              <div className="grid grid-cols-2 gap-2">
                {presets.map((preset, idx) => (
                  <button
                    key={idx}
                    onClick={() => injectDemoMovement(preset.tipo, preset.concepto, preset.importe)}
                    className="flex flex-col items-start p-2 rounded-xl text-left bg-white/5 hover:bg-indigo-500/10 border border-white/5 hover:border-indigo-500/20 group transition-all duration-200"
                  >
                    <span className="text-xs font-medium text-slate-700 dark:text-slate-300 group-hover:text-indigo-400 truncate w-full">
                      {preset.label}
                    </span>
                    <span className={`text-[10px] font-bold mt-1 flex items-center gap-1 ${
                      preset.tipo === 'ingreso' ? 'text-emerald-500' : 'text-rose-500'
                    }`}>
                      {preset.tipo === 'ingreso' ? '+' : '-'}{preset.importe} €
                    </span>
                  </button>
                ))}
              </div>
            </div>

            {/* Divider */}
            <div className="h-[1px] bg-white/10 my-4" />

            {/* Custom transaction form */}
            <form onSubmit={handleInjectCustom} className="space-y-3">
              <span className="text-xs font-semibold uppercase tracking-wider text-slate-400 block">
                Crear Movimiento Personalizado
              </span>
              
              {/* Tipo selector */}
              <div className="grid grid-cols-2 gap-2 bg-slate-100/50 dark:bg-slate-900/50 p-1 rounded-xl border border-white/5">
                <button
                  type="button"
                  onClick={() => setCustomTipo('ingreso')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    customTipo === 'ingreso'
                      ? 'bg-emerald-500 text-white shadow-md shadow-emerald-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowUpRight className="w-3.5 h-3.5" />
                  Ingreso
                </button>
                <button
                  type="button"
                  onClick={() => setCustomTipo('gasto')}
                  className={`flex items-center justify-center gap-1.5 py-1.5 rounded-lg text-xs font-semibold transition-all duration-200 ${
                    customTipo === 'gasto'
                      ? 'bg-rose-500 text-white shadow-md shadow-rose-500/20'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  <ArrowDownRight className="w-3.5 h-3.5" />
                  Gasto
                </button>
              </div>

              {/* Concepto input */}
              <div>
                <input
                  type="text"
                  placeholder="Concepto (ej. Compra Mercadona)"
                  value={customConcepto}
                  onChange={(e) => setCustomConcepto(e.target.value)}
                  className="w-full text-xs bg-slate-100/50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-100 border border-white/10 rounded-xl px-3 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder:text-slate-500"
                  required
                />
              </div>

              {/* Importe input */}
              <div className="grid grid-cols-2 gap-2">
                <div className="relative">
                  <input
                    type="number"
                    step="0.01"
                    placeholder="Importe"
                    value={customImporte}
                    onChange={(e) => setCustomImporte(e.target.value)}
                    className="w-full text-xs bg-slate-100/50 dark:bg-slate-900/50 text-slate-800 dark:text-slate-100 border border-white/10 rounded-xl pl-3 pr-7 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none placeholder:text-slate-500"
                    required
                  />
                  <span className="absolute right-2.5 top-2 text-xs text-slate-500">€</span>
                </div>

                {/* Optional: Hucha to subtract expense from */}
                {customTipo === 'gasto' ? (
                  <select
                    value={customHuchaId}
                    onChange={(e) => setCustomHuchaId(e.target.value)}
                    className="w-full text-xs bg-slate-100/50 dark:bg-slate-900/50 text-slate-400 dark:text-slate-300 border border-white/10 rounded-xl px-2 py-2 focus:ring-1 focus:ring-indigo-500 focus:outline-none"
                  >
                    <option value="" className="bg-slate-950 text-slate-400">Hucha Principal</option>
                    {huchas
                      .filter(h => !h.es_suscripciones)
                      .map(h => (
                        <option key={h.id} value={h.id} className="bg-slate-950 text-slate-200">
                          {h.nombre} ({h.saldo_acumulado.toFixed(1)}€)
                        </option>
                      ))}
                  </select>
                ) : (
                  <div className="flex items-center justify-center text-[10px] text-slate-400 text-center leading-none p-1 border border-dashed border-white/10 rounded-xl bg-white/5">
                    Se distribuirá en cascada por reglas
                  </div>
                )}
              </div>

              {/* Submit Button */}
              <button
                type="submit"
                className="w-full flex items-center justify-center gap-1.5 bg-indigo-600 hover:bg-indigo-500 text-white font-bold text-xs py-2 px-3 rounded-xl hover:shadow-md hover:shadow-indigo-500/10 active:scale-98 transition-all duration-200 border border-indigo-400/20"
              >
                <Plus className="w-4 h-4" />
                Inyectar Transacción
              </button>
            </form>
          </Card>
        </div>
      )}
    </div>
  );
};
