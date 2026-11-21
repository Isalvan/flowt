import { useMemo } from 'react';
import type { Hucha, Movimiento, Suscripcion } from '../../types';
import { groupMovementsByMonth, typicalMonthlyIncome } from '../../utils/periodStats';
import { payrollDates, periodOf, previousPeriod, type InicioPeriodo } from '../../utils/periods';
import { isIncomeSplitError, splitIncome } from '../../utils/incomeSplit';
import { calcMensual } from './subscriptionOptions';

interface FinanceStatsInput {
  chartMovements: Movimiento[];
  huchas: Hucha[];
  suscripciones: Suscripcion[];
  userStats: { total_ingresos: number; total_gastos: number } | null;
  inicioPeriodo: InicioPeriodo;
}

/** Figures derived from the loaded data: totals, typical income, budgets and the six-period chart. */
export const useFinanceStats = ({ chartMovements, huchas, suscripciones, userStats, inicioPeriodo }: FinanceStatsInput) => {
  const totalIngresos = userStats?.total_ingresos ?? 0;
  const totalGastos = userStats?.total_gastos ?? 0;
  const balance = totalIngresos - totalGastos;

  const periodConfig = useMemo(() => ({ inicioPeriodo, nominas: payrollDates(chartMovements) }), [inicioPeriodo, chartMovements]);
  const mediaIngresos = useMemo(() => typicalMonthlyIncome(chartMovements, new Date(), periodConfig), [chartMovements, periodConfig]);

  const huchaMonthlyBudgets = useMemo(() => {
    if (mediaIngresos <= 0) return {};
    try {
      return splitIncome(mediaIngresos, huchas.map(h => ({ ...h }))).saldos;
    } catch (error) {
      // An invalid rule can still be edited; a read-only estimate must not break the screen.
      if (isIncomeSplitError(error)) return {};
      throw error;
    }
  }, [huchas, mediaIngresos]);

  const totalMensualSuscripciones = useMemo(
    () => suscripciones.filter(s => s.activa).reduce((sum, s) => sum + calcMensual(s), 0),
    [suscripciones]
  );

  const principalHucha = useMemo(
    () => huchas.find(h => h.es_principal),
    [huchas]
  );

  const chartData = useMemo(() => {
    const now = new Date();
    const months = Array.from({ length: 6 }, (_, i) => new Date(now.getFullYear(), now.getMonth() - 5 + i, 1));
    if (inicioPeriodo !== 1) {
      let period = periodOf(now, inicioPeriodo, periodConfig.nominas);
      for (let i = 5; i >= 0; i--) {
        months[i] = period.start;
        period = previousPeriod(period, inicioPeriodo, periodConfig.nominas);
      }
    }
    return groupMovementsByMonth(chartMovements, months, periodConfig);
  }, [chartMovements, inicioPeriodo, periodConfig]);

  return {
    totalIngresos,
    mediaIngresos,
    totalGastos,
    balance,
    totalMensualSuscripciones,
    huchaMonthlyBudgets,
    principalHucha,
    chartData,
  };
};
