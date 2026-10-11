import React, { useMemo } from 'react';
import { BarChart3 } from 'lucide-react';
import type { Movimiento } from '../../types';
import { cuentaEnEstadisticas, importeEnEstadisticas } from '../../utils/movements';
import { usePrivacy } from '../../context/PrivacyContext';
import { parseMovimientoDate } from '../../utils/periodStats';
import { usePreferences } from '../../context/PreferencesContext';
import { payrollDates, periodOf, periodRangeLabel } from '../../utils/periods';

export const MonthlySummary: React.FC<{ movimientos: Movimiento[] }> = ({ movimientos }) => {
  const { isLocked, formatCurrency } = usePrivacy();
  const { inicioPeriodo } = usePreferences();
  const currentPeriod = useMemo(() => periodOf(new Date(), inicioPeriodo, payrollDates(movimientos)), [movimientos, inicioPeriodo]);
  const values = useMemo(() => {
    const current = movimientos.filter(m => {
      const date = parseMovimientoDate(m.fecha_operacion);
      return cuentaEnEstadisticas(m) && date && date >= currentPeriod.start && date < currentPeriod.end;
    });
    const ingresos = current.filter(m => m.tipo === 'ingreso').reduce((sum, m) => sum + importeEnEstadisticas(m), 0);
    const gastos = current.filter(m => m.tipo === 'gasto').reduce((sum, m) => sum + importeEnEstadisticas(m), 0);
    return { ingresos, gastos, neto: ingresos - gastos };
  }, [movimientos, currentPeriod]);
  const value = (number: number) => isLocked ? '•••• €' : formatCurrency(number);
  const spendRate = values.ingresos > 0 ? Math.min(100, Math.round((values.gastos / values.ingresos) * 100)) : 0;
  const rows: [string, number, string][] = [
    ['Ingresos', values.ingresos, 'text-emerald-600 dark:text-emerald-400'],
    ['Gastos', values.gastos, 'text-rose-500 dark:text-rose-400'],
    ['Ahorro neto', values.neto, values.neto >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-500 dark:text-rose-400'],
  ];
  const meterColor = spendRate >= 85 ? 'text-rose-500' : spendRate >= 65 ? 'text-sun-500' : 'text-emerald-500';
  return (
    <section className="dashboard-surface self-start p-5">
      <div className="mb-4 flex items-center gap-3">
        <span className="dashboard-icon bg-brand-tint text-brand-ink"><BarChart3 size={18} /></span>
        <div className="min-w-0">
          <h3 className="dashboard-heading">{inicioPeriodo === 1 ? 'Resumen del mes' : 'Resumen del periodo'}</h3>
          <p className="dashboard-subtitle">{inicioPeriodo === 1 ? 'Este mes · movimientos reales' : periodRangeLabel(currentPeriod)}</p>
        </div>
      </div>
      <div className="divide-y divide-line">
        {rows.map(([label, amount, color], index) => (
          <div key={label} className={`flex items-center justify-between gap-3 py-2.5 ${index === rows.length - 1 ? 'pb-0' : ''} ${index === 0 ? 'pt-0' : ''}`}>
            <span className={`text-[13px] ${index === rows.length - 1 ? 'font-bold text-ink' : 'text-ink-soft'}`}>{label}</span>
            <span className={`text-[13px] font-extrabold tabular-nums ${color}`}>{value(amount)}</span>
          </div>
        ))}
      </div>
      <div className="mt-5">
        <div className="mb-2.5 flex justify-between text-[11px] text-ink-soft">
          <span>Gasto sobre ingresos</span>
          <span className="font-bold tabular-nums text-ink">{isLocked ? '••' : `${spendRate}%`}</span>
        </div>
        <div className="flow-meter">
          {!isLocked && spendRate > 0 && <i className={meterColor} style={{ width: `${spendRate}%` }} />}
        </div>
      </div>
    </section>
  );
};
