import { useState } from 'react';
import type { Hucha } from '../../types';
import { usePrivacy } from '../../context/PrivacyContext';
import { roundMoney } from '../../utils/incomeSplit';
import { Modal } from '../common/Modal';

export function ReconcileModal({ huchas, difference, onSave, onClose }: {
  huchas: Hucha[];
  difference: number;
  onSave: (huchaId: string, amount: number) => Promise<void>;
  onClose: () => void;
}) {
  const { formatCurrency, isLocked } = usePrivacy();
  const wallets = huchas.filter(h => h.activa !== false && !h.es_metalico);
  const preferred = wallets.find(h => h.tipo_aportacion === 'resto') ?? wallets.find(h => h.es_principal) ?? wallets[0];
  const [walletId, setWalletId] = useState(preferred?.id ?? '');
  const wallet = wallets.find(h => h.id === walletId) ?? preferred;
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(false);
  const amount = roundMoney(difference);
  const close = () => { if (!saving) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!wallet || saving || isLocked || !Number.isFinite(amount) || amount === 0) return;
    setSaving(true); setError(false);
    try { await onSave(wallet.id, amount); onClose(); }
    catch { setError(true); }
    finally { setSaving(false); }
  };
  if (isLocked) return null;
  return <Modal isOpen onClose={close} size="sm" title="Cuadrar con tus bancos">
    <p className="text-xs text-ink-soft">{amount > 0
      ? `En tus bancos hay ${formatCurrency(Math.abs(amount))} más de lo que suman tus carteras. Elige a qué cartera van.`
      : `Tus carteras suman ${formatCurrency(Math.abs(amount))} más de lo que hay en tus bancos. Elige de qué cartera se restan.`}</p>
    <form onSubmit={event => void save(event)}>
      <label className="field-label mt-4" htmlFor="reconcile-wallet">Cartera</label>
      <select id="reconcile-wallet" className="field" value={wallet?.id ?? ''} disabled={saving} onChange={e => setWalletId(e.target.value)}>
        {wallets.map(h => <option key={h.id} value={h.id}>{h.nombre} · {formatCurrency(h.saldo_acumulado)}</option>)}
      </select>
      {wallet && <div className="mt-3 flex justify-between gap-3 rounded-xl bg-surface-2 p-3 text-xs"><span>Quedará en</span><span className="font-bold tabular-nums text-ink">{formatCurrency(roundMoney(wallet.saldo_acumulado + amount))}</span></div>}
      {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-500 dark:text-rose-400">No se ha podido cuadrar.</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="dashboard-secondary-button" disabled={saving} onClick={close}>Cancelar</button>
        <button type="submit" className="dashboard-primary-button" disabled={saving || !wallet || !Number.isFinite(amount) || amount === 0}>Cuadrar</button>
      </div>
    </form>
  </Modal>;
}
