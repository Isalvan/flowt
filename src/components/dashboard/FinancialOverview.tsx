import React from 'react';
import { Info, TrendingDown, TrendingUp } from 'lucide-react';
import { CountUp } from '../common/CountUp';
import { usePrivacy } from '../../context/PrivacyContext';

interface FinancialOverviewProps { balance: number; ingresos: number; gastos: number; }

export const FinancialOverview: React.FC<FinancialOverviewProps> = ({ balance, ingresos, gastos }) => {
  const { isLocked } = usePrivacy();
  const spent = ingresos > 0 ? Math.round((gastos / ingresos) * 100) : 0;
  const visible = (value: number) => isLocked ? '•••• €' : <CountUp end={value} decimals={2} decimal="," separator="." suffix=" €" preserveValue duration={1.1} />;
  return <section className="dashboard-surface grid grid-cols-2 gap-3 p-4 sm:grid-cols-[1.35fr_1fr_1fr_1fr] sm:items-center sm:gap-5 sm:p-6" aria-label="Resumen financiero">
    <div className="border-b border-slate-200 pb-4 sm:border-b-0 sm:border-r sm:pb-0 sm:pr-6 dark:border-slate-700">
      <div className="flex items-center gap-2 text-sm font-bold text-slate-500 dark:text-slate-400">Saldo actual <Info size={14} /></div>
      <div className="mt-1 text-3xl font-black tracking-tight text-slate-900 dark:text-white sm:text-4xl tabular-nums">{visible(balance)}</div>
    </div>
    <div className="flex items-center gap-3"><span className="dashboard-icon bg-emerald-50 text-emerald-600 dark:bg-emerald-500/10"><TrendingUp size={19} /></span><div><p className="dashboard-label">Ingresos</p><p className="dashboard-value text-emerald-600 dark:text-emerald-400">{visible(ingresos)}</p></div></div>
    <div className="flex items-center gap-3"><span className="dashboard-icon bg-rose-50 text-rose-500 dark:bg-rose-500/10"><TrendingDown size={19} /></span><div><p className="dashboard-label">Gastos</p><p className="dashboard-value text-rose-500 dark:text-rose-400">{visible(gastos)}</p></div></div>
    <div className="flex items-center gap-3 sm:border-l sm:border-slate-200 sm:pl-5 dark:sm:border-slate-700"><div className="relative grid h-16 w-16 shrink-0 place-items-center rounded-full" style={{ background: `conic-gradient(#35bf8a ${isLocked ? 0 : Math.min(spent, 100)}%, #e2e8f0 0)` }}><div className="grid h-12 w-12 place-items-center rounded-full bg-white text-sm font-black text-slate-800 dark:bg-slate-900 dark:text-white">{isLocked ? '••' : `${spent}%`}</div></div><div><p className="dashboard-value">Gastado</p><p className="text-xs text-slate-500 dark:text-slate-400">sobre tus ingresos</p></div></div>
  </section>;
};
