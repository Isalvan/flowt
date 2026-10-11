import { useState } from 'react';
import { Landmark } from 'lucide-react';
import { useBanks } from '../../hooks/useBanks';
import { usePrivacy } from '../../context/PrivacyContext';
import type { Movimiento } from '../../types';
import { anchorAge, anchorDateLabel, banksSummary, estimateBankBalance } from '../../utils/banks';
import { AnchorBalanceModal } from '../modals/AnchorBalanceModal';

export function BanksCard({ movimientos, walletsTotal }: { movimientos: Movimiento[]; walletsTotal: number }) {
  const { banks } = useBanks();
  const { formatCurrency, isLocked } = usePrivacy();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  if (isLocked || !banks.length) return null;
  const selected = banks.find(bank => bank.id === selectedId);
  const summary = banksSummary(banks, movimientos, walletsTotal);
  return <section className="dashboard-surface min-w-0 p-5">
    <div className="mb-3 flex items-center gap-3">
      <span className="dashboard-icon bg-brand-tint text-brand-ink"><Landmark size={18} /></span>
      <div className="min-w-0"><h3 className="dashboard-heading">Tus bancos</h3><p className="dashboard-subtitle">Saldo según lo último que anotaste</p></div>
    </div>
    <div className="divide-y divide-line">{banks.map(bank => {
      const balance = estimateBankBalance(bank, movimientos);
      const stale = !!bank.anclaFecha && anchorAge(bank.anclaFecha) > 30;
      return <button key={bank.id} type="button" className="-mx-2 flex w-full items-center gap-3 rounded-lg px-2 py-3 text-left transition-colors hover:bg-surface-2" aria-label={`${balance === null ? 'Anotar' : 'Actualizar'} saldo de ${bank.nombre}`} onClick={() => setSelectedId(bank.id)}>
        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-bold text-ink">{bank.nombre}</p>
          <p className={`text-[11px] ${stale ? 'font-bold text-sun-600 dark:text-sun-300' : 'text-ink-soft'}`}>{balance === null ? 'Sin saldo anotado' : `${anchorDateLabel(bank.anclaFecha!)}${stale ? ' · conviene actualizarlo' : ''}`}</p>
        </div>
        {balance === null ? <span className="shrink-0 text-xs font-bold text-brand-ink">Anotar saldo</span> : <span className="shrink-0 text-[13px] font-extrabold tabular-nums text-ink">{formatCurrency(balance)}</span>}
      </button>;
    })}</div>
    {summary.missing < banks.length && <div className="mt-1 border-t border-line pt-3">
      <div className="flex items-center justify-between gap-3"><span className="text-xs font-bold text-ink-soft">Total en bancos</span><span className="text-sm font-extrabold tabular-nums text-ink">{formatCurrency(summary.total)}</span></div>
      {summary.missing > 0 ? <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">Falta anotar {summary.missing} {summary.missing === 1 ? 'banco' : 'bancos'} para comparar con tus carteras.</p> : summary.difference !== null && Math.abs(summary.difference) >= 0.01 && <p className="mt-1 text-[11px] leading-relaxed text-ink-faint">Tus carteras suman {formatCurrency(walletsTotal)}: {formatCurrency(Math.abs(summary.difference))} {summary.difference > 0 ? 'sin repartir.' : 'más de lo que hay en tus bancos.'}</p>}
    </div>}
    {selected && <AnchorBalanceModal key={selected.id} bank={selected} movimientos={movimientos} onClose={() => setSelectedId(null)} />}
  </section>;
}
