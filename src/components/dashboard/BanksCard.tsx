import { BankBadge } from '../common/BankBadge';
import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { useBanks } from '../../hooks/useBanks';
import { usePrivacy } from '../../context/PrivacyContext';
import type { Hucha, Movimiento } from '../../types';
import { anchorAge, banksSummary, estimateBankBalance, estimateBasisLabel } from '../../utils/banks';
import { AnchorBalanceModal } from '../modals/AnchorBalanceModal';
import { ReconcileModal } from '../modals/ReconcileModal';

/** `walletsTotal` is what should be in the banks: the wallets without the cash one, which `cashExcluded` says out loud. */
export function BanksCard({ movimientos, walletsTotal, cashExcluded = false, huchas = [], onReconcile }: {
  movimientos: Movimiento[];
  walletsTotal: number;
  cashExcluded?: boolean;
  huchas?: Hucha[];
  onReconcile?: (huchaId: string, amount: number) => Promise<void>;
}) {
  const { banks } = useBanks();
  const { formatCurrency, isLocked } = usePrivacy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reconciling, setReconciling] = useState(false);
  if (isLocked || !banks.length) return null;
  const selected = banks.find(bank => bank.id === selectedId);
  const summary = banksSummary(banks, movimientos, walletsTotal);
  return <section className="dashboard-surface min-w-0 p-5">
    <div className="mb-3 flex items-center gap-3">
      <span className="dashboard-icon bg-brand-tint text-brand-ink"><Landmark size={18} /></span>
      <div className="min-w-0"><h3 className="dashboard-heading">Tus bancos</h3><p className="dashboard-subtitle">Saldo estimado con tus movimientos</p></div>
    </div>
    <div className="divide-y divide-line">{banks.map(bank => {
      const balance = estimateBankBalance(bank, movimientos);
      const stale = !!bank.anclaFecha && anchorAge(bank.anclaFecha) > 30;
      return <button key={bank.id} type="button" className="-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-2" aria-label={`${balance === null ? 'Anotar' : 'Actualizar'} saldo de ${bank.nombre}`} onClick={() => setSelectedId(bank.id)}>
        <BankBadge nombre={bank.nombre} size="sm" />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink">{bank.nombre}</p>
          <p className={`text-[11px] ${stale ? 'font-bold text-sun-600 dark:text-sun-300' : 'text-ink-soft'}`}>{balance === null ? 'Sin saldo anotado' : `${estimateBasisLabel(bank, movimientos)}${stale ? ' · conviene revisarlo' : ''}`}</p>
        </div>
        {balance === null ? <span className="shrink-0 text-xs font-bold text-brand-ink">Anotar saldo</span> : <span className="shrink-0 text-[13px] font-extrabold tabular-nums text-ink">{formatCurrency(balance)}</span>}
      </button>;
    })}</div>
    {summary.missing < banks.length && <div className="mt-1 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-ink-soft">Total en bancos</span><span className="text-sm font-extrabold tabular-nums text-ink">{formatCurrency(summary.total)}</span></div>
      {summary.missing > 0 ? <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">Falta anotar {summary.missing} {summary.missing === 1 ? 'banco' : 'bancos'} para comparar con tus carteras.</p> : summary.difference !== null && Math.abs(summary.difference) >= 0.01 && <div className="mt-1 flex items-start justify-between gap-3">
        <p className="text-[11px] leading-relaxed text-ink-faint">Tus carteras{cashExcluded ? ', sin el efectivo,' : ''} suman {formatCurrency(walletsTotal)}: {formatCurrency(Math.abs(summary.difference))} {summary.difference > 0 ? 'sin repartir.' : 'más de lo que hay en tus bancos.'}</p>
        {onReconcile && <button type="button" className="shrink-0 rounded-lg py-0.5 text-xs font-bold text-brand-ink underline-offset-4 hover:underline" onClick={() => setReconciling(true)}>Cuadrar</button>}
      </div>}
    </div>}
    {selected && <AnchorBalanceModal key={selected.id} bank={selected} movimientos={movimientos} onClose={() => setSelectedId(null)} />}
    {reconciling && onReconcile && summary.missing === 0 && summary.difference !== null && Math.abs(summary.difference) >= 0.01 && <ReconcileModal huchas={huchas} difference={summary.difference} onSave={onReconcile} onClose={() => setReconciling(false)} />}
  </section>;
}
