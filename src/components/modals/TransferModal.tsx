import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (fromHuchaId: string, toHuchaId: string, amount: number) => Promise<void>;
  huchas: Hucha[];
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  onTransfer,
  huchas,
}) => {
  const [fromHuchaId, setFromHuchaId] = useState('');
  const [toHuchaId, setToHuchaId] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);

  // Prefill defaults on open
  useEffect(() => {
    if (isOpen) {
      if (huchas.length >= 2) {
        // default: from principal to first non-principal hucha
        const principal = huchas.find(h => h.es_principal) || huchas[0];
        const target = huchas.find(h => h.id !== principal.id) || huchas[1];
        setFromHuchaId(principal.id);
        setToHuchaId(target.id);
      } else {
        setFromHuchaId('');
        setToHuchaId('');
      }
      setAmount('');
    }
  }, [isOpen, huchas]);

  const fromHucha = huchas.find(h => h.id === fromHuchaId);
  const toHucha = huchas.find(h => h.id === toHuchaId);

  const transferAmount = Number(amount) || 0;
  const fromBalance = fromHucha?.saldo_acumulado || 0;
  const toBalance = toHucha?.saldo_acumulado || 0;

  const newFromBalance = fromBalance - transferAmount;
  const newToBalance = toBalance + transferAmount;

  // Check if target will trigger overflow
  const willOverflow = toHucha?.tope_objetivo && toHucha.objetivo && newToBalance > toHucha.objetivo;
  const overflowAmount = willOverflow && toHucha?.objetivo ? newToBalance - toHucha.objetivo : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromHuchaId || !toHuchaId || transferAmount <= 0) return;
    if (transferAmount > fromBalance) return;

    setIsLoading(true);
    try {
      await onTransfer(fromHuchaId, toHuchaId, transferAmount);
      onClose();
    } catch (err) {
      console.error(err);
    } finally {
      setIsLoading(false);
    }
  };

  const formatCurrency = (val: number) =>
    val.toLocaleString('es-ES', { style: 'currency', currency: 'EUR' });

  return (
    <Modal
      isOpen={isOpen}
      onClose={onClose}
      title={
        <div className="flex items-center gap-2">
          <ArrowRightLeft className="text-amber-500" size={24} />
          <span>Traspaso entre Carteras</span>
        </div>
      }
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-5">
        {/* Origin Hucha */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Cartera de Origen
          </label>
          <select
            value={fromHuchaId}
            onChange={(e) => setFromHuchaId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all cursor-pointer"
          >
            <option value="" disabled className="text-slate-400">Seleccionar origen</option>
            {huchas.filter(h => h.activa !== false).map(h => (
              <option key={h.id} value={h.id} className="text-slate-800 dark:text-slate-200">
                {h.nombre} ({formatCurrency(h.saldo_acumulado)})
              </option>
            ))}
          </select>
        </div>

        {/* Target Hucha */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Cartera de Destino
          </label>
          <select
            value={toHuchaId}
            onChange={(e) => setToHuchaId(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-sky-500/50 transition-all cursor-pointer"
          >
            <option value="" disabled className="text-slate-400">Seleccionar destino</option>
            {huchas.filter(h => h.id !== fromHuchaId).map(h => (
              <option key={h.id} value={h.id} className="text-slate-800 dark:text-slate-200">
                {h.nombre} ({formatCurrency(h.saldo_acumulado)})
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2">
            Importe a Traspasar (€)
          </label>
          <input
            type="number"
            required
            min="0.01"
            step="any"
            placeholder="0.00 €"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="w-full px-4 py-3 rounded-xl border border-slate-200 dark:border-slate-800 bg-white/50 dark:bg-slate-900/50 text-slate-800 dark:text-white placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-sky-500/50 focus:border-sky-500 transition-all"
          />
        </div>

        {/* Dynamic Simulation Preview */}
        {fromHucha && toHucha && transferAmount > 0 && (
          <div className="p-4 rounded-xl border border-slate-100 dark:border-slate-800/80 bg-slate-50/50 dark:bg-slate-950/20 space-y-3.5 animate-appear-up">
            <h5 className="text-[10px] font-extrabold uppercase tracking-wider text-slate-400 mb-1">
              Simulación de Saldos Resultantes
            </h5>
            
            <div className="grid grid-cols-2 gap-4">
              {/* Origin result */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-400 truncate">{fromHucha.nombre}</span>
                <div className="flex items-center gap-1.5 text-sm font-bold text-rose-500 dark:text-rose-400">
                  <TrendingDown size={14} />
                  <span>{formatCurrency(newFromBalance)}</span>
                </div>
              </div>

              {/* Target result */}
              <div className="flex flex-col gap-1">
                <span className="text-[10px] font-bold text-slate-400 truncate">{toHucha.nombre}</span>
                <div className="flex items-center gap-1.5 text-sm font-bold text-emerald-500 dark:text-emerald-400">
                  <TrendingUp size={14} />
                  <span>{formatCurrency(willOverflow && toHucha.objetivo ? toHucha.objetivo : newToBalance)}</span>
                </div>
              </div>
            </div>

            {/* Overflow warning banner */}
            {willOverflow && (
              <div className="flex gap-2 p-3 bg-amber-500/10 border border-amber-500/20 text-amber-800 dark:text-amber-300 rounded-xl text-[11px] leading-relaxed">
                <AlertTriangle size={16} className="shrink-0 text-amber-500" />
                <span>
                  El saldo de <strong>{toHucha.nombre}</strong> alcanzará su objetivo.
                  El exceso de <strong>{formatCurrency(overflowAmount)}</strong> rebotará automáticamente a tu cartera principal.
                </span>
              </div>
            )}

            {/* Insufficient funds warning banner */}
            {transferAmount > fromBalance && (
              <div className="flex gap-2 p-3 bg-rose-500/10 border border-rose-500/20 text-rose-800 dark:text-rose-300 rounded-xl text-[11px] leading-relaxed">
                <AlertTriangle size={16} className="shrink-0 text-rose-500" />
                <span>Saldo insuficiente en la cartera origen para realizar este traspaso.</span>
              </div>
            )}
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
            disabled={isLoading || !fromHuchaId || !toHuchaId || transferAmount <= 0 || transferAmount > fromBalance}
            className="flex-1 py-3 rounded-xl bg-gradient-to-r from-amber-500 to-orange-600 hover:from-amber-600 hover:to-orange-700 text-white text-xs font-bold tracking-wide uppercase shadow-md hover:shadow-amber-500/10 flex items-center justify-center gap-2 disabled:opacity-50"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando...
              </>
            ) : (
              <>
                <ArrowRightLeft size={14} />
                Realizar Traspaso
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
