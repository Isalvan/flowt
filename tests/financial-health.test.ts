import { describe, it, expect } from 'vitest';
import { calculateFinancialHealthScore } from '../src/utils/healthScore';
import type { Hucha, Movimiento, Suscripcion } from '../src/types';

describe('Financial Health Score Dashboard Calculations', () => {
  it('calculates score and category correctly for healthy stats', () => {
    const mockHuchas: Hucha[] = [
      { id: 'h1', nombre: 'Fondo Emergencia', saldo_acumulado: 2000, es_principal: true }
    ];
    const mockMovs: Movimiento[] = [];
    const mockSubs: Suscripcion[] = [];

    const result = calculateFinancialHealthScore(
      mockMovs,
      mockHuchas,
      mockSubs,
      3000, // 3000€ income
      1500  // 1500€ expense -> 50% savings ratio
    );

    expect(result.totalScore).toBeGreaterThanOrEqual(75);
    expect(result.category).toBe('Excelente');
    expect(result.metrics).toHaveLength(4);
    expect(result.recommendations).toHaveLength(3);
  });

  it('handles zero income gracefully without division by zero', () => {
    const result = calculateFinancialHealthScore([], [], [], 0, 0);
    expect(result.totalScore).toBeGreaterThanOrEqual(0);
    expect(result.recommendations).toHaveLength(3);
  });
});
