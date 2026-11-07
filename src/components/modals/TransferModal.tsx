import React, { useState, useEffect } from 'react';
import { ArrowRightLeft, TrendingDown, TrendingUp, AlertTriangle } from 'lucide-react';
import { Modal } from '../common/Modal';
import { type Hucha } from '../../types';
import { roundMoney } from '../../utils/incomeSplit';

interface TransferModalProps {
  isOpen: boolean;
  onClose: () => void;
  onTransfer: (fromHuchaId: string, toHuchaId: string, amount: number) => Promise<void>;
  onPrestamo: (fromHuchaId: string, toHuchaId: string, amount: number, meses: number) => Promise<void>;
  huchas: Hucha[];
}

export const TransferModal: React.FC<TransferModalProps> = ({
  isOpen,
  onClose,
  onTransfer,
  onPrestamo,
  huchas,
}) => {
  const [fromHuchaId, setFromHuchaId] = useState('');
  const [toHuchaId, setToHuchaId] = useState('');
  const [amount, setAmount] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [isPrestamo, setIsPrestamo] = useState(false);
  const [meses, setMeses] = useState(3);

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
      setIsPrestamo(false);
      setMeses(3);
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
  const willOverflow = !isPrestamo && toHucha?.tope_objetivo && toHucha.objetivo && newToBalance > toHucha.objetivo;
  const overflowAmount = willOverflow && toHucha?.objetivo ? newToBalance - toHucha.objetivo : 0;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!fromHuchaId || !toHuchaId || transferAmount <= 0) return;
    if (transferAmount > fromBalance) return;

    setIsLoading(true);
    try {
      if (isPrestamo) await onPrestamo(fromHuchaId, toHuchaId, transferAmount, meses);
      else await onTransfer(fromHuchaId, toHuchaId, transferAmount);
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
      title="Traspaso entre carteras"
      size="md"
    >
      <form onSubmit={handleSubmit} className="space-y-4">
        {/* Origin Hucha */}
        <div>
          <label htmlFor="transfer-from" className="field-label">
            Cartera de origen
          </label>
          <select
            id="transfer-from"
            value={fromHuchaId}
            onChange={(e) => setFromHuchaId(e.target.value)}
            className="field"
          >
            <option value="" disabled>Seleccionar origen</option>
            {huchas.filter(h => h.activa !== false && (!isPrestamo || !h.es_metalico)).map(h => (
              <option key={h.id} value={h.id}>
                {h.nombre} ({formatCurrency(h.saldo_acumulado)})
              </option>
            ))}
          </select>
        </div>

        {/* Target Hucha */}
        <div>
          <label htmlFor="transfer-to" className="field-label">
            Cartera de destino
          </label>
          <select
            id="transfer-to"
            value={toHuchaId}
            onChange={(e) => setToHuchaId(e.target.value)}
            className="field"
          >
            <option value="" disabled>Seleccionar destino</option>
            {huchas.filter(h => h.id !== fromHuchaId && h.activa !== false && (!isPrestamo || !h.es_metalico)).map(h => (
              <option key={h.id} value={h.id}>
                {h.nombre} ({formatCurrency(h.saldo_acumulado)})
              </option>
            ))}
          </select>
        </div>

        {/* Amount */}
        <div>
          <label htmlFor="transfer-amount" className="field-label">
            Importe a traspasar (€)
          </label>
          <input
            id="transfer-amount"
            type="number"
            required
            min="0.01"
            step="any"
            placeholder="0.00 €"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            className="field tabular-nums"
          />
        </div>

        <label className="flex items-center gap-2 text-sm font-semibold">
          <input type="checkbox" role="switch" checked={isPrestamo} onChange={e => setIsPrestamo(e.target.checked)} />
          Es un préstamo
        </label>
        {isPrestamo && (
          <div className="space-y-2">
            <label htmlFor="prestamo-meses" className="field-label">Devolver en {meses || 'N'} meses</label>
            <input id="prestamo-meses" type="number" min={1} max={36} step={1} required value={meses || ''} onChange={e => setMeses(Number(e.target.value))} className="field" />
            {meses >= 1 && meses <= 36 && Number.isInteger(meses) && (
              <p className="text-sm text-ink-soft">{formatCurrency(Math.ceil(Math.round(roundMoney(transferAmount) * 100) / meses) / 100)}/mes con cada nómina</p>
            )}
            {(toHucha?.deuda_pendiente || 0) > 0 && <p role="alert" className="text-sm text-rose-500">{toHucha?.nombre} ya tiene un préstamo pendiente; devuélvelo o revierte antes</p>}
          </div>
        )}

        {/* Dynamic Simulation Preview */}
        {fromHucha && toHucha && transferAmount > 0 && (
          <div className="space-y-3 rounded-2xl bg-surface-2 p-4 animate-appear-up">
            <p className="dashboard-label">Saldos tras el traspaso</p>
            
            <div className="grid grid-cols-2 gap-3">
              {/* Origin result */}
              <div className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-ink-soft">{fromHucha.nombre}</span>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-extrabold tabular-nums text-rose-500 dark:text-rose-400">
                  <TrendingDown size={14} />
                  <span>{formatCurrency(newFromBalance)}</span>
                </div>
              </div>

              {/* Target result */}
              <div className="min-w-0">
                <span className="block truncate text-[11px] font-semibold text-ink-soft">{toHucha.nombre}</span>
                <div className="mt-1 flex items-center gap-1.5 text-sm font-extrabold tabular-nums text-emerald-600 dark:text-emerald-400">
                  <TrendingUp size={14} />
                  <span>{formatCurrency(willOverflow && toHucha.objetivo ? toHucha.objetivo : newToBalance)}</span>
                </div>
              </div>
            </div>

            {/* Overflow warning banner */}
            {willOverflow && (
              <div className="notice is-warning">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>
                  El saldo de <strong>{toHucha.nombre}</strong> alcanzará su objetivo.
                  El exceso de <strong>{formatCurrency(overflowAmount)}</strong> rebotará automáticamente a tu cartera principal.
                </span>
              </div>
            )}

            {/* Insufficient funds warning banner */}
            {transferAmount > fromBalance && (
              <div className="notice is-danger" role="alert">
                <AlertTriangle size={15} className="mt-0.5 shrink-0" />
                <span>Saldo insuficiente en la cartera origen para realizar este traspaso.</span>
              </div>
            )}
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
            disabled={isLoading || !fromHuchaId || !toHuchaId || fromHuchaId === toHuchaId || transferAmount <= 0 || transferAmount > fromBalance || (isPrestamo && (!Number.isInteger(meses) || meses < 1 || meses > 36 || !!fromHucha?.es_metalico || !!toHucha?.es_metalico || (toHucha?.deuda_pendiente || 0) > 0))}
            className="dashboard-primary-button"
          >
            {isLoading ? (
              <>
                <svg className="animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Procesando…
              </>
            ) : (
              <>
                <ArrowRightLeft size={14} />
                {isPrestamo ? 'Prestar' : 'Traspasar'}
              </>
            )}
          </button>
        </div>
      </form>
    </Modal>
  );
};
