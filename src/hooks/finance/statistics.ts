import { useMemo } from 'react';
import { typicalMonthlyIncome, groupMovementsByMonth } from '../../utils/periodStats';
import type { FinanceContext } from './context';
import { calcMensual } from './constants';

export const useFinanceStatistics = (context: Pick<
  FinanceContext,
  | 'userStats'
  | 'chartMovements'
  | 'huchas'
  | 'suscripciones'
>) => {
  const { userStats, chartMovements, huchas, suscripciones } = context;


  // Calculations for stats
  const totalIngresos = userStats?.total_ingresos ?? 0;
  const totalGastos = userStats?.total_gastos ?? 0;
  const balance = totalIngresos - totalGastos;

  const mediaIngresos = useMemo(() => typicalMonthlyIncome(chartMovements), [chartMovements]);

  const huchaMonthlyBudgets = useMemo(() => {
    const budgets: Record<string, number> = {};
    if (mediaIngresos <= 0) return budgets;
    
    let remaining = mediaIngresos;
    const activeHuchas = huchas.filter((h) => h.activa !== false);

    // 1. Flat amounts
    activeHuchas.forEach((h) => {
      if (h.tipo_aportacion === 'flat' && remaining > 0) {
        const val = h.valor_aportacion || 0;
        const toAdd = Math.min(val, remaining);
        budgets[h.id] = toAdd;
        remaining -= toAdd;
      }
    });

    // 2. Percentages
    activeHuchas.forEach((h) => {
      if (h.tipo_aportacion === 'porcentaje' && remaining > 0) {
        const perc = h.valor_aportacion || 0;
        const share = mediaIngresos * (perc / 100);
        const toAdd = Math.min(share, remaining);
        budgets[h.id] = (budgets[h.id] || 0) + toAdd;
        remaining -= toAdd;
      }
    });

    // 3. Resto
    const restoHucha =
      activeHuchas.find((h) => h.tipo_aportacion === 'resto') ||
      activeHuchas.find((h) => h.es_principal) ||
      activeHuchas[0];

    if (restoHucha && remaining > 0) {
      budgets[restoHucha.id] = (budgets[restoHucha.id] || 0) + remaining;
    }

    return budgets;
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
    return groupMovementsByMonth(chartMovements, months);
  }, [chartMovements]);

  return { totalIngresos, totalGastos, balance, mediaIngresos, huchaMonthlyBudgets, totalMensualSuscripciones, principalHucha, chartData };
};
