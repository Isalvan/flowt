import { useState } from 'react';
import { Plus, Trash2, X } from 'lucide-react';
import { useBanks } from '../../hooks/useBanks';
import { BankBadge } from '../common/BankBadge';
import { BANK_CATALOG, anchorDateLabel, bankNameKey, detectedBanks, estimateBankBalance } from '../../utils/banks';
import { usePrivacy } from '../../context/PrivacyContext';
import { AnchorBalanceModal } from '../modals/AnchorBalanceModal';
import type { Movimiento } from '../../types';
import type { Bank } from '../../context/bankContext';
import { ConfirmModal } from '../common/ConfirmModal';

const pillClass = 'inline-flex h-8 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-3 text-xs font-bold text-ink-soft transition-colors duration-150 hover:border-brand hover:bg-brand-tint hover:text-brand-ink';

export function BancosView({ chartMovements }: { chartMovements: Movimiento[] }) {
  const { banks, addBank, removeBank } = useBanks();
  const { formatCurrency, isLocked } = usePrivacy();
  const [anchoringId, setAnchoringId] = useState<string | null>(null);
  const anchoring = banks.find(bank => bank.id === anchoringId);
  const [editing, setEditing] = useState(false);
  const [nombre, setNombre] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [removing, setRemoving] = useState<Bank | null>(null);
  const exists = (name: string) => banks.some(b => bankNameKey(b.nombre) === bankNameKey(name));
  const duplicate = !!nombre.trim() && exists(nombre);
  const suggestions: { nombre: string; value: string; detected: boolean }[] = [];
  for (const name of detectedBanks(chartMovements)) {
    if (exists(name) || suggestions.some(b => bankNameKey(b.nombre) === bankNameKey(name))) continue;
    const entry = BANK_CATALOG.find(b => bankNameKey(b.nombre) === bankNameKey(name));
    suggestions.push({ nombre: entry?.nombre ?? name, value: entry?.id ?? name, detected: true });
  }
  for (const bank of BANK_CATALOG) {
    if (!exists(bank.nombre) && !suggestions.some(b => bankNameKey(b.nombre) === bankNameKey(bank.nombre))) {
      suggestions.push({ nombre: bank.nombre, value: bank.id, detected: false });
    }
  }
  const cancel = () => { setEditing(false); setNombre(''); setError(''); };
  const add = async (value: string) => {
    if (saving) return;
    setError(''); setSaving(true);
    try { await addBank(value); cancel(); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido añadir el banco.'); }
    finally { setSaving(false); }
  };
  const remove = async () => {
    if (!removing || saving) return;
    setError(''); setSaving(true);
    try { await removeBank(removing.id); setRemoving(null); }
    catch (e) { setError(e instanceof Error ? e.message : 'No se ha podido quitar el banco.'); setRemoving(null); }
    finally { setSaving(false); }
  };

  return <div className="w-full max-w-2xl mx-auto dashboard-surface p-5 animate-in fade-in">
    <h3 className="dashboard-heading mb-1">Tus bancos</h3>
    <p className="dashboard-subtitle mb-5">Los bancos donde tienes el dinero. Flowt asigna cada movimiento al suyo según quién envía el aviso.</p>
    {banks.length ? <div className="divide-y divide-line">{banks.map(bank => {
      const count = chartMovements.filter(m => m.banco?.toLowerCase() === bank.nombre.toLowerCase()).length;
      const balance = isLocked ? null : estimateBankBalance(bank, chartMovements);
      return <div key={bank.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto] items-center gap-3 py-3 sm:grid-cols-[2.5rem_minmax(0,1fr)_auto_auto]">
        <BankBadge nombre={bank.nombre} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-bold text-ink">{bank.nombre}</p>
          <p className="text-[11px] text-ink-soft">{count ? `${count} ${count === 1 ? 'movimiento' : 'movimientos'} en el último año` : 'Sin movimientos todavía'}</p>
        </div>
        {!isLocked && <div className="col-span-3 row-start-2 flex min-w-0 items-center justify-between gap-3 pl-[3.25rem] sm:col-span-1 sm:col-start-3 sm:row-start-1 sm:pl-0">
          <div className="min-w-0 flex-1 text-left sm:flex-none sm:shrink-0 sm:text-right">
            {balance !== null && <>
              <p className="text-sm font-extrabold tabular-nums text-ink">{formatCurrency(balance)}</p>
              <p className="text-[11px] text-ink-soft">{anchorDateLabel(bank.anclaFecha!)}</p>
              {bank.ultimoDesfase != null && bank.ultimoDesfase !== 0 && <p className="text-[11px] text-ink-faint">Último desfase: {bank.ultimoDesfase < 0 ? '−' : '+'}{formatCurrency(Math.abs(bank.ultimoDesfase))}</p>}
            </>}
          </div>
          <button type="button" className="dashboard-secondary-button shrink-0 !px-2.5 !py-1.5 !text-xs" onClick={() => setAnchoringId(bank.id)}>{balance === null ? 'Anotar saldo' : 'Actualizar'}</button>
        </div>}
        <button type="button" className="dashboard-icon-button is-danger col-start-3 row-start-1 sm:col-start-4" aria-label={`Quitar ${bank.nombre}`} disabled={saving} onClick={() => setRemoving(bank)}><Trash2 size={14} /></button>
      </div>;
    })}</div> : <div className="dashboard-empty py-6"><p>Aún no has añadido ningún banco</p></div>}
    <div className="mt-5 border-t border-line pt-4">
      <p className="dashboard-label mb-2">Añadir banco</p>
      <div className="flex flex-wrap gap-2">
        {suggestions.map(bank => <button type="button" key={bank.value} className={pillClass} style={{ maxWidth: '100%' }} disabled={saving} onClick={() => void add(bank.value)}><Plus size={14} className="shrink-0" /><span className="truncate">{bank.nombre}</span>{bank.detected && <span className="shrink-0 font-semibold text-ink-faint"> · detectado</span>}</button>)}
        {editing ? <form className="flex items-center gap-2 max-w-full flex-wrap" onSubmit={e => { e.preventDefault(); if (!duplicate && nombre.trim()) void add(nombre); }}>
          <input className="field h-8 w-48" aria-label="Nombre del banco" maxLength={40} autoFocus value={nombre} disabled={saving} onChange={e => { setNombre(e.target.value); setError(''); }} onKeyDown={e => { if (e.key === 'Escape') cancel(); }} />
          <button className="dashboard-secondary-button" disabled={saving || duplicate || !nombre.trim()}>Añadir</button>
          <button type="button" className="dashboard-icon-button" aria-label="Cancelar" disabled={saving} onClick={cancel}><X size={14} /></button>
          {duplicate && <p className="field-hint w-full text-rose-500 dark:text-rose-400">Ya tienes ese banco</p>}
        </form> : <button type="button" className={pillClass} disabled={saving} onClick={() => setEditing(true)}><Plus size={14} />Otro…</button>}
      </div>
    </div>
    {error && <p role="alert" className="mt-3 text-xs font-semibold text-rose-500 dark:text-rose-400">{error}</p>}
    {anchoring && !isLocked && <AnchorBalanceModal key={anchoring.id} bank={anchoring} movimientos={chartMovements} onClose={() => setAnchoringId(null)} />}
    <ConfirmModal isOpen={!!removing} onClose={() => { if (!saving) setRemoving(null); }} onConfirm={() => void remove()} title={`Quitar ${removing?.nombre ?? ''}`} message="Sus movimientos no se borran; solo deja de aparecer en tus bancos." confirmText="Quitar" type="danger" isLoading={saving} />
  </div>;
}
