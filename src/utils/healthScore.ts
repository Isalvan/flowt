import type { Hucha, Movimiento, Suscripcion } from '../types';

export interface HealthMetric {
  id: string;
  label: string;
  score: number; // 0-100
  weight: number; // e.g. 0.30
  valueFormatted: string;
  description: string;
}

export interface HealthScoreResult {
  totalScore: number; // 0-100
  category: 'Excelente' | 'Aceptable' | 'Atención Necesaria';
  colorClass: string;
  metrics: HealthMetric[];
  recommendations: string[];
}

export function calculateFinancialHealthScore(
  movimientos: Movimiento[],
  huchas: Hucha[],
  suscripciones: Suscripcion[],
  totalIngresos: number,
  totalGastos: number
): HealthScoreResult {
  // 1. Ratio Ahorro / Gasto (30%)
  let savingsRatio = 0;
  if (totalIngresos > 0) {
    savingsRatio = Math.max(0, (totalIngresos - totalGastos) / totalIngresos);
  }
  const savingsScore = Math.min(100, Math.round((savingsRatio / 0.30) * 100)); // Target 30% savings

  // 2. Cumplimiento de Huchas y Objetivos (25%)
  const activeHuchas = huchas.filter(h => h.activa !== false);
  let budgetScore = 75; // Base
  if (activeHuchas.length > 0) {
    const healthyHuchas = activeHuchas.filter(h => (h.saldo_acumulado || 0) >= 0);
    budgetScore = Math.round((healthyHuchas.length / activeHuchas.length) * 100);
  }

  // 3. Tendencia del Saldo (25%)
  const netBalance = totalIngresos - totalGastos;
  let trendScore = 50;
  if (netBalance > 0) {
    trendScore = Math.min(100, 75 + Math.round((netBalance / (totalIngresos || 1)) * 25));
  } else if (netBalance < 0) {
    trendScore = Math.max(10, 50 - Math.round((Math.abs(netBalance) / (totalGastos || 1)) * 40));
  }

  // 4. Estabilidad y Control de Suscripciones (20%)
  const totalSubMonthly = suscripciones.reduce((acc, sub) => acc + (sub.activa ? sub.importe : 0), 0);
  const subRatio = totalIngresos > 0 ? (totalSubMonthly / totalIngresos) : 0;
  let subScore = 100;
  if (subRatio > 0.15) {
    subScore = Math.max(20, Math.round(100 - (subRatio - 0.15) * 300));
  }

  // Puntuación Total Ponderada
  const totalScore = Math.round(
    savingsScore * 0.30 +
    budgetScore * 0.25 +
    trendScore * 0.25 +
    subScore * 0.20
  );

  let category: 'Excelente' | 'Aceptable' | 'Atención Necesaria' = 'Excelente';
  let colorClass = 'text-emerald-500 bg-emerald-500/10 border-emerald-500/20';

  if (totalScore < 45) {
    category = 'Atención Necesaria';
    colorClass = 'text-rose-500 bg-rose-500/10 border-rose-500/20';
  } else if (totalScore < 75) {
    category = 'Aceptable';
    colorClass = 'text-amber-500 bg-amber-500/10 border-amber-500/20';
  }

  const metrics: HealthMetric[] = [
    {
      id: 'savings',
      label: 'Ratio de Ahorro Mensual',
      score: savingsScore,
      weight: 0.30,
      valueFormatted: `${(savingsRatio * 100).toFixed(1)}%`,
      description: 'Porcentaje de tus ingresos reservado para ahorro o fondos.'
    },
    {
      id: 'huchas',
      label: 'Salud de Huchas y Fondos',
      score: budgetScore,
      weight: 0.25,
      valueFormatted: `${activeHuchas.length} huchas activas`,
      description: 'Proporción de carteras con saldo positivo y libre de deudas.'
    },
    {
      id: 'trend',
      label: 'Tendencia de Flujo de Caja',
      score: trendScore,
      weight: 0.25,
      valueFormatted: netBalance >= 0 ? `+${netBalance.toFixed(2)} €` : `${netBalance.toFixed(2)} €`,
      description: 'Evolución neta entre ingresos recibidos y gastos realizados.'
    },
    {
      id: 'subscriptions',
      label: 'Control de Suscripciones',
      score: subScore,
      weight: 0.20,
      valueFormatted: `${totalSubMonthly.toFixed(2)} €/mes`,
      description: 'Impacto de gastos recurrentes en tu presupuesto total.'
    }
  ];

  // Generación de 3 Recomendaciones Dinámicas
  const recommendations: string[] = [];

  if (savingsRatio < 0.15) {
    recommendations.push('Incrementa tu tasa de ahorro automatizando un reparto mínimo del 15% de tu nómina a tu hucha principal.');
  } else {
    recommendations.push('¡Excelente hábito de ahorro! Considera destinar el excedente a tu hucha de Inversiones u Objetivos a largo plazo.');
  }

  if (totalSubMonthly > 30) {
    recommendations.push(`Tus suscripciones suman ${totalSubMonthly.toFixed(2)} €/mes. Revisa servicios que no utilices activamente.`);
  } else {
    recommendations.push('Mantienes un nivel de suscripciones fijo muy saludable. Continúa revisando cancelaciones en la vista de Calendario.');
  }

  if (netBalance < 0) {
    recommendations.push('Has gastado más de lo ingresado en este periodo. Revisa movimientos recientes para frenar gastos imprevistos.');
  } else {
    recommendations.push('Tus ingresos cubren con holgura tus gastos. Mantén este equilibrio constante.');
  }

  return {
    totalScore,
    category,
    colorClass,
    metrics,
    recommendations
  };
}
