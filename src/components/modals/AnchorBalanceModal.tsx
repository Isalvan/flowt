import { useEffect, useId, useRef, useState } from 'react';
import type { Bank } from '../../context/bankContext';
import type { Movimiento } from '../../types';
import { useBanks } from '../../hooks/useBanks';
import { usePrivacy } from '../../context/PrivacyContext';
import { estimateBankBalance, roundBankAmount } from '../../utils/banks';
import { Modal } from '../common/Modal';

export function AnchorBalanceModal({ bank, movimientos, onClose }: { bank: Bank; movimientos: Movimiento[]; onClose: () => void }) {
  const { anchorBank } = useBanks();
  const { formatCurrency, isLocked } = usePrivacy();
  const fieldId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const [value, setValue] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => { if (!isLocked) inputRef.current?.focus(); }, [isLocked]);
  const saldo = Number(value);
  const valid = value.trim() !== '' && Number.isFinite(saldo) && saldo >= -1_000_000 && saldo <= 100_000_000;
  const estimated = estimateBankBalance(bank, movimientos);
  const difference = estimated === null ? null : roundBankAmount(saldo - estimated);
  const signed = (amount: number) => `${amount < 0 ? '−' : '+'}${formatCurrency(Math.abs(amount))}`;
  const close = () => { if (!saving) onClose(); };
  const save = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!valid || saving || isLocked) return;
    setSaving(true); setError('');
    try { await anchorBank(bank.id, roundBankAmount(saldo), difference); onClose(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido guardar el saldo.'); }
    finally { setSaving(false); }
  };
  if (isLocked) return null;
  return <Modal isOpen onClose={close} title={`Anotar saldo de ${bank.nombre}`} size="sm">
    <p className="text-xs text-ink-soft">Mira el saldo en la app de tu banco y escríbelo aquí. A partir de ahora Flowt lo irá calculando con cada movimiento.</p>
    <form className="mt-4" onSubmit={event => void save(event)}>
      <label className="field-label" htmlFor={fieldId}>Saldo que ves ahora</label>
      <div className="relative">
        <input ref={inputRef} id={fieldId} className="field has-unit" type="number" inputMode="decimal" step="0.01" min={-1_000_000} max={100_000_000} autoFocus value={value} disabled={saving} onChange={e => setValue(e.target.value)} />
        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-ink-soft">€</span>
      </div>
      {estimated !== null && <div className="mt-3 rounded-xl bg-surface-2 p-3 text-xs">
        <div className="flex justify-between gap-3"><span>Flowt calculaba</span><span className="font-bold tabular-nums text-ink">{formatCurrency(estimated)}</span></div>
        {valid && difference !== null && <div className="mt-2 flex justify-between gap-3"><span>Diferencia</span><span className={`font-bold tabular-nums ${Math.abs(difference) < 0.01 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'}`}>{Math.abs(difference) < 0.01 ? 'Coincide' : signed(difference)}</span></div>}
      </div>}
      {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-500 dark:text-rose-400">{error}</p>}
      <div className="mt-5 flex justify-end gap-2">
        <button type="button" className="dashboard-secondary-button" disabled={saving} onClick={close}>Cancelar</button>
        <button type="submit" className="dashboard-primary-button" disabled={!valid || saving}>Guardar</button>
      </div>
    </form>
  </Modal>;
}
