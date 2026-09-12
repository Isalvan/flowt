import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Movimiento } from '../../types';
import { cuentaEnEstadisticas } from '../../utils/movements';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../hooks/useFinanceData';

export const MonthlySummary: React.FC<{ movimientos: Movimiento[] }> = ({ movimientos }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const values = useMemo(() => { const now = new Date(); const current = movimientos.filter(m => cuentaEnEstadisticas(m)).filter(m => { const date = parseMovimientoDate(m.fecha_operacion); return date && date.getMonth() === now.getMonth() && date.getFullYear() === now.getFullYear(); }); const ingresos = current.filter(m => m.tipo === 'ingreso').reduce((sum, m) => sum + m.importe, 0); const gastos = current.filter(m => m.tipo === 'gasto').reduce((sum, m) => sum + m.importe, 0); return { ingresos, gastos, neto: ingresos - gastos }; }, [movimientos]);
  const value = (number: number) => isLocked ? '•••• €' : formatCurrency(number);
  return <section className="dashboard-surface p-5"><div className="mb-4 flex items-center gap-3"><span className="dashboard-icon bg-indigo-50 text-indigo-600 dark:bg-indigo-500/10"><BarChart3 size={18} /></span><div><h3 className="dashboard-heading">Resumen del mes</h3><p className="dashboard-subtitle">Este mes</p></div></div><div className="space-y-3">{[['Ingresos', values.ingresos, 'text-emerald-600'], ['Gastos', values.gastos, 'text-rose-500'], ['Ahorro neto', values.neto, values.neto >= 0 ? 'text-emerald-600' : 'text-rose-500']].map(([label, amount, color]) => <div key={label as string} className="flex items-center justify-between border-b border-slate-100 pb-2 text-xs last:border-0 last:pb-0 dark:border-slate-800"><span className="font-bold text-slate-600 dark:text-slate-300">{label as string}</span><span className={`font-black tabular-nums ${color}`}>{value(amount as number)}</span></div>)}</div></section>;
};
