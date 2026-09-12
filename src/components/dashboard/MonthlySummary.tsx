import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Movimiento } from '../../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from '../../utils/movements';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../hooks/useFinanceData';

export const MonthlySummary: React.FC<{ movimientos: Movimiento[] }> = ({ movimientos }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const values = useMemo(() => { const now = new Date(); const current = movimientos.filter(m => cuentaEnEstadisticas(m)).filter(m => { const date = parseMovimientoDate(m.fecha_operacion); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }); const ingresos = current.filter(m => m.tipo === 'ingreso').reduce((sum, m) => sum + importeEnEstadisticas(m), 0); const gastos = current.filter(m => m.tipo === 'gasto').reduce((sum, m) => sum + importeEnEstadisticas(m), 0); return { ingresos, gastos, neto: ingresos - gastos }; }, [movimientos]);
  const value = (number: number) => isLocked ? '•••• €' : formatCurrency(number);
  const spendRate = values.ingresos > 0 ? Math.min(100, Math.round((values.gastos / values.ingresos) * 100)) : 0;
  return <section className="dashboard-surface self-start p-5"><div className="mb-4 flex items-center gap-3"><span className="dashboard-icon bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><BarChart3 size={18} /></span><div><h3 className="dashboard-heading">Resumen del mes</h3><p className="dashboard-subtitle">Este mes · movimientos reales</p></div></div><div className="space-y-3">{[['Ingresos', values.ingresos, 'text-emerald-600'], ['Gastos', values.gastos, 'text-rose-500'], ['Ahorro neto', values.neto, values.neto >= 0 ? 'text-emerald-600' : 'text-rose-500']].map(([label, amount, color]) => <div key={label as string} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs last:border-0 last:pb-0 dark:border-slate-800"><span className="font-bold text-slate-600 dark:text-slate-300">{label as string}</span><span className={`font-black tabular-nums ${color}`}>{value(amount as number)}</span></div>)}</div><div className="mt-4"><div className="mb-1.5 flex justify-between text-[10px] font-bold uppercase tracking-wider text-slate-400"><span>Gasto sobre ingresos</span><span>{spendRate}%</span></div><div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800"><div className="h-full rounded-full bg-rose-400 transition-[width]" style={{ width: `${spendRate}%` }} /></div></div></section>;
};
